import { SupabaseRest } from './supabase';

type FindingBody = {
  findingType: 'visibility_gap' | 'competitor_advantage' | 'citation_gap' | 'accuracy_risk' | 'source_opportunity' | 'other';
  title: string;
  summary: string;
  evidenceObservationIds?: string[];
  impact?: number;
  confidenceScore?: number;
  urgency?: number;
  effort?: number;
  customerVisible?: boolean;
};

type InterventionBody = {
  title: string;
  interventionType: 'content_update' | 'new_content' | 'technical' | 'digital_pr' | 'source_correction' | 'product_messaging' | 'other';
  hypothesis: string;
  mechanism: string;
  ownerUserId?: string | null;
  targetUrls?: Array<Record<string, unknown>>;
  baselineReportVersionId?: string;
  targetPromptKeys: string[];
  targetProviders?: string[];
  primaryMetric: 'mention_rate' | 'average_mention_status' | 'weighted_visibility';
  expectedDirection?: 'increase' | 'decrease';
  minimumDelta?: number;
  minimumCompleteness?: number;
  minimumSampleSize?: number;
  observationWindowDays?: number;
  guardrails?: Record<string, boolean>;
};

type TransitionBody = { state: 'approved' | 'in_progress' | 'implemented' | 'cancelled'; reason?: string | null; at?: string };
type EvidenceBody = { evidenceType: 'url' | 'deployment' | 'screenshot' | 'document' | 'note' | 'other'; url?: string | null; description: string; contentHash?: string | null; capturedAt?: string };
type EvaluationBody = { currentReportVersionId: string; providerWideAnomaly?: boolean; uncontrolledChanges?: Array<Record<string, unknown>> };

const INTERVENTION_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['approved', 'cancelled']),
  approved: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['implemented', 'cancelled']),
  implemented: new Set(),
  cancelled: new Set()
};

export async function createActionFinding(db: SupabaseRest, reportVersionId: string, actorId: string, body: FindingBody) {
  if (!body.title?.trim() || !body.summary?.trim()) throw httpError(400, 'title and summary are required');
  const allowedTypes = ['visibility_gap', 'competitor_advantage', 'citation_gap', 'accuracy_risk', 'source_opportunity', 'other'];
  if (!allowedTypes.includes(body.findingType)) throw httpError(400, 'invalid findingType');
  const version = await db.one<any>('report_versions', `id=eq.${encodeURIComponent(reportVersionId)}&select=id,workspace_id,snapshot`);
  await db.one('report_publications', `report_version_id=eq.${encodeURIComponent(reportVersionId)}&withdrawn_at=is.null&select=id`);
  const snapshot = version.snapshot ?? {};
  const allowedEvidence = new Set((snapshot.evidence ?? []).map((item: any) => item.observationId));
  const evidenceObservationIds = unique(body.evidenceObservationIds ?? []);
  if (evidenceObservationIds.some((id) => !allowedEvidence.has(id))) throw httpError(400, 'evidenceObservationIds must belong to the published report');
  const impact = bounded(body.impact, 1, 5, 3);
  const confidenceScore = bounded(body.confidenceScore, 1, 5, 3);
  const urgency = bounded(body.urgency, 1, 5, 3);
  const effort = bounded(body.effort, 1, 5, 3);
  const priorityScore = round((impact * confidenceScore * urgency) / effort, 3);
  const [finding] = await db.insert<any>('action_findings', {
    workspace_id: version.workspace_id,
    brand_id: snapshot.brand?.id,
    source_report_version_id: version.id,
    finding_type: body.findingType,
    title: body.title.trim(),
    summary: body.summary.trim(),
    evidence_observation_ids: evidenceObservationIds,
    impact,
    confidence_score: confidenceScore,
    urgency,
    effort,
    priority_score: priorityScore,
    customer_visible: body.customerVisible !== false,
    created_by: actorId
  });
  return finding;
}

