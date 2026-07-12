import test from 'node:test';
import assert from 'node:assert/strict';
import { CostGuard } from '../src/engine/costs.mjs';
import { assertRunTransition } from '../src/engine/constants.mjs';
import { extractCandidate, validateProviderObservation } from '../src/engine/extraction.mjs';
import { ProviderExecutionError } from '../src/engine/failures.mjs';
import { observationKey, stableKey } from '../src/engine/ids.mjs';
import { MeasurementEngine } from '../src/engine/measurement-engine.mjs';
import { InMemoryMeasurementStore } from '../src/engine/memory-store.mjs';
import { calculateReviewedScores, finalizeReviewedRun, submitReview } from '../src/engine/review.mjs';
import { createDemoPlan, DemoProvider, runPhase1Demo } from '../src/phase1-demo.mjs';

function createHarness({ provider, limit = 100_000, retryLimit = 2 } = {}) {
  const plan = createDemoPlan();
  plan.providerProfiles = [plan.providerProfiles[0]];
  plan.prompts = [plan.prompts[0]];
  plan.repetitions = 1;
  const store = new InMemoryMeasurementStore();
  store.createRun(plan);
  const selected = provider ?? new DemoProvider({ name: 'mock-grounded' });
  const providers = new Map([[selected.name, selected]]);
  plan.providerProfiles[0].provider = selected.name;
  // Recreate because the store freezes the original profile.
  const freshStore = new InMemoryMeasurementStore();
  freshStore.createRun(plan);
  const costGuard = new CostGuard({ auditLimitMicros: limit });
  const engine = new MeasurementEngine({ store: freshStore, providers, costGuard, retryLimit, sleep: async () => {} });
  return { plan, store: freshStore, provider: selected, costGuard, engine, item: freshStore.listItems(plan.id)[0] };
}

test('stable idempotency keys are deterministic and dimension-sensitive', () => {
  assert.equal(stableKey('a', { b: 1, a: 2 }), stableKey('a', { a: 2, b: 1 }));
  const first = observationKey({ auditRunId: 'run', promptVersionId: 'p1', providerProfileId: 'provider', repetition: 1 });
  const second = observationKey({ auditRunId: 'run', promptVersionId: 'p1', providerProfileId: 'provider', repetition: 2 });
  assert.notEqual(first, second);
});

test('run state machine rejects unsafe transitions', () => {
  assert.throws(() => assertRunTransition('draft', 'ready'), /Invalid audit run transition/);
  assert.doesNotThrow(() => assertRunTransition('running', 'awaiting_review'));
});

test('store creates the full prompt × provider × repetition plan', () => {
  const plan = createDemoPlan();
  const store = new InMemoryMeasurementStore();
  store.createRun(plan);
  assert.equal(store.listItems(plan.id).length, 8);
  assert.equal(new Set(store.listItems(plan.id).map((item) => item.id)).size, 8);
});

test('lease prevents two workers from claiming the same item', () => {
  const { store, item } = createHarness();
  assert.equal(store.claimItem(item.id, 'worker-a', 60_000).claimed, true);
  const second = store.claimItem(item.id, 'worker-b', 60_000);
  assert.equal(second.claimed, false);
  assert.equal(second.reason, 'leased');
});

test('retryable provider failure creates attempts but one immutable observation', async () => {
  const provider = new DemoProvider({ name: 'mock-grounded' });
  const harness = createHarness({ provider });
  provider.failFirstKeys.add(harness.item.id);
  const result = await harness.engine.executeRun(harness.plan.id);
  assert.equal(result.state, 'awaiting_review');
  assert.equal(harness.store.listAttempts(harness.item.id).length, 2);
  assert.ok(harness.store.getObservation(harness.item.id));
  assert.throws(() => harness.store.saveObservation(harness.item.id, { answerText: 'overwrite' }), /Immutable observation/);
});

