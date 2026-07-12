const STATUS_LABELS = ['absent', 'passing', 'relevant_option', 'strong_recommendation', 'primary_recommendation'];

export function extractCandidate({ answerText, brand, competitors, citations = [] }) {
  const brandMentions = findMentions(answerText, brand.aliases ?? [brand.name]);
  const competitorResults = competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    mentions: findMentions(answerText, competitor.aliases ?? [competitor.name])
  }));
  const competitorFirstIndexes = competitorResults.flatMap((item) => item.mentions.slice(0, 1).map((mention) => mention.index));
  const earliestCompetitor = competitorFirstIndexes.length ? Math.min(...competitorFirstIndexes) : null;
  const firstBrand = brandMentions[0]?.index ?? null;
  let mentionStatus = 0;
  if (firstBrand !== null) {
    mentionStatus = 2;
    if (earliestCompetitor === null || firstBrand < earliestCompetitor) mentionStatus = 3;
    if (firstBrand < 80) mentionStatus = 4;
  }

  return {
    schemaVersion: 1,
    brand: {
      mentioned: brandMentions.length > 0,
      mentionCount: brandMentions.length,
      firstIndex: firstBrand,
      mentions: brandMentions
    },
    competitors: competitorResults.map((item) => ({
      id: item.id,
      name: item.name,
      mentioned: item.mentions.length > 0,
      mentionCount: item.mentions.length,
      firstIndex: item.mentions[0]?.index ?? null,
      mentions: item.mentions
    })),
    mentionStatus,
    mentionStatusLabel: STATUS_LABELS[mentionStatus],
    brandFirst: firstBrand !== null && (earliestCompetitor === null || firstBrand < earliestCompetitor),
    citationSummary: summarizeCitations(citations, brand, competitors),
    confidence: ambiguousAliasRisk(brand) ? 'medium' : 'high',
    requiresHumanReview: true
  };
}

export function normalizeClassification(candidate, correction = null) {
  const source = correction ?? candidate;
  const mentionStatus = Number(source.mentionStatus);
  if (!Number.isInteger(mentionStatus) || mentionStatus < 0 || mentionStatus > 4) {
    throw new Error('Reviewed mentionStatus must be an integer from 0 to 4');
  }
  return {
    mentionStatus,
    mentionStatusLabel: STATUS_LABELS[mentionStatus],
    brandMentioned: source.brandMentioned ?? source.brand?.mentioned ?? mentionStatus > 0,
    brandFirst: Boolean(source.brandFirst),
    excludedFromScoring: Boolean(source.excludedFromScoring),
    reason: source.reason ?? null,
    reviewerNotes: source.reviewerNotes ?? null
  };
}

export function validateProviderObservation(observation) {
  if (!observation || typeof observation !== 'object') throw invalid('Provider result is not an object');
  if (!String(observation.answerText ?? '').trim()) throw invalid('Provider returned an empty answer');
  if (!observation.provider) throw invalid('Provider result is missing provider');
  if (!observation.requestedModel) throw invalid('Provider result is missing requestedModel');
  if (observation.citations !== undefined && !Array.isArray(observation.citations)) throw invalid('citations must be an array');
  if (observation.sources !== undefined && !Array.isArray(observation.sources)) throw invalid('sources must be an array');
  return {
    ...observation,
    answerText: String(observation.answerText).trim(),
    citations: dedupeUrls(observation.citations ?? []),
    sources: dedupeSources(observation.sources ?? [])
  };
}

export function classifyCitation(url, brand, competitors) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const brandHost = normalizeHost(brand.domain);
    const competitorHosts = competitors.map((item) => normalizeHost(item.domain)).filter(Boolean);
    return {
      url,
      host,
      ownership: sameDomain(host, brandHost)
        ? 'brand_owned'
        : competitorHosts.some((domain) => sameDomain(host, domain))
          ? 'competitor_owned'
          : 'third_party'
    };
  } catch {
    return { url, host: null, ownership: 'invalid' };
  }
}

function findMentions(text, aliases) {
  const mentions = [];
  for (const alias of aliases) {
    const normalized = normalizeAlias(alias);
    if (!normalized) continue;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for (const match of String(text ?? '').matchAll(expression)) {
      mentions.push({ alias: match[2], index: (match.index ?? 0) + match[1].length });
    }
  }
  const seen = new Set();
  return mentions
    .filter((item) => {
      const key = `${item.alias.toLowerCase()}:${item.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.index - b.index);
}

function summarizeCitations(citations, brand, competitors) {
  const classified = citations.map((citation) => classifyCitation(citation.url ?? citation, brand, competitors));
  return {
    total: classified.length,
    brandOwned: classified.filter((item) => item.ownership === 'brand_owned').length,
    competitorOwned: classified.filter((item) => item.ownership === 'competitor_owned').length,
    thirdParty: classified.filter((item) => item.ownership === 'third_party').length,
    invalid: classified.filter((item) => item.ownership === 'invalid').length,
    citations: classified
  };
}

function ambiguousAliasRisk(entity) {
  return (entity.aliases ?? []).some((alias) => String(alias).trim().length < 5 || !/[A-Z]/.test(String(alias)));
}

function normalizeAlias(value) {
  return String(value ?? '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function normalizeHost(value) {
  return normalizeAlias(value).toLowerCase().replace(/\/.*$/, '');
}

function sameDomain(host, domain) {
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

function dedupeUrls(items) {
  const values = items.map((item) => typeof item === 'string' ? { url: item } : item).filter((item) => item?.url);
  const seen = new Set();
  return values.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function dedupeSources(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.url ?? JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function invalid(message) {
  const error = new Error(message);
  error.name = 'InvalidObservationError';
  error.code = 'invalid_observation';
  return error;
}
