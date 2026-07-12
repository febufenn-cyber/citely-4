import { randomUUID } from 'node:crypto';
import { BudgetExceededError, estimateObservationCost, reconcileObservationCost } from './costs.mjs';
import { extractCandidate, validateProviderObservation } from './extraction.mjs';
import { classifyFailure } from './failures.mjs';

export class MeasurementEngine {
  constructor({ store, providers, costGuard, workerId = `worker-${randomUUID()}`, retryLimit = 3, leaseMs = 30_000, sleep = defaultSleep, clock = () => new Date() }) {
    if (!store || !providers || !costGuard) throw new Error('MeasurementEngine requires store, providers, and costGuard');
    this.store = store;
    this.providers = providers;
    this.costGuard = costGuard;
    this.workerId = workerId;
    this.retryLimit = retryLimit;
    this.leaseMs = leaseMs;
    this.sleep = sleep;
    this.clock = clock;
  }

  async executeRun(auditRunId) {
    const run = this.store.getRun(auditRunId);
    if (!['approved', 'queued', 'running', 'budget_stopped', 'failed', 'awaiting_review', 'partially_failed'].includes(run.state)) {
      throw new Error(`Cannot execute run from state ${run.state}`);
    }
    if (run.state !== 'running') this.store.transitionRun(auditRunId, 'running', { startedAt: run.startedAt ?? this.clock().toISOString(), stopReason: null });

    let budgetStopped = false;
    for (const item of this.store.listItems(auditRunId)) {
      if (['review_required', 'accepted', 'corrected', 'excluded'].includes(item.state) || item.successfulObservationId) continue;
      try {
        await this.executeItem(item.id);
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          budgetStopped = true;
          break;
        }
        throw error;
      }
    }

    const items = this.store.listItems(auditRunId);
    const terminalFailures = items.filter((item) => item.state === 'terminal_failure').length;
    const successful = items.filter((item) => item.successfulObservationId).length;
    if (budgetStopped) return this.store.transitionRun(auditRunId, 'budget_stopped', { stopReason: 'budget_exceeded', costSnapshot: this.costGuard.snapshot() });
    if (successful === 0 && terminalFailures > 0) return this.store.transitionRun(auditRunId, 'failed', { stopReason: 'all_observations_failed', costSnapshot: this.costGuard.snapshot() });
    if (terminalFailures > 0) return this.store.transitionRun(auditRunId, 'partially_failed', { stopReason: 'one_or_more_terminal_failures', costSnapshot: this.costGuard.snapshot() });
    return this.store.transitionRun(auditRunId, 'awaiting_review', { costSnapshot: this.costGuard.snapshot() });
  }

  async executeItem(itemId) {
    const existing = this.store.getObservation(itemId);
    if (existing) return { status: 'already_succeeded', observation: existing };

    const claim = this.store.claimItem(itemId, this.workerId, this.leaseMs);
    if (!claim.claimed) return { status: claim.reason, item: claim.item };
    const item = claim.item;
    const provider = this.providers.get(item.providerProfile.provider);
    if (!provider) {
      this.store.transitionItem(itemId, 'terminal_failure', { failure: { category: 'provider_not_registered', countsAsBrandAbsence: false } });
      this.store.releaseLease(itemId, this.workerId);
      return { status: 'terminal_failure' };
    }

    const estimateMicros = provider.estimateCost
      ? await provider.estimateCost(this.requestFor(item))
      : estimateObservationCost(item.providerProfile, item.prompt);
    try {
      this.costGuard.reserve(item.id, estimateMicros);
    } catch (error) {
      this.store.releaseLease(itemId, this.workerId);
      throw error;
    }

    try {
      for (let attemptIndex = 0; attemptIndex <= this.retryLimit; attemptIndex += 1) {
        const attempt = this.store.createAttempt(itemId, {
          workerId: this.workerId,
          requestedProvider: item.providerProfile.provider,
          requestedModel: item.providerProfile.model,
          estimateMicros
        });
        const started = this.clock().getTime();
        try {
          const result = validateProviderObservation(await provider.execute(this.requestFor(item)));
          const latencyMs = Math.max(0, this.clock().getTime() - started);
          const actualMicros = reconcileObservationCost(item.providerProfile, result, estimateMicros);
          const observation = this.store.saveObservation(itemId, {
            requestedProvider: item.providerProfile.provider,
            requestedModel: item.providerProfile.model,
            reportedProvider: result.provider,
            reportedModel: result.reportedModel ?? result.requestedModel,
            providerRequestId: result.providerRequestId ?? null,
            searchMode: result.searchMode ?? item.providerProfile.searchMode ?? 'unknown',
            searchPerformed: result.searchPerformed ?? null,
            geography: result.geography ?? item.providerProfile.geography ?? null,
            locale: item.providerProfile.locale ?? null,
            answerText: result.answerText,
            citations: result.citations,
            sources: result.sources,
            usage: result.usage ?? null,
            rawResponse: result.rawResponse ?? null,
            latencyMs,
            costMicros: actualMicros,
            automatedClassification: extractCandidate({
              answerText: result.answerText,
              brand: this.store.getRun(item.auditRunId).frozenPlan.brand,
              competitors: this.store.getRun(item.auditRunId).frozenPlan.competitors,
              citations: result.citations
            })
          });
          this.store.completeAttempt(attempt.id, { state: 'succeeded', latencyMs, actualMicros, providerRequestId: result.providerRequestId ?? null });
          this.costGuard.commit(item.id, actualMicros);
          this.store.releaseLease(itemId, this.workerId);
          return { status: 'succeeded', observation };
        } catch (error) {
          const failure = classifyFailure(error);
          this.store.completeAttempt(attempt.id, {
            state: 'failed',
            latencyMs: Math.max(0, this.clock().getTime() - started),
            failure,
            error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) }
          });
          const recommendedLimit = failure.maxRecommendedAttempts ?? this.retryLimit + 1;
          const canRetry = failure.retryable && attemptIndex + 1 < Math.min(this.retryLimit + 1, recommendedLimit);
          if (canRetry) {
            this.store.transitionItem(itemId, 'retry_scheduled', { failure });
            await this.sleep(backoffMs(attemptIndex));
            this.store.transitionItem(itemId, 'attempting');
            continue;
          }
          this.store.transitionItem(itemId, 'terminal_failure', { failure });
          this.costGuard.release(item.id, failure.category);
          this.store.releaseLease(itemId, this.workerId);
          return { status: 'terminal_failure', failure };
        }
      }
    } catch (error) {
      this.costGuard.release(item.id, 'engine_error');
      this.store.releaseLease(itemId, this.workerId);
      if (error instanceof BudgetExceededError) throw error;
      throw error;
    }
    throw new Error('Unreachable item execution path');
  }

  requestFor(item) {
    const run = this.store.getRun(item.auditRunId);
    return {
      observationKey: item.id,
      auditRunId: item.auditRunId,
      promptVersionId: item.promptVersionId,
      promptId: item.prompt.id,
      prompt: item.prompt.text,
      stage: item.prompt.stage,
      importance: item.prompt.importance,
      repetition: item.repetition,
      providerProfile: item.providerProfile,
      brand: run.frozenPlan.brand,
      competitors: run.frozenPlan.competitors,
      geography: item.providerProfile.geography ?? run.frozenPlan.geography,
      locale: item.providerProfile.locale ?? run.frozenPlan.locale
    };
  }
}

function backoffMs(attemptIndex) {
  return Math.min(10_000, 250 * (2 ** attemptIndex));
}

async function defaultSleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