test('re-executing a successful item does not call the provider again', async () => {
  const harness = createHarness();
  await harness.engine.executeItem(harness.item.id);
  const callsBefore = harness.provider.calls.get(harness.item.id);
  const duplicate = await harness.engine.executeItem(harness.item.id);
  assert.equal(duplicate.status, 'already_succeeded');
  assert.equal(harness.provider.calls.get(harness.item.id), callsBefore);
});

test('terminal failures never count as brand absence', async () => {
  const provider = {
    name: 'mock-grounded',
    async execute() { throw new ProviderExecutionError('Invalid key', { status: 401, code: 'auth_error' }); }
  };
  const harness = createHarness({ provider });
  const result = await harness.engine.executeRun(harness.plan.id);
  assert.equal(result.state, 'failed');
  const item = harness.store.getItem(harness.item.id);
  assert.equal(item.failure.countsAsBrandAbsence, false);
  assert.equal(harness.store.getObservation(harness.item.id), null);
});

test('budget guard stops before the provider call and records no absence', async () => {
  const harness = createHarness({ limit: 100 });
  const result = await harness.engine.executeRun(harness.plan.id);
  assert.equal(result.state, 'budget_stopped');
  assert.equal(harness.provider.calls.size, 0);
  assert.equal(harness.store.getObservation(harness.item.id), null);
});

test('provider observations require usable evidence', () => {
  assert.throws(() => validateProviderObservation({ provider: 'x', requestedModel: 'm', answerText: '' }), /empty answer/);
  assert.equal(validateProviderObservation({ provider: 'x', requestedModel: 'm', answerText: 'ok', citations: [], sources: [] }).answerText, 'ok');
});

test('entity extraction leaves final recommendation strength for review', () => {
  const plan = createDemoPlan();
  const candidate = extractCandidate({
    answerText: 'Citely is relevant. BrightReach is also considered.',
    brand: plan.brand,
    competitors: plan.competitors,
    citations: [{ url: 'https://citely.example/a' }]
  });
  assert.equal(candidate.brand.mentioned, true);
  assert.equal(candidate.brandFirst, true);
  assert.equal(candidate.requiresHumanReview, true);
  assert.equal(candidate.citationSummary.brandOwned, 1);
});

test('review corrections, not machine guesses, drive scoring', async () => {
  const harness = createHarness();
  await harness.engine.executeRun(harness.plan.id);
  submitReview({
    store: harness.store,
    itemId: harness.item.id,
    reviewerId: 'reviewer-1',
    decision: 'corrected',
    correction: { mentionStatus: 0, brandMentioned: false, brandFirst: false, reason: 'citation-title-only' }
  });
  const calculation = calculateReviewedScores({ store: harness.store, auditRunId: harness.plan.id });
  assert.equal(calculation.metrics.mentionRate, 0);
  assert.equal(calculation.metrics.weightedVisibility, 0);
});

test('a fully reviewed run becomes ready with versioned scores', async () => {
  const harness = createHarness();
  await harness.engine.executeRun(harness.plan.id);
  submitReview({ store: harness.store, itemId: harness.item.id, reviewerId: 'reviewer-1', decision: 'accepted' });
  const ready = finalizeReviewedRun({ store: harness.store, auditRunId: harness.plan.id });
  assert.equal(ready.state, 'ready');
  const snapshot = harness.store.snapshotRun(harness.plan.id);
  assert.equal(snapshot.scoreCalculations[0].scoringModelVersion, 'visibility-v1');
  assert.equal(snapshot.scoreCalculations[0].metrics.reviewCompletion, 1);
});

test('complete Phase 1 demo survives a retry and reaches ready', async () => {
  const result = await runPhase1Demo('/tmp/citely-phase1-test-output');
  assert.equal(result.finalized.state, 'ready');
  assert.equal(result.snapshot.items.length, 8);
  assert.equal(result.snapshot.items.filter((item) => item.state === 'accepted').length, 8);
  assert.ok(result.snapshot.items.some((item) => item.attempts.length === 2));
  assert.equal(result.snapshot.scoreCalculations[0].metrics.completeness, 1);
});
