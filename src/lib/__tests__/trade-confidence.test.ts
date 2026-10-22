import { describe, expect, it } from "vitest";
import {
  assertConfidenceViewer,
  assertNoSensitiveFields,
  buildConfidenceSignals,
  formatAccountCreatedLabel,
  getTradeConfidence,
  isCompletedTradeForConfidence,
  CONFIDENCE_DISCLAIMER,
} from "../../../lib/trade-confidence.mjs";

describe("Trade Confidence viewer eligibility", () => {
  it("denies guests", () => {
    try {
      assertConfidenceViewer({ id: "g1", is_guest: true });
      expect.unreachable();
    } catch (e) {
      const err = e as Error & { code: string; status: number };
      expect(err.code).toBe("CONFIDENCE_GUESTS_EXCLUDED");
      expect(err.status).toBe(403);
    }
  });

  it("denies authenticated but unverified accounts", () => {
    try {
      assertConfidenceViewer({
        id: "u1",
        is_guest: false,
        email_verified: false,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error & { code: string }).code).toBe(
        "CONFIDENCE_EMAIL_UNVERIFIED",
      );
    }
  });

  it("allows registered verified viewers", () => {
    expect(
      assertConfidenceViewer({
        id: "u1",
        is_guest: false,
        email_verified: true,
      }),
    ).toBe(true);
  });
});

describe("signal construction (no fabrication)", () => {
  it("formats account age as month/year only", () => {
    expect(formatAccountCreatedLabel("2026-03-15T12:00:00.000Z")).toMatch(
      /March 2026/,
    );
    expect(formatAccountCreatedLabel(null)).toBeNull();
    expect(formatAccountCreatedLabel("not-a-date")).toBeNull();
  });

  it("omits completed trades when count is zero", () => {
    const signals = buildConfidenceSignals({
      isGuest: false,
      emailVerified: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      completedCount: 0,
    });
    expect(signals.map((s) => s.key)).toEqual([
      "email_verified",
      "account_created",
    ]);
  });

  it("includes completed trades only when count >= 1", () => {
    const signals = buildConfidenceSignals({
      isGuest: false,
      emailVerified: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      completedCount: 4,
    });
    expect(signals.find((s) => s.key === "completed_trades")).toEqual({
      key: "completed_trades",
      label: "Completed trades",
      value: "4",
    });
  });

  it("shows only guest participation for guest counterparts", () => {
    const signals = buildConfidenceSignals({
      isGuest: true,
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedCount: 99,
    });
    expect(signals).toEqual([
      { key: "guest_participant", label: "Participating as a guest" },
    ]);
  });

  it("does not invent email verified when false", () => {
    const signals = buildConfidenceSignals({
      isGuest: false,
      emailVerified: false,
      createdAt: "2026-03-01T00:00:00.000Z",
      completedCount: 1,
    });
    expect(signals.map((s) => s.key)).not.toContain("email_verified");
  });
});

describe("completed trade eligibility", () => {
  it("counts only completed non-demo trades", () => {
    expect(
      isCompletedTradeForConfidence({ status: "completed", is_demo: false }),
    ).toBe(true);
    expect(
      isCompletedTradeForConfidence({ status: "completed", is_demo: true }),
    ).toBe(false);
    expect(
      isCompletedTradeForConfidence({ status: "cancelled", is_demo: false }),
    ).toBe(false);
    expect(
      isCompletedTradeForConfidence({ status: "disputed", is_demo: false }),
    ).toBe(false);
  });
});

describe("response minimization", () => {
  it("rejects payloads that include raw security fields", () => {
    expect(() =>
      assertNoSensitiveFields({
        available: true,
        signals: [],
        ip: "203.0.113.1",
      }),
    ).toThrow(/Forbidden field/);
    expect(() =>
      assertNoSensitiveFields({
        fingerprint: "abc",
        device_ref: "x",
        email: "a@b.c",
        user_id: "uuid",
      }),
    ).toThrow(/Forbidden field/);
  });

  it("allows the approved response shape", () => {
    expect(() =>
      assertNoSensitiveFields({
        available: true,
        counterpartRole: "seller",
        signals: [{ key: "email_verified", label: "Email verified" }],
        disclaimer: CONFIDENCE_DISCLAIMER,
      }),
    ).not.toThrow();
  });
});

