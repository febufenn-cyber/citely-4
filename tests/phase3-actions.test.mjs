import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionBoard, compareMethodology, createExperimentPlan, evaluateExperiment,
  methodologyFingerprint, prioritizeFindings, transitionExperiment, transitionIntervention,
  validateExperimentPlan
} from '../src/phase3/actions.mjs';

function snapshot({ id = 'report-current', statuses = [0, 0, 0], completeness = 1, model = 'model-a', promptPanel = 'panel-1', volatile = false } = {}) {
  const intended = Math.max(statuses.length, Math.round(statuses.length / completeness));
  return {
    reportVersionId: id,
    publicationState: 'published',
    generatedAt: '2026-07-13T10:00:00.000Z',
    methodology: {
      promptPanelVersionId: promptPanel,
      providerProfilesFingerprint: 'providers-1',
      reportedModelsFingerprint: model,
      searchModesFingerprint: 'web',
      geographyFingerprint: 'india',
      localeFingerprint: 'en-in',
      scoringModelVersion: 'visibility-v1',
      repetitions: 1
    },
    auditRun: { intendedObservations: intended, successfulObservations: statuses.length, terminalFailures: intended - statuses.length, excludedObservations: 0 },
    evidence: statuses.map((status, index) => ({
      observationId: `o-${id}-${index}`,
      prompt: { id: `p-${index}`, stableKey: `target-${index}`, text: `Target prompt ${index}`, importance: 5 },
      provider: { profileId: 'provider-1', name: 'openai', searchMode: 'web' },
      reviewedClassification: { mention_status: status },
      stability: volatile && index === 0 ? 'volatile' : 'stable'
    }))
  };
}

function planInput(baseline = snapshot({ id: 'baseline' })) {
  return {
    workspaceId: 'w1', brandId: 'b1', findingId: 'f1', interventionId: 'i1',
    baselineReportVersionId: baseline.reportVersionId,
    baselineSnapshot: baseline,
    hypothesis: 'Publishing an evidence-backed comparison page will improve target prompt visibility.',
    mechanism: 'The page gives answer engines a clearer independent comparison target.',
    targetPromptKeys: ['target-0', 'target-1', 'target-2'],
    targetProviders: ['openai'],
    primaryMetric: 'average_mention_status', minimumDelta: 1,
    minimumCompleteness: 0.8, minimumSampleSize: 3
  };
}

function implementedIntervention() { return { id: 'i1', findingId: 'f1', state: 'implemented', implementedAt: '2026-07-01T00:00:00.000Z' }; }

test('validates a complete experiment plan', () => assert.equal(validateExperimentPlan(planInput()), true));
test('rejects a plan without a hypothesis', () => assert.throws(() => validateExperimentPlan({ ...planInput(), hypothesis: '' }), /hypothesis is required/));
test('freezes baseline methodology and metric', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 1, 2] });
  const plan = createExperimentPlan(planInput(baseline));
  assert.equal(plan.baselineReportVersionId, 'baseline');
  assert.equal(plan.baselineValue, 1);
  assert.equal(plan.baselineMethodologyFingerprint, methodologyFingerprint(baseline));
  assert.equal(Object.isFrozen(plan), true);
});
test('enforces intervention state transitions', () => {
  const approved = transitionIntervention({ id: 'i1', state: 'draft' }, 'approved', { at: '2026-07-01T00:00:00.000Z' });
  const started = transitionIntervention(approved, 'in_progress', { at: '2026-07-02T00:00:00.000Z' });
  const implemented = transitionIntervention(started, 'implemented', { implementedAt: '2026-07-03T00:00:00.000Z' });
  assert.equal(implemented.state, 'implemented');
  assert.throws(() => transitionIntervention({ state: 'draft' }, 'implemented'), /Invalid intervention transition/);
});
test('enforces experiment state transitions', () => {
  const plan = createExperimentPlan(planInput());
  const approved = transitionExperiment(plan, 'approved');
  const running = transitionExperiment(approved, 'running');
  assert.equal(running.state, 'running');
  assert.throws(() => transitionExperiment(plan, 'evaluated'), /Invalid experiment transition/);
});
test('marks a comparable target improvement as success without claiming proof', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 0, 0] });
  const current = snapshot({ id: 'current', statuses: [2, 2, 2] });
  const plan = createExperimentPlan(planInput(baseline));
  const result = evaluateExperiment({ plan, baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{ url: 'https://example.com/new-page' }] });
  assert.equal(result.outcome, 'success');
  assert.equal(result.causalConfidence, 'moderate');
  assert.match(result.statement, /not proof/);
});
test('invalidates comparison after a prompt-panel change', () => {
  const baseline = snapshot({ id: 'baseline' });
  const current = snapshot({ id: 'current', statuses: [3, 3, 3], promptPanel: 'panel-2' });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{}] });
  assert.equal(result.outcome, 'invalid');
  assert.equal(result.causalConfidence, 'none');
});
test('returns inconclusive for insufficient completeness', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 0, 0] });
  const current = snapshot({ id: 'current', statuses: [3, 3, 3], completeness: 0.5 });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{}] });
  assert.equal(result.outcome, 'inconclusive');
  assert.ok(result.reasons.some((reason) => reason.includes('data completeness')));
});
test('detects regression on target prompts', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [3, 3, 3] });
  const current = snapshot({ id: 'current', statuses: [1, 1, 1] });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{}] });
  assert.equal(result.outcome, 'regression');
});
test('model changes lower confidence but remain directionally comparable', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 0, 0], model: 'model-a' });
  const current = snapshot({ id: 'current', statuses: [2, 2, 2], model: 'model-b' });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{}] });
  assert.equal(compareMethodology(current, baseline).class, 'directionally_comparable');
  assert.equal(result.outcome, 'success');
  assert.equal(result.causalConfidence, 'low');
});
test('provider-wide anomaly makes the result inconclusive', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 0, 0] });
  const current = snapshot({ id: 'current', statuses: [4, 4, 4] });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [{}], providerWideAnomaly: true });
  assert.equal(result.outcome, 'inconclusive');
  assert.ok(result.reasons.includes('provider-wide anomaly is active'));
});
test('requires implementation evidence by default', () => {
  const baseline = snapshot({ id: 'baseline', statuses: [0, 0, 0] });
  const current = snapshot({ id: 'current', statuses: [4, 4, 4] });
  const result = evaluateExperiment({ plan: createExperimentPlan(planInput(baseline)), baselineSnapshot: baseline, currentSnapshot: current, intervention: implementedIntervention(), implementationEvidence: [] });
  assert.equal(result.outcome, 'inconclusive');
});
test('prioritizes high-impact low-effort findings', () => {
  const ranked = prioritizeFindings([
    { id: 'slow', impact: 5, confidenceScore: 5, urgency: 5, effort: 5 },
    { id: 'fast', impact: 4, confidenceScore: 4, urgency: 4, effort: 1 }
  ]);
  assert.equal(ranked[0].id, 'fast');
});
test('builds an action board with latest evaluations', () => {
  const board = buildActionBoard({ findings: [{ id: 'f1', state: 'open' }], interventions: [{ id: 'i1', findingId: 'f1', state: 'in_progress' }], experiments: [{ id: 'e1', interventionId: 'i1', state: 'awaiting_measurement' }], evaluations: [{ id: 'v1', experimentPlanId: 'e1', outcome: 'success' }] });
  assert.equal(board.summary.openFindings, 1);
  assert.equal(board.rows[0].interventions[0].experiments[0].latestEvaluation.outcome, 'success');
});
