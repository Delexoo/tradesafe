import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
} from "../../../lib/state-machine.mjs";

describe("runtime state-machine (server.mjs)", () => {
  it("allows happy-path room advances", () => {
    expect(canTransition("awaiting_payment", "payment_pending", { source: "client" })).toBe(
      true,
    );
    expect(
      canTransition("awaiting_fulfillment", "in_fulfillment", { source: "client" }),
    ).toBe(true);
    expect(
      canTransition("in_fulfillment", "awaiting_confirmation", { source: "client" }),
    ).toBe(true);
    expect(
      canTransition("awaiting_confirmation", "completion_pending", { source: "client" }),
    ).toBe(true);
  });

  it("blocks client from funds_authorized and completed", () => {
    expect(
      canTransition("payment_pending", "funds_authorized", { source: "client" }),
    ).toBe(false);
    expect(
      canTransition("completion_pending", "completed", { source: "client" }),
    ).toBe(false);
    expect(
      canTransition("payment_pending", "funds_authorized", { source: "provider" }),
    ).toBe(true);
    expect(
      canTransition("completion_pending", "completed", { source: "provider" }),
    ).toBe(true);
  });

  it("rejects skipping to completed from awaiting_confirmation", () => {
    expect(() =>
      assertTransition("awaiting_confirmation", "completed", { source: "provider" }),
    ).toThrow(InvalidTransitionError);
  });

  it("rejects disputed from cancelled", () => {
    expect(canTransition("cancelled", "disputed", { source: "client" })).toBe(false);
  });
});

/** Mirrors handlePaymentWebhook gate: no secret → 503; secret without sig → 401. */
function webhookAdmission(secretConfigured: boolean, hasSignature: boolean) {
  if (!secretConfigured) return { ok: false as const, status: 503 };
  if (!hasSignature) return { ok: false as const, status: 401 };
  return { ok: true as const };
}

describe("unsigned webhook rejection", () => {
  it("refuses when webhook secret is missing", () => {
    expect(webhookAdmission(false, false)).toEqual({ ok: false, status: 503 });
    expect(webhookAdmission(false, true)).toEqual({ ok: false, status: 503 });
  });

  it("refuses when signature header is missing", () => {
    expect(webhookAdmission(true, false)).toEqual({ ok: false, status: 401 });
  });

  it("admits only when secret and signature are present", () => {
    expect(webhookAdmission(true, true)).toEqual({ ok: true });
  });
});
