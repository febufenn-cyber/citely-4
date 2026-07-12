export class ProviderExecutionError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderExecutionError';
    this.provider = options.provider ?? null;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export class InvalidObservationError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'InvalidObservationError';
    this.code = options.code ?? 'invalid_observation';
  }
}

export function classifyFailure(error) {
  const status = Number(error?.status ?? error?.cause?.status ?? 0) || null;
  const code = String(error?.code ?? error?.cause?.code ?? '').toLowerCase();
  const message = String(error?.message ?? error ?? '').toLowerCase();

  if (status === 429 || code.includes('rate_limit') || message.includes('rate limit')) {
    return failure('rate_limited', true, 'Provider rate limit');
  }
  if ((status && status >= 500) || code.includes('overloaded') || message.includes('overloaded')) {
    return failure('provider_server_error', true, 'Provider temporary server error');
  }
  if (code.includes('timeout') || message.includes('timed out') || message.includes('timeout')) {
    return failure('network_timeout', true, 'Network timeout');
  }
  if (code.includes('econn') || code.includes('dns') || message.includes('network') || message.includes('fetch failed')) {
    return failure('network_error', true, 'Network transport error');
  }
  if (error instanceof InvalidObservationError || code === 'invalid_observation') {
    return failure('invalid_observation', true, 'Provider returned unusable observation', { maxRecommendedAttempts: 2 });
  }
  if (status === 401 || status === 403 || code.includes('auth') || message.includes('api key')) {
    return failure('authentication_error', false, 'Provider authentication failed');
  }
  if (status === 400 || status === 404 || code.includes('invalid_request') || message.includes('unsupported model')) {
    return failure('invalid_request', false, 'Provider request/configuration is invalid');
  }
  if (code.includes('policy') || message.includes('safety policy') || message.includes('content policy')) {
    return failure('policy_refusal', false, 'Provider policy refusal');
  }
  if (code.includes('budget')) {
    return failure('budget_exceeded', false, 'Citely budget guard stopped execution');
  }
  return failure('unknown_error', false, 'Unclassified provider failure');
}

function failure(category, retryable, summary, extra = {}) {
  return {
    category,
    retryable,
    terminal: !retryable,
    countsAsBrandAbsence: false,
    summary,
    ...extra
  };
}
