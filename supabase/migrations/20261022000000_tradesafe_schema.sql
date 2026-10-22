-- TradeSafe schema (ts_* prefix — isolated from Moonrise Studio tables)
-- Enables: transactions, invitations, dual progress, chat, disputes, payments, audit

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE ts_transaction_status AS ENUM (
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
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ts_participant_role AS ENUM ('buyer', 'seller', 'observer', 'creator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ts_category AS ENUM (
    'digital', 'physical', 'electronics', 'collectibles',
    'website_domain', 'service', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ts_verification_source AS ENUM (
    'user_reported', 'awaiting_verification', 'provider_confirmed', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ts_payment_status AS ENUM (
    'none', 'initiated', 'pending', 'authorized', 'captured',
    'failed', 'cancelled', 'refund_pending', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ts_dispute_status AS ENUM (
    'open', 'awaiting_response', 'under_review', 'resolved', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Profiles (TradeSafe-specific; does not alter public.profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Trader',
  avatar_url TEXT,
  notification_prefs JSONB NOT NULL DEFAULT '{"in_app":true,"email":false}'::jsonb,
  privacy_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category ts_category NOT NULL DEFAULT 'other',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (char_length(currency) = 3),
  status ts_transaction_status NOT NULL DEFAULT 'draft',
  creator_id UUID NOT NULL REFERENCES ts_profiles(id),
  delivery_method TEXT NOT NULL DEFAULT 'other',
  fulfillment_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms_version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_transactions_creator ON ts_transactions(creator_id);
CREATE INDEX IF NOT EXISTS idx_ts_transactions_status ON ts_transactions(status);
CREATE INDEX IF NOT EXISTS idx_ts_transactions_demo ON ts_transactions(is_demo);

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES ts_profiles(id) ON DELETE SET NULL,
  role ts_participant_role NOT NULL,
  display_name TEXT,
  contribution_cents INTEGER,
  terms_accepted_at TIMESTAMPTZ,
  terms_version_accepted INTEGER,
  joined_at TIMESTAMPTZ,
  invite_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'joined', 'left', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, user_id),
  UNIQUE (transaction_id, role) -- one buyer, one seller for v1 (observers can be multiple — see below)
);

-- Allow multiple observers: partial unique indexes instead of full unique on role
ALTER TABLE ts_participants DROP CONSTRAINT IF EXISTS ts_participants_transaction_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ts_participants_one_buyer
  ON ts_participants(transaction_id) WHERE role = 'buyer';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ts_participants_one_seller
  ON ts_participants(transaction_id) WHERE role = 'seller';

CREATE INDEX IF NOT EXISTS idx_ts_participants_user ON ts_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_ts_participants_tx ON ts_participants(transaction_id);

-- ---------------------------------------------------------------------------
-- Terms versions (immutable after acceptance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_terms_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  body JSONB NOT NULL,
  created_by UUID REFERENCES ts_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, version)
);

-- ---------------------------------------------------------------------------
-- Invitation tokens (store hash only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role ts_participant_role NOT NULL DEFAULT 'buyer',
  created_by UUID NOT NULL REFERENCES ts_profiles(id),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 10,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  single_use BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_invitations_tx ON ts_invitations(transaction_id);

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('buyer', 'seller', 'shared')),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'failed', 'skipped')),
  verification_source ts_verification_source NOT NULL DEFAULT 'system',
  responsible_role ts_participant_role,
  evidence JSONB,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, key)
);

CREATE INDEX IF NOT EXISTS idx_ts_milestones_tx ON ts_milestones(transaction_id);

