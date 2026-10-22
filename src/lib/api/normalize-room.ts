import type {
  ParticipantRole,
  TradeListItem,
  TradeMilestone,
  TradeParticipant,
  TradeStatus,
  TransactionRoom,
} from "@/lib/types/trade";

type ApiParticipant = {
  id: string;
  user_id: string | null;
  role: string;
  display_name?: string | null;
  status?: string;
  ts_profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
};

type ApiMilestone = {
  id: string;
  key: string;
  label: string;
  track: string;
  status: string;
  verification_source?: string;
  completed_at?: string | null;
};

type ApiEvent = {
  id: string;
  event_type: string;
  summary: string;
  created_at: string;
  actor_id?: string | null;
  ts_profiles?: { display_name?: string | null } | null;
};

type ApiMessage = {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
  ts_profiles?: { display_name?: string | null } | null;
};

type ApiTransaction = {
  id: string;
  reference_code: string;
  title: string;
  description?: string | null;
  status: string;
  is_demo: boolean;
  amount_cents: number;
  currency: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  terms?: unknown;
};

export type ApiTradeRoom = {
  transaction: ApiTransaction;
  participants: ApiParticipant[];
  milestones: ApiMilestone[];
  payment?: {
    status: string;
    provider: string;
    amount_cents: number;
    currency: string;
    authorized_at?: string | null;
  } | null;
  fulfillment?: {
    status: string;
    seller_notes?: string | null;
    tracking_url?: string | null;
  } | null;
  events?: ApiEvent[];
  messages?: ApiMessage[];
  myRole?: ParticipantRole | null;
  buyerProgress?: number | { percent: number };
  sellerProgress?: number | { percent: number };
  inviteUrl?: string;
};

function progressPercent(
  value: number | { percent: number } | undefined,
): number {
  if (typeof value === "number") return value;
  if (value && typeof value.percent === "number") return value.percent;
  return 0;
}

function mapMilestone(m: ApiMilestone): TradeMilestone {
  const status =
    m.status === "completed"
      ? "complete"
      : m.status === "active"
        ? "active"
        : m.status === "skipped"
          ? "skipped"
          : "pending";

  return {
    id: m.id,
    key: m.key,
    label: m.label,
    side: (m.track === "buyer" || m.track === "seller" ? m.track : "shared") as
      | "buyer"
      | "seller"
      | "shared",
    status,
    verification: (m.verification_source ?? "system") as TradeMilestone["verification"],
    completed_at: m.completed_at,
  };
}

function mapParticipant(p: ApiParticipant): TradeParticipant {
  const name =
    p.display_name ??
    p.ts_profiles?.display_name ??
    (p.role === "buyer" ? "Buyer" : p.role === "seller" ? "Seller" : "Participant");
  return {
    id: p.id,
    user_id: p.user_id ?? "",
    display_name: name,
    role: p.role as TradeParticipant["role"],
    avatar_url: p.ts_profiles?.avatar_url,
  };
}

export function normalizeTradeRoom(raw: ApiTradeRoom, origin?: string): TransactionRoom {
  const tx = raw.transaction;
  const sharePath = raw.inviteUrl;
  const share_url = sharePath
    ? sharePath.startsWith("http")
      ? sharePath
      : `${origin ?? ""}${sharePath}`
    : undefined;

  const isDemo = !!tx.is_demo;
  const payment = raw.payment
    ? {
        status: raw.payment.status,
        provider: raw.payment.provider as "demo" | "stripe",
        amount_cents: raw.payment.amount_cents,
        currency: raw.payment.currency,
        hold_label: isDemo
          ? "Simulated (demo)"
          : "Provider-authorized hold (not TradeSafe escrow)",
        authorized_at: raw.payment.authorized_at,
      }
    : null;

  return {
    id: tx.id,
    ref: tx.reference_code,
    title: tx.title,
    description: tx.description,
    status: tx.status as TradeStatus,
    is_demo: isDemo,
    share_url,
    expires_at: tx.expires_at,
    created_at: tx.created_at,
    updated_at: tx.updated_at,
    buyer_progress: progressPercent(raw.buyerProgress),
    seller_progress: progressPercent(raw.sellerProgress),
    current_user_role: raw.myRole ?? undefined,
    participants: (raw.participants ?? []).map(mapParticipant),
    milestones: (raw.milestones ?? []).map(mapMilestone),
    payment,
    fulfillment: raw.fulfillment
      ? {
          status: raw.fulfillment.status,
          notes: raw.fulfillment.seller_notes,
          proof_url: raw.fulfillment.tracking_url,
        }
      : null,
    events: (raw.events ?? []).map((e) => ({
      id: e.id,
      type: e.event_type,
      message: e.summary,
      actor_name: e.ts_profiles?.display_name ?? undefined,
      created_at: e.created_at,
    })),
    messages: (raw.messages ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      sender_id: m.sender_id,
      sender_name: m.ts_profiles?.display_name ?? "Participant",
      created_at: m.created_at,
    })),
    terms: typeof tx.terms === "string" ? tx.terms : JSON.stringify(tx.terms ?? {}),
    amount_cents: tx.amount_cents,
    currency: tx.currency?.toUpperCase(),
  };
}

export type ApiTradeListEntry = {
  role: string;
  transaction: {
    id: string;
    reference_code: string;
    title: string;
    status: string;
    is_demo: boolean;
    amount_cents: number;
    currency: string;
    updated_at: string;
    creator_id: string;
  };
};

export function normalizeTradeListItem(
  entry: ApiTradeListEntry,
  userId: string,
): TradeListItem {
  const tx = entry.transaction;
  const active = !["completed", "cancelled", "refunded", "expired"].includes(tx.status);
  const awaiting =
    active &&
    ((entry.role === "buyer" &&
      ["awaiting_payment", "payment_pending", "awaiting_confirmation"].includes(tx.status)) ||
      (entry.role === "seller" &&
        ["awaiting_fulfillment", "in_fulfillment", "funds_authorized"].includes(tx.status)) ||
      tx.status === "awaiting_acceptance");

  return {
    id: tx.id,
    ref: tx.reference_code,
    title: tx.title,
    status: tx.status as TradeStatus,
    is_demo: tx.is_demo,
    role: entry.role as TradeListItem["role"],
    relationship: tx.creator_id === userId ? "created" : "joined",
    amount_cents: tx.amount_cents,
    currency: tx.currency?.toUpperCase(),
    updated_at: tx.updated_at,
    awaiting_action: awaiting,
  };
}
