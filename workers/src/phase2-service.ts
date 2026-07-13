import { SupabaseRest } from './supabase';
import { renderPublishedReport, renderShareError, type PublishedSnapshot } from './portal';
import type { Env } from './workflow-types';

type ReviewBody = { decision: 'accepted' | 'corrected' | 'excluded'; acceptedClassification?: Record<string, unknown> | null; reasonCode?: string | null; notes?: string | null };
type ReportBody = { title: string; executiveSummary: string; findings?: Array<Record<string, unknown>>; limitations?: string[]; nextMeasurement?: string | null };

export async function getReviewQueue(db: SupabaseRest, workspaceId: string) {
  const items = await db.select<any>('audit_run_items', [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    'state=eq.review_required',
    'select=id,audit_run_id,repetition,successful_observation_id,prompt_versions(id,text,stage,importance,persona,locale,geography,prompts(stable_key)),provider_profiles(id,name,provider,requested_model,search_mode)',
    'order=created_at.asc'
  ].join('&'));
  const queue = [];
  for (const item of items) {
    if (!item.successful_observation_id) continue;
    const observation = await db.one<any>('observations', `id=eq.${encodeURIComponent(item.successful_observation_id)}&select=id,answer_text,automated_classification,reported_provider,reported_model,search_mode,received_at`);
    const sources = await db.select<any>('response_sources', `observation_id=eq.${encodeURIComponent(observation.id)}&select=url,title,domain,ownership,source_kind,citation_start,citation_end`);
    queue.push({ ...item, observation: { ...observation, sources } });
  }
  return queue;
}

export async function reviewAuditItem(db: SupabaseRest, itemId: string, reviewerId: string, body: ReviewBody) {
  if (!['accepted', 'corrected', 'excluded'].includes(body.decision)) throw httpError(400, 'invalid review decision');
  if (body.decision === 'corrected' && !body.acceptedClassification) throw httpError(400, 'corrected decisions require acceptedClassification');
  const item = await db.one<{ id: string; workspace_id: string; audit_run_id: string; state: string; successful_observation_id: string | null }>('audit_run_items', `id=eq.${encodeURIComponent(itemId)}&select=id,workspace_id,audit_run_id,state,successful_observation_id`);
  if (item.state !== 'review_required') throw httpError(409, `item is ${item.state}, not review_required`);
  if (!item.successful_observation_id) throw httpError(409, 'item has no accepted raw observation');
  const observation = await db.one<{ id: string; automated_classification: Record<string, unknown> }>('observations', `id=eq.${encodeURIComponent(item.successful_observation_id)}&select=id,automated_classification`);
  const acceptedClassification = body.decision === 'accepted' ? observation.automated_classification : body.decision === 'corrected' ? body.acceptedClassification : null;
  const [decision] = await db.insert<{ id: string }>('review_decisions', {
    workspace_id: item.workspace_id,
    audit_run_id: item.audit_run_id,
    audit_run_item_id: item.id,
    observation_id: observation.id,
    reviewer_id: reviewerId,
    decision: body.decision,
    reason_code: body.reasonCode ?? null,
    notes: body.notes ?? null,
    machine_classification: observation.automated_classification,
    accepted_classification: acceptedClassification
  });
  await db.patch('audit_run_items', `id=eq.${encodeURIComponent(item.id)}`, { state: body.decision });
  const remaining = await db.select<{ state: string }>('audit_run_items', `audit_run_id=eq.${encodeURIComponent(item.audit_run_id)}&select=state`);
  const unresolved = remaining.some((row) => ['review_required', 'planned', 'attempting', 'retry_scheduled', 'succeeded'].includes(row.state));
  await db.patch('audit_runs', `id=eq.${encodeURIComponent(item.audit_run_id)}`, { state: unresolved ? 'review_in_progress' : 'ready' });
  return { reviewDecisionId: decision.id, itemId: item.id, state: body.decision, auditRunState: unresolved ? 'review_in_progress' : 'ready' };
}

