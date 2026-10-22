import { describe, expect, it } from "vitest";

/**
 * Pure helper mirroring webhook insert semantics:
 * first event id wins; duplicates are no-ops.
 */
function processWebhookOnce(
  seen: Set<string>,
  provider: string,
  eventId: string,
  apply: () => void
): { processed: boolean; duplicate: boolean } {
  const key = `${provider}:${eventId}`;
  if (seen.has(key)) {
    return { processed: false, duplicate: true };
  }
  seen.add(key);
  apply();
  return { processed: true, duplicate: false };
}

describe("webhook idempotency", () => {
  it("processes a new event once", () => {
    const seen = new Set<string>();
    let releases = 0;
    const first = processWebhookOnce(seen, "stripe", "evt_1", () => {
      releases += 1;
    });
    const second = processWebhookOnce(seen, "stripe", "evt_1", () => {
      releases += 1;
    });
    expect(first).toEqual({ processed: true, duplicate: false });
    expect(second).toEqual({ processed: false, duplicate: true });
    expect(releases).toBe(1);
  });

  it("allows distinct event ids", () => {
    const seen = new Set<string>();
    let n = 0;
    processWebhookOnce(seen, "stripe", "evt_a", () => {
      n += 1;
    });
    processWebhookOnce(seen, "stripe", "evt_b", () => {
      n += 1;
    });
    expect(n).toBe(2);
  });
});