-- ---------------------------------------------------------------------------
-- Payments (TradeSafe — not Moonrise public.payments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'demo',
  provider_session_id TEXT,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status ts_payment_status NOT NULL DEFAULT 'none',
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_payments_tx ON ts_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ts_payments_provider_id ON ts_payments(provider_payment_id);

-- ---------------------------------------------------------------------------
-- Fulfillment
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES ts_transactions(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started', 'acknowledged', 'preparing', 'shipped',
      'transferred', 'delivered', 'confirmed'
    )),
  tracking_carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  seller_notes TEXT,
  buyer_confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Attachments / evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES ts_profiles(id),
  kind TEXT NOT NULL DEFAULT 'evidence'
    CHECK (kind IN ('item_image', 'evidence', 'chat_file', 'dispute_evidence')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  storage_path TEXT NOT NULL,
  malware_scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (malware_scan_status IN ('pending', 'clean', 'flagged', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_attachments_tx ON ts_attachments(transaction_id);

-- ---------------------------------------------------------------------------
-- Events (activity feed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES ts_profiles(id),
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_source ts_verification_source NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_events_tx_created ON ts_events(transaction_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Chat messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES ts_profiles(id),
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  is_system BOOLEAN NOT NULL DEFAULT false,
  attachment_id UUID REFERENCES ts_attachments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_messages_tx_created ON ts_messages(transaction_id, created_at);

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES ts_profiles(id),
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status ts_dispute_status NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES ts_profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_disputes_tx ON ts_disputes(transaction_id);

CREATE TABLE IF NOT EXISTS ts_dispute_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES ts_disputes(id) ON DELETE CASCADE,
  author_id UUID REFERENCES ts_profiles(id),
  body TEXT NOT NULL,
  attachment_id UUID REFERENCES ts_attachments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ts_transactions(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES ts_payments(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'pending', 'succeeded', 'failed')),
  provider_refund_id TEXT,
  requested_by UUID REFERENCES ts_profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ts_profiles(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES ts_transactions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_notifications_user ON ts_notifications(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Provider webhook events (idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Audit logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  ip INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_audit_created ON ts_audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Helper: is participant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ts_is_participant(tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ts_participants p
    WHERE p.transaction_id = tx_id
      AND p.user_id = auth.uid()
      AND p.status = 'joined'
  );
$$;

CREATE OR REPLACE FUNCTION ts_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM ts_profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Auto-create ts_profiles on signup
CREATE OR REPLACE FUNCTION ts_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ts_profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1), 'Trader')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ts_on_auth_user_created ON auth.users;
CREATE TRIGGER ts_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION ts_handle_new_user();

-- updated_at helper
CREATE OR REPLACE FUNCTION ts_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ts_transactions_updated ON ts_transactions;
CREATE TRIGGER ts_transactions_updated
  BEFORE UPDATE ON ts_transactions
  FOR EACH ROW EXECUTE FUNCTION ts_set_updated_at();

DROP TRIGGER IF EXISTS ts_payments_updated ON ts_payments;
CREATE TRIGGER ts_payments_updated
  BEFORE UPDATE ON ts_payments
  FOR EACH ROW EXECUTE FUNCTION ts_set_updated_at();

DROP TRIGGER IF EXISTS ts_profiles_updated ON ts_profiles;
CREATE TRIGGER ts_profiles_updated
  BEFORE UPDATE ON ts_profiles
  FOR EACH ROW EXECUTE FUNCTION ts_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE ts_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_terms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_dispute_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_rate_limits ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS ts_profiles_select ON ts_profiles;
CREATE POLICY ts_profiles_select ON ts_profiles FOR SELECT
  USING (id = auth.uid() OR ts_is_admin() OR EXISTS (
    SELECT 1 FROM ts_participants me
    JOIN ts_participants other ON me.transaction_id = other.transaction_id
    WHERE me.user_id = auth.uid() AND other.user_id = ts_profiles.id AND me.status = 'joined'
  ));

DROP POLICY IF EXISTS ts_profiles_update ON ts_profiles;
CREATE POLICY ts_profiles_update ON ts_profiles FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS ts_profiles_insert ON ts_profiles;
CREATE POLICY ts_profiles_insert ON ts_profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- Transactions
DROP POLICY IF EXISTS ts_tx_select ON ts_transactions;
CREATE POLICY ts_tx_select ON ts_transactions FOR SELECT
  USING (ts_is_participant(id) OR creator_id = auth.uid() OR ts_is_admin());

DROP POLICY IF EXISTS ts_tx_insert ON ts_transactions;
CREATE POLICY ts_tx_insert ON ts_transactions FOR INSERT
  WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS ts_tx_update ON ts_transactions;
CREATE POLICY ts_tx_update ON ts_transactions FOR UPDATE
  USING (ts_is_participant(id) OR creator_id = auth.uid() OR ts_is_admin());

-- Participants
DROP POLICY IF EXISTS ts_part_select ON ts_participants;
CREATE POLICY ts_part_select ON ts_participants FOR SELECT
  USING (ts_is_participant(transaction_id) OR user_id = auth.uid() OR ts_is_admin());

DROP POLICY IF EXISTS ts_part_insert ON ts_participants;
CREATE POLICY ts_part_insert ON ts_participants FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM ts_transactions t WHERE t.id = transaction_id AND t.creator_id = auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS ts_part_update ON ts_participants;
CREATE POLICY ts_part_update ON ts_participants FOR UPDATE
  USING (user_id = auth.uid() OR ts_is_participant(transaction_id) OR ts_is_admin());

-- Terms
DROP POLICY IF EXISTS ts_terms_select ON ts_terms_versions;
CREATE POLICY ts_terms_select ON ts_terms_versions FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

-- Invitations: participants can see metadata (not used for joining — join uses server hash lookup)
DROP POLICY IF EXISTS ts_inv_select ON ts_invitations;
CREATE POLICY ts_inv_select ON ts_invitations FOR SELECT
  USING (
    created_by = auth.uid()
    OR ts_is_participant(transaction_id)
    OR ts_is_admin()
  );

-- Milestones, payments, fulfillments, attachments, events, messages
DROP POLICY IF EXISTS ts_milestones_select ON ts_milestones;
CREATE POLICY ts_milestones_select ON ts_milestones FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_payments_select ON ts_payments;
CREATE POLICY ts_payments_select ON ts_payments FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_fulfill_select ON ts_fulfillments;
CREATE POLICY ts_fulfill_select ON ts_fulfillments FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_attach_select ON ts_attachments;
CREATE POLICY ts_attach_select ON ts_attachments FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_events_select ON ts_events;
CREATE POLICY ts_events_select ON ts_events FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_messages_select ON ts_messages;
CREATE POLICY ts_messages_select ON ts_messages FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_messages_insert ON ts_messages;
CREATE POLICY ts_messages_insert ON ts_messages FOR INSERT
  WITH CHECK (ts_is_participant(transaction_id) AND sender_id = auth.uid());

-- Disputes
DROP POLICY IF EXISTS ts_disputes_select ON ts_disputes;
CREATE POLICY ts_disputes_select ON ts_disputes FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

DROP POLICY IF EXISTS ts_dispute_msg_select ON ts_dispute_messages;
CREATE POLICY ts_dispute_msg_select ON ts_dispute_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ts_disputes d
      WHERE d.id = dispute_id AND (ts_is_participant(d.transaction_id) OR ts_is_admin())
    )
  );

-- Refunds
DROP POLICY IF EXISTS ts_refunds_select ON ts_refunds;
CREATE POLICY ts_refunds_select ON ts_refunds FOR SELECT
  USING (ts_is_participant(transaction_id) OR ts_is_admin());

-- Notifications
DROP POLICY IF EXISTS ts_notif_select ON ts_notifications;
CREATE POLICY ts_notif_select ON ts_notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ts_notif_update ON ts_notifications;
CREATE POLICY ts_notif_update ON ts_notifications FOR UPDATE
  USING (user_id = auth.uid());

-- Webhooks, audit, rate limits: service role only (no policies for authenticated)
DROP POLICY IF EXISTS ts_webhook_deny ON ts_webhook_events;
CREATE POLICY ts_webhook_deny ON ts_webhook_events FOR ALL
  USING (false);

DROP POLICY IF EXISTS ts_audit_admin ON ts_audit_logs;
CREATE POLICY ts_audit_admin ON ts_audit_logs FOR SELECT
  USING (ts_is_admin());

DROP POLICY IF EXISTS ts_rate_deny ON ts_rate_limits;
CREATE POLICY ts_rate_deny ON ts_rate_limits FOR ALL
  USING (false);

-- Realtime publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_transactions;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_events;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_messages;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_milestones;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_payments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_fulfillments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_notifications;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ts_participants;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- Storage bucket for evidence (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ts-evidence',
  'ts-evidence',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf','text/plain']
)
ON CONFLICT (id) DO NOTHING;
