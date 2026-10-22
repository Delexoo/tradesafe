import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashToken,
  isInvitationValid,
} from "../invitations";

describe("invitations", () => {
  it("generateInviteToken produces distinct high-entropy tokens", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
    expect(a.raw.length).toBeGreaterThan(20);
    expect(a.hash).toBe(hashToken(a.raw));
  });

  it("hashToken is stable and hex-encoded", () => {
    const token = "test-token-value";
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("isInvitationValid enforces expiry, revocation, and use limits", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    expect(
      isInvitationValid({
        token_hash: hashToken("x"),
        role: "buyer",
        expires_at: future,
        max_uses: 5,
        use_count: 0,
      }).valid
    ).toBe(true);

    expect(
      isInvitationValid({
        token_hash: hashToken("x"),
        role: "buyer",
        expires_at: past,
        max_uses: 5,
        use_count: 0,
      }).valid
    ).toBe(false);

    expect(
      isInvitationValid({
        token_hash: hashToken("x"),
        role: "buyer",
        expires_at: future,
        max_uses: 1,
        use_count: 1,
        single_use: true,
      }).valid
    ).toBe(false);

    expect(
      isInvitationValid({
        token_hash: hashToken("x"),
        role: "buyer",
        expires_at: future,
        max_uses: 2,
        use_count: 2,
        revoked_at: new Date().toISOString(),
      }).valid
    ).toBe(false);
  });
});
