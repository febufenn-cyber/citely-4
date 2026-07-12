import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { SupabaseRest } from './supabase';
import { executeAuditItem } from './workflow-item';
import type { AuditRun, Env, WorkflowParams } from './workflow-types';
export type { Env } from './workflow-types';

export class AuditWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const db = new SupabaseRest(this.env);
    const auditRunId = event.payload.auditRunId;

    const plan = await step.do('load frozen audit plan', async () => {
      return await db.one<AuditRun>('audit_runs', [
        `id=eq.${encodeURIComponent(auditRunId)}`,
        'select=id,workspace_id,state,audit_budget_micros,actual_cost_micros,frozen_configuration,audit_run_items(id,idempotency_key,repetition,state,successful_observation_id,prompt_versions(id,text,stage,importance,locale,geography),provider_profiles(id,provider,requested_model,search_mode,geography,locale,options,cost_config))'
      ].join('&'));
    });

    await step.do('mark audit running', async () => {
      await db.patch('audit_runs', `id=eq.${encodeURIComponent(auditRunId)}`, {
        state: 'running',
        started_at: new Date().toISOString(),
        workflow_instance_id: event.instanceId,
        stop_reason: null
      });
      return { state: 'running' };
    });

    let budgetStopped = false;
    for (const item of plan.audit_run_items) {
      let result: { status: string };
      try {
        result = await step.do(
          `observation ${item.id}`,
          { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
          async () => await executeAuditItem(db, this.env, plan, item)
        );
      } catch (error) {
        result = await step.do(`terminalize exhausted observation ${item.id}`, async () => {
          const failure = { category: 'retry_exhausted', retryable: false, counts_as_brand_absence: false, summary: error instanceof Error ? error.message : String(error) };
          await db.patch('audit_run_items', `id=eq.${encodeURIComponent(item.id)}`, {
            state: 'terminal_failure', lease_owner: null, lease_expires_at: null, failure
          });
          return { status: 'terminal_failure' };
        });
      }
      if (result.status === 'budget_stopped') {
        budgetStopped = true;
        break;
      }
    }

    return await step.do('finalize execution state', async () => {
      const items = await db.select<{ state: string; successful_observation_id: string | null }>('audit_run_items', `audit_run_id=eq.${encodeURIComponent(auditRunId)}&select=state,successful_observation_id`);
      const terminalFailures = items.filter((item) => item.state === 'terminal_failure').length;
      const successes = items.filter((item) => item.successful_observation_id).length;
      const state = budgetStopped ? 'budget_stopped' : successes === 0 && terminalFailures ? 'failed' : terminalFailures ? 'partially_failed' : 'awaiting_review';
      await db.patch('audit_runs', `id=eq.${encodeURIComponent(auditRunId)}`, {
        state,
        stop_reason: budgetStopped ? 'budget_exceeded' : terminalFailures ? 'one_or_more_terminal_failures' : null
      });
      return { state, successes, terminalFailures, intended: items.length };
    });
  }
}
