import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const REVIEWED_DECISIONS = new Set(['accepted', 'corrected']);
const REPORT_STATES = new Set(['draft', 'internal_review', 'customer_ready', 'published', 'superseded', 'withdrawn']);

export function buildReportSnapshot(input) {
  validateReportInput(input);
  const approved = new Map(
    input.observations
      .filter((item) => REVIEWED_DECISIONS.has(item.review?.decision))
      .map((item) => [item.id, item])
  );
  const evidence = input.scoreCalculation.inputObservationIds.map((id) => customerEvidence(approved.get(id)));
  const snapshot = {
    schemaVersion: 1,
    reportVersionId: input.reportVersionId,
    reportId: input.reportId,
    workspaceId: input.workspaceId,
    publicationState: input.publicationState ?? 'customer_ready',
    title: input.narrative.title,
    executiveSummary: input.narrative.executiveSummary,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    brand: pick(input.brand, ['id', 'name', 'domain']),
    auditRun: {
      id: input.auditRun.id,
      state: input.auditRun.state,
      completedAt: input.auditRun.completedAt ?? null,
      promptPanelVersionId: input.auditRun.promptPanelVersionId,
      intendedObservations: metricNumber(input.scoreCalculation.metrics, 'intendedObservations'),
      successfulObservations: metricNumber(input.scoreCalculation.metrics, 'successfulObservations'),
      terminalFailures: metricNumber(input.scoreCalculation.metrics, 'terminalFailures'),
      excludedObservations: metricNumber(input.scoreCalculation.metrics, 'excludedObservations')
    },
    methodology: normalizeMethodology(input),
    scoring: {
      calculationId: input.scoreCalculation.id,
      modelVersion: input.scoreCalculation.scoringModelVersion,
      inputObservationIds: [...input.scoreCalculation.inputObservationIds],
      metrics: structuredClone(input.scoreCalculation.metrics)
    },
    findings: (input.findings ?? []).filter((item) => item.customerVisible !== false).map(customerFinding),
    evidence,
    nextMeasurement: input.narrative.nextMeasurement ?? null,
    limitations: unique([
      ...(input.limitations ?? []),
      'AI answers are sampled observations, not deterministic rankings.',
      'Failed and excluded observations are disclosed and do not count as brand absence.'
    ])
  };
  return deepFreeze(snapshot);
}

export function validateReportInput(input) {
  const errors = [];
  if (!input?.reportId) errors.push('reportId is required');
  if (!input?.reportVersionId) errors.push('reportVersionId is required');
  if (!input?.workspaceId) errors.push('workspaceId is required');
  if (!input?.brand?.id || !input?.brand?.name) errors.push('brand id and name are required');
  if (!['ready', 'delivered'].includes(input?.auditRun?.state)) errors.push('audit run must be ready or delivered');
  if (!input?.scoreCalculation?.scoringModelVersion) errors.push('scoring model version is required');
  if (!Array.isArray(input?.scoreCalculation?.inputObservationIds)) errors.push('input observation ids are required');
  if (!Array.isArray(input?.observations)) errors.push('observations are required');
  if (!input?.narrative?.title || !input?.narrative?.executiveSummary) errors.push('title and executive summary are required');
  if (input?.publicationState && !REPORT_STATES.has(input.publicationState)) errors.push('invalid publication state');

  const byId = new Map((input?.observations ?? []).map((item) => [item.id, item]));
  for (const observationId of input?.scoreCalculation?.inputObservationIds ?? []) {
    const item = byId.get(observationId);
    if (!item) errors.push(`score input ${observationId} is not traceable to an observation`);
    else if (!REVIEWED_DECISIONS.has(item.review?.decision)) errors.push(`score input ${observationId} is not accepted or corrected`);
  }
  const metrics = input?.scoreCalculation?.metrics ?? {};
  const intended = metricNumber(metrics, 'intendedObservations');
  const successful = metricNumber(metrics, 'successfulObservations');
  const terminal = metricNumber(metrics, 'terminalFailures');
  const excluded = metricNumber(metrics, 'excludedObservations');
  if (intended < successful + terminal) errors.push('metric counts exceed intended observations');
  if (successful < (input?.scoreCalculation?.inputObservationIds?.length ?? 0) + excluded) errors.push('reviewed and excluded counts exceed successful observations');
  if (errors.length) throw new Error(`Report input is invalid:\n- ${errors.join('\n- ')}`);
  return true;
}

