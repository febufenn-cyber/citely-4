import { createHash, randomUUID } from 'node:crypto';

const INTERVENTION_STATES = new Set(['draft', 'approved', 'in_progress', 'implemented', 'cancelled']);
const EXPERIMENT_STATES = new Set(['draft', 'approved', 'running', 'awaiting_measurement', 'evaluated', 'invalidated']);
const METRICS = new Set(['mention_rate', 'average_mention_status', 'weighted_visibility']);
const OUTCOMES = new Set(['success', 'partial_success', 'no_change', 'regression', 'inconclusive', 'invalid']);

const INTERVENTION_TRANSITIONS = {
  draft: new Set(['approved', 'cancelled']),
  approved: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['implemented', 'cancelled']),
  implemented: new Set([]),
  cancelled: new Set([])
};

const EXPERIMENT_TRANSITIONS = {
  draft: new Set(['approved', 'invalidated']),
  approved: new Set(['running', 'invalidated']),
  running: new Set(['awaiting_measurement', 'invalidated']),
  awaiting_measurement: new Set(['evaluated', 'invalidated']),
  evaluated: new Set([]),
  invalidated: new Set([])
};

export function prioritizeFindings(findings) {
  return findings.map((finding) => {
    const impact = bounded(finding.impact, 1, 5, 3);
    const confidence = bounded(finding.confidenceScore, 1, 5, 3);
    const urgency = bounded(finding.urgency, 1, 5, 3);
    const effort = bounded(finding.effort, 1, 5, 3);
    const score = round((impact * confidence * urgency) / effort, 3);
    return { ...structuredClone(finding), priorityScore: score };
  }).sort((a, b) => b.priorityScore - a.priorityScore || String(a.id).localeCompare(String(b.id)));
}

export function createExperimentPlan(input) {
  validateExperimentPlan(input);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const plan = {
    schemaVersion: 1,
    id: input.id ?? randomUUID(),
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    findingId: input.findingId,
    interventionId: input.interventionId,
    baselineReportVersionId: input.baselineReportVersionId,
    hypothesis: input.hypothesis.trim(),
    mechanism: input.mechanism.trim(),
    targetPromptKeys: unique(input.targetPromptKeys),
    targetProviders: unique(input.targetProviders ?? []),
    primaryMetric: input.primaryMetric,
    expectedDirection: input.expectedDirection ?? 'increase',
    minimumDelta: Number(input.minimumDelta ?? 0),
    minimumCompleteness: Number(input.minimumCompleteness ?? 0.8),
    minimumSampleSize: Number(input.minimumSampleSize ?? 3),
    observationWindowDays: Number(input.observationWindowDays ?? 30),
    guardrails: {
      requireImplementationEvidence: input.guardrails?.requireImplementationEvidence !== false,
      rejectProviderWideAnomaly: input.guardrails?.rejectProviderWideAnomaly !== false,
      requireStableTargetSamples: input.guardrails?.requireStableTargetSamples !== false
    },
    baselineMethodologyFingerprint: methodologyFingerprint(input.baselineSnapshot),
    baselineValue: metricValue(input.baselineSnapshot, {
      targetPromptKeys: input.targetPromptKeys,
      targetProviders: input.targetProviders ?? [],
      primaryMetric: input.primaryMetric
    }),
    state: 'draft',
    createdAt
  };
  return deepFreeze(plan);
}

export function validateExperimentPlan(input) {
  const errors = [];
  for (const field of ['workspaceId', 'brandId', 'findingId', 'interventionId', 'baselineReportVersionId']) {
    if (!input?.[field]) errors.push(`${field} is required`);
  }
  if (!input?.hypothesis?.trim()) errors.push('hypothesis is required');
  if (!input?.mechanism?.trim()) errors.push('mechanism is required');
  if (!Array.isArray(input?.targetPromptKeys) || !input.targetPromptKeys.length) errors.push('targetPromptKeys must not be empty');
  if (!METRICS.has(input?.primaryMetric)) errors.push('primaryMetric is invalid');
  if (!['increase', 'decrease'].includes(input?.expectedDirection ?? 'increase')) errors.push('expectedDirection must be increase or decrease');
  if (!input?.baselineSnapshot?.reportVersionId) errors.push('baselineSnapshot must be a published report snapshot');
  if (!['published', 'customer_ready'].includes(input?.baselineSnapshot?.publicationState)) errors.push('baselineSnapshot must be customer_ready or published');
  if (!Number.isFinite(Number(input?.minimumDelta ?? 0)) || Number(input?.minimumDelta ?? 0) < 0) errors.push('minimumDelta must be non-negative');
  if (!between(Number(input?.minimumCompleteness ?? 0.8), 0, 1)) errors.push('minimumCompleteness must be between 0 and 1');
  if (!Number.isInteger(Number(input?.minimumSampleSize ?? 3)) || Number(input?.minimumSampleSize ?? 3) < 1) errors.push('minimumSampleSize must be a positive integer');
  if (errors.length) throw new Error(`Experiment plan is invalid:\n- ${errors.join('\n- ')}`);
  return true;
}

