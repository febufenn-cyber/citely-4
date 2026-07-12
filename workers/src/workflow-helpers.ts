import { ProviderHttpError } from './provider';
import type { AuditRun } from './workflow-types';

export function classifyWorkerFailure(error: unknown) {
  const status = error instanceof ProviderHttpError ? error.status : 0;
  const code = error instanceof ProviderHttpError ? error.code : null;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) return { category: 'rate_limited', retryable: true, counts_as_brand_absence: false, summary: 'Provider rate limit' };
  if (status >= 500) return { category: code === 'invalid_observation' ? 'invalid_observation' : 'provider_server_error', retryable: true, counts_as_brand_absence: false, summary: message };
  if (status === 401 || status === 403) return { category: 'authentication_error', retryable: false, counts_as_brand_absence: false, summary: message };
  if (status >= 400) return { category: 'invalid_request', retryable: false, counts_as_brand_absence: false, summary: message };
  return { category: 'network_error', retryable: true, counts_as_brand_absence: false, summary: message };
}

export function eventWorkerId(runId: string) {
  return `workflow:${runId}`;
}

export function safeDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

export function classifyOwnership(url: string, brand: AuditRun['frozen_configuration']['brand'], competitors: AuditRun['frozen_configuration']['competitors']) {
  const domain = safeDomain(url);
  if (!domain) return 'invalid';
  if (sameDomain(domain, brand.domain)) return 'brand_owned';
  if (competitors.some((competitor) => competitor.domain && sameDomain(domain, competitor.domain))) return 'competitor_owned';
  return 'third_party';
}

export function extractCandidate(answerText: string, brand: AuditRun['frozen_configuration']['brand'], competitors: AuditRun['frozen_configuration']['competitors']) {
  const mentions = extractMentions(answerText, brand, competitors);
  const brandMentions = mentions.filter((mention) => mention.entityKind === 'brand');
  const competitorMentions = mentions.filter((mention) => mention.entityKind === 'competitor');
  const brandFirstIndex = brandMentions[0]?.start ?? null;
  const earliestCompetitor = competitorMentions.length ? Math.min(...competitorMentions.map((mention) => mention.start)) : null;
  let mentionStatus = 0;
  if (brandFirstIndex !== null) {
    mentionStatus = 2;
    if (earliestCompetitor === null || brandFirstIndex < earliestCompetitor) mentionStatus = 3;
    if (brandFirstIndex < 80) mentionStatus = 4;
  }
  return {
    schema_version: 1,
    brand_mentioned: brandMentions.length > 0,
    brand_first: brandFirstIndex !== null && (earliestCompetitor === null || brandFirstIndex < earliestCompetitor),
    mention_status: mentionStatus,
    competitor_count: new Set(competitorMentions.map((mention) => mention.entityId)).size,
    confidence: 'deterministic_alias_match',
    requires_human_review: true
  };
}

export function extractMentions(answerText: string, brand: AuditRun['frozen_configuration']['brand'], competitors: AuditRun['frozen_configuration']['competitors']) {
  const entities = [
    { entityKind: 'brand', entityId: brand.id, aliases: brand.aliases ?? [brand.name] },
    ...competitors.map((competitor) => ({ entityKind: 'competitor', entityId: competitor.id, aliases: competitor.aliases ?? [competitor.name] }))
  ];
  const results: Array<{ entityKind: string; entityId: string; alias: string; start: number; end: number; confidence: number }> = [];
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      const normalized = String(alias).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
      if (!normalized) continue;
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      for (const match of answerText.matchAll(expression)) {
        const start = (match.index ?? 0) + match[1].length;
        results.push({ entityKind: entity.entityKind, entityId: entity.entityId, alias: match[2], start, end: start + match[2].length, confidence: 1 });
      }
    }
  }
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = `${item.entityKind}:${item.entityId}:${item.start}:${item.alias.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.start - b.start);
}

function sameDomain(host: string, domain: string) {
  const normalized = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}
