-- Guest-first access + append-only policy acceptance (TradeSafe)

-- Allow profiles that are not auth.users (guests)
ALTER TABLE ts_profiles DROP CONSTRAINT IF EXISTS ts_profiles_id_fkey;
ALTER TABLE ts_profiles
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_session_id UUID;

CREATE TABLE IF NOT EXISTS ts_guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  profile_id UUID NOT NULL REFERENCES ts_profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Guest',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_guest_sessions_hash ON ts_guest_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_ts_guest_sessions_profile ON ts_guest_sessions(profile_id);

-- Optional back-reference only (no circular insert requirement)
DO $$ BEGIN
  ALTER TABLE ts_profiles
    ADD CONSTRAINT ts_profiles_guest_session_id_fkey
    FOREIGN KEY (guest_session_id) REFERENCES ts_guest_sessions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Platform policy versions (immutable once published)
CREATE TABLE IF NOT EXISTS ts_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL CHECK (policy_key IN ('tos', 'privacy', 'transaction_dispute')),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body_summary TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ts_policy_one_active
  ON ts_policy_versions(policy_key) WHERE is_active = true;

-- Append-only acceptance audit (no UPDATE/DELETE for clients)
CREATE TABLE IF NOT EXISTS ts_policy_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES ts_profiles(id),
  policy_version_id UUID NOT NULL REFERENCES ts_policy_versions(id),
  policy_key TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  transaction_id UUID REFERENCES ts_transactions(id) ON DELETE SET NULL,
  method TEXT NOT NULL DEFAULT 'checkbox'
    CHECK (method IN ('checkbox', 'api')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_policy_acceptances_actor
  ON ts_policy_acceptances(actor_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ts_policy_acceptances_tx
  ON ts_policy_acceptances(transaction_id);

-- Seed active draft policies (not legal advice — labeled as drafts in UI)
INSERT INTO ts_policy_versions (policy_key, version, title, content_hash, body_summary, is_active)
VALUES
  (
    'tos',
    '2026-10-22',
    'Terms of Service',
    encode(digest('tradesafe-tos-2026-10-22-draft', 'sha256'), 'hex'),
    'Draft terms describing TradeSafe as a coordination tool, not escrow or insurance.',
    true
  ),
  (
    'privacy',
    '2026-10-22',
    'Privacy Policy',
    encode(digest('tradesafe-privacy-2026-10-22-draft', 'sha256'), 'hex'),
    'Draft privacy summary for guest sessions, invite links, and trade records.',
    true
  ),
  (
    'transaction_dispute',
    '2026-10-22',
    'Transaction and Dispute Policies',
    encode(digest('tradesafe-txn-dispute-2026-10-22-draft', 'sha256'), 'hex'),
    'Draft rules for cancellations, disputes, and the limits of platform involvement.',
    true
  )
ON CONFLICT (policy_key, version) DO NOTHING;

-- RLS: service role continues to bypass; tighten client paths
ALTER TABLE ts_guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_policy_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ts_policy_versions_read ON ts_policy_versions;
CREATE POLICY ts_policy_versions_read ON ts_policy_versions
  FOR SELECT USING (true);

-- No direct client writes to acceptances or guest sessions (server/service role only)
DROP POLICY IF EXISTS ts_policy_acceptances_deny ON ts_policy_acceptances;
CREATE POLICY ts_policy_acceptances_deny ON ts_policy_acceptances
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ts_guest_sessions_deny ON ts_guest_sessions;
CREATE POLICY ts_guest_sessions_deny ON ts_guest_sessions
  FOR ALL USING (false) WITH CHECK (false);