export function transitionIntervention(intervention, nextState, metadata = {}) {
  if (!INTERVENTION_STATES.has(intervention?.state)) throw new Error(`Unknown intervention state: ${intervention?.state}`);
  if (!INTERVENTION_STATES.has(nextState)) throw new Error(`Unknown intervention state: ${nextState}`);
  if (!INTERVENTION_TRANSITIONS[intervention.state].has(nextState)) throw new Error(`Invalid intervention transition: ${intervention.state} → ${nextState}`);
  const now = metadata.at ?? new Date().toISOString();
  return deepFreeze({
    ...structuredClone(intervention),
    state: nextState,
    updatedAt: now,
    ...(nextState === 'in_progress' ? { startedAt: intervention.startedAt ?? now } : {}),
    ...(nextState === 'implemented' ? { implementedAt: metadata.implementedAt ?? now } : {}),
    ...(nextState === 'cancelled' ? { cancelledAt: now, cancellationReason: metadata.reason ?? null } : {})
  });
}

export function transitionExperiment(plan, nextState, metadata = {}) {
  if (!EXPERIMENT_STATES.has(plan?.state)) throw new Error(`Unknown experiment state: ${plan?.state}`);
  if (!EXPERIMENT_STATES.has(nextState)) throw new Error(`Unknown experiment state: ${nextState}`);
  if (!EXPERIMENT_TRANSITIONS[plan.state].has(nextState)) throw new Error(`Invalid experiment transition: ${plan.state} → ${nextState}`);
  const now = metadata.at ?? new Date().toISOString();
  return deepFreeze({
    ...structuredClone(plan),
    state: nextState,
    updatedAt: now,
    ...(nextState === 'approved' ? { approvedAt: now } : {}),
    ...(nextState === 'running' ? { startedAt: now } : {}),
    ...(nextState === 'awaiting_measurement' ? { measurementRequestedAt: now } : {}),
    ...(nextState === 'evaluated' ? { evaluatedAt: now } : {}),
    ...(nextState === 'invalidated' ? { invalidatedAt: now, invalidationReason: metadata.reason ?? null } : {})
  });
}

