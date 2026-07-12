export interface ProviderEnv {
  OPENAI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
}

export type RunItem = {
  id: string;
  idempotency_key: string;
  repetition: number;
  prompt_versions: {
    id: string;
    text: string;
    stage: string;
    importance: number;
    locale: string;
    geography: Record<string, unknown>;
  };
  provider_profiles: {
    id: string;
    provider: 'openai' | 'perplexity' | 'mock';
    requested_model: string;
    search_mode: string;
    geography: Record<string, unknown>;
    locale: string;
    options: Record<string, unknown>;
    cost_config: Record<string, unknown>;
  };
};

export type NormalizedProviderObservation = {
  provider: string;
  requestedModel: string;
  reportedModel: string;
  providerRequestId: string | null;
  answerText: string;
  citations: Array<{ url: string; title?: string; start?: number; end?: number }>;
  sources: Array<{ url: string; title?: string }>;
  searchMode: string;
  searchPerformed: boolean | null;
  usage: Record<string, unknown> | null;
  rawResponse: unknown;
  costMicros: number;
};

export class ProviderHttpError extends Error {
  status: number;
  code: string | null;
  retryAfter: string | null;

  constructor(message: string, options: { status: number; code?: string | null; retryAfter?: string | null }) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export async function executeProvider(item: RunItem, env: ProviderEnv): Promise<NormalizedProviderObservation> {
  if (item.provider_profiles.provider === 'openai') return await executeOpenAI(item, env);
  if (item.provider_profiles.provider === 'perplexity') return await executePerplexity(item, env);
  if (item.provider_profiles.provider === 'mock') return executeMock(item);
  throw new ProviderHttpError(`Unsupported provider: ${item.provider_profiles.provider}`, { status: 400, code: 'unsupported_provider' });
}

export function estimateItemCostMicros(item: RunItem): number {
  const config = item.provider_profiles.cost_config ?? {};
  const fixed = integer(config.fixedMicros, 0);
  const expectedOutput = integer(config.expectedOutputMicros, 0);
  const search = integer(config.searchMicros, 0);
  const inputPerCharacter = Number(config.inputMicrosPerCharacter ?? 0);
  return Math.max(0, Math.ceil(fixed + expectedOutput + search + item.prompt_versions.text.length * inputPerCharacter));
}

function executeMock(item: RunItem): NormalizedProviderObservation {
  return {
    provider: 'mock',
    requestedModel: item.provider_profiles.requested_model,
    reportedModel: item.provider_profiles.requested_model,
    providerRequestId: `mock-${item.id}`,
    answerText: 'Citely is a relevant evidence-first option. BrightReach is another established platform.',
    citations: [{ url: 'https://citely.example/methodology', title: 'Citely methodology' }],
    sources: [{ url: 'https://citely.example/methodology', title: 'Citely methodology' }],
    searchMode: 'fixture',
    searchPerformed: false,
    usage: null,
    rawResponse: { fixture: true },
    costMicros: estimateItemCostMicros(item)
  };
}

async function executeOpenAI(item: RunItem, env: ProviderEnv): Promise<NormalizedProviderObservation> {
  if (!env.OPENAI_API_KEY) throw new ProviderHttpError('OPENAI_API_KEY is not configured', { status: 401, code: 'auth_error' });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': item.idempotency_key
    },
    body: JSON.stringify({
      model: item.provider_profiles.requested_model,
      tools: [{ type: 'web_search', user_location: locationForOpenAI(item.provider_profiles.geography) }],
      include: ['web_search_call.action.sources'],
      input: [
        `Answer this buyer question naturally for locale ${item.provider_profiles.locale}.`,
        'Use current web evidence where useful. Do not optimize for a named company.',
        'Explain recommendation criteria and preserve source citations.',
        '',
        item.prompt_versions.text
      ].join('\n')
    })
  });
  const body = await parseProviderResponse(response);
  const textParts = (body.output ?? []).flatMap((entry: any) => entry.content ?? []).filter((entry: any) => entry.type === 'output_text');
  const citations = dedupeByUrl(textParts.flatMap((entry: any) => entry.annotations ?? []).map((annotation: any) => ({
    url: annotation.url ?? annotation.url_citation?.url,
    title: annotation.title ?? annotation.url_citation?.title,
    start: annotation.start_index ?? annotation.url_citation?.start_index,
    end: annotation.end_index ?? annotation.url_citation?.end_index
  })).filter((entry: any) => entry.url));
  const sources = dedupeByUrl((body.output ?? []).flatMap((entry: any) => entry.action?.sources ?? []).map((source: any) => ({ url: source.url, title: source.title })).filter((entry: any) => entry.url));
  const answerText = body.output_text ?? textParts.map((entry: any) => entry.text ?? '').join('\n').trim();
  if (!answerText) throw new ProviderHttpError('OpenAI returned an empty answer', { status: 502, code: 'invalid_observation' });
  return {
    provider: 'openai',
    requestedModel: item.provider_profiles.requested_model,
    reportedModel: body.model ?? item.provider_profiles.requested_model,
    providerRequestId: response.headers.get('x-request-id') ?? body.id ?? null,
    answerText,
    citations,
    sources,
    searchMode: item.provider_profiles.search_mode,
    searchPerformed: (body.output ?? []).some((entry: any) => entry.type === 'web_search_call'),
    usage: body.usage ?? null,
    rawResponse: body,
    costMicros: estimateItemCostMicros(item)
  };
}