export async function createIntervention(db: SupabaseRest, findingId: string, actorId: string, body: InterventionBody) {
  validateInterventionBody(body);
  const finding = await db.one<any>('action_findings', `id=eq.${encodeURIComponent(findingId)}&select=id,workspace_id,brand_id,source_report_version_id,state`);
  if (!['open', 'planned'].includes(finding.state)) throw httpError(409, `finding is ${finding.state}`);
  const baselineReportVersionId = body.baselineReportVersionId ?? finding.source_report_version_id;
  const baseline = await db.one<any>('report_versions', `id=eq.${encodeURIComponent(baselineReportVersionId)}&select=id,workspace_id,snapshot`);
  await db.one('report_publications', `report_version_id=eq.${encodeURIComponent(baselineReportVersionId)}&withdrawn_at=is.null&select=id`);
  if (baseline.workspace_id !== finding.workspace_id) throw httpError(409, 'baseline report belongs to another workspace');
  const promptKeys = new Set((baseline.snapshot?.evidence ?? []).map((item: any) => item.prompt?.stableKey ?? item.prompt?.id));
  const targets = unique(body.targetPromptKeys);
  if (!targets.length || targets.some((key) => !promptKeys.has(key))) throw httpError(400, 'targetPromptKeys must exist in the baseline report');
  const [intervention] = await db.insert<any>('interventions', {
    workspace_id: finding.workspace_id,
    brand_id: finding.brand_id,
    finding_id: finding.id,
    title: body.title.trim(),
    intervention_type: body.interventionType,
    hypothesis: body.hypothesis.trim(),
    mechanism: body.mechanism.trim(),
    owner_user_id: body.ownerUserId ?? null,
    target_urls: body.targetUrls ?? [],
    created_by: actorId
  });
  const providers = unique(body.targetProviders ?? []);
  const baselineValue = metricValue(baseline.snapshot, targets, providers, body.primaryMetric);
  const [plan] = await db.insert<any>('experiment_plans', {
    workspace_id: finding.workspace_id,
    brand_id: finding.brand_id,
    intervention_id: intervention.id,
    baseline_report_version_id: baseline.id,
    baseline_methodology_fingerprint: await methodologyFingerprint(baseline.snapshot),
    baseline_value: baselineValue,
    target_prompt_keys: targets,
    target_providers: providers,
    primary_metric: body.primaryMetric,
    expected_direction: body.expectedDirection ?? 'increase',
    minimum_delta: nonNegative(body.minimumDelta, 0),
    minimum_completeness: between(body.minimumCompleteness, 0, 1, 0.8),
    minimum_sample_size: positiveInteger(body.minimumSampleSize, 3),
    observation_window_days: positiveInteger(body.observationWindowDays, 30),
    guardrails: {
      requireImplementationEvidence: body.guardrails?.requireImplementationEvidence !== false,
      rejectProviderWideAnomaly: body.guardrails?.rejectProviderWideAnomaly !== false,
      requireStableTargetSamples: body.guardrails?.requireStableTargetSamples !== false
    },
    created_by: actorId
  });
  await db.patch('action_findings', `id=eq.${encodeURIComponent(finding.id)}`, { state: 'planned' });
  await db.insert('intervention_events', { workspace_id: finding.workspace_id, intervention_id: intervention.id, event_type: 'created', actor_id: actorId, payload: { experimentPlanId: plan.id } });
  return { intervention, experimentPlan: plan };
}

