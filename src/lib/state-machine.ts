import type {
  ParticipantRole,
  TransactionStatus,
  TransitionSource,
} from './types';

export type TransactionAction =
  | 'publish'
  | 'accept_terms'
  | 'initiate_payment'
  | 'payment_authorized'
  | 'payment_failed'
  | 'start_fulfillment'
  | 'update_fulfillment'
  | 'mark_delivered'
  | 'confirm_receipt'
  | 'request_capture'
  | 'capture_completed'
  | 'request_cancellation'
  | 'approve_cancellation'
  | 'deny_cancellation'
  | 'request_refund'
  | 'refund_completed'
  | 'open_dispute'
  | 'resolve_dispute'
  | 'suspend'
  | 'resume'
  | 'expire'
  | 'system_reconcile';

/** Allowed status edges (happy path + branches). */
export const TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> =
  {
    draft: ['awaiting_acceptance', 'cancelled', 'expired'],
    awaiting_acceptance: [
      'awaiting_payment',
      'cancellation_requested',
      'cancelled',
      'disputed',
      'expired',
    ],
    awaiting_payment: [
      'payment_pending',
      'cancellation_requested',
      'cancelled',
      'disputed',
      'expired',
    ],
    payment_pending: [
      'funds_authorized',
      'awaiting_payment',
      'cancellation_requested',
      'cancelled',
      'disputed',
      'expired',
    ],
    funds_authorized: [
      'awaiting_fulfillment',
      'refund_pending',
      'cancellation_requested',
      'disputed',
      'suspended',
      'expired',
    ],
    awaiting_fulfillment: [
      'in_fulfillment',
      'cancellation_requested',
      'disputed',
      'suspended',
    ],
    in_fulfillment: [
      'awaiting_confirmation',
      'disputed',
      'suspended',
    ],
    awaiting_confirmation: ['completion_pending', 'disputed', 'suspended'],
    completion_pending: ['completed', 'disputed', 'suspended'],
    completed: ['refund_pending', 'disputed'],
    cancellation_requested: [
      'cancelled',
      'awaiting_acceptance',
      'awaiting_payment',
      'funds_authorized',
      'disputed',
    ],
    cancelled: [],
    refund_pending: ['refunded', 'funds_authorized', 'disputed'],
    refunded: [],
    disputed: [
      'suspended',
      'awaiting_fulfillment',
      'in_fulfillment',
      'awaiting_confirmation',
      'completion_pending',
      'cancellation_requested',
      'refund_pending',
      'cancelled',
      'completed',
    ],
    suspended: [
      'awaiting_acceptance',
      'awaiting_payment',
      'payment_pending',
      'funds_authorized',
      'awaiting_fulfillment',
      'in_fulfillment',
      'awaiting_confirmation',
      'completion_pending',
      'disputed',
    ],
    expired: [],
  };

/** Roles permitted to trigger each client-facing action (server still enforces RLS). */
export const ROLE_ACTIONS: Record<TransactionAction, readonly ParticipantRole[]> =
  {
    publish: ['creator', 'seller'],
    accept_terms: ['buyer', 'seller'],
    initiate_payment: ['buyer'],
    payment_authorized: ['creator'],
    payment_failed: ['creator'],
    start_fulfillment: ['seller'],
    update_fulfillment: ['seller'],
    mark_delivered: ['seller'],
    confirm_receipt: ['buyer'],
    request_capture: ['buyer', 'seller', 'creator'],
    capture_completed: ['creator'],
    request_cancellation: ['buyer', 'seller', 'creator'],
    approve_cancellation: ['buyer', 'seller'],
    deny_cancellation: ['buyer', 'seller'],
    request_refund: ['buyer', 'seller', 'creator'],
    refund_completed: ['creator'],
    open_dispute: ['buyer', 'seller'],
    resolve_dispute: ['creator'],
    suspend: ['creator'],
    resume: ['creator'],
    expire: ['creator'],
    system_reconcile: ['creator'],
  };

/** Financially privileged targets — never reachable with source `client`. */
const PRIVILEGED_TARGETS: ReadonlySet<TransactionStatus> = new Set([
  'funds_authorized',
  'completed',
  'refunded',
]);

export interface TransitionContext {
  source: TransitionSource;
  action?: TransactionAction;
  actorRole?: ParticipantRole;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TransactionStatus,
    public readonly to: TransactionStatus,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

function isPrivilegedTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  if (PRIVILEGED_TARGETS.has(to)) {
    if (to === 'completed') {
      return from === 'completion_pending';
    }
    if (to === 'funds_authorized') {
      return from === 'payment_pending';
    }
    if (to === 'refunded') {
      return from === 'refund_pending';
    }
    return true;
  }
  return false;
}

function isTrustedFinancialSource(source: TransitionSource): boolean {
  return (
    source === 'provider' ||
    source === 'demo_server' ||
    source === 'system'
  );
}

export function canTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  context: TransitionContext,
): boolean {
  if (from === to) {
    return true;
  }

  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return false;
  }

  if (isPrivilegedTransition(from, to) && !isTrustedFinancialSource(context.source)) {
    return false;
  }

  if (context.action && context.actorRole) {
    const roles = ROLE_ACTIONS[context.action];
    if (roles && !roles.includes(context.actorRole)) {
      return false;
    }
  }

  return true;
}

export function assertTransition(
  from: TransactionStatus,
  to: TransactionStatus,
  context: TransitionContext,
): void {
  if (canTransition(from, to, context)) {
    return;
  }

  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(
      from,
      to,
      `Transition ${from} → ${to} is not allowed. Allowed: ${allowed.join(', ') || '(none)'}`,
    );
  }

  if (
    isPrivilegedTransition(from, to) &&
    !isTrustedFinancialSource(context.source)
  ) {
    throw new InvalidTransitionError(
      from,
      to,
      `Transition ${from} → ${to} requires a trusted financial source (provider, demo_server, or system), not "${context.source}".`,
    );
  }

  if (context.action && context.actorRole) {
    const roles = ROLE_ACTIONS[context.action];
    if (roles && !roles.includes(context.actorRole)) {
      throw new InvalidTransitionError(
        from,
        to,
        `Role "${context.actorRole}" cannot perform action "${context.action}".`,
      );
    }
  }

  throw new InvalidTransitionError(from, to, `Transition ${from} → ${to} denied.`);
}
