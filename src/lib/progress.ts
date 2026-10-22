import type {
  FulfillmentStatus,
  Milestone,
  PaymentStatus,
  Participant,
  TransactionStatus,
} from "./types";

export const BUYER_STEPS = [
  { key: "buyer_terms_accepted", label: "Terms accepted" },
  { key: "buyer_payment_initiated", label: "Payment initiated" },
  { key: "buyer_payment_authorized", label: "Payment authorized" },
  { key: "awaiting_seller", label: "Waiting for seller" },
  { key: "buyer_receipt_confirmed", label: "Receipt confirmed" },
  { key: "completed", label: "Completed" },
] as const;

export const SELLER_STEPS = [
  { key: "seller_terms_accepted", label: "Terms accepted" },
  { key: "seller_fulfillment_acknowledged", label: "Order acknowledged" },
  { key: "seller_preparing", label: "Preparing" },
  { key: "seller_shipped", label: "Shipped / transferred" },
  { key: "seller_delivery_complete", label: "Delivery evidence" },
  { key: "buyer_confirmed", label: "Buyer confirmed" },
] as const;

export interface ProgressStepView {
  key: string;
  label: string;
  done: boolean;
  active: boolean;
}

export interface ProgressResult {
  percent: number;
  currentStep: string | null;
  steps: ProgressStepView[];
}

function milestoneDone(
  milestones: Array<{ key: string; status: string }>,
  key: string
) {
  return milestones.some((m) => m.key === key && m.status === "completed");
}

export function calculateBuyerProgress(input: {
  milestones: Array<{ key: string; status: string }>;
  paymentStatus: PaymentStatus | string;
  participants?: Participant[];
  transactionStatus?: TransactionStatus | string;
}): ProgressResult {
  const { milestones, paymentStatus, transactionStatus } = input;
  const pay = String(paymentStatus);
  const tx = String(transactionStatus ?? "");

  const flags = {
    buyer_terms_accepted: milestoneDone(milestones, "buyer_terms_accepted"),
    buyer_payment_initiated:
      milestoneDone(milestones, "buyer_payment_initiated") ||
      ["initiated", "pending", "authorized", "captured"].includes(pay),
    buyer_payment_authorized:
      milestoneDone(milestones, "buyer_payment_authorized") ||
      ["authorized", "captured"].includes(pay),
    awaiting_seller:
      ["awaiting_fulfillment", "in_fulfillment", "awaiting_confirmation", "completion_pending", "completed"].includes(
        tx
      ) || ["authorized", "captured"].includes(pay),
    buyer_receipt_confirmed:
      milestoneDone(milestones, "buyer_receipt_confirmed") ||
      ["completion_pending", "completed"].includes(tx),
    completed: tx === "completed" || pay === "captured",
  };

  const steps: ProgressStepView[] = BUYER_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    done: flags[s.key as keyof typeof flags] ?? false,
    active: false,
  }));

  let current: string | null = null;
  for (const step of steps) {
    if (!step.done) {
      step.active = true;
      current = step.key;
      break;
    }
  }
  if (!current && steps.every((s) => s.done)) {
    current = "completed";
  }

  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return { percent, currentStep: current, steps };
}

export function calculateSellerProgress(input: {
  milestones: Array<{ key: string; status: string }>;
  fulfillmentStatus: FulfillmentStatus | string;
}): ProgressResult {
  const { milestones, fulfillmentStatus } = input;
  const f = String(fulfillmentStatus);

  const flags = {
    seller_terms_accepted: milestoneDone(milestones, "seller_terms_accepted"),
    seller_fulfillment_acknowledged:
      milestoneDone(milestones, "seller_fulfillment_acknowledged") ||
      ["acknowledged", "preparing", "shipped", "transferred", "delivered", "confirmed"].includes(
        f
      ),
    seller_preparing:
      f === "preparing" ||
      ["shipped", "transferred", "delivered", "confirmed"].includes(f),
    seller_shipped:
      milestoneDone(milestones, "seller_shipped") ||
      milestoneDone(milestones, "seller_digital_transfer") ||
      ["shipped", "transferred", "delivered", "confirmed"].includes(f),
    seller_delivery_complete:
      milestoneDone(milestones, "seller_delivery_complete") ||
      ["delivered", "confirmed"].includes(f),
    buyer_confirmed: f === "confirmed",
  };

  const steps: ProgressStepView[] = SELLER_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    done: flags[s.key as keyof typeof flags] ?? false,
    active: false,
  }));

  let current: string | null = null;
  for (const step of steps) {
    if (!step.done) {
      step.active = true;
      current = step.key;
      break;
    }
  }

  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return { percent, currentStep: current, steps };
}

/** Derive milestone key updates from a transaction status change. */
export function milestoneKeysForStatus(
  status: TransactionStatus
): Array<{ key: string; status: Milestone["status"] }> {
  switch (status) {
    case "awaiting_payment":
      return [{ key: "shared_parties_ready", status: "completed" }];
    case "payment_pending":
      return [{ key: "buyer_payment_initiated", status: "completed" }];
    case "funds_authorized":
      return [{ key: "buyer_payment_authorized", status: "completed" }];
    case "in_fulfillment":
      return [{ key: "seller_fulfillment_acknowledged", status: "completed" }];
    case "awaiting_confirmation":
      return [{ key: "seller_delivery_complete", status: "completed" }];
    case "completed":
      return [
        { key: "buyer_receipt_confirmed", status: "completed" },
        { key: "shared_trade_completed", status: "completed" },
      ];
    default:
      return [];
  }
}

export function milestoneKeysForTermsAccepted(
  role: "buyer" | "seller"
): { key: string; status: Milestone["status"] } {
  return {
    key: role === "buyer" ? "buyer_terms_accepted" : "seller_terms_accepted",
    status: "completed",
  };
}