export async function transitionIntervention(db: SupabaseRest, interventionId: string, actorId: string, body: TransitionBody) {
  const intervention = await db.one<any>('interventions', `id=eq.${encodeURIComponent(interventionId)}&select=id,workspace_id,finding_id,state,started_at,implemented_at`);
  if (!INTERVENTION_TRANSITIONS[intervention.state]?.has(body.state)) throw httpError(409, `invalid transition ${intervention.state} → ${body.state}`);
  if (body.state === 'implemented') {
    const evidence = await db.select<{ id: string }>('implementation_evidence', `intervention_id=eq.${encodeURIComponent(intervention.id)}&select=id&limit=1`);
    if (!evidence.length) throw httpError(409, 'implementation evidence is required before marking implemented');
  }
  const at = validTimestamp(body.at) ?? new Date().toISOString();
  const patch: Record<string, unknown> = { state: body.state };
  if (body.state === 'in_progress') patch.started_at = intervention.started_at ?? at;
  if (body.state === 'implemented') patch.implemented_at = intervention.implemented_at ?? at;
  if (body.state === 'cancelled') { patch.cancelled_at = at; patch.cancellation_reason = body.reason ?? null; }
  await db.patch('interventions', `id=eq.${encodeURIComponent(intervention.id)}`, patch);
  const eventType = body.state === 'in_progress' ? 'started' : body.state;
  await db.insert('intervention_events', { workspace_id: intervention.workspace_id, intervention_id: intervention.id, event_type: eventType, actor_id: actorId, payload: { reason: body.reason ?? null, at } });
  const planState = body.state === 'approved' ? 'approved' : body.state === 'in_progress' ? 'running' : body.state === 'implemented' ? 'awaiting_measurement' : 'invalidated';
  const planPatch: Record<string, unknown> = { state: planState };
  if (body.state === 'approved') { planPatch.approved_by = actorId; planPatch.approved_at = at; }
  await db.patch('experiment_plans', `intervention_id=eq.${encodeURIComponent(intervention.id)}`, planPatch);
  return { interventionId: intervention.id, state: body.state, experimentState: planState };
}

export async function addImplementationEvidence(db: SupabaseRest, interventionId: string, actorId: string, body: EvidenceBody) {
  if (!body.description?.trim()) throw httpError(400, 'description is required');
  const intervention = await db.one<any>('interventions', `id=eq.${encodeURIComponent(interventionId)}&select=id,workspace_id,state`);
  if (['implemented', 'cancelled'].includes(intervention.state)) throw httpError(409, `cannot add implementation evidence while intervention is ${intervention.state}`);
  const [evidence] = await db.insert<any>('implementation_evidence', {
    workspace_id: intervention.workspace_id,
    intervention_id: intervention.id,
    evidence_type: body.evidenceType,
    url: body.url ?? null,
    description: body.description.trim(),
    content_hash: body.contentHash ?? null,
    captured_at: validTimestamp(body.capturedAt) ?? new Date().toISOString(),
    created_by: actorId
  });
  return evidence;
}