async function executePerplexity(item: RunItem, env: ProviderEnv): Promise<NormalizedProviderObservation> {
  if (!env.PERPLEXITY_API_KEY) throw new ProviderHttpError('PERPLEXITY_API_KEY is not configured', { status: 401, code: 'auth_error' });
  const response = await fetch('https://api.perplexity.ai/v1/sonar', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: item.provider_profiles.requested_model,
      search_mode: item.provider_profiles.search_mode,
      messages: [
        { role: 'system', content: `Answer buyer questions naturally for locale ${item.provider_profiles.locale}; explain recommendation criteria.` },
        { role: 'user', content: item.prompt_versions.text }
      ],
      ...item.provider_profiles.options
    })
  });
  const body = await parseProviderResponse(response);
  const answerText = body.choices?.[0]?.message?.content ?? '';
  if (!answerText) throw new ProviderHttpError('Perplexity returned an empty answer', { status: 502, code: 'invalid_observation' });
  const citations = dedupeByUrl((body.citations ?? []).map((entry: any) => typeof entry === 'string' ? { url: entry } : entry));
  const sources = dedupeByUrl((body.search_results ?? []).map((entry: any) => ({ url: entry.url, title: entry.title })).filter((entry: any) => entry.url));
  return {
    provider: 'perplexity',
    requestedModel: item.provider_profiles.requested_model,
    reportedModel: body.model ?? item.provider_profiles.requested_model,
    providerRequestId: response.headers.get('request-id') ?? body.id ?? null,
    answerText,
    citations,
    sources,
    searchMode: item.provider_profiles.search_mode,
    searchPerformed: true,
    usage: body.usage ?? null,
    rawResponse: body,
    costMicros: estimateItemCostMicros(item)
  };
}

async function parseProviderResponse(response: Response): Promise<any> {
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { rawText: text }; }
  if (!response.ok) {
    throw new ProviderHttpError(body?.error?.message ?? body?.detail?.[0]?.msg ?? `Provider HTTP ${response.status}`, {
      status: response.status,
      code: body?.error?.code ?? null,
      retryAfter: response.headers.get('retry-after')
    });
  }
  return body;
}

function locationForOpenAI(geography: Record<string, unknown>) {
  if (!geography || !geography.country) return undefined;
  return {
    type: 'approximate',
    country: geography.country,
    region: geography.region,
    city: geography.city,
    timezone: geography.timezone
  };
}

function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
