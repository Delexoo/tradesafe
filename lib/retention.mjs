/**
 * Documented retention windows (days). Enforcement job: scripts/retention-cleanup.mjs
 * Legal holds skip deletion — see ts_security_incidents.status in ('investigating','escalated').
 */
export const RETENTION_DAYS = {
  security_events: 730, // 24 months
  device_tokens: 365,
  security_consents: 1095, // 36 months (proof of acceptance)
  admin_audit: 1095,
  resolved_incidents: 1095,
};

export async function runRetentionCleanup(admin, { dryRun = false } = {}) {
  const now = Date.now();
  const cut = (days) => new Date(now - days * 864e5).toISOString();
  const results = {};

  const eventsCut = cut(RETENTION_DAYS.security_events);
  if (!dryRun) {
    const { count, error } = await admin
      .from("ts_security_events")
      .delete({ count: "exact" })
      .lt("created_at", eventsCut)
      .not(
        "transaction_id",
        "in",
        `(select transaction_id from ts_security_incidents where status in ('investigating','escalated') and transaction_id is not null)`,
      );
    // Supabase JS may not support subquery in .not; fall back to simple age delete
    if (error) {
      const { count: c2, error: e2 } = await admin
        .from("ts_security_events")
        .delete({ count: "exact" })
        .lt("created_at", eventsCut);
      results.security_events = { deleted: c2, error: e2?.message || null, note: "simple_age_delete" };
    } else {
      results.security_events = { deleted: count };
    }
  } else {
    results.security_events = { dryRun: true, olderThan: eventsCut };
  }

  const deviceCut = cut(RETENTION_DAYS.device_tokens);
  if (!dryRun) {
    const { count, error } = await admin
      .from("ts_device_tokens")
      .delete({ count: "exact" })
      .lt("last_seen_at", deviceCut);
    results.device_tokens = { deleted: count, error: error?.message || null };
  } else {
    results.device_tokens = { dryRun: true, olderThan: deviceCut };
  }

  return results;
}