export async function evaluateIntervention(db: SupabaseRest, interventionId: string, actorId: string, body: EvaluationBody) {
  if (!body.currentReportVersionId) throw httpError(400, 'currentReportVersionId is required');
  const intervention = await db.one<any>('interventions', `id=eq.${encodeURIComponent(interventionId)}&select=id,workspace_id,finding_id,state,implemented_at`);
  if (intervention.state !== 'implemented' || !intervention.implemented_at) throw httpError(409, 'intervention must be implemented before evaluation');
  const plan = await db.one<any>('experiment_plans', `intervention_id=eq.${encodeURIComponent(intervention.id)}&select=*`);
  if (!['awaiting_measurement', 'running'].includes(plan.state)) throw httpError(409, `experiment plan is ${plan.state}`);
  const baseline = await db.one<any>('report_versions', `id=eq.${encodeURIComponent(plan.baseline_report_version_id)}&select=id,snapshot`);
  const current = await db.one<any>('report_versions', `id=eq.${encodeURIComponent(body.currentReportVersionId)}&select=id,workspace_id,snapshot`);
  await db.one('report_publications', `report_version_id=eq.${encodeURIComponent(current.id)}&withdrawn_at=is.null&select=id`);
  if (current.workspace_id !== intervention.workspace_id) throw httpError(409, 'current report belongs to another workspace');
  const implementationEvidence = await db.select<any>('implementation_evidence', `intervention_id=eq.${encodeURIComponent(intervention.id)}&select=id,evidence_type,url,description,captured_at`);
  const result = await evaluateSnapshots({ plan, baseline: baseline.snapshot, current: current.snapshot, intervention, implementationEvidence, providerWideAnomaly: body.providerWideAnomaly === true, uncontrolledChanges: body.uncontrolledChanges ?? [] });
  const [evaluation] = await db.insert<any>('experiment_evaluations', {
    workspace_id: intervention.workspace_id,
    experiment_plan_id: plan.id,
    baseline_report_version_id: baseline.id,
    current_report_version_id: current.id,
    outcome: result.outcome,
    causal_confidence: result.causalConfidence,
    baseline_value: result.baselineValue,
    current_value: result.currentValue,
    delta: result.delta,
    target_observation_counts: result.targetObservationCounts,
    data_completeness: result.dataCompleteness,
    comparability: result.comparability,
    reasons: result.reasons,
    statement: result.statement,
    provider_wide_anomaly: body.providerWideAnomaly === true,
    uncontrolled_changes: body.uncontrolledChanges ?? [],
    evaluated_by: actorId
  });
  await db.patch('experiment_plans', `id=eq.${encodeURIComponent(plan.id)}`, { state: result.outcome === 'invalid' ? 'invalidated' : 'evaluated' });
  if (result.outcome === 'success') await db.patch('action_findings', `id=eq.${encodeURIComponent(intervention.finding_id)}`, { state: 'resolved' });
  return { ...result, evaluationId: evaluation.id };
}

export async function getActionBoard(db: SupabaseRest, brandId: string) {
  const findings = await db.select<any>('action_findings', `brand_id=eq.${encodeURIComponent(brandId)}&select=*&order=priority_score.desc,created_at.asc`);
  if (!findings.length) return { summary: { openFindings: 0, interventionsInProgress: 0, awaitingMeasurement: 0, successfulExperiments: 0, inconclusiveExperiments: 0 }, rows: [] };
  const findingIds = findings.map((item) => encodeURIComponent(item.id)).join(',');
  const interventions = await db.select<any>('interventions', `finding_id=in.(${findingIds})&select=*&order=created_at.asc`);
  const interventionIds = interventions.map((item) => encodeURIComponent(item.id)).join(',');
  const plans = interventionIds ? await db.select<any>('experiment_plans', `intervention_id=in.(${interventionIds})&select=*&order=created_at.asc`) : [];
  const planIds = plans.map((item) => encodeURIComponent(item.id)).join(',');
  const evaluations = planIds ? await db.select<any>('experiment_evaluations', `experiment_plan_id=in.(${planIds})&select=*&order=created_at.desc`) : [];
  const latest = new Map<string, any>();
  for (const evaluation of evaluations) if (!latest.has(evaluation.experiment_plan_id)) latest.set(evaluation.experiment_plan_id, evaluation);
  const rows = findings.map((finding) => ({
    finding,
    interventions: interventions.filter((item) => item.finding_id === finding.id).map((intervention) => ({
      ...intervention,
      experiment: (() => { const plan = plans.find((item) => item.intervention_id === intervention.id); return plan ? { ...plan, latest_evaluation: latest.get(plan.id) ?? null } : null; })()
    }))
  }));
  return {
    summary: {
      openFindings: findings.filter((item) => ['open', 'planned'].includes(item.state)).length,
      interventionsInProgress: interventions.filter((item) => item.state === 'in_progress').length,
      awaitingMeasurement: plans.filter((item) => item.state === 'awaiting_measurement').length,
      successfulExperiments: evaluations.filter((item) => item.outcome === 'success').length,
      inconclusiveExperiments: evaluations.filter((item) => ['inconclusive', 'invalid'].includes(item.outcome)).length
    },
    rows
  };
}

