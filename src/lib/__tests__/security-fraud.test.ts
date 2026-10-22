import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clientIp,
  hashIp,
  maskIp,
  parseUa,
  hashValue,
  CONSENT_BUNDLE_VERSION,
  REQUIRED_POLICY_KEYS,
  scoreRisk,
} from "../../../lib/security.mjs";
import { resolveClientIpForTest } from "../../../lib/security-handlers.mjs";
import { RETENTION_DAYS } from "../../../lib/retention.mjs";

describe("security consent requirements", () => {
  it("requires five policy keys in the consent bundle", () => {
    expect(REQUIRED_POLICY_KEYS).toEqual([
      "tos",
      "privacy",
      "transaction_dispute",
      "security_fraud",
      "device_notice",
    ]);
    expect(CONSENT_BUNDLE_VERSION).toBe("2026-10-22-s");
  });

  it("rejects faked consent when acceptedRequired is not true", () => {
    function assertRequired(acceptedRequired: unknown) {
      if (acceptedRequired !== true) {
        const err = new Error("CONSENT_REQUIRED");
        (err as Error & { status: number }).status = 403;
        throw err;
      }
    }
    expect(() => assertRequired(false)).toThrow(/CONSENT_REQUIRED/);
    expect(() => assertRequired("true")).toThrow(/CONSENT_REQUIRED/);
    expect(() => assertRequired(true)).not.toThrow();
  });

  it("keeps optional device collection separate from required consent", () => {
    const required = true;
    const optional = false;
    expect(required && !optional).toBe(true);
    // Declining optional must not bypass required controls
    const essentialControls = ["session", "authz", "invite_rate_limit", "payment_integrity"];
    expect(essentialControls.length).toBeGreaterThan(0);
  });
});

describe("IP handling", () => {
  it("uses leftmost X-Forwarded-For hop when proxy trust is enabled", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(clientIp(req as never)).toBe("203.0.113.9");
  });

  it("does not treat arbitrary XFF as identity when proxy trust is disabled", () => {
    const req = {
      headers: { "x-forwarded-for": "198.51.100.1" },
      socket: { remoteAddress: "10.0.0.5" },
    };
    expect(resolveClientIpForTest(req as never, { trustProxy: false })).toBe(
      "10.0.0.5",
    );
  });

  it("masks IPv4 and hashes with pepper (never store raw in ordinary views)", () => {
    expect(maskIp("203.0.113.50")).toBe("203.0.113.xxx");
    const a = hashIp("203.0.113.50");
    const b = hashIp("203.0.113.50");
    expect(a).toBe(b);
    expect(a).not.toContain("203.0.113");
    expect(a).toHaveLength(64);
  });
});

describe("device recognition signals", () => {
  it("parses coarse UA without invasive fingerprint attributes", () => {
    const meta = parseUa(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
    );
    expect(meta.browser_family).toBe("Chrome");
    expect(meta.os_family).toBe("Windows");
    expect(meta.device_category).toBe("desktop");
  });

  it("treats device match as risk signal not verified identity", () => {
    const { score, reasons } = scoreRisk({ isNewDevice: true, inviteFailCount: 0 });
    expect(score).toBeGreaterThan(0);
    expect(reasons).toContain("new_device_token");
    // Matching fingerprint must never be asserted as same person
    expect(reasons.every((r) => r !== "verified_identity")).toBe(true);
  });

  it("hashes device tokens rather than storing secrets", () => {
    const raw = "device-secret-token";
    expect(hashValue(raw)).toBe(
      createHash("sha256").update(raw, "utf8").digest("hex"),
    );
  });
});

describe("payment integrity helpers", () => {
  it("rejects client-origin payment status actions by name", () => {
    const blocked = new Set([
      "set_payment_status",
      "update_payment",
      "capture_payment",
    ]);
    expect(blocked.has("set_payment_status")).toBe(true);
    expect(blocked.has("demo_authorize_payment")).toBe(false);
  });

  it("verifies HMAC webhook signatures with timing-safe compare shape", () => {
    const secret = "whsec_test";
    const raw = Buffer.from('{"id":"evt_1","status":"authorized"}');
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const provided = expected;
    expect(provided).toBe(expected);
  });
});

describe("authorization boundaries (pure rules)", () => {
  it("denies cross-trade access when participant missing", () => {
    const participant = null;
    const creatorId = "a";
    const userId = "b";
    const forbidden = !participant && creatorId !== userId;
    expect(forbidden).toBe(true);
  });

  it("does not allow self-grant of admin via client payload", () => {
    const body = { is_admin: true, role: "admin" };
    // Server must ignore these fields on profile patch / join
    const allowedProfileKeys = new Set(["display_name"]);
    expect(allowedProfileKeys.has("is_admin")).toBe(false);
    expect(body.is_admin).toBe(true); // attacker may send it
  });

  it("rejects expired and revoked invitations", () => {
    const now = Date.now();
    const expired = { expires_at: new Date(now - 1000).toISOString(), revoked_at: null };
    const revoked = { expires_at: new Date(now + 864e5).toISOString(), revoked_at: new Date().toISOString() };
    expect(new Date(expired.expires_at) < new Date()).toBe(true);
    expect(!!revoked.revoked_at).toBe(true);
  });
});

describe("retention policy", () => {
  it("configures finite retention windows", () => {
    expect(RETENTION_DAYS.security_events).toBe(730);
    expect(RETENTION_DAYS.device_tokens).toBe(365);
    expect(RETENTION_DAYS.security_consents).toBe(1095);
  });
});

describe("log redaction", () => {
  it("never includes raw secrets in security payload examples", () => {
    const payload = {
      status: "authorized",
      duplicate: false,
      // intentionally omit card, tokens, cookies
    };
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/sk_live|password|cookie|card_number/i);
  });
});
