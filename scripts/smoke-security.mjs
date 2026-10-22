/**
 * Live smoke: consent fail-closed on create, then success with consent.
 * Requires local server on PORT (default 3000) and configured .env.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const base = process.env.SMOKE_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  const results = [];

  // Guest session
  const sess = await fetch(`${base}/api/guest/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "SmokeGuest" }),
  });
  const cookie = parseSetCookie(sess);
  results.push({ step: "guest_session", ok: sess.ok, status: sess.status });

  // Create without consent — must fail
  const denied = await fetch(`${base}/api/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "No consent trade",
      amount_cents: 1000,
      currency: "usd",
      display_name: "SmokeGuest",
      acceptedPolicies: false,
      acceptedRequired: false,
    }),
  });
  const deniedBody = await denied.json().catch(() => ({}));
  results.push({
    step: "create_without_consent",
    ok: denied.status === 403 || denied.status === 400,
    status: denied.status,
    error: deniedBody.error,
  });

  // Create with required consent
  const created = await fetch(`${base}/api/trades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      title: "Consented smoke trade",
      amount_cents: 2500,
      currency: "usd",
      category: "other",
      delivery_method: "other",
      creator_role: "seller",
      display_name: "SmokeGuest",
      acceptedRequired: true,
      acceptedOptionalDevice: false,
      acceptedPolicies: true,
    }),
  });
  const createdBody = await created.json().catch(() => ({}));
  results.push({
    step: "create_with_consent",
    ok: created.status === 201,
    status: created.status,
    tradeId: createdBody.transaction?.id,
    error: createdBody.error,
  });

  // Cross-trade access with second guest
  const sess2 = await fetch(`${base}/api/guest/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: "OtherGuest" }),
  });
  const cookie2 = parseSetCookie(sess2);
  if (createdBody.transaction?.id) {
    const cross = await fetch(
      `${base}/api/trades/${createdBody.transaction.id}`,
      { headers: { Cookie: cookie2 } },
    );
    results.push({
      step: "cross_trade_denied",
      ok: cross.status === 403 || cross.status === 500,
      status: cross.status,
    });
  }

  // Admin denied for ordinary guest
  const admin = await fetch(`${base}/api/admin/security/overview`, {
    headers: { Cookie: cookie },
  });
  results.push({
    step: "admin_denied_for_guest",
    ok: admin.status === 403,
    status: admin.status,
  });

  // Client cannot set payment status
  if (createdBody.transaction?.id) {
    const payHack = await fetch(
      `${base}/api/trades/${createdBody.transaction.id}/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          action: "set_payment_status",
          payload: { status: "captured" },
        }),
      },
    );
    results.push({
      step: "payment_status_client_blocked",
      ok: payHack.status === 403 || payHack.status >= 400,
      status: payHack.status,
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ base, results, failed: failed.length }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
