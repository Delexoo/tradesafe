export type TradeStatus =
  | "draft"
  | "awaiting_acceptance"
  | "awaiting_payment"
  | "payment_pending"
  | "funds_authorized"
  | "awaiting_fulfillment"
  | "in_fulfillment"
  | "awaiting_confirmation"
  | "completion_pending"
  | "completed"
  | "cancellation_requested"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "disputed"
  | "suspended"
  | "expired";

export type ParticipantRole = "buyer" | "seller" | "observer" | "admin";

export type MilestoneVerification =
  | "user_reported"
  | "awaiting_verification"
  | "provider_confirmed"
  | "system";

export interface TradeParticipant {
  id: string;
  user_id: string;
  display_name: string;
  email?: string;
  role: ParticipantRole;
  avatar_url?: string | null;
  online?: boolean;
}

export interface TradeMilestone {
  id: string;
  key: string;
  label: string;
  side: "buyer" | "seller" | "shared";
  status: "pending" | "active" | "complete" | "skipped";
  verification: MilestoneVerification;
  completed_at?: string | null;
}

export interface TradeEvent {
  id: string;
  type: string;
  message: string;
  actor_name?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface TradeMessage {
  id: string;
  body: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
}

export interface TradePayment {
  status: string;
  provider: "demo" | "stripe";
  amount_cents: number;
  currency: string;
  hold_label: string;
  authorized_at?: string | null;
}

export interface TradeFulfillment {
  status: string;
  notes?: string | null;
  delivered_at?: string | null;
  proof_url?: string | null;
}

export interface TransactionRoom {
  id: string;
  ref: string;
  title: string;
  description?: string | null;
  status: TradeStatus;
  is_demo: boolean;
  share_url?: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  buyer_progress: number;
  seller_progress: number;
  current_user_role?: ParticipantRole;
  participants: TradeParticipant[];
  milestones: TradeMilestone[];
  payment?: TradePayment | null;
  fulfillment?: TradeFulfillment | null;
  events?: TradeEvent[];
  messages?: TradeMessage[];
  terms?: string | null;
  amount_cents?: number;
  currency?: string;
}

export interface TradeListItem {
  id: string;
  ref: string;
  title: string;
  status: TradeStatus;
  is_demo: boolean;
  role: ParticipantRole;
  relationship: "created" | "joined";
  amount_cents?: number;
  currency?: string;
  updated_at: string;
  awaiting_action?: boolean;
}