export async function createReportDraft(db: SupabaseRest, auditRunId: string, actorId: string, body: ReportBody) {
  if (!body.title?.trim() || !body.executiveSummary?.trim()) throw httpError(400, 'title and executiveSummary are required');
  const run = await db.one<any>('audit_runs', `id=eq.${encodeURIComponent(auditRunId)}&select=id,workspace_id,brand_id,prompt_panel_version_id,state,repetitions,frozen_configuration,completed_at,brands(id,name,domain)`);
  if (!['ready', 'delivered'].includes(run.state)) throw httpError(409, 'audit run must be ready or delivered');
  const scores = await db.select<any>('score_calculations', `audit_run_id=eq.${encodeURIComponent(auditRunId)}&select=id,scoring_model_version,input_observation_ids,metrics,created_at&order=created_at.desc&limit=1`);
  if (!scores[0]) throw httpError(409, 'audit run has no score calculation');
  const score = scores[0];
  const observations = await loadEvidence(db, score.input_observation_ids as string[]);
  const reportVersionId = crypto.randomUUID();
  const snapshot = await buildSnapshot(run, score, observations, body);
  snapshot.reportVersionId = reportVersionId;
  const existing = await db.select<{ id: string }>('report_drafts', `audit_run_id=eq.${encodeURIComponent(auditRunId)}&select=id&limit=1`);
  const report = existing[0] ?? (await db.insert<{ id: string }>('report_drafts', { workspace_id: run.workspace_id, audit_run_id: run.id, title: body.title.trim(), state: 'customer_ready', executive_summary: body.executiveSummary.trim(), created_by: actorId }))[0];
  if (existing[0]) await db.patch('report_drafts', `id=eq.${encodeURIComponent(report.id)}`, { title: body.title.trim(), state: 'customer_ready', executive_summary: body.executiveSummary.trim(), updated_at: new Date().toISOString() });
  const versions = await db.select<{ version: number }>('report_versions', `report_draft_id=eq.${encodeURIComponent(report.id)}&select=version&order=version.desc&limit=1`);
  const version = (versions[0]?.version ?? 0) + 1;
  const [reportVersion] = await db.insert<{ id: string }>('report_versions', { id: reportVersionId, workspace_id: run.workspace_id, report_draft_id: report.id, version, snapshot, input_observation_ids: score.input_observation_ids, scoring_model_version: score.scoring_model_version, created_by: actorId });
  return { reportId: report.id, reportVersionId: reportVersion.id, version, state: 'customer_ready', snapshot };
}

export async function publishReport(db: SupabaseRest, reportId: string, actorId: string) {
  const report = await db.one<{ id: string; workspace_id: string; state: string }>('report_drafts', `id=eq.${encodeURIComponent(reportId)}&select=id,workspace_id,state`);
  if (!['customer_ready', 'published'].includes(report.state)) throw httpError(409, `report is ${report.state}`);
  const version = await db.one<{ id: string; version: number }>('report_versions', `report_draft_id=eq.${encodeURIComponent(reportId)}&select=id,version&order=version.desc&limit=1`);
  const existing = await db.select<{ id: string }>('report_publications', `report_version_id=eq.${encodeURIComponent(version.id)}&select=id&limit=1`);
  const publication = existing[0] ?? (await db.insert<{ id: string }>('report_publications', { workspace_id: report.workspace_id, report_version_id: version.id, published_by: actorId }))[0];
  await db.patch('report_drafts', `id=eq.${encodeURIComponent(report.id)}`, { state: 'published', updated_at: new Date().toISOString() });
  return { reportId: report.id, reportVersionId: version.id, publicationId: publication.id, state: 'published' };
}

export async function createShareLink(db: SupabaseRest, env: Env, reportId: string, actorId: string, expiresInHours: number) {
  const report = await db.one<{ id: string }>('report_drafts', `id=eq.${encodeURIComponent(reportId)}&state=eq.published&select=id`);
  const version = await db.one<{ id: string }>('report_versions', `report_draft_id=eq.${encodeURIComponent(report.id)}&select=id&order=version.desc&limit=1`);
  const publication = await db.one<{ id: string; workspace_id: string }>('report_publications', `report_version_id=eq.${encodeURIComponent(version.id)}&withdrawn_at=is.null&select=id,workspace_id`);
  const hours = Math.min(Math.max(Number(expiresInHours) || 72, 1), 720);
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
  await db.insert('report_share_links', { workspace_id: publication.workspace_id, report_publication_id: publication.id, token_hash: tokenHash, expires_at: expiresAt, created_by: actorId });
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return { token, expiresAt, url: `${base}/share/${encodeURIComponent(token)}` };
}

export async function serveSharedReport(db: SupabaseRest, token: string) {
  const tokenHash = await sha256(token);
  const links = await db.select<any>('report_share_links', `token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,report_publication_id,expires_at,revoked_at,access_count&limit=1`);
  const link = links[0];
  if (!link) return renderShareError(404, 'The report link is invalid.');
  if (link.revoked_at) return renderShareError(410, 'The report link has been revoked.');
  if (new Date(link.expires_at).getTime() <= Date.now()) return renderShareError(410, 'The report link has expired.');
  const publication = await db.one<any>('report_publications', `id=eq.${encodeURIComponent(link.report_publication_id)}&select=id,report_version_id,withdrawn_at`);
  if (publication.withdrawn_at) return renderShareError(410, 'This report has been withdrawn.');
  const version = await db.one<{ snapshot: PublishedSnapshot }>('report_versions', `id=eq.${encodeURIComponent(publication.report_version_id)}&select=snapshot`);
  await db.patch('report_share_links', `id=eq.${encodeURIComponent(link.id)}`, { last_accessed_at: new Date().toISOString(), access_count: Number(link.access_count ?? 0) + 1 });
  return renderPublishedReport(version.snapshot);
}

