import { createHmac, timingSafeEqual } from "node:crypto";
import {
  incidentPublicId,
  clientIp,
  hashIp,
  maskIp,
} from "./security.mjs";
import { emitSecurityEvent } from "./security-request.mjs";
import { RETENTION_DAYS, runRetentionCleanup } from "./retention.mjs";

const CATEGORIES = new Set([
  "scam",
  "impersonation",
  "suspicious",
  "unauthorized_access",
  "payment",
  "abuse",
  "compromised_invite",
  "other",
]);

const processedWebhooks = new Map();

export async function createSecurityReport(admin, actor, body, req) {
  const category = CATEGORIES.has(body.category) ? body.category : "other";
  const summary = String(body.summary || "").trim().slice(0, 500);
  if (!summary) {
    const err = new Error("Report summary is required");
    err.status = 400;
    throw err;
  }
  const details = String(body.details || "").slice(0, 5000);
  const transactionId = body.transaction_id || null;
  if (transactionId) {
    const { data: part } = await admin
      .from("ts_participants")
      .select("id")
      .eq("transaction_id", transactionId)
      .eq("user_id", actor.id)
      .eq("status", "joined")
      .maybeSingle();
    if (!part) {
      const err = new Error("You can only report trades you belong to");
      err.status = 403;
      throw err;
    }
  }

  const public_id = incidentPublicId();
  const triage =
    category === "scam" || category === "unauthorized_access"
      ? "high"
      : category === "payment"
        ? "medium"
        : "unreviewed";

  const { data: incident, error } = await admin
    .from("ts_security_incidents")
    .insert({
      public_id,
      transaction_id: transactionId,
      reporter_id: actor.id,
      category,
      summary,
      details,
      status: "open",
      triage,
    })
    .select("id, public_id, status, triage, created_at")
    .single();
  if (error) throw new Error(error.message);

  await emitSecurityEvent(admin, req, actor, {
    event_type: "user_report_submitted",
    severity: triage === "high" ? "high" : "medium",
    transaction_id: transactionId,
    payload: {
      incident_public_id: public_id,
      category,
      // no IP or device details exposed to reporter
    },
  });

  return {
    public_id: incident.public_id,
    status: incident.status,
    triage: incident.triage,
    created_at: incident.created_at,
    message:
      "Report received. Authorized security staff will review it. Internal findings are not shared with other participants.",
  };
}

export async function getReportStatus(admin, actor, publicId) {
  const { data } = await admin
    .from("ts_security_incidents")
    .select("public_id, status, triage, category, summary, created_at, resolved_at")
    .eq("public_id", publicId)
    .eq("reporter_id", actor.id)
    .maybeSingle();
  if (!data) {
    const err = new Error("Report not found");
    err.status = 404;
    throw err;
  }
  return {
    public_id: data.public_id,
    status: data.status,
    category: data.category,
    summary: data.summary,
    created_at: data.created_at,
    resolved_at: data.resolved_at,
    // triage kept coarse for reporter; no IP/device/risk internals
  };
}

async function auditAdmin(admin, adminId, action, target_type, target_id, meta = {}) {
  await admin.from("ts_admin_audit").insert({
    admin_id: adminId,
    action,
    target_type,
    target_id: target_id ? String(target_id) : null,
    meta,
  });
}