type Fixture = {
  tx?: Record<string, unknown> | null;
  myPart?: Record<string, unknown> | null;
  participants?: Record<string, unknown>[];
  profile?: Record<string, unknown> | null;
  authUser?: Record<string, unknown> | null;
  tradeRows?: {
    transaction_id: string;
    ts_transactions: Record<string, unknown>;
  }[];
};

/** Minimal chainable Supabase mock for getTradeConfidence. */
function mockAdmin(fixture: Fixture) {
  return {
    from(table: string) {
      return {
        select(cols: string) {
          if (table === "ts_transactions") {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: fixture.tx ?? null,
                  error: null,
                }),
              }),
            };
          }
          if (table === "ts_profiles") {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: fixture.profile ?? null,
                  error: null,
                }),
              }),
            };
          }
          if (table === "ts_participants") {
            if (String(cols).includes("ts_transactions")) {
              return {
                eq: () => ({
                  eq: async () => ({
                    data: fixture.tradeRows || [],
                    error: null,
                  }),
                }),
              };
            }
            // Viewer membership: select + eq + eq + eq + maybeSingle
            // Counterpart list: select + eq + in
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: fixture.myPart ?? null,
                      error: null,
                    }),
                  }),
                  in: async () => ({
                    data: fixture.participants || [],
                    error: null,
                  }),
                }),
                in: async () => ({
                  data: fixture.participants || [],
                  error: null,
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: fixture.authUser ? { user: fixture.authUser } : { user: null },
          error: null,
        }),
      },
    },
  };
}