export async function getReport(db: SupabaseRest, reportId: string) {
  const report = await db.one<any>('report_drafts', `id=eq.${encodeURIComponent(reportId)}&select=id,workspace_id,audit_run_id,title,state,executive_summary,created_at,updated_at`);
  const versions = await db.select<any>('report_versions', `report_draft_id=eq.${encodeURIComponent(reportId)}&select=id,version,snapshot,scoring_model_version,created_at&order=version.desc`);
  return { ...report, versions };
}

export function comparePublishedSnapshots(current: any, baseline: any) {
  const critical = ['promptPanelVersionId', 'providerProfilesFingerprint', 'searchModesFingerprint', 'geographyFingerprint', 'localeFingerprint', 'scoringModelVersion'];
  const changed = critical.filter((field) => current.methodology?.[field] !== baseline.methodology?.[field]);
  if (changed.length) return { comparability: 'not_comparable', reasons: changed.map((field) => `${field} changed`), changes: [] };
  const baselineMap = new Map((baseline.evidence ?? []).map((item: any) => [evidenceKey(item), item]));
  const changes = (current.evidence ?? []).map((item: any) => { const previous = baselineMap.get(evidenceKey(item)); if (!previous) return { key: evidenceKey(item), change: 'not_comparable', reason: 'no baseline observation' }; const from = mentionStatus(previous); const to = mentionStatus(item); return { key: evidenceKey(item), prompt: item.prompt.text, provider: item.provider.name, from, to, change: from === 0 && to > 0 ? 'newly_visible' : from > 0 && to === 0 ? 'lost_visibility' : to > from ? 'improved_prominence' : to < from ? 'declined_prominence' : to > 0 ? 'stable_positive' : 'stable_absent' }; });
  return { comparability: current.methodology.reportedModelsFingerprint === baseline.methodology.reportedModelsFingerprint ? 'fully_comparable' : 'directionally_comparable', reasons: [], changes };
}

async function loadEvidence(db: SupabaseRest, ids: string[]) {
  if (!ids.length) throw httpError(409, 'score calculation has no input observations');
  const filter = ids.map((id) => encodeURIComponent(id)).join(',');
  const observations = await db.select<any>('observations', `id=in.(${filter})&select=id,audit_run_item_id,requested_provider,requested_model,reported_provider,reported_model,search_mode,answer_text,automated_classification,received_at`);
  const result = [];
  for (const observation of observations) {
    const item = await db.one<any>('audit_run_items', `id=eq.${encodeURIComponent(observation.audit_run_item_id)}&select=id,repetition,prompt_versions(id,prompt_id,text,stage,importance,persona,locale,geography,prompts(stable_key)),provider_profiles(id,name,provider,requested_model,search_mode)`);
    const reviews = await db.select<any>('review_decisions', `observation_id=eq.${encodeURIComponent(observation.id)}&select=id,decision,accepted_classification,created_at&order=created_at.desc&limit=1`);
    const review = reviews[0];
    if (!review || !['accepted', 'corrected'].includes(review.decision)) throw httpError(409, `observation ${observation.id} is not approved for publication`);
    const sources = await db.select<any>('response_sources', `observation_id=eq.${encodeURIComponent(observation.id)}&select=url,title,domain,ownership,source_kind,citation_start,citation_end`);
    result.push({ observation, item, review, sources });
  }
  return result;
}