export async function handleAdminSecurity(admin, req, res, url, actor, p, json) {
  if (p === "/api/admin/security/overview" && req.method === "GET") {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const [
      { count: openIncidents },
      { count: highRisk },
      { count: inviteFails },
      { count: unauth },
      { data: recentReports },
    ] = await Promise.all([
      admin
        .from("ts_security_incidents")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "triage", "investigating"]),
      admin
        .from("ts_security_events")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since)
        .gte("risk_score", 40),
      admin
        .from("ts_security_events")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("event_type", "invite_redeem_failed"),
      admin
        .from("ts_security_events")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("event_type", "unauthorized_trade_access"),
      admin
        .from("ts_security_incidents")
        .select(
          "public_id, category, status, triage, summary, created_at, transaction_id",
        )
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    await auditAdmin(admin, actor.id, "view_overview", "dashboard", null, {});
    json(
      res,
      200,
      {
        periodDays: 7,
        metrics: {
          incidentsAwaitingReview: openIncidents || 0,
          highRiskEvents: highRisk || 0,
          failedInvitationAttempts: inviteFails || 0,
          unauthorizedAccessAttempts: unauth || 0,
        },
        recentReports: recentReports || [],
        retentionDays: RETENTION_DAYS,
        note: "Summary cards omit raw IP and device fingerprints.",
      },
      req,
    );
    return;
  }

  const incidentMatch = p.match(/^\/api\/admin\/security\/incidents\/([^/]+)(.*)$/);
  if (incidentMatch) {
    const publicId = incidentMatch[1];
    const rest = incidentMatch[2] || "";
    const { data: incident } = await admin
      .from("ts_security_incidents")
      .select("*")
      .eq("public_id", publicId)
      .maybeSingle();
    if (!incident) {
      json(res, 404, { error: "Not found" }, req);
      return;
    }

    if (rest === "" && req.method === "GET") {
      const showIp = url.searchParams.get("reveal_ip") === "1";
      const { data: events } = await admin
        .from("ts_security_events")
        .select(
          showIp
            ? "*"
            : "id, event_type, severity, actor_id, transaction_id, session_ref, device_ref, ip_masked, user_agent, correlation_id, risk_score, risk_reasons, payload, created_at",
        )
        .eq("transaction_id", incident.transaction_id || "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: true })
        .limit(200);

      // Also pull events correlated by reporter if no trade
      let timeline = events || [];
      if (!incident.transaction_id) {
        const { data: byActor } = await admin
          .from("ts_security_events")
          .select(
            "id, event_type, severity, actor_id, transaction_id, session_ref, device_ref, ip_masked, user_agent, correlation_id, risk_score, risk_reasons, payload, created_at",
          )
          .eq("actor_id", incident.reporter_id)
          .order("created_at", { ascending: false })
          .limit(50);
        timeline = byActor || [];
      }

      const { data: notes } = await admin
        .from("ts_security_incident_notes")
        .select("id, body, is_internal, author_id, created_at")
        .eq("incident_id", incident.id)
        .order("created_at", { ascending: true });

      await auditAdmin(admin, actor.id, "view_incident", "incident", publicId, {
        reveal_ip: showIp,
      });

      json(
        res,
        200,
        {
          incident: {
            public_id: incident.public_id,
            category: incident.category,
            summary: incident.summary,
            details: incident.details,
            status: incident.status,
            triage: incident.triage,
            transaction_id: incident.transaction_id,
            reporter_ref: incident.reporter_id
              ? String(incident.reporter_id).slice(0, 8)
              : null,
            assigned_to: incident.assigned_to,
            resolution: incident.resolution,
            resolved_at: incident.resolved_at,
            created_at: incident.created_at,
          },
          timeline,
          notes: notes || [],
          ipPolicy:
            "Full IP hashes only when reveal_ip=1; ordinary views use masked IP.",
        },
        req,
      );
      return;
    }

    if (rest === "/notes" && req.method === "POST") {
      const body = await readJsonBody(req);
      const { data: note, error } = await admin
        .from("ts_security_incident_notes")
        .insert({
          incident_id: incident.id,
          author_id: actor.id,
          body: String(body.body || "").slice(0, 8000),
          is_internal: body.is_internal !== false,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await auditAdmin(admin, actor.id, "add_note", "incident", publicId, {});
      json(res, 201, { note }, req);
      return;
    }

    if (rest === "" && req.method === "PATCH") {
      const body = await readJsonBody(req);
      const patch = { updated_at: new Date().toISOString() };
      if (body.status) patch.status = body.status;
      if (body.triage) patch.triage = body.triage;
      if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to;
      if (body.resolution !== undefined) {
        patch.resolution = String(body.resolution || "").slice(0, 4000);
        if (body.status === "resolved" || body.status === "closed") {
          patch.resolved_at = new Date().toISOString();
        }
      }
      const reason = String(body.decision_reason || "").slice(0, 1000);
      const { data, error } = await admin
        .from("ts_security_incidents")
        .update(patch)
        .eq("id", incident.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await auditAdmin(admin, actor.id, "update_incident", "incident", publicId, {
        reason,
        patch,
      });
      json(res, 200, { incident: data }, req);
      return;
    }
  }

  if (p === "/api/admin/security/events" && req.method === "GET") {
    const { data } = await admin
      .from("ts_security_events")
      .select(
        "id, event_type, severity, actor_id, transaction_id, session_ref, device_ref, ip_masked, risk_score, risk_reasons, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    await auditAdmin(admin, actor.id, "list_events", "security_events", null, {});
    json(res, 200, { events: data || [] }, req);
    return;
  }

  if (p === "/api/admin/security/retention" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await runRetentionCleanup(admin, {
      dryRun: body.dryRun !== false,
    });
    await auditAdmin(admin, actor.id, "retention_run", "retention", null, {
      dryRun: body.dryRun !== false,
      result,
    });
    json(res, 200, { result, retentionDays: RETENTION_DAYS }, req);
    return;
  }

  json(res, 404, { error: "Not found" }, req);
}

function readJsonBody(req) {
  if (req._body) return Promise.resolve(req._body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Idempotent provider-confirmed payment updates only.
 * Client cannot invent payment status via this path without a verified source.
 */
export async function applyProviderPaymentUpdate(admin, {
  provider_payment_id,
  status,
  source,
  idempotency_key,
  actor_id = null,
}) {
  if (!provider_payment_id || !status) {
    throw new Error("provider_payment_id and status required");
  }
  if (!["demo_server", "webhook", "provider_api"].includes(source)) {
    throw new Error("Untrusted payment update source");
  }
  const key = idempotency_key || `${provider_payment_id}:${status}:${source}`;
  if (processedWebhooks.has(key)) {
    return { ok: true, duplicate: true };
  }

  const { data: payment } = await admin
    .from("ts_payments")
    .select("*")
    .eq("provider_payment_id", provider_payment_id)
    .maybeSingle();
  if (!payment) throw new Error("Payment not found");

  if (payment.status === status) {
    processedWebhooks.set(key, Date.now());
    return { ok: true, duplicate: true };
  }

  const patch = { status };
  if (status === "authorized") patch.authorized_at = new Date().toISOString();
  if (status === "captured") patch.captured_at = new Date().toISOString();
  await admin.from("ts_payments").update(patch).eq("id", payment.id);

  if (status === "authorized") {
    await admin
      .from("ts_transactions")
      .update({ status: "awaiting_fulfillment" })
      .eq("id", payment.transaction_id);
    await admin
      .from("ts_milestones")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        verification_source: "provider_confirmed",
      })
      .eq("transaction_id", payment.transaction_id)
      .eq("key", "buyer_payment_authorized");
  }

  await admin.from("ts_events").insert({
    transaction_id: payment.transaction_id,
    actor_id,
    event_type: `payment_${status}`,
    summary: `Payment ${status} (${source})`,
    verification_source: "provider_confirmed",
    payload: { provider_payment_id, idempotency_key: key, source },
  });

  processedWebhooks.set(key, Date.now());
  return { ok: true, duplicate: false, transaction_id: payment.transaction_id };
}

async function handleStripeEvent(admin, stripe, event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const txId = session.metadata?.transaction_id;
    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!txId || !piId) return { received: true, ignored: true };
    const intent = await stripe.paymentIntents.retrieve(piId);
    await admin
      .from("ts_payments")
      .update({ provider: "stripe", provider_payment_id: piId, provider_session_id: session.id })
      .eq("transaction_id", txId);
    const status =
      intent.status === "requires_capture"
        ? "authorized"
        : intent.status === "succeeded"
          ? "captured"
          : null;
    if (!status) return { received: true, pending: true };
    return applyProviderPaymentUpdate(admin, {
      provider_payment_id: piId,
      status,
      source: "webhook",
      idempotency_key: event.id,
    });
  }

  if (String(event.type || "").startsWith("payment_intent.")) {
    const intent = event.data.object;
    const txId = intent.metadata?.transaction_id;
    if (txId) {
      await admin
        .from("ts_payments")
        .update({ provider: "stripe", provider_payment_id: intent.id })
        .eq("transaction_id", txId);
    }
    const status =
      intent.status === "requires_capture" || event.type === "payment_intent.amount_capturable_updated"
        ? "authorized"
        : intent.status === "succeeded" || event.type === "payment_intent.succeeded"
          ? "captured"
          : event.type === "payment_intent.payment_failed"
            ? "failed"
            : intent.status === "canceled"
              ? "cancelled"
              : null;
    if (!status) return { received: true, ignored: true };
    const result = await applyProviderPaymentUpdate(admin, {
      provider_payment_id: intent.id,
      status,
      source: "webhook",
      idempotency_key: event.id,
    });
    if (status === "captured" && result.transaction_id) {
      await admin
        .from("ts_transactions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", result.transaction_id)
        .eq("status", "completion_pending");
    }
    return result;
  }

  return { received: true, ignored: true };
}

export async function handlePaymentWebhook(admin, req) {
  const rawChunks = [];
  const raw = await new Promise((resolve, reject) => {
    req.on("data", (c) => rawChunks.push(c));
    req.on("end", () => resolve(Buffer.concat(rawChunks)));
    req.on("error", reject);
  });

  const stripeSig = req.headers["stripe-signature"];
  if (
    typeof stripeSig === "string" &&
    stripeSig.includes("t=") &&
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET
  ) {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let event;
    try {
      event = stripe.webhooks.constructEvent(raw, stripeSig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      const err = new Error("Invalid webhook signature");
      err.status = 401;
      throw err;
    }
    const result = await handleStripeEvent(admin, stripe, event);
    return { received: true, duplicate: !!result?.duplicate };
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    const err = new Error("Invalid JSON");
    err.status = 400;
    throw err;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"] || req.headers["x-webhook-signature"];

  if (secret) {
    if (!sig || typeof sig !== "string") {
      const err = new Error("Missing webhook signature");
      err.status = 401;
      throw err;
    }
    // Minimal HMAC check for custom providers; Stripe SDK preferred in production
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const provided = sig.includes("v1=")
      ? sig.split(",").find((p) => p.startsWith("v1="))?.slice(3)
      : sig;
    try {
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(String(provided || ""), "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        const err = new Error("Invalid webhook signature");
        err.status = 401;
        throw err;
      }
    } catch (e) {
      if (e.status) throw e;
      const err = new Error("Invalid webhook signature");
      err.status = 401;
      throw err;
    }
  } else if (process.env.NODE_ENV === "production" && process.env.PAYMENT_PROVIDER === "stripe") {
    const err = new Error("Webhook secret not configured");
    err.status = 503;
    throw err;
  }

  const provider_payment_id =
    body.provider_payment_id || body.data?.object?.id || body.id;
  const status = body.status || mapStripeStatus(body.type || body.event_type);
  const idempotency_key =
    body.idempotency_key || req.headers["idempotency-key"] || `${provider_payment_id}:${status}:${body.id || ""}`;

  // Trusted IP observation for audit only (hashed) — never trust browser XFF for identity
  const ip = clientIp(req);

  const result = await applyProviderPaymentUpdate(admin, {
    provider_payment_id,
    status,
    source: "webhook",
    idempotency_key,
  });

  await admin.from("ts_security_events").insert({
    event_type: "payment_webhook",
    severity: "info",
    transaction_id: result.transaction_id || null,
    ip_hash: hashIp(ip),
    ip_masked: maskIp(ip),
    payload: {
      duplicate: !!result.duplicate,
      status,
      // never log secrets or full card data
    },
  });

  return { received: true, duplicate: !!result.duplicate };
}

function mapStripeStatus(type) {
  if (type === "payment_intent.amount_capturable_updated" || type === "authorized")
    return "authorized";
  if (type === "payment_intent.succeeded" || type === "captured") return "captured";
  if (type === "payment_intent.payment_failed") return "failed";
  return "pending";
}

/** Unit-test helper: prove spoofed XFF is not trusted when socket IP is used without proxy. */
export function resolveClientIpForTest(req, { trustProxy = true } = {}) {
  if (!trustProxy) {
    return req.socket?.remoteAddress || null;
  }
  return clientIp(req);
}
