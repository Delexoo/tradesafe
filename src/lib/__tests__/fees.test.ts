import { describe, expect, it } from "vitest";
import { platformFeeCents, sellerNetCents } from "../../../lib/fees.mjs";

describe("platform fee", () => {
  it("charges 2.9% plus 30 cents on a normal amount", () => {
    // 10000 cents → 290 + 30 = 320
    expect(platformFeeCents(10000)).toBe(320);
    expect(sellerNetCents(10000)).toBe(9680);
  });

  it("never takes the whole trade amount", () => {
    expect(platformFeeCents(50)).toBeLessThan(50);
    expect(sellerNetCents(50)).toBeGreaterThan(0);
  });

  it("returns zero for empty amounts", () => {
    expect(platformFeeCents(0)).toBe(0);
    expect(sellerNetCents(0)).toBe(0);
  });
});
