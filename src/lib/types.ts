/**
 * TradeSafe domain types aligned with Supabase `ts_*` enums and tables.
 */

export const TRANSACTION_STATUSES = [
  'draft',
  'awaiting_acceptance',
  'awaiting_payment',
  'payment_pending',
  'funds_authorized',
  'awaiting_fulfillment',
  'in_fulfillment',
  'awaiting_confirmation',
  'completion_pending',
  'completed',
  'cancellation_requested',
  'cancelled',
  'refund_pending',
  'refunded',
  'disputed',
  'suspended',
  'expired',
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const PARTICIPANT_ROLES = [
  'buyer',
  'seller',
  'observer',
  'creator',
] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const CATEGORIES = [
  'digital',
  'physical',
  'electronics',
  'collectibles',
  'website_domain',
  'service',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const VERIFICATION_SOURCES = [
  'user_reported',
  'awaiting_verification',
  'provider_confirmed',
  'system',
] as const;

export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const PAYMENT_STATUSES = [
  'none',
  'initiated',
  'pending',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'refund_pending',
  'refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DISPUTE_STATUSES = [
  'open',
  'awaiting_response',
  'under_review',
  'resolved',
  'closed',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export type MilestoneTrack = 'buyer' | 'seller' | 'shared';

export type MilestoneStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface Milestone {
  key: string;
  track: MilestoneTrack;
  label: string;
  status: MilestoneStatus;
  verification_source?: VerificationSource;
  responsible_role?: ParticipantRole | null;
  sort_order?: number;
}

export type ParticipantStatus = 'pending' | 'joined' | 'left' | 'removed';

export interface Participant {
  id?: string;
  user_id?: string | null;
  role: ParticipantRole;
  display_name?: string | null;
  terms_accepted_at?: string | null;
  terms_version_accepted?: number | null;
  status?: ParticipantStatus;
}

export type FulfillmentStatus =
  | 'not_started'
  | 'acknowledged'
  | 'preparing'
  | 'shipped'
  | 'transferred'
  | 'delivered'
  | 'confirmed';

export interface FulfillmentSnapshot {
  status: FulfillmentStatus;
  method?: string;
}

/** Who initiated a transition (client actions are never trusted for money). */
export type TransitionSource =
  | 'client'
  | 'provider'
  | 'demo_server'
  | 'system';

export interface InvitationRecord {
  id?: string;
  token_hash: string;
  role: ParticipantRole;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked_at?: string | null;
  single_use?: boolean;
}
