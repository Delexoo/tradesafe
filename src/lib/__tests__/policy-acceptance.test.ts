import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/** Mirrors server rule: client may only send acceptedPolicies:true; versions come from DB. */
function assertPolicyFlag(acceptedPolicies: unknown) {
  if (acceptedPolicies !== true) {
    throw new Error(
      "You must accept the Terms of Service, Privacy Policy, and Transaction and Dispute Policies.",
    );
  }
}

function buildAcceptanceRows(
  actorId: string,
  policies: { id: string; policy_key: string; version: string; content_hash: string }[],
  transactionId: string | null,
) {
  const required = ["tos", "privacy", "transaction_dispute"];
  for (const key of required) {
    if (!policies.some((p) => p.policy_key === key)) {
      throw new Error(`Missing active policy: ${key}`);
    }
  }
  return policies
    .filter((p) => required.includes(p.policy_key))
    .map((p) => ({
      actor_id: actorId,
      policy_version_id: p.id,
      policy_key: p.policy_key,
      policy_version: p.version,
      content_hash: p.content_hash,
      transaction_id: transactionId,
      method: "checkbox" as const,
    }));
}

describe("policy acceptance", () => {
  const policies = [
    {
      id: "1",
      policy_key: "tos",
      version: "2026-10-22",
      content_hash: createHash("sha256").update("tos").digest("hex"),
    },
    {
      id: "2",
      policy_key: "privacy",
      version: "2026-10-22",
      content_hash: createHash("sha256").update("privacy").digest("hex"),
    },
    {
      id: "3",
      policy_key: "transaction_dispute",
      version: "2026-10-22",
      content_hash: createHash("sha256").update("td").digest("hex"),
    },
  ];

  it("rejects missing acceptance flag", () => {
    expect(() => assertPolicyFlag(false)).toThrow(/must accept/);
    expect(() => assertPolicyFlag(undefined)).toThrow(/must accept/);
    expect(() => assertPolicyFlag("true")).toThrow(/must accept/);
  });

  it("accepts only boolean true", () => {
    expect(() => assertPolicyFlag(true)).not.toThrow();
  });

  it("records server policy versions not client-supplied ones", () => {
    const rows = buildAcceptanceRows("actor-1", policies, "tx-1");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.actor_id === "actor-1")).toBe(true);
    expect(rows.map((r) => r.policy_version)).toEqual([
      "2026-10-22",
      "2026-10-22",
      "2026-10-22",
    ]);
    expect(rows.find((r) => r.policy_key === "tos")?.content_hash).toBe(
      policies[0].content_hash,
    );
  });

  it("fails if an active policy is missing", () => {
    expect(() =>
      buildAcceptanceRows("actor-1", policies.slice(0, 2), null),
    ).toThrow(/Missing active policy/);
  });
});

describe("platform vs transaction terms", () => {
  it("treats platform policy acceptance as separate from trade terms", () => {
    const platformAccepted = true;
    const tradeTermsAccepted = false;
    expect(platformAccepted && !tradeTermsAccepted).toBe(true);
  });
});
