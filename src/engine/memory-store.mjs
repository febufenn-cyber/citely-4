import { randomUUID } from 'node:crypto';
import { assertItemTransition, assertRunTransition } from './constants.mjs';
import { observationKey } from './ids.mjs';

export class InMemoryMeasurementStore {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.runs = new Map();
    this.items = new Map();
    this.attempts = new Map();
    this.observations = new Map();
    this.reviews = new Map();
    this.scoreCalculations = new Map();
    this.events = [];
  }

  createRun(plan) {
    validateRunPlan(plan);
    if (this.runs.has(plan.id)) throw new Error(`Audit run already exists: ${plan.id}`);
    const now = this.isoNow();
    const frozenPlan = clone(plan);
    const run = {
      id: plan.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brand.id,
      promptPanelVersionId: plan.promptPanelVersionId,
      state: 'approved',
      frozenPlan,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      stopReason: null
    };
    this.runs.set(run.id, run);

    for (const prompt of plan.prompts) {
      for (const profile of plan.providerProfiles) {
        for (let repetition = 1; repetition <= plan.repetitions; repetition += 1) {
          const idempotencyKey = observationKey({
            auditRunId: plan.id,
            promptVersionId: prompt.versionId,
            providerProfileId: profile.id,
            repetition
          });
          this.items.set(idempotencyKey, {
            id: idempotencyKey,
            auditRunId: plan.id,
            promptVersionId: prompt.versionId,
            providerProfileId: profile.id,
            repetition,
            state: 'planned',
            prompt: clone(prompt),
            providerProfile: clone(profile),
            leaseOwner: null,
            leaseExpiresAt: null,
            successfulObservationId: null,
            failure: null,
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }
    this.recordEvent('run_created', { auditRunId: run.id, intendedObservations: this.listItems(run.id).length });
    return clone(run);
  }

  getRun(id) {
    return clone(this.requireRun(id));
  }

  transitionRun(id, nextState, patch = {}) {
    const run = this.requireRun(id);
    assertRunTransition(run.state, nextState);
    run.state = nextState;
    Object.assign(run, clone(patch), { updatedAt: this.isoNow() });
    this.recordEvent('run_transitioned', { auditRunId: id, state: nextState });
    return clone(run);
  }

  listItems(auditRunId) {
    return [...this.items.values()].filter((item) => item.auditRunId === auditRunId).map(clone);
  }

  getItem(id) {
    const item = this.items.get(id);
    return item ? clone(item) : null;
  }

  claimItem(id, owner, leaseMs = 30_000) {
    const item = this.requireItem(id);
    if (item.successfulObservationId) return { claimed: false, reason: 'already_succeeded', item: clone(item) };
    const now = this.clock().getTime();
    const leaseExpiry = item.leaseExpiresAt ? new Date(item.leaseExpiresAt).getTime() : 0;
    if (item.leaseOwner && leaseExpiry > now && item.leaseOwner !== owner) {
      return { claimed: false, reason: 'leased', item: clone(item) };
    }
    if (!['planned', 'retry_scheduled', 'terminal_failure', 'attempting'].includes(item.state)) {
      return { claimed: false, reason: `state_${item.state}`, item: clone(item) };
    }
    if (item.state !== 'attempting') this.transitionItem(id, 'attempting');
    item.leaseOwner = owner;
    item.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    item.updatedAt = this.isoNow();
    return { claimed: true, item: clone(item) };
  }

  releaseLease(id, owner) {
    const item = this.requireItem(id);
    if (item.leaseOwner !== owner) return false;
    item.leaseOwner = null;
    item.leaseExpiresAt = null;
    item.updatedAt = this.isoNow();
    return true;
  }

  transitionItem(id, nextState, patch = {}) {
    const item = this.requireItem(id);
    assertItemTransition(item.state, nextState);
    item.state = nextState;
    Object.assign(item, clone(patch), { updatedAt: this.isoNow() });
    this.recordEvent('item_transitioned', { auditRunId: item.auditRunId, itemId: id, state: nextState });
    return clone(item);
  }

  createAttempt(itemId, data = {}) {
    const item = this.requireItem(itemId);
    const attemptNumber = this.listAttempts(itemId).length + 1;
    const attempt = {
      id: randomUUID(),
      itemId,
      auditRunId: item.auditRunId,
      attemptNumber,
      state: 'running',
      startedAt: this.isoNow(),
      completedAt: null,
      ...clone(data)
    };
    this.attempts.set(attempt.id, attempt);
    this.recordEvent('attempt_started', { auditRunId: item.auditRunId, itemId, attemptId: attempt.id, attemptNumber });
    return clone(attempt);
  }

  completeAttempt(attemptId, data) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error(`Unknown attempt: ${attemptId}`);
    if (attempt.state !== 'running') return clone(attempt);
    Object.assign(attempt, clone(data), { completedAt: this.isoNow() });
    this.recordEvent('attempt_completed', { auditRunId: attempt.auditRunId, itemId: attempt.itemId, attemptId, state: attempt.state });
    return clone(attempt);
  }

  listAttempts(itemId) {
    return [...this.attempts.values()].filter((attempt) => attempt.itemId === itemId).sort((a, b) => a.attemptNumber - b.attemptNumber).map(clone);
  }

  saveObservation(itemId, observation) {
    const item = this.requireItem(itemId);
    if (this.observations.has(itemId)) throw new Error(`Immutable observation already exists for item: ${itemId}`);
    const stored = {
      id: observation.id ?? randomUUID(),
      itemId,
      auditRunId: item.auditRunId,
      observationKey: item.id,
      createdAt: this.isoNow(),
      ...clone(observation)
    };
    this.observations.set(itemId, stored);
    item.successfulObservationId = stored.id;
    item.failure = null;
    if (item.state === 'attempting') this.transitionItem(itemId, 'review_required');
    else if (item.state === 'succeeded') this.transitionItem(itemId, 'review_required');
    this.recordEvent('observation_saved', { auditRunId: item.auditRunId, itemId, observationId: stored.id });
    return clone(stored);
  }

  getObservation(itemId) {
    const observation = this.observations.get(itemId);
    return observation ? clone(observation) : null;
  }

  addReview(itemId, review) {
    const item = this.requireItem(itemId);
    if (!this.observations.has(itemId)) throw new Error(`Cannot review item without observation: ${itemId}`);
    const decision = {
      id: randomUUID(),
      itemId,
      auditRunId: item.auditRunId,
      createdAt: this.isoNow(),
      ...clone(review)
    };
    const list = this.reviews.get(itemId) ?? [];
    list.push(decision);
    this.reviews.set(itemId, list);
    const state = review.decision === 'accepted' ? 'accepted' : review.decision === 'corrected' ? 'corrected' : 'excluded';
    this.transitionItem(itemId, state);
    this.recordEvent('review_recorded', { auditRunId: item.auditRunId, itemId, decision: review.decision });
    return clone(decision);
  }

  latestReview(itemId) {
    const list = this.reviews.get(itemId) ?? [];
    return list.length ? clone(list.at(-1)) : null;
  }

  saveScoreCalculation(calculation) {
    const id = calculation.id ?? randomUUID();
    if (this.scoreCalculations.has(id)) throw new Error(`Score calculation already exists: ${id}`);
    const stored = { id, createdAt: this.isoNow(), ...clone(calculation) };
    this.scoreCalculations.set(id, stored);
    this.recordEvent('score_calculated', { auditRunId: calculation.auditRunId, calculationId: id, scoringModelVersion: calculation.scoringModelVersion });
    return clone(stored);
  }

  listEvents(auditRunId) {
    return this.events.filter((event) => !auditRunId || event.auditRunId === auditRunId).map(clone);
  }

  snapshotRun(auditRunId) {
    const items = this.listItems(auditRunId).map((item) => ({
      ...item,
      attempts: this.listAttempts(item.id),
      observation: this.getObservation(item.id),
      review: this.latestReview(item.id)
    }));
    return {
      run: this.getRun(auditRunId),
      items,
      scoreCalculations: [...this.scoreCalculations.values()].filter((item) => item.auditRunId === auditRunId).map(clone),
      events: this.listEvents(auditRunId)
    };
  }

  isoNow() {
    return this.clock().toISOString();
  }

  recordEvent(type, data) {
    this.events.push({ id: randomUUID(), type, occurredAt: this.isoNow(), ...clone(data) });
  }

  requireRun(id) {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown audit run: ${id}`);
    return run;
  }

  requireItem(id) {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown audit run item: ${id}`);
    return item;
  }
}

function validateRunPlan(plan) {
  if (!plan?.id || !plan?.workspaceId || !plan?.brand?.id || !plan?.promptPanelVersionId) throw new Error('Run plan is missing identity fields');
  if (!Array.isArray(plan.prompts) || !plan.prompts.length) throw new Error('Run plan must contain prompts');
  if (!Array.isArray(plan.providerProfiles) || !plan.providerProfiles.length) throw new Error('Run plan must contain provider profiles');
  if (!Number.isInteger(plan.repetitions) || plan.repetitions < 1) throw new Error('Run plan repetitions must be a positive integer');
  const promptIds = new Set();
  for (const prompt of plan.prompts) {
    if (!prompt.versionId || !prompt.text || !prompt.stage || !Number.isFinite(prompt.importance)) throw new Error('Prompt versions require versionId, text, stage, and importance');
    if (promptIds.has(prompt.versionId)) throw new Error(`Duplicate prompt version: ${prompt.versionId}`);
    promptIds.add(prompt.versionId);
  }
  const profileIds = new Set();
  for (const profile of plan.providerProfiles) {
    if (!profile.id || !profile.provider || !profile.model) throw new Error('Provider profiles require id, provider, and model');
    if (profileIds.has(profile.id)) throw new Error(`Duplicate provider profile: ${profile.id}`);
    profileIds.add(profile.id);
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
