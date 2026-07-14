import { createHash } from 'node:crypto';

const PURPOSES = new Set(['benchmark_intelligence', 'recommendation_learning', 'source_graph']);
const METHODOLOGY_FIELDS = ['promptPanelFingerprint','providerProfilesFingerprint','searchModesFingerprint','geographyFingerprint','localeFingerprint','scoringModelVersion'];

export function consentEligible(consent, purpose, now = Date.now()) {
  if (!PURPOSES.has(purpose)) return { eligible: false, reason: 'unsupported_purpose' };
  if (!consent || consent.purpose !== purpose) return { eligible: false, reason: 'missing_consent' };
  if (consent.status !== 'granted' || consent.withdrawnAt) return { eligible: false, reason: 'withdrawn_or_inactive' };
  if (consent.expiresAt && new Date(consent.expiresAt).getTime() <= now) return { eligible: false, reason: 'expired' };
  return { eligible: true };
}

export function methodologyCohortKey(methodology, dimensions = {}) {
  const missing = METHODOLOGY_FIELDS.filter((field) => methodology?.[field] === undefined || methodology?.[field] === null || methodology?.[field] === '');
  if (missing.length) throw new Error(`incomplete methodology: ${missing.join(', ')}`);
  return fingerprint({ methodology: Object.fromEntries(METHODOLOGY_FIELDS.map((field) => [field, methodology[field]])), dimensions });
}

export function buildBenchmarkSnapshot({ records = [], consents = [], rule = {}, generatedAt = new Date().toISOString() }) {
  const purpose = rule.purpose ?? 'benchmark_intelligence';
  const consentMap = latestConsentMap(consents, purpose);
  const dimensionNames = rule.dimensions ?? ['industry','geography','locale'];
  const groups = new Map();
  const exclusions = { noConsent: 0, incompleteMethodology: 0, invalidMetrics: 0 };
  for (const record of records) {
    if (!consentEligible(consentMap.get(record.workspaceId), purpose, new Date(generatedAt).getTime()).eligible) { exclusions.noConsent += 1; continue; }
    let methodologyKey;
    const dimensions = Object.fromEntries(dimensionNames.map((name) => [name, record.dimensions?.[name] ?? 'unknown']));
    try { methodologyKey = methodologyCohortKey(record.methodology, dimensions); } catch { exclusions.incompleteMethodology += 1; continue; }
    if (!record.metrics || !Number.isFinite(Number(record.observationCount)) || Number(record.observationCount) < 1) { exclusions.invalidMetrics += 1; continue; }
    const group = groups.get(methodologyKey) ?? { methodologyKey, dimensions, workspaces: new Set(), brands: new Set(), observationCount: 0, metrics: {} };
    group.workspaces.add(record.workspaceId); group.brands.add(record.brandId); group.observationCount += Number(record.observationCount);
    for (const [metric, value] of Object.entries(record.metrics)) if (Number.isFinite(Number(value))) (group.metrics[metric] ??= []).push(Number(value));
    groups.set(methodologyKey, group);
  }
  const minWorkspaces = Number(rule.minWorkspaces ?? 5), minBrands = Number(rule.minBrands ?? 5), minObservations = Number(rule.minObservations ?? 100);
  const cohorts = [...groups.values()].map((group) => {
    const counts = { workspaces: group.workspaces.size, brands: group.brands.size, observations: group.observationCount };
    const suppressed = counts.workspaces < minWorkspaces || counts.brands < minBrands || counts.observations < minObservations;
    return suppressed ? { cohortKey: group.methodologyKey, dimensions: group.dimensions, counts, suppressed: true, suppressionReason: 'privacy_threshold' } : { cohortKey: group.methodologyKey, dimensions: group.dimensions, counts, suppressed: false, statistics: Object.fromEntries(Object.entries(group.metrics).map(([metric, values]) => [metric, distribution(values)])) };
  }).sort((a, b) => a.cohortKey.localeCompare(b.cohortKey));
  const core = { schemaVersion: 1, purpose, rule: { dimensions: dimensionNames, minWorkspaces, minBrands, minObservations }, exclusions, cohorts };
  return deepFreeze({ ...core, generatedAt, fingerprint: fingerprint(core) });
}

