/** Runtime copy of the transaction state machine for server.mjs (vanilla path). */

export const TRANSITIONS = {
  draft: ["awaiting_acceptance", "cancelled", "expired"],
  awaiting_acceptance: [
    "awaiting_payment",
    "cancellation_requested",
    "cancelled",
    "disputed",
    "expired",
  ],
  awaiting_payment: [
    "payment_pending",
    "cancellation_requested",
    "cancelled",
    "disputed",
    "expired",
  ],
  payment_pending: [
    "funds_authorized",
    "awaiting_payment",
    "cancellation_requested",
    "cancelled",
    "disputed",
    "expired",
  ],
  funds_authorized: [
    "awaiting_fulfillment",
    "refund_pending",
    "cancellation_requested",
    "disputed",
    "suspended",
    "expired",
  ],
  awaiting_fulfillment: [
    "in_fulfillment",
    "cancellation_requested",
    "disputed",
    "suspended",
  ],
  in_fulfillment: ["awaiting_confirmation", "disputed", "suspended"],
  awaiting_confirmation: ["completion_pending", "disputed", "suspended"],
  completion_pending: ["completed", "disputed", "suspended"],
  completed: ["refund_pending", "disputed"],
  cancellation_requested: [
    "cancelled",
    "awaiting_acceptance",
    "awaiting_payment",
    "funds_authorized",
    "disputed",
  ],
  cancelled: [],
  refund_pending: ["refunded", "funds_authorized", "disputed"],
  refunded: [],
  disputed: [
    "suspended",
    "awaiting_fulfillment",
    "in_fulfillment",
    "awaiting_confirmation",
    "completion_pending",
    "cancellation_requested",
    "refund_pending",
    "cancelled",
    "completed",
  ],
  suspended: [
    "awaiting_acceptance",
    "awaiting_payment",
    "payment_pending",
    "funds_authorized",
    "awaiting_fulfillment",
    "in_fulfillment",
    "awaiting_confirmation",
    "completion_pending",
    "disputed",
  ],
  expired: [],
};

const PRIVILEGED_TARGETS = new Set(["funds_authorized", "completed", "refunded"]);

export class InvalidTransitionError extends Error {
  constructor(from, to, message) {
    super(message);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
    this.status = 409;
  }
}

function isPrivilegedTransition(from, to) {
  if (!PRIVILEGED_TARGETS.has(to)) return false;
  if (to === "completed") return from === "completion_pending";
  if (to === "funds_authorized") return from === "payment_pending";
  if (to === "refunded") return from === "refund_pending";
  return true;
}

function isTrustedFinancialSource(source) {
  return source === "provider" || source === "demo_server" || source === "system";
}

/** Map live payment update sources onto machine TransitionSource values. */
export function financialSource(source) {
  if (source === "demo_server") return "demo_server";
  if (source === "webhook" || source === "provider_api" || source === "provider") {
    return "provider";
  }
  if (source === "system") return "system";
  return "client";
}

export function canTransition(from, to, context = { source: "client" }) {
  if (from === to) return true;
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) return false;
  if (isPrivilegedTransition(from, to) && !isTrustedFinancialSource(context.source)) {
    return false;
  }
  return true;
}

export function assertTransition(from, to, context = { source: "client" }) {
  if (canTransition(from, to, context)) return;
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(
      from,
      to,
      `Transition ${from} → ${to} is not allowed. Allowed: ${allowed.join(", ") || "(none)"}`,
    );
  }
  if (isPrivilegedTransition(from, to) && !isTrustedFinancialSource(context.source)) {
    throw new InvalidTransitionError(
      from,
      to,
      `Transition ${from} → ${to} requires a trusted financial source, not "${context.source}".`,
    );
  }
  throw new InvalidTransitionError(from, to, `Transition ${from} → ${to} denied.`);
}