async function evaluateSnapshots(input: any) {
  const { plan, baseline, current, intervention, implementationEvidence, providerWideAnomaly, uncontrolledChanges } = input;
  const comparability = compareMethodology(current, baseline);
  const baselineFingerprint = await methodologyFingerprint(baseline);
  const targets = plan.target_prompt_keys as string[];
  const providers = plan.target_providers as string[];
  const baselineTarget = targetEvidence(baseline, targets, providers);
  const currentTarget = targetEvidence(current, targets, providers);
  const completeness = dataCompleteness(current);
  const guardrails = plan.guardrails ?? {};
  const reasons: string[] = [];
  if (comparability.class === 'not_comparable') reasons.push(...comparability.reasons);
  if (baseline.reportVersionId !== plan.baseline_report_version_id) reasons.push('baseline report version does not match frozen plan');
  if (baselineFingerprint !== plan.baseline_methodology_fingerprint) reasons.push('baseline methodology fingerprint changed');
  if (guardrails.requireImplementationEvidence !== false && !implementationEvidence.length) reasons.push('implementation evidence is required');
  if (completeness < Number(plan.minimum_completeness)) reasons.push('data completeness is below the frozen minimum');
  if (baselineTarget.length < Number(plan.minimum_sample_size) || currentTarget.length < Number(plan.minimum_sample_size)) reasons.push('target sample is below the frozen minimum');
  if (guardrails.rejectProviderWideAnomaly !== false && providerWideAnomaly) reasons.push('provider-wide anomaly is active');
  if (guardrails.requireStableTargetSamples !== false && [...baselineTarget, ...currentTarget].some((item) => item.stability === 'volatile')) reasons.push('target evidence is volatile');
  if (uncontrolledChanges.length) reasons.push('other material changes occurred during the experiment');
  if (new Date(current.generatedAt).getTime() < new Date(intervention.implemented_at).getTime()) reasons.push('current measurement predates implementation');
  const baselineValue = metricValue(baseline, targets, providers, plan.primary_metric);
  const currentValue = metricValue(current, targets, providers, plan.primary_metric);
  const delta = round(currentValue - baselineValue, 4);
  let outcome = 'inconclusive';
  if (comparability.class === 'not_comparable' || reasons.includes('baseline report version does not match frozen plan') || reasons.includes('baseline methodology fingerprint changed')) outcome = 'invalid';
  else if (!reasons.length) {
    const signed = plan.expected_direction === 'increase' ? delta : -delta;
    outcome = signed >= Number(plan.minimum_delta) ? 'success' : signed > 0 ? 'partial_success' : signed === 0 ? 'no_change' : 'regression';
  }
  const causalConfidence = ['invalid', 'inconclusive'].includes(outcome) ? 'none' : comparability.class === 'fully_comparable' && !uncontrolledChanges.length && !providerWideAnomaly ? 'moderate' : 'low';
  const statement = ['invalid', 'inconclusive'].includes(outcome)
    ? outcome === 'invalid' ? 'The rerun cannot be evaluated against the frozen baseline.' : 'The experiment does not have enough trustworthy evidence for an outcome.'
    : `The targeted ${String(plan.primary_metric).replaceAll('_', ' ')} changed by ${Math.abs(delta).toFixed(3)}. This is an observational ${String(outcome).replaceAll('_', ' ')} with ${causalConfidence} causal confidence, not proof that the intervention caused the change.`;
  return { outcome, causalConfidence, baselineValue, currentValue, delta, targetObservationCounts: { baseline: baselineTarget.length, current: currentTarget.length }, dataCompleteness: completeness, comparability, reasons, statement };
}