export function tenantBenchmarkView(snapshot, ownRecord) {
  const dimensions = Object.fromEntries((snapshot.rule?.dimensions ?? []).map((name) => [name, ownRecord.dimensions?.[name] ?? 'unknown']));
  const cohortKey = methodologyCohortKey(ownRecord.methodology, dimensions);
  const cohort = snapshot.cohorts.find((item) => item.cohortKey === cohortKey);
  if (!cohort) return { available: false, reason: 'no_matching_cohort', ownMetrics: structuredClone(ownRecord.metrics ?? {}) };
  if (cohort.suppressed) return { available: false, reason: 'privacy_threshold', cohort: { dimensions: cohort.dimensions, counts: cohort.counts, suppressed: true }, ownMetrics: structuredClone(ownRecord.metrics ?? {}) };
  return { available: true, cohort: structuredClone(cohort), ownMetrics: structuredClone(ownRecord.metrics ?? {}), deltas: Object.fromEntries(Object.entries(ownRecord.metrics ?? {}).filter(([, value]) => Number.isFinite(Number(value))).map(([metric, value]) => [metric, Number(value) - Number(cohort.statistics?.[metric]?.median ?? value)])) };
}

export function buildSourceGraph(reportSnapshots = []) {
  const nodes = new Map(), edges = new Map();
  for (const snapshot of reportSnapshots) for (const evidence of snapshot.evidence ?? []) {
    const provider = evidence.provider?.name ?? 'unknown';
    for (const [kind, items] of [['inline_citation', evidence.citations ?? []], ['retrieved', evidence.sources ?? []]]) for (const item of items) {
      const domain = normalizedDomain(item.domain ?? item.url); if (!domain) continue;
      const node = nodes.get(domain) ?? { domain, inlineCitations: 0, retrievedSources: 0, providers: new Set(), ownership: {} };
      if (kind === 'inline_citation') node.inlineCitations += 1; else node.retrievedSources += 1;
      node.providers.add(provider); node.ownership[item.ownership ?? 'unknown'] = (node.ownership[item.ownership ?? 'unknown'] ?? 0) + 1; nodes.set(domain, node);
      const edgeKey = `${provider}|${domain}|${kind}`; edges.set(edgeKey, { provider, domain, kind, count: (edges.get(edgeKey)?.count ?? 0) + 1 });
    }
  }
  const publicNodes = [...nodes.values()].map((node) => ({ ...node, providers: [...node.providers].sort(), providerDependent: node.providers.size === 1 })).sort((a,b) => a.domain.localeCompare(b.domain));
  const core = { schemaVersion: 1, nodes: publicNodes, edges: [...edges.values()].sort((a,b) => `${a.provider}${a.domain}${a.kind}`.localeCompare(`${b.provider}${b.domain}${b.kind}`)) };
  return deepFreeze({ ...core, fingerprint: fingerprint(core) });
}

export function compareSourceGraphs(current, baseline) {
  const currentMap = new Map(current.nodes.map((node) => [node.domain, node])); const baselineMap = new Map(baseline.nodes.map((node) => [node.domain, node]));
  const appeared = [...currentMap.keys()].filter((domain) => !baselineMap.has(domain)).sort();
  const disappeared = [...baselineMap.keys()].filter((domain) => !currentMap.has(domain)).sort();
  const changed = [...currentMap.keys()].filter((domain) => baselineMap.has(domain)).map((domain) => ({ domain, inlineDelta: currentMap.get(domain).inlineCitations - baselineMap.get(domain).inlineCitations, retrievedDelta: currentMap.get(domain).retrievedSources - baselineMap.get(domain).retrievedSources })).filter((item) => item.inlineDelta || item.retrievedDelta);
  return deepFreeze({ appeared, disappeared, changed, providerDependent: current.nodes.filter((node) => node.providerDependent).map((node) => node.domain) });
}

export function detectCanaryDrift({ baseline = [], current = [], thresholds = {} }) {
  const defaults = { refusalRateDelta: 0.15, citationMeanDelta: 2, latencyRatio: 1.75, costRatio: 1.5, mentionMeanDelta: 1 };
  const limits = { ...defaults, ...thresholds }; const base = summarizeCanaries(baseline), now = summarizeCanaries(current); const providers = [...new Set([...base.keys(), ...now.keys()])]; const drifts = [];
  for (const provider of providers) {
    const before = base.get(provider), after = now.get(provider); if (!before || !after) { drifts.push({ provider, severity: 'high', reasons: ['provider sample missing'] }); continue; }
    const reasons = [];
    if (after.refusalRate - before.refusalRate >= limits.refusalRateDelta) reasons.push('refusal_rate_increased');
    if (Math.abs(after.meanCitations - before.meanCitations) >= limits.citationMeanDelta) reasons.push('citation_pattern_changed');
    if (before.p95LatencyMs > 0 && after.p95LatencyMs / before.p95LatencyMs >= limits.latencyRatio) reasons.push('latency_increased');
    if (before.meanCostMicros > 0 && after.meanCostMicros / before.meanCostMicros >= limits.costRatio) reasons.push('cost_increased');
    if (Math.abs(after.meanMentionStatus - before.meanMentionStatus) >= limits.mentionMeanDelta) reasons.push('mention_distribution_changed');
    if (reasons.length) drifts.push({ provider, severity: reasons.length >= 3 ? 'high' : 'medium', reasons, baseline: before, current: after });
  }
  return deepFreeze({ status: drifts.length ? 'drift_detected' : 'stable', drifts, providerWide: providers.length > 0 && drifts.length / providers.length >= 0.5, mustReviewBeforeCustomerInterpretation: drifts.length > 0 });
}

