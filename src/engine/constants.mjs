export const RUN_STATES = Object.freeze([
  'draft',
  'configured',
  'approved',
  'queued',
  'running',
  'partially_failed',
  'awaiting_review',
  'review_in_progress',
  'ready',
  'delivered',
  'cancelled',
  'budget_stopped',
  'failed'
]);

export const ITEM_STATES = Object.freeze([
  'planned',
  'attempting',
  'retry_scheduled',
  'succeeded',
  'terminal_failure',
  'review_required',
  'accepted',
  'corrected',
  'excluded'
]);

export const REVIEW_DECISIONS = Object.freeze(['accepted', 'corrected', 'excluded']);

const RUN_TRANSITIONS = new Map([
  ['draft', new Set(['configured', 'cancelled'])],
  ['configured', new Set(['approved', 'draft', 'cancelled'])],
  ['approved', new Set(['queued', 'running', 'cancelled'])],
  ['queued', new Set(['running', 'cancelled', 'failed'])],
  ['running', new Set(['awaiting_review', 'partially_failed', 'budget_stopped', 'failed', 'cancelled'])],
  ['partially_failed', new Set(['running', 'review_in_progress', 'ready', 'cancelled'])],
  ['awaiting_review', new Set(['review_in_progress', 'running', 'cancelled'])],
  ['review_in_progress', new Set(['ready', 'partially_failed', 'cancelled'])],
  ['ready', new Set(['delivered', 'review_in_progress'])],
  ['delivered', new Set([])],
  ['budget_stopped', new Set(['running', 'cancelled'])],
  ['failed', new Set(['running', 'cancelled'])],
  ['cancelled', new Set([])]
]);

const ITEM_TRANSITIONS = new Map([
  ['planned', new Set(['attempting', 'excluded'])],
  ['attempting', new Set(['retry_scheduled', 'terminal_failure', 'review_required', 'succeeded'])],
  ['retry_scheduled', new Set(['attempting', 'terminal_failure'])],
  ['succeeded', new Set(['review_required'])],
  ['review_required', new Set(['accepted', 'corrected', 'excluded'])],
  ['terminal_failure', new Set(['attempting', 'excluded'])],
  ['accepted', new Set(['corrected', 'excluded'])],
  ['corrected', new Set(['accepted', 'excluded'])],
  ['excluded', new Set(['review_required'])]
]);

export function assertRunTransition(from, to) {
  assertKnown(RUN_STATES, from, 'run state');
  assertKnown(RUN_STATES, to, 'run state');
  if (from === to) return;
  if (!RUN_TRANSITIONS.get(from)?.has(to)) {
    throw new Error(`Invalid audit run transition: ${from} -> ${to}`);
  }
}

export function assertItemTransition(from, to) {
  assertKnown(ITEM_STATES, from, 'item state');
  assertKnown(ITEM_STATES, to, 'item state');
  if (from === to) return;
  if (!ITEM_TRANSITIONS.get(from)?.has(to)) {
    throw new Error(`Invalid audit item transition: ${from} -> ${to}`);
  }
}

function assertKnown(values, value, label) {
  if (!values.includes(value)) throw new Error(`Unknown ${label}: ${value}`);
}
