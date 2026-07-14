import { createHash, randomUUID } from 'node:crypto';

export const PLATFORM_ROLES = new Set(['platform_admin', 'platform_operator', 'platform_reviewer', 'support']);
export const WORKSPACE_ROLES = new Set(['owner', 'operator', 'reviewer', 'viewer']);

const PERMISSIONS = {
  owner: new Set(['workspace:read','workspace:manage','brand:write','run:start','review:write','report:publish','experiment:write']),
  operator: new Set(['workspace:read','brand:write','run:start','review:write','report:publish','experiment:write']),
  reviewer: new Set(['workspace:read','review:write','report:read']),
  viewer: new Set(['workspace:read','report:read']),
};

export function resolveEnvironment(name, env = {}) {
  if (!['local','test','staging','production'].includes(name)) throw new Error(`invalid environment: ${name}`);
  const productionLike = name === 'staging' || name === 'production';
  const required = productionLike ? ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'] : [];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`missing ${name} configuration: ${missing.join(', ')}`);
  if (productionLike && String(env.SUPABASE_URL).includes('localhost')) throw new Error(`${name} cannot use localhost Supabase`);
  return Object.freeze({ name, productionLike, publicBaseUrl: env.PUBLIC_BASE_URL ?? (name === 'local' ? 'http://localhost:8787' : null), logging: name === 'production' ? 'info' : 'debug', allowFixtureProvider: name !== 'production', deployWritesEnabled: name !== 'test' });
}

export function hasPermission({ platformRole = null, workspaceRole = null, permission }) {
  if (platformRole === 'platform_admin') return true;
  if (platformRole === 'platform_operator' && permission !== 'workspace:manage') return true;
  if (platformRole === 'platform_reviewer' && ['workspace:read','review:write','report:read'].includes(permission)) return true;
  if (platformRole === 'support' && ['workspace:read','report:read'].includes(permission)) return true;
  return Boolean(workspaceRole && PERMISSIONS[workspaceRole]?.has(permission));
}

export function authorizeWorkspace(input) {
  const { session, workspaceId, permission, platformRole, membership } = input;
  if (!session?.userId || !session?.expiresAt) return { allowed: false, reason: 'missing_session' };
  if (new Date(session.expiresAt).getTime() <= Date.now()) return { allowed: false, reason: 'expired_session' };
  if (session.revokedAt) return { allowed: false, reason: 'revoked_session' };
  if (membership && membership.workspaceId !== workspaceId) return { allowed: false, reason: 'wrong_workspace' };
  const workspaceRole = membership?.role ?? null;
  return hasPermission({ platformRole, workspaceRole, permission }) ? { allowed: true, workspaceRole, platformRole: platformRole ?? null } : { allowed: false, reason: 'insufficient_role' };
}

export function validateInvitation(invitation, now = Date.now()) {
  if (!invitation?.tokenHash || !invitation?.workspaceId || !WORKSPACE_ROLES.has(invitation.role)) return { valid: false, reason: 'invalid' };
  if (invitation.acceptedAt) return { valid: false, reason: 'already_accepted' };
  if (invitation.revokedAt) return { valid: false, reason: 'revoked' };
  if (new Date(invitation.expiresAt).getTime() <= now) return { valid: false, reason: 'expired' };
  return { valid: true };
}

export function redactLogValue(value) {
  const secretKeys = /authorization|token|secret|password|api[_-]?key|raw_response|answer_text/i;
  const visit = (input, key = '') => {
    if (secretKeys.test(key)) return '[REDACTED]';
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([k,v]) => [k, visit(v, k)]));
    if (typeof input === 'string' && /bearer\s+[\w.-]+/i.test(input)) return '[REDACTED]';
    return input;
  };
  return visit(value);
}

export function structuredEvent({ correlationId = randomUUID(), event, level = 'info', actor = null, workspaceId = null, resource = null, details = {} }) {
  if (!event) throw new Error('event is required');
  return Object.freeze({ schemaVersion: 1, timestamp: new Date().toISOString(), correlationId, event, level, actor, workspaceId, resource, details: redactLogValue(details) });
}

export function deploymentManifest({ environment, commitSha, schemaVersion, workerName = 'citely', builtAt = new Date().toISOString() }) {
  if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) throw new Error('valid commitSha is required');
  if (!schemaVersion) throw new Error('schemaVersion is required');
  const manifest = { schemaVersion: 1, environment, commitSha, databaseSchema: schemaVersion, workerName, builtAt };
  return Object.freeze({ ...manifest, fingerprint: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') });
}

export function providerHealth(samples, thresholds = {}) {
  const minSuccess = Number(thresholds.minSuccessRate ?? 0.9);
  const maxLatency = Number(thresholds.maxP95LatencyMs ?? 15000);
  if (!samples.length) return { status: 'unknown', successRate: null, p95LatencyMs: null };
  const successRate = samples.filter((sample) => sample.ok).length / samples.length;
  const latencies = samples.map((sample) => Number(sample.latencyMs ?? 0)).sort((a,b) => a-b);
  const p95LatencyMs = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)];
  return { status: successRate < minSuccess || p95LatencyMs > maxLatency ? 'degraded' : 'healthy', successRate, p95LatencyMs };
}

export function buildPilotVerification(input) {
  const required = ['audit','review','score','report','share','finding','intervention','implementationEvidence','rerun','evaluation'];
  const stages = required.map((name) => ({ name, status: input.stages?.[name]?.status ?? 'missing', evidenceId: input.stages?.[name]?.evidenceId ?? null }));
  const failures = stages.filter((stage) => stage.status !== 'passed');
  const security = input.security ?? {};
  if (!security.crossWorkspaceDenied) failures.push({ name: 'cross_workspace_isolation', status: 'failed' });
  if (!security.expiredLinkDenied) failures.push({ name: 'expired_link', status: 'failed' });
  if (!security.revokedLinkDenied) failures.push({ name: 'revoked_link', status: 'failed' });
  return Object.freeze({ schemaVersion: 1, verificationId: input.verificationId ?? randomUUID(), environment: input.environment ?? 'test', commitSha: input.commitSha, stages, security, status: failures.length ? 'failed' : 'passed', failures, liveInfrastructureVerified: Boolean(input.liveInfrastructureVerified), limitations: input.liveInfrastructureVerified ? [] : ['Live Supabase and Cloudflare deployment still requires credentials.'] });
}