export function buildRecommendationEvidence(evaluations = [], { minSamples = 3 } = {}) {
  const groups = new Map();
  for (const item of evaluations) {
    if (!['success','partial_success','no_change','regression'].includes(item.outcome) || !item.implementationVerified) continue;
    const key = `${item.interventionType ?? 'other'}|${item.mechanism ?? 'unknown'}`;
    const group = groups.get(key) ?? { interventionType: item.interventionType ?? 'other', mechanism: item.mechanism ?? 'unknown', samples: [] };
    group.samples.push(item); groups.set(key, group);
  }
  return deepFreeze([...groups.values()].map((group) => {
    const count = group.samples.length; if (count < minSamples) return { interventionType: group.interventionType, mechanism: group.mechanism, sampleCount: count, suppressed: true, reason: 'insufficient_evidence' };
    const successes = group.samples.filter((item) => ['success','partial_success'].includes(item.outcome)).length; const regressions = group.samples.filter((item) => item.outcome === 'regression').length;
    const deltas = group.samples.map((item) => Number(item.delta)).filter(Number.isFinite);
    return { interventionType: group.interventionType, mechanism: group.mechanism, sampleCount: count, suppressed: false, favourableRate: successes / count, regressionRate: regressions / count, medianDelta: quantile(deltas, 0.5), confidence: count >= 20 ? 'moderate_directional' : 'low_directional', limitation: 'Historical observational outcomes do not prove this intervention will cause future visibility improvement.' };
  }).sort((a,b) => `${a.interventionType}${a.mechanism}`.localeCompare(`${b.interventionType}${b.mechanism}`)));
}

export function launchReadiness({ activeConsents = 0, visibleBenchmarkCohorts = 0, canaryStatus = 'unknown', recommendationGroups = 0, latestDeploymentVerified = false, livePilotVerified = false }) {
  const checks = { consentProgram: activeConsents > 0, benchmarkPrivacy: visibleBenchmarkCohorts > 0, canaryStable: canaryStatus === 'stable', recommendationEvidence: recommendationGroups > 0, deploymentVerified: latestDeploymentVerified, livePilotVerified };
  return deepFreeze({ status: Object.values(checks).every(Boolean) ? 'ready' : 'conditional', checks, blockedCapabilities: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name) });
}

function latestConsentMap(consents, purpose) { const map = new Map(); for (const consent of [...consents].filter((item) => item.purpose === purpose).sort((a,b) => new Date(a.updatedAt ?? a.grantedAt ?? 0) - new Date(b.updatedAt ?? b.grantedAt ?? 0))) map.set(consent.workspaceId, consent); return map; }
function distribution(values) { const sorted = [...values].sort((a,b) => a-b); return { count: sorted.length, mean: sorted.reduce((a,b) => a+b,0) / Math.max(1, sorted.length), p25: quantile(sorted,0.25), median: quantile(sorted,0.5), p75: quantile(sorted,0.75) }; }
function quantile(values, q) { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b); const position = (sorted.length - 1) * q; const lower = Math.floor(position), upper = Math.ceil(position); return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower); }
function summarizeCanaries(samples) { const groups = new Map(); for (const sample of samples) (groups.get(sample.provider) ?? groups.set(sample.provider, []).get(sample.provider)).push(sample); return new Map([...groups].map(([provider, items]) => { const latencies = items.map((item) => Number(item.latencyMs ?? 0)).sort((a,b) => a-b); return [provider, { samples: items.length, refusalRate: items.filter((item) => item.refused).length / items.length, successRate: items.filter((item) => item.ok).length / items.length, meanCitations: mean(items.map((item) => item.citationCount)), p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0, meanCostMicros: mean(items.map((item) => item.costMicros)), meanMentionStatus: mean(items.map((item) => item.mentionStatus)) }]; })); }
function mean(values) { const numbers = values.map(Number).filter(Number.isFinite); return numbers.length ? numbers.reduce((a,b) => a+b,0) / numbers.length : 0; }
function normalizedDomain(value) { try { return new URL(String(value).includes('://') ? value : `https://${value}`).hostname.replace(/^www\./,'').toLowerCase(); } catch { return null; } }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex'); }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
