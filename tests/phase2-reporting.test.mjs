import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSnapshot, compareMethodology, compareReportSnapshots, createSignedShareToken, verifySignedShareToken } from '../src/phase2/reporting.mjs';
import { renderPublishedReport } from '../src/phase2/render.mjs';

function input(overrides = {}) {
  const observations = overrides.observations ?? [observation('o1', 3), observation('o2', 0)];
  return {
    reportId: 'r1', reportVersionId: overrides.reportVersionId ?? 'rv1', workspaceId: 'w1', publicationState: 'customer_ready',
    brand: { id: 'b1', name: 'Citely', domain: 'citely.example' },
    auditRun: { id: 'run1', state: overrides.runState ?? 'ready', promptPanelVersionId: 'panel-v1', repetitions: overrides.repetitions ?? 1, frozenConfiguration: { methodology: { geography: { country: 'IN' }, locale: 'en-IN', repetitions: overrides.repetitions ?? 1 } } },
    scoreCalculation: { id: 's1', scoringModelVersion: overrides.scoringModelVersion ?? 'visibility-v1', inputObservationIds: overrides.inputObservationIds ?? observations.filter((item) => item.review.decision !== 'excluded').map((item) => item.id), metrics: overrides.metrics ?? { intendedObservations: 3, successfulObservations: 2, terminalFailures: 1, excludedObservations: 0, mentionRate: 0.5, weightedVisibility: 0.375, dataCompleteness: 2 / 3 } },
    observations,
    narrative: { title: 'Citely report', executiveSummary: 'Reviewed evidence shows mixed commercial visibility.' },
    findings: [{ id: 'f1', type: 'gap', title: 'Discovery gap', summary: 'The brand is absent from one category prompt.', evidenceObservationIds: ['o2'], customerVisible: true }],
    internalNotes: 'never publish', ...overrides
  };
}

function observation(id, mentionStatus, overrides = {}) {
  return {
    id, auditRunItemId: `item-${id}`, repetition: 1,
    prompt: { id: `p-${id}`, stableKey: `stable-${id}`, text: `Prompt ${id}`, stage: 'comparison', importance: 5, locale: 'en-IN', geography: { country: 'IN' } },
    provider: { profileId: 'provider-v1', name: 'openai', requestedModel: 'gpt-demo', reportedModel: overrides.reportedModel ?? 'gpt-demo-1', searchMode: 'web' },
    answerText: mentionStatus ? 'Citely is relevant.' : 'Another brand is relevant.', citations: [], sources: [], receivedAt: '2026-07-13T00:00:00Z', stability: overrides.stability ?? 'stable_positive',
    rawResponse: { secret: true }, machineClassification: { mention_status: mentionStatus },
    review: { decision: overrides.decision ?? 'accepted', acceptedClassification: { mention_status: mentionStatus }, notes: 'internal reviewer note' }
  };
}

test('builds an immutable customer-safe report snapshot', () => {
  const report = buildReportSnapshot(input());
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.evidence[0]), true);
  assert.equal('rawResponse' in report.evidence[0], false);
  assert.equal('notes' in report.evidence[0], false);
  assert.equal('internalNotes' in report, false);
});

test('requires ready or delivered audit runs', () => {
  assert.throws(() => buildReportSnapshot(input({ runState: 'awaiting_review' })), /ready or delivered/);
});

test('rejects score inputs without reviewed observations', () => {
  const observations = [observation('o1', 2, { decision: 'excluded' })];
  assert.throws(() => buildReportSnapshot(input({ observations, inputObservationIds: ['o1'], metrics: { intendedObservations: 1, successfulObservations: 1, terminalFailures: 0, excludedObservations: 0 } })), /not accepted or corrected/);
});

test('discloses failures without putting them in evidence', () => {
  const report = buildReportSnapshot(input());
  assert.equal(report.auditRun.terminalFailures, 1);
  assert.equal(report.evidence.length, 2);
});

test('fully comparable methodology requires matching critical and directional fields', () => {
  const a = buildReportSnapshot(input({ reportVersionId: 'a' }));
  const b = buildReportSnapshot(input({ reportVersionId: 'b' }));
  assert.equal(compareMethodology(a.methodology, b.methodology).class, 'fully_comparable');
});

test('reported model changes are directionally comparable', () => {
  const a = buildReportSnapshot(input({ reportVersionId: 'a' }));
  const changed = [observation('o1', 3, { reportedModel: 'gpt-demo-2' }), observation('o2', 0, { reportedModel: 'gpt-demo-2' })];
  const b = buildReportSnapshot(input({ reportVersionId: 'b', observations: changed }));
  assert.equal(compareMethodology(b.methodology, a.methodology).class, 'directionally_comparable');
});

test('prompt panel or scoring changes break direct comparison', () => {
  const a = buildReportSnapshot(input({ reportVersionId: 'a' }));
  const b = structuredClone(a);
  b.methodology.promptPanelFingerprint = 'changed';
  assert.equal(compareMethodology(b.methodology, a.methodology).class, 'not_comparable');
});

test('classifies visibility changes from comparable evidence', () => {
  const previous = buildReportSnapshot(input({ reportVersionId: 'previous' }));
  const currentObservations = [observation('o1', 4), observation('o2', 2)];
  const current = buildReportSnapshot(input({ reportVersionId: 'current', observations: currentObservations }));
  const comparison = compareReportSnapshots(current, previous);
  assert.equal(comparison.summary.improved, 2);
  assert.deepEqual(comparison.changes.map((item) => item.change).sort(), ['improved_prominence', 'newly_visible']);
});

test('creates and verifies expiring signed share tokens', () => {
  const token = createSignedShareToken({ reportVersionId: 'rv1', expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: 'fixed' }, 'secret');
  const verified = verifySignedShareToken(token, 'secret');
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.reportVersionId, 'rv1');
});

test('rejects tampered and expired share tokens', () => {
  const token = createSignedShareToken({ reportVersionId: 'rv1', expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: 'fixed' }, 'secret');
  assert.equal(verifySignedShareToken(`${token}x`, 'secret').valid, false);
  const expired = createSignedShareToken({ reportVersionId: 'rv1', expiresAt: '2020-01-01T00:00:00Z', nonce: 'fixed' }, 'secret');
  assert.equal(verifySignedShareToken(expired, 'secret').reason, 'expired');
});

test('renders evidence and methodology without internal data', () => {
  const report = buildReportSnapshot(input());
  const html = renderPublishedReport(report);
  assert.match(html, /Prompt-level evidence/);
  assert.match(html, /Failed and excluded observations/);
  assert.doesNotMatch(html, /internal reviewer note|never publish|secret/);
});
