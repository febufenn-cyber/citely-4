import { REVIEW_DECISIONS } from './constants.mjs';
import { normalizeClassification } from './extraction.mjs';

export const SCORING_MODEL_VERSION = 'visibility-v1';

export function submitReview({ store, itemId, reviewerId, decision, correction = null, reasonCode = null, notes = null }) {
  if (!REVIEW_DECISIONS.includes(decision)) throw new Error(`Invalid review decision: ${decision}`);
  if (!reviewerId) throw new Error('reviewerId is required');
  const observation = store.getObservation(itemId);
  if (!observation) throw new Error(`Observation not found for review: ${itemId}`);
  let classification = null;
  if (decision !== 'excluded') {
    classification = normalizeClassification(observation.automatedClassification, decision === 'corrected' ? correction : null);
  }
  return store.addReview(itemId, {
    reviewerId,
    decision,
    reasonCode,
    notes,
    machineClassification: observation.automatedClassification,
    acceptedClassification: classification
  });
}

export function autoAcceptReviewQueue({ store, auditRunId, reviewerId = 'phase1-demo-reviewer' }) {
  const decisions = [];
  for (const item of store.listItems(auditRunId)) {
    if (item.state !== 'review_required') continue;
    decisions.push(submitReview({ store, itemId: item.id, reviewerId, decision: 'accepted', reasonCode: 'demo_fixture_verified' }));
  }
  return decisions;
}

export function calculateReviewedScores({ store, auditRunId, scoringModelVersion = SCORING_MODEL_VERSION }) {
  const snapshot = store.snapshotRun(auditRunId);
  const eligible = [];
  const failed = [];
  const excluded = [];

  for (const item of snapshot.items) {
    if (item.state === 'terminal_failure') {
      failed.push(item);
      continue;
    }
    if (item.state === 'excluded' || item.review?.decision === 'excluded') {
      excluded.push(item);
      continue;
    }
    const classification = item.review?.acceptedClassification;
    if (classification && !classification.excludedFromScoring) eligible.push({ item, classification });
  }

  const mentionCount = eligible.filter(({ classification }) => classification.brandMentioned).length;
  const brandFirstCount = eligible.filter(({ classification }) => classification.brandFirst).length;
  const weightedPoints = eligible.reduce((total, { item, classification }) => total + classification.mentionStatus * item.prompt.importance, 0);
  const possibleWeightedPoints = eligible.reduce((total, { item }) => total + 4 * item.prompt.importance, 0);
  const intended = snapshot.items.length;
  const successful = snapshot.items.filter((item) => Boolean(item.observation)).length;

  const metrics = {
    intendedObservations: intended,
    successfulObservations: successful,
    reviewedEligibleObservations: eligible.length,
    terminalFailures: failed.length,
    excludedObservations: excluded.length,
    completeness: ratio(successful, intended),
    reviewCompletion: ratio(eligible.length + excluded.length, successful),
    mentionRate: ratio(mentionCount, eligible.length),
    firstMentionRate: ratio(brandFirstCount, eligible.length),
    weightedVisibility: ratio(weightedPoints, possibleWeightedPoints),
    byStage: aggregateDimension(eligible, ({ item }) => item.prompt.stage),
    byProvider: aggregateDimension(eligible, ({ item }) => item.providerProfile.provider),
    stability: calculateStability(eligible)
  };

  return store.saveScoreCalculation({
    auditRunId,
    scoringModelVersion,
    inputItemIds: eligible.map(({ item }) => item.id),
    metrics
  });
}

export function finalizeReviewedRun({ store, auditRunId, minimumCompleteness = 0.8 }) {
  const run = store.getRun(auditRunId);
  if (!['awaiting_review', 'partially_failed', 'review_in_progress'].includes(run.state)) {
    throw new Error(`Run is not reviewable from state ${run.state}`);
  }
  if (run.state !== 'review_in_progress') store.transitionRun(auditRunId, 'review_in_progress');
  const items = store.listItems(auditRunId);
  const successful = items.filter((item) => Boolean(item.successfulObservationId));
  const reviewed = successful.filter((item) => ['accepted', 'corrected', 'excluded'].includes(item.state));
  if (reviewed.length !== successful.length) throw new Error(`Review incomplete: ${reviewed.length}/${successful.length} successful observations reviewed`);
  const completeness = ratio(successful.length, items.length);
  if (completeness < minimumCompleteness) {
    store.transitionRun(auditRunId, 'partially_failed', { stopReason: `Completeness ${completeness} is below ${minimumCompleteness}` });
    return store.getRun(auditRunId);
  }
  const score = calculateReviewedScores({ store, auditRunId });
  return store.transitionRun(auditRunId, 'ready', { completedAt: new Date().toISOString(), latestScoreCalculationId: score.id });
}

function aggregateDimension(eligible, keySelector) {
  const groups = new Map();
  for (const entry of eligible) {
    const key = keySelector(entry) ?? 'unknown';
    const values = groups.get(key) ?? [];
    values.push(entry);
    groups.set(key, values);
  }
  return Object.fromEntries([...groups.entries()].map(([key, values]) => [key, {
    observations: values.length,
    mentionRate: ratio(values.filter(({ classification }) => classification.brandMentioned).length, values.length),
    averageMentionStatus: round(values.reduce((total, { classification }) => total + classification.mentionStatus, 0) / values.length)
  }]));
}

function calculateStability(eligible) {
  const promptGroups = new Map();
  for (const entry of eligible) {
    const key = `${entry.item.promptVersionId}:${entry.item.providerProfileId}`;
    const group = promptGroups.get(key) ?? [];
    group.push(entry.classification.brandMentioned);
    promptGroups.set(key, group);
  }
  const summary = { stablePositive: 0, stableAbsent: 0, volatile: 0, insufficientSample: 0 };
  for (const values of promptGroups.values()) {
    if (values.length < 2) summary.insufficientSample += 1;
    else if (values.every(Boolean)) summary.stablePositive += 1;
    else if (values.every((value) => !value)) summary.stableAbsent += 1;
    else summary.volatile += 1;
  }
  return summary;
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : 0;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
