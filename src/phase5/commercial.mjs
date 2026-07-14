import { createHash } from 'node:crypto';

export const AGENCY_ROLES = new Set(['agency_owner','agency_operator']);
export const CLIENT_ROLES = new Set(['client_owner','client_editor','client_viewer']);

export function authorizePortfolioAccess({ userId, agencyId, targetWorkspaceId, agencyMemberships = [], clientMemberships = [], links = [], action = 'read' }) {
  const agencyRole = agencyMemberships.find((m) => m.userId === userId && m.agencyId === agencyId && !m.revokedAt)?.role;
  const linked = links.some((link) => link.agencyId === agencyId && link.workspaceId === targetWorkspaceId && !link.revokedAt);
  if (agencyRole && linked) {
    if (action === 'manage' && agencyRole !== 'agency_owner') return { allowed: false, reason: 'agency_owner_required' };
    return { allowed: true, principal: 'agency', role: agencyRole };
  }
  const clientRole = clientMemberships.find((m) => m.userId === userId && m.workspaceId === targetWorkspaceId && !m.revokedAt)?.role;
  if (!clientRole) return { allowed: false, reason: 'not_linked' };
  if (action === 'manage' && clientRole !== 'client_owner') return { allowed: false, reason: 'client_owner_required' };
  if (action === 'edit' && clientRole === 'client_viewer') return { allowed: false, reason: 'read_only' };
  return { allowed: true, principal: 'client', role: clientRole };
}

export function checkEntitlement({ plan, usage, action, requested = 1, feature = null }) {
  if (!plan || plan.status !== 'active') return { allowed: false, reason: 'inactive_plan' };
  if (action === 'feature') return plan.features?.includes(feature) ? { allowed: true } : { allowed: false, reason: 'feature_not_in_plan' };
  const limits = { brand: plan.brandLimit, observation: plan.monthlyObservationLimit, run: plan.monthlyRunLimit };
  const used = { brand: usage.brands ?? 0, observation: usage.observations ?? 0, run: usage.runs ?? 0 };
  const limit = Number(limits[action] ?? 0);
  if (limit < 0) return { allowed: true, remaining: null };
  const remaining = Math.max(0, limit - Number(used[action] ?? 0));
  return requested <= remaining ? { allowed: true, remaining: remaining - requested } : { allowed: false, reason: `${action}_limit_exceeded`, remaining };
}

export function applyBillingEvent(projection, event) {
  const current = structuredClone(projection ?? { processedEventIds: [], lastOccurredAt: null, status: 'manual', planKey: null });
  if (!event?.id || !event?.type || !event?.occurredAt) throw new Error('billing event id, type and occurredAt are required');
  if (current.processedEventIds.includes(event.id)) return { projection: current, applied: false, reason: 'duplicate' };
  current.processedEventIds.push(event.id);
  const stale = current.lastOccurredAt && new Date(event.occurredAt) < new Date(current.lastOccurredAt);
  if (!stale) {
    current.lastOccurredAt = event.occurredAt;
    if (event.type === 'subscription.active') { current.status = 'active'; current.planKey = event.planKey; }
    else if (event.type === 'subscription.past_due') current.status = 'past_due';
    else if (event.type === 'subscription.cancelled') current.status = 'cancelled';
    else if (event.type === 'subscription.trial') { current.status = 'trial'; current.planKey = event.planKey; }
  }
  return { projection: Object.freeze(current), applied: true, stale };
}

export function scheduleShard(scheduleId, windowMinutes = 240) { const hash = createHash('sha256').update(String(scheduleId)).digest(); return hash.readUInt32BE(0) % windowMinutes; }
export function scheduleExecutionKey(scheduleId, scheduledFor) { if (!scheduleId || !scheduledFor) throw new Error('scheduleId and scheduledFor are required'); return createHash('sha256').update(`${scheduleId}|${new Date(scheduledFor).toISOString()}`).digest('hex'); }
export function claimSchedule(schedule, scheduledFor, existingKeys = new Set()) { if (schedule.status !== 'active') return { claimed: false, reason: `schedule_${schedule.status}` }; const key = scheduleExecutionKey(schedule.id, scheduledFor); if (existingKeys.has(key)) return { claimed: false, reason: 'duplicate', key }; return { claimed: true, key, auditConfigurationId: schedule.auditConfigurationId, scheduledFor: new Date(scheduledFor).toISOString() }; }

export function buildAgencyReportTheme({ agencyName, logoUrl = null, accent = null, methodology, completeness, limitations }) {
  if (!methodology || completeness === undefined) throw new Error('methodology and completeness are required');
  return Object.freeze({ agencyName, logoUrl, accent, attribution: 'Measured by Citely', methodology, completeness, limitations: [...new Set([...(limitations ?? []), 'AI-answer visibility is observational and does not guarantee traffic, leads, revenue, or causation.'])] });
}

export function safeReportExport(snapshot) {
  const rows = (snapshot.evidence ?? []).map((item) => ({ prompt: item.prompt?.text ?? '', stage: item.prompt?.stage ?? '', provider: item.provider?.name ?? '', model: item.provider?.reportedModel ?? item.provider?.requestedModel ?? '', mentionStatus: Number(item.reviewedClassification?.mention_status ?? 0), answer: item.answerText ?? '', citations: (item.citations ?? []).map((c) => c.url).join(' | ') }));
  return { metadata: { title: snapshot.title, generatedAt: snapshot.generatedAt, methodology: snapshot.methodology, completeness: snapshot.scoring?.metrics?.dataCompleteness ?? snapshot.auditRun?.successfulObservations / Math.max(1, snapshot.auditRun?.intendedObservations), limitations: snapshot.limitations }, rows };
}

export function commercialMetrics({ validObservations, providerCostMicros, reviewMinutes, reportsDelivered, planRevenueMicros, brands, rerunsApproved, invitedWorkspaces, activatedWorkspaces }) {
  const valid = Math.max(1, Number(validObservations ?? 0)); const reports = Math.max(1, Number(reportsDelivered ?? 0));
  const grossMargin = planRevenueMicros > 0 ? (planRevenueMicros - providerCostMicros) / planRevenueMicros : null;
  return Object.freeze({ costPerValidObservationMicros: Math.round(Number(providerCostMicros ?? 0) / valid), costPerReportMicros: Math.round(Number(providerCostMicros ?? 0) / reports), reviewMinutesPerReport: Number(reviewMinutes ?? 0) / reports, activationRate: invitedWorkspaces ? activatedWorkspaces / invitedWorkspaces : null, rerunApprovalRate: reportsDelivered ? rerunsApproved / reportsDelivered : null, brands, grossMargin, marginWarning: grossMargin !== null && grossMargin < 0.6 });
}

export function portfolioFixture() { const agency={id:'agency-1',name:'Signal Studio'}; const clients=[{workspaceId:'client-a',brands:['Alpha','Alpha Pro']},{workspaceId:'client-b',brands:['Beta']}]; return Object.freeze({agency,clients,links:clients.map((client)=>({agencyId:agency.id,workspaceId:client.workspaceId})),isolated:clients[0].workspaceId!==clients[1].workspaceId}); }
