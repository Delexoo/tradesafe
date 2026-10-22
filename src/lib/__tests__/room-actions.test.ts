import { describe, expect, it } from "vitest";
import { nextStep } from "../../../site/js/room-actions.js";

describe("room next step", () => {
  it("does not offer another dispute when one is already open", () => {
    const step = nextStep({ status: "disputed", role: "buyer", accepted: true });
    expect(step.action).toBeNull();
    expect(step.headline).toMatch(/paused/i);
    expect(step.detail).toMatch(/Messages/);
  });

  it("asks the buyer to pay through Stripe", () => {
    const step = nextStep({
      status: "awaiting_payment",
      role: "buyer",
      accepted: true,
    });
    expect(step.action).toEqual({ act: "pay", label: "Pay now" });
    expect(step.detail).toMatch(/Stripe/);
    expect(step.detail).toMatch(/does not hold/i);
  });

  it("asks the seller to add a payout account before anything else", () => {
    const step = nextStep({
      status: "awaiting_acceptance",
      role: "seller",
      accepted: false,
      payoutReady: false,
    });
    expect(step.action).toEqual({ act: "payout", label: "Add payout account" });
    expect(step.detail).toMatch(/does not hold/i);
  });

  it("asks the seller for one send action", () => {
    const step = nextStep({
      status: "awaiting_fulfillment",
      role: "seller",
      accepted: true,
    });
    expect(step.action.label).toBe("I've sent it");
    expect(step.track).toBe(true);
  });

  it("waits quietly when it is the other person's turn", () => {
    const step = nextStep({
      status: "awaiting_payment",
      role: "seller",
      accepted: true,
    });
    expect(step.action).toBeNull();
    expect(step.headline).toMatch(/Waiting/);
  });
});