export function compareMethodology(current, baseline) {
  const critical = [
    ['promptPanelFingerprint', current.promptPanelFingerprint, baseline.promptPanelFingerprint],
    ['providerProfilesFingerprint', current.providerProfilesFingerprint, baseline.providerProfilesFingerprint],
    ['searchModesFingerprint', current.searchModesFingerprint, baseline.searchModesFingerprint],
    ['geographyFingerprint', current.geographyFingerprint, baseline.geographyFingerprint],
    ['localeFingerprint', current.localeFingerprint, baseline.localeFingerprint],
    ['scoringModelVersion', current.scoringModelVersion, baseline.scoringModelVersion]
  ];
  const criticalChanges = critical.filter(([, a, b]) => a !== b).map(([field]) => field);
  if (criticalChanges.length) return { class: 'not_comparable', reasons: criticalChanges.map((field) => `${field} changed`) };
  const directionalChanges = [];
  if (current.reportedModelsFingerprint !== baseline.reportedModelsFingerprint) directionalChanges.push('reported model changed');
  if (current.repetitions !== baseline.repetitions) directionalChanges.push('repetition count changed');
  if (directionalChanges.length) return { class: 'directionally_comparable', reasons: directionalChanges };
  return { class: 'fully_comparable', reasons: [] };
}

export function compareReportSnapshots(current, baseline) {
  const methodology = compareMethodology(current.methodology, baseline.methodology);
  if (methodology.class === 'not_comparable') {
    return deepFreeze({
      schemaVersion: 1,
      currentReportVersionId: current.reportVersionId,
      baselineReportVersionId: baseline.reportVersionId,
      comparability: methodology,
      summary: { compared: 0, improved: 0, declined: 0, changed: 0, notComparable: current.evidence.length },
      changes: []
    });
  }
  const previous = new Map(baseline.evidence.map((item) => [evidenceKey(item), item]));
  const changes = current.evidence.map((item) => classifyChange(item, previous.get(evidenceKey(item)), methodology.class));
  const summary = {
    compared: changes.filter((item) => item.change !== 'not_comparable').length,
    improved: changes.filter((item) => ['newly_visible', 'improved_prominence'].includes(item.change)).length,
    declined: changes.filter((item) => ['lost_visibility', 'declined_prominence'].includes(item.change)).length,
    changed: changes.filter((item) => !['stable_positive', 'stable_absent', 'not_comparable'].includes(item.change)).length,
    notComparable: changes.filter((item) => item.change === 'not_comparable').length
  };
  return deepFreeze({
    schemaVersion: 1,
    currentReportVersionId: current.reportVersionId,
    baselineReportVersionId: baseline.reportVersionId,
    comparability: methodology,
    summary,
    changes
  });
}

