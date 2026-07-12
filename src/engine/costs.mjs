export class BudgetExceededError extends Error {
  constructor(scope, requestedMicros, remainingMicros) {
    super(`${scope} budget exceeded: requested ${requestedMicros}µUSD with ${remainingMicros}µUSD remaining`);
    this.name = 'BudgetExceededError';
    this.code = 'budget_exceeded';
    this.scope = scope;
    this.requestedMicros = requestedMicros;
    this.remainingMicros = remainingMicros;
  }
}

export class CostGuard {
  constructor({ auditLimitMicros, workspaceLimitMicros = Number.MAX_SAFE_INTEGER, globalLimitMicros = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(auditLimitMicros) || auditLimitMicros < 0) throw new Error('auditLimitMicros must be a non-negative safe integer');
    this.limits = { audit: auditLimitMicros, workspace: workspaceLimitMicros, global: globalLimitMicros };
    this.spent = { audit: 0, workspace: 0, global: 0 };
    this.reservations = new Map();
    this.events = [];
  }

  reserve(id, estimateMicros) {
    assertMicros(estimateMicros);
    if (this.reservations.has(id)) return this.reservations.get(id);
    for (const scope of ['audit', 'workspace', 'global']) {
      const remaining = this.limits[scope] - this.spent[scope] - this.reservedTotal(scope);
      if (estimateMicros > remaining) {
        this.events.push({ type: 'budget_rejected', scope, id, estimateMicros, remainingMicros: remaining });
        throw new BudgetExceededError(scope, estimateMicros, remaining);
      }
    }
    const reservation = { id, estimateMicros, state: 'reserved' };
    this.reservations.set(id, reservation);
    this.events.push({ type: 'cost_reserved', id, estimateMicros });
    return reservation;
  }

  commit(id, actualMicros) {
    assertMicros(actualMicros);
    const reservation = this.requireReservation(id);
    if (reservation.state === 'committed') return reservation;
    for (const scope of ['audit', 'workspace', 'global']) this.spent[scope] += actualMicros;
    reservation.actualMicros = actualMicros;
    reservation.state = 'committed';
    this.events.push({ type: 'cost_committed', id, actualMicros });
    return reservation;
  }

  release(id, reason = 'released') {
    const reservation = this.reservations.get(id);
    if (!reservation || reservation.state !== 'reserved') return null;
    reservation.state = 'released';
    reservation.reason = reason;
    this.events.push({ type: 'cost_released', id, reason });
    return reservation;
  }

  snapshot() {
    return {
      limits: { ...this.limits },
      spent: { ...this.spent },
      reservedMicros: this.reservedTotal('audit'),
      events: structuredClone(this.events)
    };
  }

  reservedTotal() {
    return [...this.reservations.values()]
      .filter((item) => item.state === 'reserved')
      .reduce((total, item) => total + item.estimateMicros, 0);
  }

  requireReservation(id) {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new Error(`Unknown cost reservation: ${id}`);
    return reservation;
  }
}

export function estimateObservationCost(profile, prompt) {
  const fixed = Number(profile?.cost?.fixedMicros ?? 0);
  const inputRate = Number(profile?.cost?.inputMicrosPerCharacter ?? 0);
  const outputAllowance = Number(profile?.cost?.expectedOutputMicros ?? 0);
  const searchAllowance = Number(profile?.cost?.searchMicros ?? 0);
  const estimate = Math.ceil(fixed + String(prompt?.text ?? '').length * inputRate + outputAllowance + searchAllowance);
  assertMicros(estimate);
  return estimate;
}

export function reconcileObservationCost(profile, observation, fallbackEstimate) {
  const reported = Number(observation?.costMicros);
  if (Number.isSafeInteger(reported) && reported >= 0) return reported;
  const usage = observation?.usage;
  if (!usage) return fallbackEstimate;
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const inputRate = Number(profile?.cost?.inputMicrosPerToken ?? 0);
  const outputRate = Number(profile?.cost?.outputMicrosPerToken ?? 0);
  const calculated = Math.ceil(inputTokens * inputRate + outputTokens * outputRate + Number(profile?.cost?.searchMicros ?? 0));
  return calculated > 0 ? calculated : fallbackEstimate;
}

function assertMicros(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Cost must be a non-negative integer in micro-USD: ${value}`);
}
