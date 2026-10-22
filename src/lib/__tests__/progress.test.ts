import { describe, expect, it } from "vitest";
import {
  calculateBuyerProgress,
  calculateSellerProgress,
} from "../progress";

describe("progress", () => {
  it("buyer percent reflects completed applicable steps", () => {
    const result = calculateBuyerProgress({
      milestones: [
        { key: "buyer_terms_accepted", status: "completed" },
        { key: "buyer_payment_initiated", status: "pending" },
      ],
      paymentStatus: "none",
      transactionStatus: "awaiting_acceptance",
    });

    expect(result.percent).toBeGreaterThan(0);
    expect(result.percent).toBeLessThan(100);
    expect(result.currentStep).toBe("buyer_payment_initiated");
  });

  it("buyer reaches 100% when payment captured and trade completed", () => {
    const result = calculateBuyerProgress({
      milestones: [
        { key: "buyer_terms_accepted", status: "completed" },
        { key: "buyer_payment_initiated", status: "completed" },
        { key: "buyer_payment_authorized", status: "completed" },
        { key: "buyer_receipt_confirmed", status: "completed" },
      ],
      paymentStatus: "captured",
      transactionStatus: "completed",
    });

    expect(result.percent).toBe(100);
    expect(result.steps.every((s) => s.done)).toBe(true);
  });

  it("seller progress advances with fulfillment status", () => {
    const result = calculateSellerProgress({
      milestones: [{ key: "seller_terms_accepted", status: "completed" }],
      fulfillmentStatus: "shipped",
    });

    expect(result.percent).toBeGreaterThan(40);
    expect(result.percent).toBeLessThan(100);
  });

  it("does not treat user clicks as payment authorized", () => {
    const result = calculateBuyerProgress({
      milestones: [{ key: "buyer_payment_initiated", status: "completed" }],
      paymentStatus: "pending",
      transactionStatus: "payment_pending",
    });

    const authStep = result.steps.find(
      (s) => s.key === "buyer_payment_authorized"
    );
    expect(authStep?.done).toBe(false);
  });
});
