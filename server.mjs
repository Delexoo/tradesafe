/**
 * TradeSafe vanilla site server — static HTML from /site + JSON API.
 * Web-only. No Electron/Tauri. Load .env from project root.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  resolveActor,
  ensureGuestActor,
  getActivePolicies,
  isSecurityAdmin,
  hashToken as hashGuestToken,
} from "./lib/guest-auth.mjs";
import {
  CONSENT_BUNDLE_VERSION,
  hasRequiredConsent,
  recordSecurityConsent,
  clientIp,
  hashIp,
} from "./lib/security.mjs";
import {
  ensureConsentForProtectedAction,
  emitSecurityEvent,
  bumpInviteFail,
  inviteFailCount,
} from "./lib/security-request.mjs";
import { RETENTION_DAYS } from "./lib/retention.mjs";
import {
  createSecurityReport as createSecurityReportImpl,
  getReportStatus as getReportStatusImpl,
  handleAdminSecurity as handleAdminSecurityImpl,
  handlePaymentWebhook as handlePaymentWebhookImpl,
  applyProviderPaymentUpdate as applyProviderPaymentUpdateImpl,
} from "./lib/security-handlers.mjs";
import { getTradeConfidence } from "./lib/trade-confidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SITE = path.join(ROOT, "site");
const PORT = Number(process.env.PORT || 3000);

loadEnv(path.join(ROOT, ".env"));

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_ON = Boolean(process.env.STRIPE_SECRET_KEY);
const DEMO_MODE = !STRIPE_ON && process.env.DEMO_MODE !== "false";
const PAYMENT_PROVIDER = STRIPE_ON
  ? "stripe"
  : process.env.PAYMENT_PROVIDER || "demo";

function requireEnv() {
  if (!SUPABASE_URL || !ANON || !SERVICE) {
    throw new Error("Missing SUPABASE_URL / ANON / SERVICE_ROLE_KEY");
  }
}

let admin;
function getAdmin() {
  if (!admin) {
    requireEnv();
    admin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function appHandler(req, res) {
  req._pendingCookies = [];
  try {
    const host = req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "http";
    const url = new URL(req.url || "/", `${proto}://${host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, { error: err.message || "Server error" }, req);
  }
}

const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

if (!isServerless) {
  requireEnv();
  const server = http.createServer(appHandler);
  server.listen(PORT, () => {
    console.log(`TradeSafe (vanilla) http://localhost:${PORT}`);
    console.log(`DEMO_MODE=${DEMO_MODE} PAYMENT_PROVIDER=${PAYMENT_PROVIDER}`);
  });
}

export default appHandler;
export { appHandler, handleApi, getAdmin };

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.startsWith("/join/") && !rel.endsWith(".html")) {
    // /join/TOKEN → join.html?token=
    const token = rel.slice("/join/".length);
    res.writeHead(302, { Location: `/join.html?token=${encodeURIComponent(token)}` });
    res.end();
    return;
  }
  const filePath = path.normalize(path.join(SITE, rel));
  if (!filePath.startsWith(SITE)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    json(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" || ext === ".js" || ext === ".css" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === "/api/config" && req.method === "GET") {
    json(
      res,
      200,
      {
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: ANON,
        demoMode: DEMO_MODE,
        paymentProvider: PAYMENT_PROVIDER,
        appUrl: process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${PORT}`,
        guestMode: true,
        consentBundleVersion: CONSENT_BUNDLE_VERSION,
        retentionDays: RETENTION_DAYS,
      },
      req,
    );
    return;
  }

  if (p === "/api/policies" && req.method === "GET") {
    const policies = await getActivePolicies(getAdmin());
    json(
      res,
      200,
      { policies, consentBundleVersion: CONSENT_BUNDLE_VERSION },
      req,
    );
    return;
  }

  if (p === "/api/payments/webhook" && req.method === "POST") {
    json(res, 200, await handlePaymentWebhookImpl(getAdmin(), req), req);
    return;
  }

  if (p === "/api/invitations/preview" && req.method === "GET") {
    const token = url.searchParams.get("token") || "";
    json(res, 200, await previewInvite(token), req);
    return;
  }

  if (p === "/api/guest/session" && req.method === "POST") {
    const body = await readJson(req);
    const actor = await ensureGuestActor(
      req,
      getAdmin(),
      body.display_name,
      req._pendingCookies,
    );
    json(
      res,
      200,
      {
        actor: {
          id: actor.id,
          display_name: actor.display_name,
          is_guest: actor.is_guest,
        },
      },
      req,
    );
    return;
  }

  let actor = await resolveActor(req, getAdmin());

  // Guest-capable routes: ensure session when missing
  const guestRoutes =
    (p === "/api/trades" && req.method === "POST") ||
    (p === "/api/invitations/join" && req.method === "POST");

  if (!actor && guestRoutes) {
    const bodyPeek = await readJson(req);
    req._body = bodyPeek;
    actor = await ensureGuestActor(
      req,
      getAdmin(),
      bodyPeek.display_name,
      req._pendingCookies,
    );
  }

  if (!actor && p !== "/api/payments/webhook") {
    json(res, 401, { error: "Unauthorized" }, req);
    return;
  }

  if (p === "/api/security/consent" && req.method === "GET") {
    const consent = await hasRequiredConsent(getAdmin(), actor.id);
    json(
      res,
      200,
      {
        consentBundleVersion: CONSENT_BUNDLE_VERSION,
        requiredAccepted: !!consent?.required_accepted,
        optionalDeviceAccepted: !!consent?.optional_device_accepted,
        acceptedAt: consent?.accepted_at || null,
      },
      req,
    );
    return;
  }

  if (p === "/api/security/consent" && req.method === "POST") {
    const body = await readJson(req);
    try {
      const result = await recordSecurityConsent(getAdmin(), actor.id, {
        acceptedRequired:
          body.acceptedRequired === true || body.acceptedPolicies === true,
        acceptedOptionalDevice: body.acceptedOptionalDevice === true,
        userAgent: req.headers["user-agent"],
      });
      if (result.optional_device_accepted) {
        const { ensureDeviceToken } = await import("./lib/security.mjs");
        await ensureDeviceToken(
          getAdmin(),
          req,
          actor.id,
          true,
          req._pendingCookies,
        );
      }
      await emitSecurityEvent(getAdmin(), req, actor, {
        event_type: "consent_recorded",
        payload: {
          consent_bundle_version: result.consent_bundle_version,
          optional_device: result.optional_device_accepted,
        },
      });
      json(res, 200, result, req);
    } catch (err) {
      json(
        res,
        err.status || 400,
        {
          error: err.message,
          code: err.code || "CONSENT_FAILED",
          retry: "Re-check the required policies and try again.",
        },
        req,
      );
    }
    return;
  }

  if (p === "/api/security/reports" && req.method === "POST") {
    const body = await readJson(req);
    json(
      res,
      201,
      await createSecurityReportImpl(getAdmin(), actor, body, req),
      req,
    );
    return;
  }

  const reportMatch = p.match(/^\/api\/security\/reports\/([^/]+)$/);
  if (reportMatch && req.method === "GET") {
    json(
      res,
      200,
      await getReportStatusImpl(getAdmin(), actor, reportMatch[1]),
      req,
    );
    return;
  }

  if (p.startsWith("/api/admin/security")) {
    if (!(await isSecurityAdmin(getAdmin(), actor.id))) {
      await emitSecurityEvent(getAdmin(), req, actor, {
        event_type: "admin_access_denied",
        severity: "medium",
        payload: { path: p },
      });
      json(res, 403, { error: "Forbidden" }, req);
      return;
    }
    await handleAdminSecurityImpl(getAdmin(), req, res, url, actor, p, json);
    return;
  }

  if (p === "/api/profile" && req.method === "GET") {
    await ensureProfile(actor);
    const { data } = await getAdmin()
      .from("ts_profiles")
      .select("*")
      .eq("id", actor.id)
      .single();
    json(res, 200, { profile: data, email: actor.email || null, is_guest: !!actor.is_guest }, req);
    return;
  }

  if (p === "/api/profile" && req.method === "PATCH") {
    const body = await readJson(req);
    const { data, error } = await getAdmin()
      .from("ts_profiles")
      .update({ display_name: String(body.display_name || "").slice(0, 80) })
      .eq("id", actor.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    json(res, 200, { profile: data }, req);
    return;
  }

  if (p === "/api/trades" && req.method === "GET") {
    const { data: parts } = await getAdmin()
      .from("ts_participants")
      .select("role, status, ts_transactions(*)")
      .eq("user_id", actor.id)
      .eq("status", "joined");
    json(
      res,
      200,
      {
        trades: (parts || []).map((row) => ({
          role: row.role,
          transaction: row.ts_transactions,
        })),
      },
      req,
    );
    return;
  }

  if (p === "/api/trades" && req.method === "POST") {
    const body = req._body || (await readJson(req));
    const result = await createTrade(actor, body, req);
    json(res, 201, result, req);
    return;
  }

  const tradeMatch = p.match(/^\/api\/trades\/([^/]+)(.*)$/);
  if (tradeMatch) {
    const tradeId = tradeMatch[1];
    const rest = tradeMatch[2] || "";

    if (rest === "" && req.method === "GET") {
      try {
        const room = await getRoom(actor.id, tradeId);
        json(res, 200, room, req);
      } catch (err) {
        if (err.code === "TRADE_ACCESS_DENIED" || err.status === 403) {
          await emitSecurityEvent(getAdmin(), req, actor, {
            event_type: "unauthorized_trade_access",
            severity: "high",
            transaction_id: tradeId,
            payload: {},
          });
        }
        throw err;
      }
      return;
    }
    if (rest === "/confidence" && req.method === "GET") {
      try {
        const confidence = await getTradeConfidence(
          getAdmin(),
          actor,
          tradeId,
        );
        // No shared caches — per-viewer authorization-sensitive response
        res.setHeader(
          "Cache-Control",
          "private, no-store, max-age=0, must-revalidate",
        );
        json(res, 200, confidence, req);
      } catch (err) {
        if (err.code === "TRADE_ACCESS_DENIED" || err.status === 403) {
          await emitSecurityEvent(getAdmin(), req, actor, {
            event_type: "unauthorized_trade_access",
            severity: "high",
            transaction_id: tradeId,
            payload: { route: "confidence" },
          });
        }
        const status = err.status || 500;
        json(
          res,
          status,
          {
            error: err.message || "Trade Confidence unavailable",
            code: err.code || "CONFIDENCE_FAILED",
          },
          req,
        );
      }
      return;
    }
    if (rest === "/report" && req.method === "POST") {
      const body = await readJson(req);
      body.transaction_id = tradeId;
      json(
        res,
        201,
        await createSecurityReportImpl(getAdmin(), actor, body, req),
        req,
      );
      return;
    }
    if (rest === "/accept" && req.method === "POST") {
      json(res, 200, await acceptTerms(actor.id, tradeId), req);
      return;
    }
    if (rest === "/actions" && req.method === "POST") {
      const body = await readJson(req);
      json(
        res,
        200,
        await performAction(actor.id, tradeId, body.action, body.payload || {}, req),
        req,
      );
      return;
    }
    if (rest === "/messages" && req.method === "POST") {
      const body = await readJson(req);
      await getRoom(actor.id, tradeId);
      const { data, error } = await getAdmin()
        .from("ts_messages")
        .insert({
          transaction_id: tradeId,
          sender_id: actor.id,
          body: String(body.body || "").slice(0, 4000),
          is_system: false,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      json(res, 201, { message: data }, req);
      return;
    }
  }

  if (p === "/api/invitations/join" && req.method === "POST") {
    const body = req._body || (await readJson(req));
    if (body.display_name) {
      actor = await ensureGuestActor(
        req,
        getAdmin(),
        body.display_name,
        req._pendingCookies,
      );
    }
    json(res, 200, await joinInvite(actor, body, req), req);
    return;
  }

  if (p === "/api/invitations/create" && req.method === "POST") {
    const body = await readJson(req);
    const room = await getRoom(actor.id, body.transactionId);
    if (room.transaction.creator_id !== actor.id) {
      json(res, 403, { error: "Only creator can mint invites" }, req);
      return;
    }
    const raw = randomBytes(32).toString("base64url");
    await getAdmin().from("ts_invitations").insert({
      transaction_id: body.transactionId,
      token_hash: hashToken(raw),
      role: body.role || "buyer",
      created_by: actor.id,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    json(res, 201, { token: raw, url: `/join/${raw}` }, req);
    return;
  }

  json(res, 404, { error: "Not found" }, req);
}

async function ensureProfile(actor) {
  const { data } = await getAdmin()
    .from("ts_profiles")
    .select("id")
    .eq("id", actor.id)
    .maybeSingle();
  if (!data) {
    await getAdmin().from("ts_profiles").insert({
      id: actor.id,
      display_name: actor.display_name || "Trader",
      is_guest: !!actor.is_guest,
    });
  }
}

function hashToken(raw) {
  return hashGuestToken(raw);
}

function refCode() {
  return `TS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function createTrade(actor, input, req) {
  const displayName = String(
    input.display_name || actor.display_name || "Guest",
  )
    .trim()
    .slice(0, 80);
  if (!displayName) {
    const err = new Error("Display name is required");
    err.status = 400;
    throw err;
  }

  await ensureProfile({ ...actor, display_name: displayName });
  await getAdmin()
    .from("ts_profiles")
    .update({ display_name: displayName })
    .eq("id", actor.id);

  // Fail closed: required security consent must be recorded server-side
  let consentPack;
  try {
    consentPack = await ensureConsentForProtectedAction(
      getAdmin(),
      actor,
      input,
      req,
      req._pendingCookies || [],
    );
  } catch (err) {
    await emitSecurityEvent(getAdmin(), req, actor, {
      event_type: "consent_blocked_create",
      severity: "low",
      payload: { reason: err.code || "CONSENT_REQUIRED" },
    });
    throw err;
  }

  const isDemo = !STRIPE_ON;
  const creatorRole = input.creator_role === "buyer" ? "buyer" : "seller";
  const other = creatorRole === "buyer" ? "seller" : "buyer";
  const termsBody = {
    deliveryMethod: input.delivery_method || "other",
    ...(input.terms || {}),
    honestyAck: true,
  };

  const { data: tx, error } = await getAdmin()
    .from("ts_transactions")
    .insert({
      reference_code: refCode(),
      title: input.title,
      description: input.description || "",
      category: input.category || "other",
      amount_cents: input.amount_cents,
      currency: (input.currency || "usd").toLowerCase(),
      status: "awaiting_acceptance",
      creator_id: actor.id,
      delivery_method: input.delivery_method || "other",
      terms: termsBody,
      terms_version: 1,
      is_demo: isDemo,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await getAdmin().from("ts_participants").insert([
    {
      transaction_id: tx.id,
      user_id: actor.id,
      role: creatorRole,
      status: "joined",
      joined_at: new Date().toISOString(),
      display_name: displayName,
    },
    { transaction_id: tx.id, user_id: null, role: other, status: "pending" },
  ]);

  await getAdmin().from("ts_terms_versions").insert({
    transaction_id: tx.id,
    version: 1,
    body: termsBody,
    created_by: actor.id,
  });

  const milestones = defaultMilestones(input.category || "other");
  await getAdmin().from("ts_milestones").insert(
    milestones.map((m, i) => ({
      transaction_id: tx.id,
      ...m,
      status: m.key === "shared_parties_ready" ? "active" : "pending",
      sort_order: i,
    })),
  );

  await getAdmin().from("ts_fulfillments").insert({
    transaction_id: tx.id,
    method: input.delivery_method || "other",
    status: "not_started",
  });

  const raw = randomBytes(32).toString("base64url");
  await getAdmin().from("ts_invitations").insert({
    transaction_id: tx.id,
    token_hash: hashToken(raw),
    role: other,
    created_by: actor.id,
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    max_uses: 10,
  });

  await getAdmin().from("ts_events").insert({
    transaction_id: tx.id,
    actor_id: actor.id,
    event_type: "transaction_created",
    summary: `Trade ${tx.reference_code} created${isDemo ? " (DEMO)" : ""}`,
    verification_source: "system",
  });

  await emitSecurityEvent(getAdmin(), req, actor, {
    event_type: "trade_created",
    transaction_id: tx.id,
    device_ref: consentPack.device?.ref || null,
    isNewDevice: consentPack.device?.is_new,
    payload: {
      reference_code: tx.reference_code,
      optional_device: consentPack.optionalOk,
    },
  });

  return {
    transaction: tx,
    inviteToken: raw,
    inviteUrl: `/join/${raw}`,
    isDemo,
  };
}

function defaultMilestones(category) {
  const base = [
    { key: "shared_parties_ready", track: "shared", label: "Both parties joined", verification_source: "system" },
    { key: "buyer_terms_accepted", track: "buyer", label: "Buyer accepted terms", verification_source: "system" },
    { key: "seller_terms_accepted", track: "seller", label: "Seller accepted terms", verification_source: "system" },
    { key: "buyer_payment_initiated", track: "buyer", label: "Payment started", verification_source: "provider_confirmed" },
    { key: "buyer_payment_authorized", track: "buyer", label: "Payment authorization on file", verification_source: "provider_confirmed" },
    { key: "seller_fulfillment_acknowledged", track: "seller", label: "Seller acknowledged order", verification_source: "user_reported" },
  ];
  if (category === "digital" || category === "website_domain") {
    base.push({ key: "seller_digital_transfer", track: "seller", label: "Digital asset transferred", verification_source: "awaiting_verification" });
  } else {
    base.push({ key: "seller_shipped", track: "seller", label: "Shipped / transferred", verification_source: "user_reported" });
    base.push({ key: "seller_delivery_complete", track: "seller", label: "Delivery evidence", verification_source: "awaiting_verification" });
  }
  base.push(
    { key: "buyer_receipt_confirmed", track: "buyer", label: "Buyer confirmed receipt", verification_source: "user_reported" },
    { key: "shared_trade_completed", track: "shared", label: "Trade marked complete", verification_source: "provider_confirmed" },
  );
  return base;
}

async function getRoom(userId, tradeId) {
  const { data: tx } = await getAdmin()
    .from("ts_transactions")
    .select("*")
    .eq("id", tradeId)
    .single();
  if (!tx) throw new Error("Transaction not found");

  const { data: participant } = await getAdmin()
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", tradeId)
    .eq("user_id", userId)
    .eq("status", "joined")
    .maybeSingle();

  if (!participant && tx.creator_id !== userId) {
    const err = new Error("Forbidden");
    err.status = 403;
    err.code = "TRADE_ACCESS_DENIED";
    throw err;
  }

  const [
    { data: participants },
    { data: milestones },
    { data: payments },
    { data: fulfillment },
    { data: events },
    { data: messages },
  ] = await Promise.all([
    getAdmin().from("ts_participants").select("*, ts_profiles(display_name, avatar_url)").eq("transaction_id", tradeId),
    getAdmin().from("ts_milestones").select("*").eq("transaction_id", tradeId).order("sort_order"),
    getAdmin().from("ts_payments").select("*").eq("transaction_id", tradeId).order("created_at", { ascending: false }),
    getAdmin().from("ts_fulfillments").select("*").eq("transaction_id", tradeId).maybeSingle(),
    getAdmin().from("ts_events").select("*").eq("transaction_id", tradeId).order("created_at", { ascending: false }).limit(100),
    getAdmin().from("ts_messages").select("*, ts_profiles(display_name, avatar_url)").eq("transaction_id", tradeId).order("created_at", { ascending: true }).limit(200),
  ]);

  let payment = payments?.[0] || null;
  let transaction = tx;
  try {
    const synced = await syncStripeCheckout(transaction, payment);
    if (synced) {
      payment = synced.payment;
      transaction = synced.transaction;
    }
  } catch {
    // The room still loads if Stripe cannot be read yet.
  }

  return {
    transaction,
    participants: participants || [],
    milestones: milestones || [],
    payment,
    fulfillment: fulfillment || null,
    events: events || [],
    messages: messages || [],
    myRole: participant?.role || null,
  };
}

async function syncStripeCheckout(tx, payment) {
  if (!payment || !process.env.STRIPE_SECRET_KEY) return null;
  const sessionId = String(payment.provider_session_id || "");
  if (!sessionId.startsWith("cs_")) return null;
  if (String(payment.provider_payment_id || "").startsWith("pi_") && payment.status === "authorized") {
    return null;
  }
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!piId) return null;
  const intent = await stripe.paymentIntents.retrieve(piId);
  const status =
    intent.status === "requires_capture"
      ? "authorized"
      : intent.status === "succeeded"
        ? "captured"
        : null;
  if (!status) return null;
  await getAdmin()
    .from("ts_payments")
    .update({ provider: "stripe", provider_payment_id: piId })
    .eq("id", payment.id);
  if (payment.status !== status) {
    await applyProviderPaymentUpdateImpl(getAdmin(), {
      provider_payment_id: piId,
      status,
      source: "provider_api",
      idempotency_key: `sync_${piId}_${status}`,
    });
  }
  const { data: fresh } = await getAdmin()
    .from("ts_transactions")
    .select("*")
    .eq("id", tx.id)
    .single();
  return {
    payment: { ...payment, provider: "stripe", provider_payment_id: piId, status },
    transaction: fresh || tx,
  };
}

async function acceptTerms(userId, tradeId) {
  const room = await getRoom(userId, tradeId);
  const me = room.participants.find((p) => p.user_id === userId);
  if (!me) throw new Error("Not a participant");
  await getAdmin()
    .from("ts_participants")
    .update({
      terms_accepted_at: new Date().toISOString(),
      terms_version_accepted: room.transaction.terms_version,
    })
    .eq("id", me.id);
  const key =
    me.role === "buyer" ? "buyer_terms_accepted" : "seller_terms_accepted";
  await getAdmin()
    .from("ts_milestones")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      verification_source: "user_reported",
    })
    .eq("transaction_id", tradeId)
    .eq("key", key);
  await getAdmin().from("ts_events").insert({
    transaction_id: tradeId,
    actor_id: userId,
    event_type: "terms_accepted",
    summary: `${me.role} accepted terms`,
    verification_source: "user_reported",
  });
  const { data: refreshed } = await getAdmin()
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", tradeId)
    .in("role", ["buyer", "seller"]);
  const both = (refreshed || [])
    .filter((p) => p.role === "buyer" || p.role === "seller")
    .every((p) => p.terms_accepted_at && p.status === "joined");
  if (both && room.transaction.status === "awaiting_acceptance") {
    await getAdmin()
      .from("ts_transactions")
      .update({ status: "awaiting_payment" })
      .eq("id", tradeId);
  }
  return { bothAccepted: both };
}

async function previewInvite(token) {
  if (!token || token.length < 16) throw new Error("Invalid invitation");
  const { data: inv } = await getAdmin()
    .from("ts_invitations")
    .select("role, expires_at, revoked_at, use_count, max_uses, transaction_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!inv) throw new Error("Invalid invitation");
  if (inv.revoked_at) throw new Error("Invitation revoked");
  if (new Date(inv.expires_at) < new Date()) throw new Error("Invitation expired");
  if (inv.use_count >= inv.max_uses) throw new Error("Invitation exhausted");
  const { data: tx } = await getAdmin()
    .from("ts_transactions")
    .select(
      "id, reference_code, title, description, amount_cents, currency, category, delivery_method, status, is_demo, terms_version",
    )
    .eq("id", inv.transaction_id)
    .single();
  if (!tx) throw new Error("Invalid invitation");
  return {
    role: inv.role,
    expires_at: inv.expires_at,
    transaction: {
      id: tx.id,
      reference_code: tx.reference_code,
      title: tx.title,
      description: tx.description,
      amount_cents: tx.amount_cents,
      currency: tx.currency,
      category: tx.category,
      delivery_method: tx.delivery_method,
      status: tx.status,
      is_demo: tx.is_demo,
      terms_version: tx.terms_version,
    },
  };
}

async function joinInvite(actor, body, req) {
  const token = body.token;
  const displayName = String(body.display_name || actor.display_name || "Guest")
    .trim()
    .slice(0, 80);
  if (!displayName) {
    const err = new Error("Display name is required");
    err.status = 400;
    throw err;
  }

  const ipH = hashIp(clientIp(req));
  const fails = inviteFailCount(ipH);
  if (fails >= 20) {
    const err = new Error("Too many invitation attempts. Try again later.");
    err.status = 429;
    throw err;
  }

  let consentPack;
  try {
    consentPack = await ensureConsentForProtectedAction(
      getAdmin(),
      actor,
      body,
      req,
      req._pendingCookies || [],
    );
  } catch (err) {
    await emitSecurityEvent(getAdmin(), req, actor, {
      event_type: "consent_blocked_join",
      severity: "low",
      payload: { reason: err.code || "CONSENT_REQUIRED" },
    });
    throw err;
  }

  await ensureProfile({ ...actor, display_name: displayName });
  await getAdmin()
    .from("ts_profiles")
    .update({ display_name: displayName })
    .eq("id", actor.id);

  const { data: inv } = await getAdmin()
    .from("ts_invitations")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!inv) {
    bumpInviteFail(ipH);
    await emitSecurityEvent(getAdmin(), req, actor, {
      event_type: "invite_redeem_failed",
      severity: "medium",
      inviteFailCount: fails + 1,
      payload: { reason: "invalid" },
    });
    const err = new Error("Invalid invitation");
    err.status = 400;
    throw err;
  }
  if (inv.revoked_at) {
    bumpInviteFail(ipH);
    await emitSecurityEvent(getAdmin(), req, actor, {
      event_type: "invite_redeem_failed",
      severity: "medium",
      transaction_id: inv.transaction_id,
      payload: { reason: "revoked" },
    });
    throw Object.assign(new Error("Invitation revoked"), { status: 400 });
  }
  if (new Date(inv.expires_at) < new Date()) {
    bumpInviteFail(ipH);
    await emitSecurityEvent(getAdmin(), req, actor, {
      event_type: "invite_redeem_failed",
      severity: "low",
      transaction_id: inv.transaction_id,
      payload: { reason: "expired" },
    });
    throw Object.assign(new Error("Invitation expired"), { status: 400 });
  }
  if (inv.use_count >= inv.max_uses) {
    throw Object.assign(new Error("Invitation exhausted"), { status: 400 });
  }

  const { data: existing } = await getAdmin()
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", inv.transaction_id)
    .eq("user_id", actor.id)
    .maybeSingle();
  if (existing?.status === "joined") {
    return { transactionId: inv.transaction_id, alreadyJoined: true };
  }

  const { data: slot } = await getAdmin()
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", inv.transaction_id)
    .eq("role", inv.role)
    .maybeSingle();
  if (slot?.user_id && slot.user_id !== actor.id) {
    throw new Error("Role already filled");
  }
  if (slot) {
    await getAdmin()
      .from("ts_participants")
      .update({
        user_id: actor.id,
        status: "joined",
        joined_at: new Date().toISOString(),
        display_name: displayName,
      })
      .eq("id", slot.id);
  } else {
    await getAdmin().from("ts_participants").insert({
      transaction_id: inv.transaction_id,
      user_id: actor.id,
      role: inv.role,
      status: "joined",
      joined_at: new Date().toISOString(),
      display_name: displayName,
    });
  }
  await getAdmin()
    .from("ts_invitations")
    .update({ use_count: inv.use_count + 1 })
    .eq("id", inv.id);
  await getAdmin()
    .from("ts_milestones")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("transaction_id", inv.transaction_id)
    .eq("key", "shared_parties_ready");
  await getAdmin().from("ts_events").insert({
    transaction_id: inv.transaction_id,
    actor_id: actor.id,
    event_type: "participant_joined",
    summary: `Participant joined as ${inv.role}`,
    verification_source: "system",
  });
  await emitSecurityEvent(getAdmin(), req, actor, {
    event_type: "invite_redeemed",
    transaction_id: inv.transaction_id,
    device_ref: consentPack.device?.ref || null,
    isNewDevice: consentPack.device?.is_new,
    payload: { role: inv.role, optional_device: consentPack.optionalOk },
  });
  return { transactionId: inv.transaction_id, role: inv.role };
}

function publicOrigin(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .split(",")[0]
    .trim();
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL || "https://tradesafe-alpha.vercel.app";
}

async function performAction(userId, tradeId, action, payload, req) {
  const room = await getRoom(userId, tradeId);
  const role = room.myRole;
  if (!role) throw new Error("Forbidden");
  const tx = room.transaction;
  const isDemo = !!tx.is_demo;

  // Clients cannot set payment status or grant themselves roles
  if (
    action === "set_payment_status" ||
    action === "set_role" ||
    action === "grant_admin" ||
    payload?.payment_status ||
    payload?.is_admin
  ) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }

  if (action === "initiate_payment") {
    if (role !== "buyer") throw new Error("Only the buyer can pay");
    if (!process.env.STRIPE_SECRET_KEY) {
      const err = new Error("Card payments are not set up on this server yet.");
      err.status = 503;
      throw err;
    }
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = publicOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          transaction_id: tradeId,
          reference_code: tx.reference_code,
        },
      },
      line_items: [
        {
          price_data: {
            currency: String(tx.currency || "usd").toLowerCase(),
            unit_amount: tx.amount_cents,
            product_data: {
              name: tx.title || `Trade ${tx.reference_code}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/room.html?id=${encodeURIComponent(tradeId)}&paid=1`,
      cancel_url: `${origin}/room.html?id=${encodeURIComponent(tradeId)}&paid=0`,
      metadata: { transaction_id: tradeId },
    });
    const paymentPatch = {
      provider: "stripe",
      provider_payment_id: session.id,
      provider_session_id: session.id,
      amount_cents: tx.amount_cents,
      currency: tx.currency,
      status: "pending",
    };
    if (room.payment?.id) {
      await getAdmin().from("ts_payments").update(paymentPatch).eq("id", room.payment.id);
    } else {
      await getAdmin().from("ts_payments").insert({
        transaction_id: tradeId,
        ...paymentPatch,
      });
    }
    await getAdmin()
      .from("ts_transactions")
      .update({ status: "payment_pending" })
      .eq("id", tradeId);
    await getAdmin()
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "user_reported",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "buyer_payment_initiated");
    await getAdmin().from("ts_events").insert({
      transaction_id: tradeId,
      actor_id: userId,
      event_type: "payment_initiated",
      summary: "Buyer opened Stripe to authorize the card",
      verification_source: "user_reported",
    });
    return { ok: true, url: session.url };
  }

  if (action === "demo_authorize_payment") {
    if (!isDemo || !DEMO_MODE) throw new Error("Demo actions unavailable");
    if (role !== "buyer") throw new Error("Only buyer");
    const payment = room.payment;
    if (!payment) throw new Error("Initiate payment first");
    // Demo path is an explicit server-side simulation, not client-trusted status
    await applyProviderPaymentUpdateImpl(getAdmin(), {
      provider_payment_id: payment.provider_payment_id,
      status: "authorized",
      source: "demo_server",
      idempotency_key: `demo_auth_${payment.id}`,
      actor_id: userId,
    });
    return { ok: true };
  }

  if (
    action === "set_payment_status" ||
    action === "update_payment" ||
    action === "capture_payment"
  ) {
    const err = new Error(
      "Payment status can only change via verified provider events",
    );
    err.status = 403;
    throw err;
  }

  if (action === "mark_preparing") {
    if (role !== "seller") throw new Error("Only seller");
    await getAdmin()
      .from("ts_fulfillments")
      .update({ status: "preparing" })
      .eq("transaction_id", tradeId);
    await getAdmin()
      .from("ts_transactions")
      .update({ status: "in_fulfillment" })
      .eq("id", tradeId);
    await getAdmin()
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "user_reported",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "seller_fulfillment_acknowledged");
    return { ok: true };
  }

  if (action === "submit_tracking") {
    if (role !== "seller") throw new Error("Only seller");
    await getAdmin()
      .from("ts_fulfillments")
      .update({
        status: "shipped",
        tracking_number: payload.tracking_number || null,
        seller_notes: payload.notes || null,
      })
      .eq("transaction_id", tradeId);
    await getAdmin()
      .from("ts_transactions")
      .update({ status: "awaiting_confirmation" })
      .eq("id", tradeId);
    await getAdmin().from("ts_events").insert({
      transaction_id: tradeId,
      actor_id: userId,
      event_type: "fulfillment_shipped",
      summary: "Seller submitted tracking / transfer evidence",
      verification_source: "user_reported",
      payload,
    });
    return { ok: true };
  }

  if (action === "confirm_delivery") {
    if (role !== "buyer") throw new Error("Only the buyer can confirm");
    const pi = room.payment?.provider_payment_id || "";
    if (!String(pi).startsWith("pi_")) {
      const err = new Error(
        "Stripe has not confirmed the card yet. Stay on this page, then confirm again.",
      );
      err.status = 409;
      throw err;
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      const err = new Error("Card payments are not set up on this server yet.");
      err.status = 503;
      throw err;
    }
    await getAdmin()
      .from("ts_fulfillments")
      .update({
        status: "confirmed",
        buyer_confirmed_at: new Date().toISOString(),
      })
      .eq("transaction_id", tradeId);
    await getAdmin()
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "user_reported",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "buyer_receipt_confirmed");
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    await stripe.paymentIntents.capture(pi);
    await applyProviderPaymentUpdateImpl(getAdmin(), {
      provider_payment_id: pi,
      status: "captured",
      source: "provider_api",
      idempotency_key: `capture_${pi}`,
      actor_id: userId,
    });
    await getAdmin()
      .from("ts_transactions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", tradeId);
    await getAdmin()
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "provider_confirmed",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "shared_trade_completed");
    await getAdmin().from("ts_events").insert({
      transaction_id: tradeId,
      actor_id: userId,
      event_type: "completed",
      summary: "Buyer confirmed receipt and Stripe captured the card authorization",
      verification_source: "provider_confirmed",
    });
    return { ok: true };
  }

  if (action === "open_dispute") {
    if (tx.status === "disputed") {
      const err = new Error("A dispute is already open. Use messages.");
      err.status = 409;
      throw err;
    }
    await getAdmin().from("ts_disputes").insert({
      transaction_id: tradeId,
      opened_by: userId,
      reason: payload.reason || "Dispute",
      details: payload.details || "",
      status: "open",
    });
    await getAdmin()
      .from("ts_transactions")
      .update({ status: "disputed" })
      .eq("id", tradeId);
    await getAdmin().from("ts_events").insert({
      transaction_id: tradeId,
      actor_id: userId,
      event_type: "dispute_opened",
      summary: "Dispute opened",
      verification_source: "user_reported",
    });
    return { ok: true };
  }

  throw new Error(`Unknown action: ${action}`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body, req) {
  const payload = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const cookies = req?._pendingCookies || [];
  if (cookies.length === 1) headers["Set-Cookie"] = cookies[0];
  else if (cookies.length > 1) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(payload);
}