export function evaluateExperiment(input) {
  const { plan, baselineSnapshot, currentSnapshot, intervention } = input;
  if (!plan || !baselineSnapshot || !currentSnapshot || !intervention) throw new Error('plan, baselineSnapshot, currentSnapshot, and intervention are required');
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const comparability = compareMethodology(currentSnapshot, baselineSnapshot);
  const completeness = dataCompleteness(currentSnapshot);
  const currentTargets = targetEvidence(currentSnapshot, plan);
  const baselineTargets = targetEvidence(baselineSnapshot, plan);
  const reasons = [];

  if (comparability.class === 'not_comparable') reasons.push(...comparability.reasons);
  if (plan.baselineReportVersionId !== baselineSnapshot.reportVersionId) reasons.push('baseline report version does not match frozen plan');
  if (methodologyFingerprint(baselineSnapshot) !== plan.baselineMethodologyFingerprint) reasons.push('baseline methodology fingerprint changed');
  if (intervention.state !== 'implemented' || !intervention.implementedAt) reasons.push('intervention is not marked implemented');
  if (plan.guardrails.requireImplementationEvidence && !(input.implementationEvidence?.length)) reasons.push('implementation evidence is required');
  if (completeness < plan.minimumCompleteness) reasons.push(`data completeness ${round(completeness, 3)} is below ${plan.minimumCompleteness}`);
  if (currentTargets.length < plan.minimumSampleSize || baselineTargets.length < plan.minimumSampleSize) reasons.push('target sample is below minimumSampleSize');
  if (plan.guardrails.rejectProviderWideAnomaly && input.providerWideAnomaly) reasons.push('provider-wide anomaly is active');
  if (plan.guardrails.requireStableTargetSamples && [...currentTargets, ...baselineTargets].some((item) => item.stability === 'volatile')) reasons.push('target evidence is volatile');
  if (new Date(currentSnapshot.generatedAt).getTime() < new Date(intervention.implementedAt ?? 0).getTime()) reasons.push('current measurement predates implementation');
  if (input.uncontrolledChanges?.length) reasons.push('other material changes occurred during the experiment');

  const baselineValue = metricValue(baselineSnapshot, plan);
  const currentValue = metricValue(currentSnapshot, plan);
  const delta = round(currentValue - baselineValue, 4);

  let outcome = 'inconclusive';
  if (comparability.class === 'not_comparable' || reasons.includes('baseline methodology fingerprint changed') || reasons.includes('baseline report version does not match frozen plan')) outcome = 'invalid';
  else if (!reasons.length) outcome = classifyOutcome(plan, delta);

  const causalConfidence = causalConfidenceFor({ outcome, comparability, reasons, input });
  const evaluation = {
    schemaVersion: 1,
    id: input.id ?? randomUUID(),
    experimentPlanId: plan.id,
    baselineReportVersionId: baselineSnapshot.reportVersionId,
    currentReportVersionId: currentSnapshot.reportVersionId,
    outcome,
    causalConfidence,
    primaryMetric: plan.primaryMetric,
    baselineValue,
    currentValue,
    delta,
    targetObservationCounts: { baseline: baselineTargets.length, current: currentTargets.length },
    dataCompleteness: completeness,
    comparability,
    reasons,
    statement: evaluationStatement({ outcome, causalConfidence, delta, plan }),
    evaluatedAt
  };
  if (!OUTCOMES.has(evaluation.outcome)) throw new Error('Unexpected evaluation outcome');
  return deepFreeze(evaluation);
}

export function buildActionBoard({ findings = [], interventions = [], experiments = [], evaluations = [] }) {
  const latestEvaluationByExperiment = new Map(evaluations.map((item) => [item.experimentPlanId, item]));
  const rows = findings.map((finding) => {
    const linkedInterventions = interventions.filter((item) => item.findingId === finding.id);
    return {
      finding: structuredClone(finding),
      interventions: linkedInterventions.map((intervention) => {
        const linkedExperiments = experiments.filter((item) => item.interventionId === intervention.id);
        return {
          ...structuredClone(intervention),
          experiments: linkedExperiments.map((experiment) => ({ ...structuredClone(experiment), latestEvaluation: latestEvaluationByExperiment.get(experiment.id) ?? null }))
        };
      })
    };
  });
  return deepFreeze({
    summary: {
      openFindings: findings.filter((item) => ['open', 'planned'].includes(item.state)).length,
      interventionsInProgress: interventions.filter((item) => item.state === 'in_progress').length,
      awaitingMeasurement: experiments.filter((item) => item.state === 'awaiting_measurement').length,
      successfulExperiments: evaluations.filter((item) => item.outcome === 'success').length,
      inconclusiveExperiments: evaluations.filter((item) => ['inconclusive', 'invalid'].includes(item.outcome)).length
    },
    rows
  });
}

export function methodologyFingerprint(snapshot) {
  const methodology = snapshot?.methodology ?? {};
  const critical = {
    promptPanelVersionId: methodology.promptPanelVersionId,
    providerProfilesFingerprint: methodology.providerProfilesFingerprint,
    searchModesFingerprint: methodology.searchModesFingerprint,
    geographyFingerprint: methodology.geographyFingerprint,
    localeFingerprint: methodology.localeFingerprint,
    scoringModelVersion: methodology.scoringModelVersion
  };
  return createHash('sha256').update(JSON.stringify(sortValue(critical))).digest('hex');
}

