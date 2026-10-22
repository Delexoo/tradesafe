import type { TradeStatus } from "@/lib/types/trade";

export const STATUS_LABELS: Record<TradeStatus, string> = {
  draft: "Draft",
  awaiting_acceptance: "Awaiting acceptance",
  awaiting_payment: "Awaiting payment",
  payment_pending: "Payment pending",
  funds_authorized: "Funds authorized (hold)",
  awaiting_fulfillment: "Awaiting fulfillment",
  in_fulfillment: "In fulfillment",
  awaiting_confirmation: "Awaiting confirmation",
  completion_pending: "Completing",
  completed: "Completed",
  cancellation_requested: "Cancellation requested",
  cancelled: "Cancelled",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  disputed: "Disputed",
  suspended: "Suspended",
  expired: "Expired",
};

export function statusBadgeVariant(
  status: TradeStatus,
): "default" | "blue" | "green" | "purple" | "amber" | "red" {
  if (status === "completed") return "green";
  if (status === "disputed" || status === "suspended") return "red";
  if (status === "funds_authorized") return "green";
  if (status === "in_fulfillment" || status === "awaiting_fulfillment") return "purple";
  if (status === "expired" || status === "cancelled" || status === "refunded") return "amber";
  return "blue";
}