async function buildSnapshot(run: any, score: any, evidenceRows: any[], body: ReportBody): Promise<PublishedSnapshot & Record<string, unknown>> {
  const evidence = evidenceRows.map(({ observation, item, review, sources }) => ({
    observationId: observation.id,
    auditRunItemId: item.id,
    prompt: { id: item.prompt_versions.id, stableKey: item.prompt_versions.prompts?.stable_key ?? item.prompt_versions.prompt_id, text: item.prompt_versions.text, stage: item.prompt_versions.stage, importance: item.prompt_versions.importance, persona: item.prompt_versions.persona, locale: item.prompt_versions.locale, geography: item.prompt_versions.geography },
    provider: { profileId: item.provider_profiles.id, name: item.provider_profiles.provider, requestedModel: item.provider_profiles.requested_model, reportedModel: observation.reported_model ?? observation.requested_model, searchMode: observation.search_mode ?? item.provider_profiles.search_mode },
    repetition: item.repetition,
    answerText: observation.answer_text,
    citations: sources.filter((source: any) => source.source_kind === 'inline_citation').map(publicSource),
    sources: sources.filter((source: any) => source.source_kind === 'retrieved').map(publicSource),
    reviewedClassification: review.accepted_classification,
    reviewDecision: review.decision,
    receivedAt: observation.received_at,
    stability: 'insufficient_sample'
  }));
  const metrics = score.metrics ?? {};
  const providerProfilesFingerprint = await fingerprint(evidence.map((item: any) => [item.provider.profileId, item.provider.requestedModel, item.provider.searchMode]));
  const reportedModelsFingerprint = await fingerprint(evidence.map((item: any) => [item.provider.name, item.provider.reportedModel]));
  const searchModesFingerprint = await fingerprint(evidence.map((item: any) => item.provider.searchMode));
  const config = run.frozen_configuration ?? {};
  return {
    schemaVersion: 1,
    reportVersionId: 'pending-database-id',
    title: body.title.trim(),
    executiveSummary: body.executiveSummary.trim(),
    generatedAt: new Date().toISOString(),
    brand: { id: run.brands.id, name: run.brands.name, domain: run.brands.domain },
    auditRun: { id: run.id, state: run.state, completedAt: run.completed_at, promptPanelVersionId: run.prompt_panel_version_id, intendedObservations: metricNumber(metrics, 'intendedObservations'), successfulObservations: metricNumber(metrics, 'successfulObservations'), terminalFailures: metricNumber(metrics, 'terminalFailures'), excludedObservations: metricNumber(metrics, 'excludedObservations') },
    methodology: { promptPanelVersionId: run.prompt_panel_version_id, providerProfilesFingerprint, reportedModelsFingerprint, searchModesFingerprint, geographyFingerprint: await fingerprint(config.methodology?.geography ?? config.geography ?? {}), localeFingerprint: await fingerprint(config.methodology?.locale ?? config.locale ?? ''), scoringModelVersion: score.scoring_model_version, providers: unique(evidence.map((item: any) => item.provider.name)), reportedModels: unique(evidence.map((item: any) => item.provider.reportedModel)), searchModes: unique(evidence.map((item: any) => item.provider.searchMode)) },
    scoring: { calculationId: score.id, modelVersion: score.scoring_model_version, inputObservationIds: score.input_observation_ids, metrics },
    findings: (body.findings ?? []).map((item) => ({ id: String(item.id ?? crypto.randomUUID()), type: String(item.type ?? 'finding'), title: String(item.title ?? 'Finding'), summary: String(item.summary ?? ''), evidenceObservationIds: Array.isArray(item.evidenceObservationIds) ? item.evidenceObservationIds.map(String) : [], confidence: String(item.confidence ?? 'medium'), suggestedInvestigation: item.suggestedInvestigation == null ? null : String(item.suggestedInvestigation) })),
    evidence,
    nextMeasurement: body.nextMeasurement ?? null,
    limitations: unique([...(body.limitations ?? []), 'AI answers are sampled observations, not deterministic rankings.', 'Failed and excluded observations are disclosed and do not count as brand absence.'])
  };
}

function publicSource(source: any) { return { url: source.url, title: source.title, domain: source.domain, ownership: source.ownership, start: source.citation_start, end: source.citation_end }; }
function metricNumber(metrics: Record<string, unknown>, camel: string) { const snake = camel.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`); const value = Number(metrics[camel] ?? metrics[snake] ?? 0); return Number.isFinite(value) && value >= 0 ? value : 0; }
function unique<T>(values: T[]) { return [...new Set(values.filter(Boolean))]; }
function randomToken(length: number) { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return base64url(bytes); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function fingerprint(value: unknown) { return await sha256(JSON.stringify(sortValue(value))); }
function sortValue(value: any): any { if (Array.isArray(value)) return value.map(sortValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
function base64url(bytes: Uint8Array) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function evidenceKey(item: any) { return [item.prompt.stableKey ?? item.prompt.id, item.provider.profileId ?? item.provider.name, item.provider.searchMode, item.prompt.locale ?? ''].join('|'); }
function mentionStatus(item: any) { return Number(item.reviewedClassification?.mention_status ?? item.reviewedClassification?.mentionStatus ?? 0); }
function httpError(status: number, message: string) { const error = new Error(message) as Error & { status: number }; error.status = status; return error; }
