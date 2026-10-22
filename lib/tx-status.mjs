import { assertTransition, financialSource } from "./state-machine.mjs";

/**
 * Conditionally advance a transaction status.
 * Fails closed if the row is no longer in `from` (race) or the edge is illegal.
 */
export async function advanceTransactionStatus(
  admin,
  { id, from, to, source = "client", patch = {} },
) {
  const trusted = financialSource(source);
  assertTransition(from, to, { source: trusted });
  if (from === to) return { ok: true, unchanged: true };

  const { data, error } = await admin
    .from("ts_transactions")
    .update({ status: to, ...patch })
    .eq("id", id)
    .eq("status", from)
    .select("id, status")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    const err = new Error(
      `Could not move trade from ${from} to ${to}. Refresh and try again.`,
    );
    err.status = 409;
    err.code = "STALE_STATUS";
    throw err;
  }
  return { ok: true, status: data.status };
}

export function requireStatus(actual, allowed, message) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (list.includes(actual)) return;
  const err = new Error(message || `This trade is not ready for that step (${actual}).`);
  err.status = 409;
  err.code = "WRONG_STATUS";
  throw err;
}