export function createSignedShareToken({ reportVersionId, expiresAt, nonce = randomBytes(12).toString('base64url') }, secret) {
  if (!secret) throw new Error('share secret is required');
  const payload = Buffer.from(JSON.stringify({ reportVersionId, expiresAt, nonce })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySignedShareToken(token, secret, now = Date.now()) {
  try {
    const [payload, signature, extra] = String(token).split('.');
    if (!payload || !signature || extra) return { valid: false, reason: 'malformed' };
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { valid: false, reason: 'invalid_signature' };
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expiresAt = new Date(decoded.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return { valid: false, reason: 'expired' };
    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

export function customerSafeSnapshot(snapshot) {
  return structuredClone(snapshot);
}

function normalizeMethodology(input) {
  const config = input.auditRun.frozenConfiguration ?? {};
  const methodology = config.methodology ?? {};
  return {
    promptPanelVersionId: input.auditRun.promptPanelVersionId,
    promptPanelFingerprint: methodology.promptPanelFingerprint ?? fingerprint(input.observations.map((item) => [item.prompt.stableKey, item.prompt.text])),
    providerProfilesFingerprint: methodology.providerProfilesFingerprint ?? fingerprint(input.observations.map((item) => [item.provider.profileId, item.provider.requestedModel, item.provider.searchMode])),
    reportedModelsFingerprint: fingerprint(input.observations.map((item) => [item.provider.name, item.provider.reportedModel ?? item.provider.requestedModel])),
    searchModesFingerprint: fingerprint(input.observations.map((item) => item.provider.searchMode)),
    geographyFingerprint: fingerprint(methodology.geography ?? config.geography ?? {}),
    localeFingerprint: fingerprint(methodology.locale ?? config.locale ?? ''),
    repetitions: Number(methodology.repetitions ?? input.auditRun.repetitions ?? 1),
    scoringModelVersion: input.scoreCalculation.scoringModelVersion,
    providers: unique(input.observations.map((item) => item.provider.name)),
    reportedModels: unique(input.observations.map((item) => item.provider.reportedModel ?? item.provider.requestedModel)),
    searchModes: unique(input.observations.map((item) => item.provider.searchMode))
  };
}

function customerEvidence(item) {
  if (!item) throw new Error('Evidence item is missing');
  const accepted = item.review.acceptedClassification ?? item.machineClassification;
  return {
    observationId: item.id,
    auditRunItemId: item.auditRunItemId,
    prompt: pick(item.prompt, ['id', 'stableKey', 'text', 'stage', 'importance', 'persona', 'locale', 'geography']),
    provider: pick(item.provider, ['profileId', 'name', 'requestedModel', 'reportedModel', 'searchMode']),
    repetition: item.repetition,
    answerText: item.answerText,
    citations: (item.citations ?? []).map((citation) => pick(citation, ['url', 'title', 'domain', 'ownership', 'start', 'end'])),
    sources: (item.sources ?? []).map((source) => pick(source, ['url', 'title', 'domain', 'ownership'])),
    reviewedClassification: structuredClone(accepted),
    reviewDecision: item.review.decision,
    receivedAt: item.receivedAt,
    stability: item.stability ?? 'insufficient_sample'
  };
}

function customerFinding(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    summary: item.summary,
    evidenceObservationIds: [...(item.evidenceObservationIds ?? [])],
    confidence: item.confidence ?? 'medium',
    suggestedInvestigation: item.suggestedInvestigation ?? null
  };
}

function classifyChange(current, previous, comparabilityClass) {
  if (!previous) return { key: evidenceKey(current), prompt: current.prompt.text, provider: current.provider.name, change: 'not_comparable', reason: 'no matching baseline observation' };
  if (comparabilityClass === 'directionally_comparable' && (current.stability === 'volatile' || previous.stability === 'volatile')) {
    return { key: evidenceKey(current), prompt: current.prompt.text, provider: current.provider.name, change: 'volatile', from: status(previous), to: status(current) };
  }
  const from = status(previous);
  const to = status(current);
  let change = 'stable_absent';
  if (from === 0 && to > 0) change = 'newly_visible';
  else if (from > 0 && to === 0) change = 'lost_visibility';
  else if (to > from) change = 'improved_prominence';
  else if (to < from) change = 'declined_prominence';
  else if (to > 0) change = 'stable_positive';
  return { key: evidenceKey(current), prompt: current.prompt.text, provider: current.provider.name, change, from, to };
}

function evidenceKey(item) {
  return [item.prompt.stableKey ?? item.prompt.id, item.provider.profileId ?? item.provider.name, item.provider.searchMode, item.prompt.locale ?? ''].join('|');
}

function status(item) {
  return Number(item.reviewedClassification?.mention_status ?? item.reviewedClassification?.mentionStatus ?? 0);
}

function fingerprint(value) {
  const canonical = JSON.stringify(sortValue(value));
  return createHmac('sha256', 'citely-methodology-v1').update(canonical).digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  return value;
}

function metricNumber(metrics, camel) {
  const snake = camel.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
  const value = metrics?.[camel] ?? metrics?.[snake] ?? 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object?.[key] !== undefined).map((key) => [key, structuredClone(object[key])]));
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