describe("getTradeConfidence authorization", () => {
  const viewer = {
    id: "viewer-1",
    is_guest: false,
    email_verified: true,
  };

  it("denies guests at the entry point", async () => {
    await expect(
      getTradeConfidence(mockAdmin({}) as never, {
        id: "g1",
        is_guest: true,
      }, "t1"),
    ).rejects.toMatchObject({ code: "CONFIDENCE_GUESTS_EXCLUDED" });
  });

  it("denies unverified registered users", async () => {
    await expect(
      getTradeConfidence(mockAdmin({}) as never, {
        id: "u1",
        is_guest: false,
        email_verified: false,
      }, "t1"),
    ).rejects.toMatchObject({ code: "CONFIDENCE_EMAIL_UNVERIFIED" });
  });

  it("denies non-participants even with verified email", async () => {
    const admin = mockAdmin({
      tx: { id: "t1", creator_id: "other", status: "active", is_demo: false },
      myPart: null,
      participants: [],
    });
    await expect(
      getTradeConfidence(admin as never, viewer, "t1"),
    ).rejects.toMatchObject({ code: "TRADE_ACCESS_DENIED", status: 403 });
  });

  it("denies when trade id is swapped to one the viewer is not in", async () => {
    const admin = mockAdmin({
      tx: { id: "t-other", creator_id: "x", status: "active", is_demo: false },
      myPart: null,
    });
    await expect(
      getTradeConfidence(admin as never, viewer, "t-other"),
    ).rejects.toMatchObject({ code: "TRADE_ACCESS_DENIED" });
  });

  it("returns counterpart_pending when the other party has not joined", async () => {
    const admin = mockAdmin({
      tx: {
        id: "t1",
        creator_id: "viewer-1",
        status: "awaiting_acceptance",
        is_demo: false,
      },
      myPart: {
        id: "p1",
        role: "seller",
        status: "joined",
        user_id: "viewer-1",
      },
      participants: [
        {
          id: "p1",
          role: "seller",
          status: "joined",
          user_id: "viewer-1",
        },
        {
          id: "p2",
          role: "buyer",
          status: "pending",
          user_id: null,
        },
      ],
    });
    const result = await getTradeConfidence(admin as never, viewer, "t1");
    expect(result).toEqual({
      available: false,
      reason: "counterpart_pending",
      disclaimer: CONFIDENCE_DISCLAIMER,
    });
  });

  it("returns approved signals for a registered counterpart", async () => {
    const admin = mockAdmin({
      tx: {
        id: "t1",
        creator_id: "viewer-1",
        status: "awaiting_acceptance",
        is_demo: false,
      },
      myPart: {
        id: "p1",
        role: "seller",
        status: "joined",
        user_id: "viewer-1",
      },
      participants: [
        {
          id: "p1",
          role: "seller",
          status: "joined",
          user_id: "viewer-1",
        },
        {
          id: "p2",
          role: "buyer",
          status: "joined",
          user_id: "buyer-9",
        },
      ],
      profile: {
        id: "buyer-9",
        is_guest: false,
        created_at: "2026-03-10T00:00:00.000Z",
      },
      authUser: {
        id: "buyer-9",
        email_confirmed_at: "2026-03-11T00:00:00.000Z",
        created_at: "2026-03-10T00:00:00.000Z",
      },
      tradeRows: [
        {
          transaction_id: "done-1",
          ts_transactions: { status: "completed", is_demo: false },
        },
        {
          transaction_id: "demo-1",
          ts_transactions: { status: "completed", is_demo: true },
        },
        {
          transaction_id: "cancel-1",
          ts_transactions: { status: "cancelled", is_demo: false },
        },
      ],
    });
    const result = (await getTradeConfidence(
      admin as never,
      viewer,
      "t1",
    )) as {
      available: boolean;
      counterpartRole: string;
      signals: { key: string; value?: string }[];
    };
    expect(result.available).toBe(true);
    expect(result.counterpartRole).toBe("buyer");
    expect(result.signals.map((s) => s.key)).toEqual([
      "email_verified",
      "account_created",
      "completed_trades",
    ]);
    expect(
      result.signals.find((s) => s.key === "completed_trades")?.value,
    ).toBe("1");
    expect(JSON.stringify(result)).not.toMatch(/buyer-9|@|ip_|fingerprint/i);
    assertNoSensitiveFields(result);
  });

  it("omits device/session familiarity for guest counterparts", async () => {
    const admin = mockAdmin({
      tx: { id: "t1", creator_id: "viewer-1", status: "active", is_demo: false },
      myPart: {
        id: "p1",
        role: "buyer",
        status: "joined",
        user_id: "viewer-1",
      },
      participants: [
        {
          id: "p1",
          role: "buyer",
          status: "joined",
          user_id: "viewer-1",
        },
        {
          id: "p2",
          role: "seller",
          status: "joined",
          user_id: "guest-2",
        },
      ],
      profile: {
        id: "guest-2",
        is_guest: true,
        created_at: "2026-10-01T00:00:00.000Z",
      },
      tradeRows: [],
    });
    const result = (await getTradeConfidence(
      admin as never,
      viewer,
      "t1",
    )) as { signals: { key: string }[] };
    expect(result.signals.map((s) => s.key)).toEqual(["guest_participant"]);
    expect(JSON.stringify(result)).not.toMatch(
      /session|device|previously seen|fingerprint/i,
    );
  });
});

describe("guest trading flow remains separate", () => {
  it("confidence denial does not change guest actor shape", () => {
    // Guests still resolve as is_guest without email_verified — room APIs stay open.
    const guest = { id: "g1", is_guest: true, display_name: "Guest" };
    expect(guest.is_guest).toBe(true);
    expect(() => assertConfidenceViewer(guest)).toThrow(
      /CONFIDENCE_GUESTS_EXCLUDED|registered accounts only/i,
    );
  });
});
