import { executeProvider, estimateItemCostMicros, type RunItem } from './provider';
import { SupabaseRest } from './supabase';
import { classifyOwnership, classifyWorkerFailure, eventWorkerId, extractCandidate, extractMentions, safeDomain } from './workflow-helpers';
import type { AuditRun, Env } from './workflow-types';

export async function executeAuditItem(db: SupabaseRest, env: Env, run: AuditRun, item: RunItem) {
  if ((item as any).successful_observation_id) return { status: 'already_succeeded' };
  const claimed = await db.rpc<any[]>('claim_audit_run_item', { p_item_id: item.id, p_worker_id: run.id, p_lease_seconds: 180 });
  if (!claimed.length) {
    const existing = await db.select<{ id: string }>('observations', `audit_run_item_id=eq.${encodeURIComponent(item.id)}&select=id&limit=1`);
    return { status: existing.length ? 'already_succeeded' : 'not_claimed' };
  }

  const estimateMicros = estimateItemCostMicros(item);
  const currentRun = await db.one<{ actual_cost_micros: number; audit_budget_micros: number }>('audit_runs', `id=eq.${encodeURIComponent(run.id)}&select=actual_cost_micros,audit_budget_micros`);
  if (Number(currentRun.actual_cost_micros) + estimateMicros > Number(currentRun.audit_budget_micros)) {
    await db.insert('budget_events', {
      workspace_id: run.workspace_id,
      audit_run_id: run.id,
      audit_run_item_id: item.id,
      event_type: 'rejected',
      scope: 'audit',
      amount_micros: estimateMicros,
      metadata: { remaining_micros: Number(currentRun.audit_budget_micros) - Number(currentRun.actual_cost_micros) }
    });
    await db.patch('audit_run_items', `id=eq.${encodeURIComponent(item.id)}`, { state: 'planned', lease_owner: null, lease_expires_at: null });
    return { status: 'budget_stopped' };
  }

  const latestAttempts = await db.select<{ attempt_number: number }>('observation_attempts', `audit_run_item_id=eq.${encodeURIComponent(item.id)}&select=attempt_number&order=attempt_number.desc&limit=1`);
  const attemptNumber = (latestAttempts[0]?.attempt_number ?? 0) + 1;
  const [attempt] = await db.insert<{ id: string }>('observation_attempts', {
    workspace_id: run.workspace_id,
    audit_run_id: run.id,
    audit_run_item_id: item.id,
    attempt_number: attemptNumber,
    state: 'running',
    worker_id: eventWorkerId(run.id),
    requested_provider: item.provider_profiles.provider,
    requested_model: item.provider_profiles.requested_model,
    estimate_micros: estimateMicros
  });

  const started = Date.now();
  try {
    const result = await executeProvider(item, env);
    const existing = await db.select<{ id: string }>('observations', `audit_run_item_id=eq.${encodeURIComponent(item.id)}&select=id&limit=1`);
    let observationId = existing[0]?.id;
    if (!observationId) {
      const [observation] = await db.insert<{ id: string }>('observations', {
        workspace_id: run.workspace_id,
        audit_run_id: run.id,
        audit_run_item_id: item.id,
        observation_key: item.idempotency_key,
        requested_provider: item.provider_profiles.provider,
        requested_model: item.provider_profiles.requested_model,
        reported_provider: result.provider,
        reported_model: result.reportedModel,
        provider_request_id: result.providerRequestId,
        search_mode: result.searchMode,
        search_performed: result.searchPerformed,
        geography: item.provider_profiles.geography,
        locale: item.provider_profiles.locale,
        answer_text: result.answerText,
        usage: result.usage,
        raw_response: result.rawResponse,
        latency_ms: Date.now() - started,
        cost_micros: result.costMicros,
        automated_classification: extractCandidate(result.answerText, run.frozen_configuration.brand, run.frozen_configuration.competitors)
      });
      observationId = observation.id;
      const mentions = extractMentions(result.answerText, run.frozen_configuration.brand, run.frozen_configuration.competitors);
      if (mentions.length) await db.insert('entity_mentions', mentions.map((mention) => ({
        workspace_id: run.workspace_id,
        observation_id: observationId,
        entity_kind: mention.entityKind,
        entity_id: mention.entityId,
        alias: mention.alias,
        character_start: mention.start,
        character_end: mention.end,
        machine_confidence: mention.confidence,
        context_label: 'unreviewed'
      })));
      const sources = [
        ...result.sources.map((source) => ({ ...source, source_kind: 'retrieved' })),
        ...result.citations.map((source) => ({ ...source, source_kind: 'inline_citation' }))
      ];
      if (sources.length) await db.insert('response_sources', sources.map((source) => ({
        workspace_id: run.workspace_id,
        observation_id: observationId,
        url: source.url,
        title: source.title ?? null,
        domain: safeDomain(source.url),
        source_kind: source.source_kind,
        ownership: classifyOwnership(source.url, run.frozen_configuration.brand, run.frozen_configuration.competitors),
        citation_start: (source as any).start ?? null,
        citation_end: (source as any).end ?? null
      })));
    }

    await db.patch('observation_attempts', `id=eq.${encodeURIComponent(attempt.id)}`, {
      state: 'succeeded',
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
      actual_micros: result.costMicros,
      provider_request_id: result.providerRequestId
    });
    await db.patch('audit_run_items', `id=eq.${encodeURIComponent(item.id)}`, {
      state: 'review_required',
      successful_observation_id: observationId,
      lease_owner: null,
      lease_expires_at: null,
      failure: null
    });
    await db.patch('audit_runs', `id=eq.${encodeURIComponent(run.id)}`, {
      actual_cost_micros: Number(currentRun.actual_cost_micros) + result.costMicros
    });
    await db.insert('budget_events', {
      workspace_id: run.workspace_id,
      audit_run_id: run.id,
      audit_run_item_id: item.id,
      event_type: 'committed',
      scope: 'audit',
      amount_micros: result.costMicros,
      metadata: { estimate_micros: estimateMicros }
    });
    return { status: 'succeeded', observationId };
  } catch (error) {
    const classification = classifyWorkerFailure(error);
    await db.patch('observation_attempts', `id=eq.${encodeURIComponent(attempt.id)}`, {
      state: 'failed',
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
      failure: classification,
      error: { name: (error as Error).name, message: (error as Error).message }
    });
    await db.patch('audit_run_items', `id=eq.${encodeURIComponent(item.id)}`, {
      state: classification.retryable ? 'retry_scheduled' : 'terminal_failure',
      lease_owner: null,
      lease_expires_at: null,
      failure: classification
    });
    if (!classification.retryable) return { status: 'terminal_failure' };
    throw error;
  }
}
