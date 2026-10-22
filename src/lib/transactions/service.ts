import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertTransition } from "@/lib/state-machine";
import { defaultMilestonesForCategory } from "@/lib/milestones";
import {
  generateInviteToken,
  hashInviteToken,
} from "@/lib/invitations";
import { getPaymentProvider } from "@/lib/payments";
import type {
  Category,
  ParticipantRole,
  TransactionStatus,
} from "@/lib/types";
import type { CreateTradeInput } from "@/lib/validation";

function referenceCode(): string {
  return `TS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

type Admin = ReturnType<typeof createAdminClient>;

async function ensureProfile(
  admin: Admin,
  userId: string,
  displayName?: string
) {
  const { data } = await admin
    .from("ts_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!data) {
    await admin.from("ts_profiles").insert({
      id: userId,
      display_name: displayName || "Trader",
    });
  }
}

async function logEvent(
  admin: Admin,
  transactionId: string,
  eventType: string,
  summary: string,
  actorId?: string | null,
  payload: Record<string, unknown> = {},
  verificationSource:
    | "user_reported"
    | "awaiting_verification"
    | "provider_confirmed"
    | "system" = "system"
) {
  await admin.from("ts_events").insert({
    transaction_id: transactionId,
    actor_id: actorId ?? null,
    event_type: eventType,
    summary,
    payload,
    verification_source: verificationSource,
  });
}

async function notify(
  admin: Admin,
  userId: string,
  transactionId: string,
  type: string,
  title: string,
  body: string
) {
  await admin.from("ts_notifications").insert({
    user_id: userId,
    transaction_id: transactionId,
    type,
    title,
    body,
  });
}

export async function createTrade(
  userId: string,
  input: CreateTradeInput,
  opts?: { displayName?: string }
) {
  const admin = createAdminClient();
  await ensureProfile(admin, userId, opts?.displayName);

  const isDemo =
    process.env.DEMO_MODE === "true" ||
    process.env.PAYMENT_PROVIDER !== "stripe";

  const creatorRole = input.creator_role;
  const counterpartyRole: ParticipantRole =
    creatorRole === "buyer" ? "seller" : "buyer";

  const ref = referenceCode();
  const termsBody = {
    deliveryMethod: input.delivery_method,
    ...(input.terms ?? {}),
    acknowledgments: true,
  };

  const status: TransactionStatus = input.draft
    ? "draft"
    : "awaiting_acceptance";

  const { data: tx, error: txErr } = await admin
    .from("ts_transactions")
    .insert({
      reference_code: ref,
      title: input.title,
      description: input.description ?? "",
      category: (input.category ?? "other") as Category,
      amount_cents: input.amount_cents,
      currency: (input.currency ?? "usd").toLowerCase(),
      status,
      creator_id: userId,
      delivery_method: input.delivery_method ?? "other",
      fulfillment_milestones: [],
      terms: termsBody,
      terms_version: 1,
      notes: input.notes ?? null,
      is_demo: isDemo,
    })
    .select("*")
    .single();

  if (txErr || !tx) {
    throw new Error(txErr?.message || "Failed to create transaction");
  }

  await admin.from("ts_participants").insert([
    {
      transaction_id: tx.id,
      user_id: userId,
      role: creatorRole,
      display_name: opts?.displayName || "Trader",
      status: "joined",
      joined_at: new Date().toISOString(),
    },
    {
      transaction_id: tx.id,
      user_id: null,
      role: counterpartyRole,
      status: "pending",
    },
  ]);

  await admin.from("ts_terms_versions").insert({
    transaction_id: tx.id,
    version: 1,
    body: termsBody,
    created_by: userId,
  });

  const milestones = defaultMilestonesForCategory(
    (input.category ?? "other") as Category,
    input.delivery_method ?? "other"
  );

  if (milestones.length) {
    await admin.from("ts_milestones").insert(
      milestones.map((m, i) => ({
        transaction_id: tx.id,
        key: m.key,
        track: m.track,
        label: m.label,
        status: m.key === "shared_parties_ready" ? "active" : "pending",
        verification_source: m.verification_source ?? "system",
        responsible_role: m.responsible_role ?? null,
        sort_order: m.sort_order ?? i,
      }))
    );
  }

  await admin.from("ts_fulfillments").insert({
    transaction_id: tx.id,
    method: input.delivery_method ?? "other",
    status: "not_started",
  });

  const { raw: rawToken, hash: tokenHash } = generateInviteToken();
  const inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await admin.from("ts_invitations").insert({
    transaction_id: tx.id,
    token_hash: tokenHash,
    role: counterpartyRole,
    created_by: userId,
    expires_at: inviteExpires.toISOString(),
    max_uses: 10,
  });

  await logEvent(
    admin,
    tx.id,
    "transaction_created",
    `Trade ${ref} created${isDemo ? " (DEMO)" : ""}`,
    userId,
    { is_demo: isDemo }
  );

  return {
    transaction: tx,
    inviteToken: rawToken,
    inviteUrl: `/join/${rawToken}`,
    isDemo,
  };
}

export async function getTradeRoom(userId: string, transactionId: string) {
  const admin = createAdminClient();

  const { data: participant } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", transactionId)
    .eq("user_id", userId)
    .eq("status", "joined")
    .maybeSingle();

  const { data: tx } = await admin
    .from("ts_transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (!tx) throw new Error("Transaction not found");

  const isCreator = tx.creator_id === userId;
  const { data: profile } = await admin
    .from("ts_profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (!participant && !isCreator && !profile?.is_admin) {
    throw new Error("Forbidden");
  }

  const [
    { data: participants },
    { data: milestones },
    { data: payments },
    { data: fulfillment },
    { data: events },
    { data: messages },
    { data: disputes },
  ] = await Promise.all([
    admin
      .from("ts_participants")
      .select("*, ts_profiles(display_name, avatar_url)")
      .eq("transaction_id", transactionId),
    admin
      .from("ts_milestones")
      .select("*")
      .eq("transaction_id", transactionId)
      .order("sort_order"),
    admin
      .from("ts_payments")
      .select("*")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: false }),
    admin
      .from("ts_fulfillments")
      .select("*")
      .eq("transaction_id", transactionId)
      .maybeSingle(),
    admin
      .from("ts_events")
      .select("*")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("ts_messages")
      .select("*, ts_profiles(display_name, avatar_url)")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("ts_disputes")
      .select("*")
      .eq("transaction_id", transactionId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    transaction: tx,
    participants: participants ?? [],
    milestones: milestones ?? [],
    payment: payments?.[0] ?? null,
    payments: payments ?? [],
    fulfillment: fulfillment ?? null,
    events: events ?? [],
    messages: messages ?? [],
    disputes: disputes ?? [],
    myRole: (participant?.role as ParticipantRole | undefined) ?? null,
  };
}

export async function listUserTrades(userId: string) {
  const admin = createAdminClient();
  const { data: parts } = await admin
    .from("ts_participants")
    .select("transaction_id, role, status, ts_transactions(*)")
    .eq("user_id", userId)
    .eq("status", "joined");

  return (parts ?? []).map((p) => ({
    role: p.role as ParticipantRole,
    transaction: p.ts_transactions,
  }));
}

export async function acceptTerms(userId: string, transactionId: string) {
  const admin = createAdminClient();
  const room = await getTradeRoom(userId, transactionId);
  const me = room.participants.find(
    (p: { user_id: string | null }) => p.user_id === userId
  ) as { id: string; role: ParticipantRole } | undefined;
  if (!me) throw new Error("Not a participant");

  await admin
    .from("ts_participants")
    .update({
      terms_accepted_at: new Date().toISOString(),
      terms_version_accepted: room.transaction.terms_version,
    })
    .eq("id", me.id);

  const milestoneKey =
    me.role === "buyer" ? "buyer_terms_accepted" : "seller_terms_accepted";
  await admin
    .from("ts_milestones")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      verification_source: "user_reported",
    })
    .eq("transaction_id", transactionId)
    .eq("key", milestoneKey);

  await logEvent(
    admin,
    transactionId,
    "terms_accepted",
    `${me.role} accepted terms`,
    userId,
    {},
    "user_reported"
  );

  const { data: refreshed } = await admin
    .from("ts_participants")
    .select("*")
    .eq("transaction_id", transactionId)
    .in("role", ["buyer", "seller"]);

  const bothAccepted = (refreshed ?? [])
    .filter((p) => p.role === "buyer" || p.role === "seller")
    .every((p) => p.terms_accepted_at && p.status === "joined");

  if (bothAccepted && room.transaction.status === "awaiting_acceptance") {
    assertTransition(room.transaction.status, "awaiting_payment", {
      source: "system",
    });
    await admin
      .from("ts_transactions")
      .update({ status: "awaiting_payment" })
      .eq("id", transactionId);
    await logEvent(
      admin,
      transactionId,
      "awaiting_payment",
      "Both parties accepted terms — awaiting payment",
      null
    );
  }

  return { bothAccepted };
}

export async function joinViaInvite(userId: string, token: string) {
  const admin = createAdminClient();
  await ensureProfile(admin, userId);
  const tokenHash = hashInviteToken(token);

  const { data: inv } = await admin
    .from("ts_invitations")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!inv) throw new Error("Invalid invitation");
  if (inv.revoked_at) throw new Error("Invitation revoked");
  if (new Date(inv.expires_at) < new Date()) throw new Error("Invitation expired");
  if (inv.use_count >= inv.max_uses) throw new Error("Invitation exhausted");
  if (inv.single_use && inv.use_count > 0) throw new Error("Invitation already used");

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
    await admin.from("ts_participants").insert({
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
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("transaction_id", inv.transaction_id)
    .eq("key", "shared_parties_ready");

  await logEvent(
    admin,
    inv.transaction_id,
    "participant_joined",
    `Participant joined as ${inv.role}`,
    userId
  );

  const { data: tx } = await admin
    .from("ts_transactions")
    .select("creator_id, title")
    .eq("id", inv.transaction_id)
    .single();

  if (tx?.creator_id) {
    await notify(
      admin,
      tx.creator_id,
      inv.transaction_id,
      "invitation_accepted",
      "Invitation accepted",
      `Someone joined "${tx.title}" as ${inv.role}.`
    );
  }

  return { transactionId: inv.transaction_id, role: inv.role };
}

export async function addMessage(
  userId: string,
  transactionId: string,
  body: string
) {
  const admin = createAdminClient();
  await getTradeRoom(userId, transactionId);

  const { data, error } = await admin
    .from("ts_messages")
    .insert({
      transaction_id: transactionId,
      sender_id: userId,
      body: body.slice(0, 4000),
      is_system: false,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function performAction(
  userId: string,
  transactionId: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
  const admin = createAdminClient();
  const room = await getTradeRoom(userId, transactionId);
  const role = room.myRole;
  if (!role) throw new Error("Forbidden");

  const status = room.transaction.status as TransactionStatus;
  const isDemo = !!room.transaction.is_demo;

  switch (action) {
    case "initiate_payment": {
      if (role !== "buyer") throw new Error("Only buyer can initiate payment");
      assertTransition(status, "payment_pending", {
        source: "client",
        actorRole: role,
        action: "initiate_payment",
      });
      // Force demo provider when trade is demo or PAYMENT_PROVIDER is not stripe
      const prev = process.env.PAYMENT_PROVIDER;
      if (isDemo) process.env.PAYMENT_PROVIDER = "demo";
      const provider = getPaymentProvider();
      if (prev !== undefined) process.env.PAYMENT_PROVIDER = prev;

      const session = await provider.createSession({
        transactionId,
        amountCents: room.transaction.amount_cents,
        currency: room.transaction.currency,
        metadata: { reference: room.transaction.reference_code },
      });
      const initiated = await provider.initiatePayment({
        sessionId: session.sessionId,
        transactionId,
      });

      await admin.from("ts_payments").insert({
        transaction_id: transactionId,
        provider: provider.id,
        provider_session_id: session.sessionId,
        provider_payment_id: initiated.providerPaymentId,
        amount_cents: room.transaction.amount_cents,
        currency: room.transaction.currency,
        status: "pending",
      });
      await admin
        .from("ts_transactions")
        .update({ status: "payment_pending" })
        .eq("id", transactionId);
      await admin
        .from("ts_milestones")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          verification_source: "user_reported",
        })
        .eq("transaction_id", transactionId)
        .eq("key", "buyer_payment_initiated");
      await logEvent(
        admin,
        transactionId,
        "payment_initiated",
        isDemo
          ? "DEMO: Payment initiated (simulated)"
          : "Payment initiated",
        userId,
        {},
        "user_reported"
      );
      return { session, payment: initiated };
    }

    case "demo_authorize_payment": {
      if (!isDemo || process.env.DEMO_MODE !== "true") {
        throw new Error("Demo payment actions unavailable");
      }
      if (role !== "buyer") throw new Error("Only buyer");
      assertTransition(status, "funds_authorized", { source: "demo_server" });
      const payment = room.payment;
      if (!payment?.provider_payment_id) {
        throw new Error("No payment to authorize — initiate payment first");
      }
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
        .eq("id", transactionId);
      await admin
        .from("ts_milestones")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          verification_source: "provider_confirmed",
        })
        .eq("transaction_id", transactionId)
        .eq("key", "buyer_payment_authorized");
      await logEvent(
        admin,
        transactionId,
        "payment_authorized",
        "DEMO: Payment authorized (simulated — not real money)",
        userId,
        { demo: true },
        "provider_confirmed"
      );
      return { ok: true };
    }

    case "mark_preparing": {
      if (role !== "seller") throw new Error("Only seller");
      await admin
        .from("ts_fulfillments")
        .update({ status: "preparing" })
        .eq("transaction_id", transactionId);
      if (
        status === "funds_authorized" ||
        status === "awaiting_fulfillment"
      ) {
        await admin
          .from("ts_transactions")
          .update({ status: "in_fulfillment" })
          .eq("id", transactionId);
      }
      await admin
        .from("ts_milestones")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          verification_source: "user_reported",
        })
        .eq("transaction_id", transactionId)
        .eq("key", "seller_fulfillment_acknowledged");
      await logEvent(
        admin,
        transactionId,
        "fulfillment_preparing",
        "Seller started preparation",
        userId,
        {},
        "user_reported"
      );
      return { ok: true };
    }

    case "submit_tracking": {
      if (role !== "seller") throw new Error("Only seller");
      await admin
        .from("ts_fulfillments")
        .update({
          status: "shipped",
          tracking_carrier: (payload.tracking_carrier as string) || null,
          tracking_number: (payload.tracking_number as string) || null,
          tracking_url: (payload.tracking_url as string) || null,
          seller_notes: (payload.notes as string) || null,
        })
        .eq("transaction_id", transactionId);
      await admin
        .from("ts_transactions")
        .update({ status: "awaiting_confirmation" })
        .eq("id", transactionId);
      await logEvent(
        admin,
        transactionId,
        "fulfillment_shipped",
        "Seller submitted tracking / transfer evidence",
        userId,
        payload,
        "user_reported"
      );
      return { ok: true };
    }

    case "confirm_delivery": {
      if (role !== "buyer") throw new Error("Only buyer");
      await admin
        .from("ts_fulfillments")
        .update({
          status: "confirmed",
          buyer_confirmed_at: new Date().toISOString(),
        })
        .eq("transaction_id", transactionId);
      await admin
        .from("ts_milestones")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          verification_source: "user_reported",
        })
        .eq("transaction_id", transactionId)
        .eq("key", "buyer_receipt_confirmed");
      await admin
        .from("ts_transactions")
        .update({ status: "completion_pending" })
        .eq("id", transactionId);
      await logEvent(
        admin,
        transactionId,
        "delivery_confirmed",
        "Buyer confirmed delivery/transfer",
        userId,
        {},
        "user_reported"
      );

      if (isDemo && process.env.DEMO_MODE === "true") {
        const payment = room.payment;
        if (payment?.provider_payment_id) {
          const prev = process.env.PAYMENT_PROVIDER;
          process.env.PAYMENT_PROVIDER = "demo";
          const provider = getPaymentProvider();
          if (prev !== undefined) process.env.PAYMENT_PROVIDER = prev;
          await provider.requestRelease({
            transactionId,
            amountCents: payment.amount_cents,
            currency: payment.currency,
            providerPaymentId: payment.provider_payment_id,
          });
          await admin
            .from("ts_payments")
            .update({
              status: "captured",
              captured_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        }
        assertTransition("completion_pending", "completed", {
          source: "demo_server",
        });
        await admin
          .from("ts_transactions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", transactionId);
        await admin
          .from("ts_milestones")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            verification_source: "provider_confirmed",
          })
          .eq("transaction_id", transactionId)
          .eq("key", "shared_trade_completed");
        await logEvent(
          admin,
          transactionId,
          "completed",
          "DEMO: Transaction completed (simulated capture)",
          null,
          { demo: true },
          "provider_confirmed"
        );
      }
      return { ok: true };
    }

    case "request_cancel": {
      assertTransition(status, "cancellation_requested", {
        source: "client",
        actorRole: role,
        action: "request_cancellation",
      });
      await admin
        .from("ts_transactions")
        .update({ status: "cancellation_requested" })
        .eq("id", transactionId);
      await logEvent(
        admin,
        transactionId,
        "cancellation_requested",
        "Cancellation requested",
        userId
      );
      return { ok: true };
    }

    case "open_dispute": {
      assertTransition(status, "disputed", {
        source: "client",
        actorRole: role,
        action: "open_dispute",
      });
      const { data: dispute } = await admin
        .from("ts_disputes")
        .insert({
          transaction_id: transactionId,
          opened_by: userId,
          reason: (payload.reason as string) || "Dispute",
          details: (payload.details as string) || "",
          status: "open",
        })
        .select("*")
        .single();
      await admin
        .from("ts_transactions")
        .update({ status: "disputed" })
        .eq("id", transactionId);
      await logEvent(
        admin,
        transactionId,
        "dispute_opened",
        "Dispute opened",
        userId,
        { disputeId: dispute?.id }
      );
      return { dispute };
    }

    case "demo_capture": {
      if (!isDemo || process.env.DEMO_MODE !== "true") {
        throw new Error("Demo capture unavailable");
      }
      assertTransition(status, "completed", { source: "demo_server" });
      await admin
        .from("ts_transactions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", transactionId);
      return { ok: true };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export async function createInviteLink(
  userId: string,
  transactionId: string,
  role: ParticipantRole
) {
  const admin = createAdminClient();
  const room = await getTradeRoom(userId, transactionId);
  if (room.transaction.creator_id !== userId) {
    throw new Error("Only creator can mint invites");
  }
  const { raw, hash } = generateInviteToken();
  await admin.from("ts_invitations").insert({
    transaction_id: transactionId,
    token_hash: hash,
    role,
    created_by: userId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return { token: raw, url: `/join/${raw}` };
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
