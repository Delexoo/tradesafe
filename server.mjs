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
const DEMO_MODE = process.env.DEMO_MODE !== "false";
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "demo";

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
    json(res, 500, { error: err.message || "Server error" });
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
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === "/api/config" && req.method === "GET") {
    json(res, 200, {
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: ANON,
      demoMode: DEMO_MODE,
      paymentProvider: PAYMENT_PROVIDER,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${PORT}`,
    });
    return;
  }

  const user = await userFromAuth(req);
  if (!user && p !== "/api/payments/webhook") {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  if (p === "/api/profile" && req.method === "GET") {
    await ensureProfile(user);
    const { data } = await admin
      .from("ts_profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    json(res, 200, { profile: data, email: user.email });
    return;
  }

  if (p === "/api/profile" && req.method === "PATCH") {
    const body = await readJson(req);
    const { data, error } = await admin
      .from("ts_profiles")
      .update({ display_name: body.display_name })
      .eq("id", user.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    json(res, 200, { profile: data });
    return;
  }

  if (p === "/api/trades" && req.method === "GET") {
    const { data: parts } = await admin
      .from("ts_participants")
      .select("role, status, ts_transactions(*)")
      .eq("user_id", user.id)
      .eq("status", "joined");
    json(res, 200, {
      trades: (parts || []).map((p) => ({
        role: p.role,
        transaction: p.ts_transactions,
      })),
    });
    return;
  }

  if (p === "/api/trades" && req.method === "POST") {
    const body = await readJson(req);
    const result = await createTrade(user, body);
    json(res, 201, result);
    return;
  }

  const tradeMatch = p.match(/^\/api\/trades\/([^/]+)(.*)$/);
  if (tradeMatch) {
    const tradeId = tradeMatch[1];
    const rest = tradeMatch[2] || "";

    if (rest === "" && req.method === "GET") {
      const room = await getRoom(user.id, tradeId);
      json(res, 200, room);
      return;
    }
    if (rest === "/accept" && req.method === "POST") {
      json(res, 200, await acceptTerms(user.id, tradeId));
      return;
    }
    if (rest === "/actions" && req.method === "POST") {
      const body = await readJson(req);
      json(res, 200, await performAction(user.id, tradeId, body.action, body.payload || {}));
      return;
    }
    if (rest === "/messages" && req.method === "POST") {
      const body = await readJson(req);
      const room = await getRoom(user.id, tradeId);
      void room;
      const { data, error } = await admin
        .from("ts_messages")
        .insert({
          transaction_id: tradeId,
          sender_id: user.id,
          body: String(body.body || "").slice(0, 4000),
          is_system: false,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      json(res, 201, { message: data });
      return;
    }
  }

  if (p === "/api/invitations/join" && req.method === "POST") {
    const body = await readJson(req);
    json(res, 200, await joinInvite(user.id, body.token));
    return;
  }

  if (p === "/api/invitations/create" && req.method === "POST") {
    const body = await readJson(req);
    const room = await getRoom(user.id, body.transactionId);
    if (room.transaction.creator_id !== user.id) {
      json(res, 403, { error: "Only creator can mint invites" });
      return;
    }
    const raw = randomBytes(32).toString("base64url");
    await getAdmin().from("ts_invitations").insert({
      transaction_id: body.transactionId,
      token_hash: hashToken(raw),
      role: body.role || "buyer",
      created_by: user.id,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    json(res, 201, { token: raw, url: `/join/${raw}` });
    return;
  }

  json(res, 404, { error: "Not found" });
}

async function userFromAuth(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return null;
  const { data, error } = await getAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function ensureProfile(user) {
  const { data } = await admin
    .from("ts_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) {
    await getAdmin().from("ts_profiles").insert({
      id: user.id,
      display_name:
        user.user_metadata?.display_name ||
        user.email?.split("@")[0] ||
        "Trader",
    });
  }
}

function hashToken(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function refCode() {
  return `TS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function createTrade(user, input) {
  await ensureProfile(user);
  const isDemo = DEMO_MODE || PAYMENT_PROVIDER !== "stripe";
  const creatorRole = input.creator_role === "buyer" ? "buyer" : "seller";
  const other = creatorRole === "buyer" ? "seller" : "buyer";
  const termsBody = {
    deliveryMethod: input.delivery_method || "other",
    ...(input.terms || {}),
    acknowledgments: true,
  };

  const { data: tx, error } = await admin
    .from("ts_transactions")
    .insert({
      reference_code: refCode(),
      title: input.title,
      description: input.description || "",
      category: input.category || "other",
      amount_cents: input.amount_cents,
      currency: (input.currency || "usd").toLowerCase(),
      status: "awaiting_acceptance",
      creator_id: user.id,
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
      user_id: user.id,
      role: creatorRole,
      status: "joined",
      joined_at: new Date().toISOString(),
      display_name:
        user.user_metadata?.display_name || user.email?.split("@")[0],
    },
    { transaction_id: tx.id, user_id: null, role: other, status: "pending" },
  ]);

  await getAdmin().from("ts_terms_versions").insert({
    transaction_id: tx.id,
    version: 1,
    body: termsBody,
    created_by: user.id,
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
    created_by: user.id,
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    max_uses: 10,
  });

  await getAdmin().from("ts_events").insert({
    transaction_id: tx.id,
    actor_id: user.id,
    event_type: "transaction_created",
    summary: `Trade ${tx.reference_code} created${isDemo ? " (DEMO)" : ""}`,
    verification_source: "system",
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
  const { data: tx } = await admin
    .from("ts_transactions")
    .select("*")
    .eq("id", tradeId)
    .single();
  if (!tx) throw new Error("Transaction not found");

  const { data: participant } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", tradeId)
    .eq("user_id", userId)
    .eq("status", "joined")
    .maybeSingle();

  if (!participant && tx.creator_id !== userId) {
    throw new Error("Forbidden");
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

  return {
    transaction: tx,
    participants: participants || [],
    milestones: milestones || [],
    payment: payments?.[0] || null,
    fulfillment: fulfillment || null,
    events: events || [],
    messages: messages || [],
    myRole: participant?.role || null,
  };
}

async function acceptTerms(userId, tradeId) {
  const room = await getRoom(userId, tradeId);
  const me = room.participants.find((p) => p.user_id === userId);
  if (!me) throw new Error("Not a participant");
  await admin
    .from("ts_participants")
    .update({
      terms_accepted_at: new Date().toISOString(),
      terms_version_accepted: room.transaction.terms_version,
    })
    .eq("id", me.id);
  const key =
    me.role === "buyer" ? "buyer_terms_accepted" : "seller_terms_accepted";
  await admin
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
  const { data: refreshed } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", tradeId)
    .in("role", ["buyer", "seller"]);
  const both = (refreshed || [])
    .filter((p) => p.role === "buyer" || p.role === "seller")
    .every((p) => p.terms_accepted_at && p.status === "joined");
  if (both && room.transaction.status === "awaiting_acceptance") {
    await admin
      .from("ts_transactions")
      .update({ status: "awaiting_payment" })
      .eq("id", tradeId);
  }
  return { bothAccepted: both };
}

async function joinInvite(userId, token) {
  await ensureProfile({ id: userId });
  const { data: inv } = await admin
    .from("ts_invitations")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!inv) throw new Error("Invalid invitation");
  if (inv.revoked_at) throw new Error("Invitation revoked");
  if (new Date(inv.expires_at) < new Date()) throw new Error("Invitation expired");
  if (inv.use_count >= inv.max_uses) throw new Error("Invitation exhausted");

  const { data: existing } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", inv.transaction_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.status === "joined") {
    return { transactionId: inv.transaction_id, alreadyJoined: true };
  }

  const { data: slot } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", inv.transaction_id)
    .eq("role", inv.role)
    .maybeSingle();
  if (slot?.user_id && slot.user_id !== userId) {
    throw new Error("Role already filled");
  }
  if (slot) {
    await admin
      .from("ts_participants")
      .update({
        user_id: userId,
        status: "joined",
        joined_at: new Date().toISOString(),
      })
      .eq("id", slot.id);
  } else {
    await getAdmin().from("ts_participants").insert({
      transaction_id: inv.transaction_id,
      user_id: userId,
      role: inv.role,
      status: "joined",
      joined_at: new Date().toISOString(),
    });
  }
  await admin
    .from("ts_invitations")
    .update({ use_count: inv.use_count + 1 })
    .eq("id", inv.id);
  await admin
    .from("ts_milestones")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("transaction_id", inv.transaction_id)
    .eq("key", "shared_parties_ready");
  await getAdmin().from("ts_events").insert({
    transaction_id: inv.transaction_id,
    actor_id: userId,
    event_type: "participant_joined",
    summary: `Participant joined as ${inv.role}`,
    verification_source: "system",
  });
  return { transactionId: inv.transaction_id, role: inv.role };
}

async function performAction(userId, tradeId, action, payload) {
  const room = await getRoom(userId, tradeId);
  const role = room.myRole;
  if (!role) throw new Error("Forbidden");
  const tx = room.transaction;
  const isDemo = !!tx.is_demo;

  if (action === "initiate_payment") {
    if (role !== "buyer") throw new Error("Only buyer");
    const paymentId = `demo_pi_${randomBytes(8).toString("hex")}`;
    await getAdmin().from("ts_payments").insert({
      transaction_id: tradeId,
      provider: isDemo ? "demo" : PAYMENT_PROVIDER,
      provider_payment_id: paymentId,
      provider_session_id: `sess_${paymentId}`,
      amount_cents: tx.amount_cents,
      currency: tx.currency,
      status: "pending",
    });
    await admin
      .from("ts_transactions")
      .update({ status: "payment_pending" })
      .eq("id", tradeId);
    await admin
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
      summary: isDemo ? "DEMO: Payment initiated" : "Payment initiated",
      verification_source: "user_reported",
    });
    return { ok: true };
  }

  if (action === "demo_authorize_payment") {
    if (!isDemo || !DEMO_MODE) throw new Error("Demo actions unavailable");
    if (role !== "buyer") throw new Error("Only buyer");
    const payment = room.payment;
    if (!payment) throw new Error("Initiate payment first");
    await admin
      .from("ts_payments")
      .update({
        status: "authorized",
        authorized_at: new Date().toISOString(),
      })
      .eq("id", payment.id);
    await admin
      .from("ts_transactions")
      .update({ status: "awaiting_fulfillment" })
      .eq("id", tradeId);
    await admin
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "provider_confirmed",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "buyer_payment_authorized");
    await getAdmin().from("ts_events").insert({
      transaction_id: tradeId,
      actor_id: userId,
      event_type: "payment_authorized",
      summary: "DEMO: Payment authorized (simulated — not real money)",
      verification_source: "provider_confirmed",
      payload: { demo: true },
    });
    return { ok: true };
  }

  if (action === "mark_preparing") {
    if (role !== "seller") throw new Error("Only seller");
    await admin
      .from("ts_fulfillments")
      .update({ status: "preparing" })
      .eq("transaction_id", tradeId);
    await admin
      .from("ts_transactions")
      .update({ status: "in_fulfillment" })
      .eq("id", tradeId);
    await admin
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
    await admin
      .from("ts_fulfillments")
      .update({
        status: "shipped",
        tracking_number: payload.tracking_number || null,
        seller_notes: payload.notes || null,
      })
      .eq("transaction_id", tradeId);
    await admin
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
    if (role !== "buyer") throw new Error("Only buyer");
    await admin
      .from("ts_fulfillments")
      .update({
        status: "confirmed",
        buyer_confirmed_at: new Date().toISOString(),
      })
      .eq("transaction_id", tradeId);
    await admin
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "user_reported",
      })
      .eq("transaction_id", tradeId)
      .eq("key", "buyer_receipt_confirmed");
    if (isDemo && DEMO_MODE) {
      if (room.payment) {
        await admin
          .from("ts_payments")
          .update({
            status: "captured",
            captured_at: new Date().toISOString(),
          })
          .eq("id", room.payment.id);
      }
      await admin
        .from("ts_transactions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", tradeId);
      await admin
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
        event_type: "completed",
        summary: "DEMO: Transaction completed (simulated capture)",
        verification_source: "provider_confirmed",
        payload: { demo: true },
      });
    } else {
      await admin
        .from("ts_transactions")
        .update({ status: "completion_pending" })
        .eq("id", tradeId);
    }
    return { ok: true };
  }

  if (action === "open_dispute") {
    await getAdmin().from("ts_disputes").insert({
      transaction_id: tradeId,
      opened_by: userId,
      reason: payload.reason || "Dispute",
      details: payload.details || "",
      status: "open",
    });
    await admin
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

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}