function validateInterventionBody(body: InterventionBody) {
  if (!body.title?.trim() || !body.hypothesis?.trim() || !body.mechanism?.trim()) throw httpError(400, 'title, hypothesis, and mechanism are required');
  if (!Array.isArray(body.targetPromptKeys) || !body.targetPromptKeys.length) throw httpError(400, 'targetPromptKeys are required');
  if (!['mention_rate', 'average_mention_status', 'weighted_visibility'].includes(body.primaryMetric)) throw httpError(400, 'invalid primaryMetric');
}
function targetEvidence(snapshot: any, targets: string[], providers: string[]) { const targetSet = new Set(targets); const providerSet = new Set(providers); return (snapshot?.evidence ?? []).filter((item: any) => targetSet.has(item.prompt?.stableKey ?? item.prompt?.id) && (!providerSet.size || providerSet.has(item.provider?.name))); }
function metricValue(snapshot: any, targets: string[], providers: string[], metric: string) { const evidence = targetEvidence(snapshot, targets, providers); if (!evidence.length) return 0; if (metric === 'mention_rate') return round(evidence.filter((item: any) => status(item) > 0).length / evidence.length, 4); if (metric === 'average_mention_status') return round(evidence.reduce((sum: number, item: any) => sum + status(item), 0) / evidence.length, 4); const numerator = evidence.reduce((sum: number, item: any) => sum + status(item) * Number(item.prompt?.importance ?? 1), 0); const denominator = evidence.reduce((sum: number, item: any) => sum + 4 * Number(item.prompt?.importance ?? 1), 0); return denominator ? round(numerator / denominator, 4) : 0; }
function compareMethodology(current: any, baseline: any) { const fields = ['promptPanelVersionId', 'providerProfilesFingerprint', 'searchModesFingerprint', 'geographyFingerprint', 'localeFingerprint', 'scoringModelVersion']; const changed = fields.filter((field) => current?.methodology?.[field] !== baseline?.methodology?.[field]); if (changed.length) return { class: 'not_comparable', reasons: changed.map((field) => `${field} changed`) }; const reasons: string[] = []; if (current?.methodology?.reportedModelsFingerprint !== baseline?.methodology?.reportedModelsFingerprint) reasons.push('reported model changed'); if (Number(current?.methodology?.repetitions ?? 1) !== Number(baseline?.methodology?.repetitions ?? 1)) reasons.push('repetition count changed'); return reasons.length ? { class: 'directionally_comparable', reasons } : { class: 'fully_comparable', reasons: [] }; }
async function methodologyFingerprint(snapshot: any) { const m = snapshot?.methodology ?? {}; const canonical = JSON.stringify(sortValue({ promptPanelVersionId: m.promptPanelVersionId, providerProfilesFingerprint: m.providerProfilesFingerprint, searchModesFingerprint: m.searchModesFingerprint, geographyFingerprint: m.geographyFingerprint, localeFingerprint: m.localeFingerprint, scoringModelVersion: m.scoringModelVersion })); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function dataCompleteness(snapshot: any) { const intended = Number(snapshot?.auditRun?.intendedObservations ?? snapshot?.scoring?.metrics?.intendedObservations ?? 0); const successful = Number(snapshot?.auditRun?.successfulObservations ?? snapshot?.scoring?.metrics?.successfulObservations ?? 0); return intended > 0 ? successful / intended : 0; }
function status(item: any) { return Number(item?.reviewedClassification?.mention_status ?? item?.reviewedClassification?.mentionStatus ?? 0); }
function sortValue(value: any): any { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
function unique(values: string[]) { return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]; }
function bounded(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function nonNegative(value: unknown, fallback: number) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback; }
function between(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : fallback; }
function positiveInteger(value: unknown, fallback: number) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function validTimestamp(value: unknown) { if (!value) return null; const time = new Date(String(value)); return Number.isFinite(time.getTime()) ? time.toISOString() : null; }
function round(value: number, places = 4) { const factor = 10 ** places; return Math.round((value + Number.EPSILON) * factor) / factor; }
function httpError(status: number, message: string) { const error = new Error(message) as Error & { status: number }; error.status = status; return error; }
