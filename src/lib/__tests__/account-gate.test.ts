import { describe, expect, it } from "vitest";
import { accountProblem, payoutProblem, safeReturnPath } from "../../../lib/account-gate.mjs";

describe("create account gate", () => {
  it("blocks guests", () => {
    expect(accountProblem(null)).toMatch(/account/i);
    expect(accountProblem({ is_guest: true })).toMatch(/account/i);
    expect(accountProblem({ is_guest: false, id: "u1" })).toBeNull();
  });

  it("hides Stripe key details from payout errors", () => {
    expect(payoutProblem("Permission denied. key rk_live_secret connected_account_write")).toMatch(
      /not allowed/i,
    );
    expect(payoutProblem("Permission denied. key rk_live_secret connected_account_write")).not.toMatch(
      /rk_live/,
    );
  });

  it("keeps payout return paths on this site", () => {
    expect(safeReturnPath("/create.html?payout=return")).toBe("/create.html?payout=return");
    expect(safeReturnPath("https://evil.example")).toBe("/create.html");
    expect(safeReturnPath("//evil.example")).toBe("/create.html");
  });
});