export function compareMethodology(current, baseline) {
  const currentMethodology = current?.methodology ?? {};
  const baselineMethodology = baseline?.methodology ?? {};
  const criticalFields = ['promptPanelVersionId', 'providerProfilesFingerprint', 'searchModesFingerprint', 'geographyFingerprint', 'localeFingerprint', 'scoringModelVersion'];
  const criticalChanges = criticalFields.filter((field) => currentMethodology[field] !== baselineMethodology[field]);
  if (criticalChanges.length) return { class: 'not_comparable', reasons: criticalChanges.map((field) => `${field} changed`) };
  const directional = [];
  if (currentMethodology.reportedModelsFingerprint !== baselineMethodology.reportedModelsFingerprint) directional.push('reported model changed');
  if (Number(currentMethodology.repetitions ?? 1) !== Number(baselineMethodology.repetitions ?? 1)) directional.push('repetition count changed');
  return directional.length ? { class: 'directionally_comparable', reasons: directional } : { class: 'fully_comparable', reasons: [] };
}

function classifyOutcome(plan, delta) {
  const signed = plan.expectedDirection === 'increase' ? delta : -delta;
  if (signed >= plan.minimumDelta) return 'success';
  if (signed > 0) return 'partial_success';
  if (signed === 0) return 'no_change';
  return 'regression';
}

function causalConfidenceFor({ outcome, comparability, reasons, input }) {
  if (['invalid', 'inconclusive'].includes(outcome)) return 'none';
  if (comparability.class === 'fully_comparable' && !reasons.length && !input.uncontrolledChanges?.length && !input.providerWideAnomaly) return 'moderate';
  return 'low';
}

function evaluationStatement({ outcome, causalConfidence, delta, plan }) {
  const metric = plan.primaryMetric.replaceAll('_', ' ');
  if (outcome === 'invalid') return 'The rerun cannot be evaluated against the frozen baseline because the methodology or baseline changed.';
  if (outcome === 'inconclusive') return 'The experiment does not have enough trustworthy evidence for an outcome.';
  const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'did not change';
  return `The targeted ${metric} ${direction} by ${Math.abs(delta).toFixed(3)}. This is an observational ${outcome.replaceAll('_', ' ')} with ${causalConfidence} causal confidence, not proof that the intervention caused the change.`;
}

function metricValue(snapshot, plan) {
  const evidence = targetEvidence(snapshot, plan);
  if (!evidence.length) return 0;
  if (plan.primaryMetric === 'mention_rate') return round(evidence.filter((item) => mentionStatus(item) > 0).length / evidence.length, 4);
  if (plan.primaryMetric === 'average_mention_status') return round(evidence.reduce((sum, item) => sum + mentionStatus(item), 0) / evidence.length, 4);
  if (plan.primaryMetric === 'weighted_visibility') {
    const numerator = evidence.reduce((sum, item) => sum + mentionStatus(item) * Number(item.prompt?.importance ?? 1), 0);
    const denominator = evidence.reduce((sum, item) => sum + 4 * Number(item.prompt?.importance ?? 1), 0);
    return denominator ? round(numerator / denominator, 4) : 0;
  }
  throw new Error(`Unsupported metric: ${plan.primaryMetric}`);
}

function targetEvidence(snapshot, plan) {
  const promptKeys = new Set(plan.targetPromptKeys ?? []);
  const providers = new Set(plan.targetProviders ?? []);
  return (snapshot?.evidence ?? []).filter((item) => {
    const promptKey = item.prompt?.stableKey ?? item.prompt?.id;
    const provider = item.provider?.name;
    return promptKeys.has(promptKey) && (!providers.size || providers.has(provider));
  });
}

function dataCompleteness(snapshot) {
  const intended = Number(snapshot?.auditRun?.intendedObservations ?? snapshot?.scoring?.metrics?.intendedObservations ?? 0);
  const successful = Number(snapshot?.auditRun?.successfulObservations ?? snapshot?.scoring?.metrics?.successfulObservations ?? 0);
  return intended > 0 ? successful / intended : 0;
}

function mentionStatus(item) {
  return Number(item?.reviewedClassification?.mention_status ?? item?.reviewedClassification?.mentionStatus ?? 0);
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}
function between(value, minimum, maximum) { return Number.isFinite(value) && value >= minimum && value <= maximum; }
function unique(values) { return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]; }
function round(value, places = 4) { const factor = 10 ** places; return Math.round((value + Number.EPSILON) * factor) / factor; }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); } return value; }
