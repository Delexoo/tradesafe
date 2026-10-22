-- TradeSafe security, consent expansion, device tokens, incidents

-- Expand policy keys
ALTER TABLE ts_policy_versions DROP CONSTRAINT IF EXISTS ts_policy_versions_policy_key_check;
ALTER TABLE ts_policy_versions ADD CONSTRAINT ts_policy_versions_policy_key_check
  CHECK (policy_key IN (
    'tos', 'privacy', 'transaction_dispute',
    'security_fraud', 'device_notice'
  ));

-- Deactivate old single-bundle assumption; seed new active policies
UPDATE ts_policy_versions SET is_active = false
WHERE policy_key IN ('tos', 'privacy', 'transaction_dispute') AND version = '2026-10-22';

INSERT INTO ts_policy_versions (policy_key, version, title, content_hash, body_summary, is_active)
VALUES
  ('tos', '2026-10-22-s', 'Terms of Service',
   encode(digest('tradesafe-tos-2026-10-22-s', 'sha256'), 'hex'),
   'Draft terms for guest trade rooms and platform use.', true),
  ('privacy', '2026-10-22-s', 'Privacy Policy',
   encode(digest('tradesafe-privacy-2026-10-22-s', 'sha256'), 'hex'),
   'Draft privacy practices including security logging and processors.', true),
  ('transaction_dispute', '2026-10-22-s', 'Transaction and Dispute Policies',
   encode(digest('tradesafe-disputes-2026-10-22-s', 'sha256'), 'hex'),
   'Draft dispute, cancellation, and trade-terms rules.', true),
  ('security_fraud', '2026-10-22-s', 'Security and Fraud Prevention Policy',
   encode(digest('tradesafe-security-2026-10-22-s', 'sha256'), 'hex'),
   'Draft security logging, investigation access, and retention.', true),
  ('device_notice', '2026-10-22-s', 'Device Recognition and Security Logging Notice',
   encode(digest('tradesafe-device-2026-10-22-s', 'sha256'), 'hex'),
   'Draft notice for optional device recognition signals.', true)
ON CONFLICT (policy_key, version) DO NOTHING;

-- Required security consent bundle (platform policies) + optional device
CREATE TABLE IF NOT EXISTS ts_security_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES ts_profiles(id),
  consent_bundle_version TEXT NOT NULL DEFAULT '2026-10-22-s',
  required_accepted BOOLEAN NOT NULL DEFAULT false,
  optional_device_accepted BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ts_security_consents_actor
  ON ts_security_consents(actor_id, accepted_at DESC);

-- Append-only security events (service role writes)
CREATE TABLE IF NOT EXISTS ts_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  actor_id UUID REFERENCES ts_profiles(id),
  transaction_id UUID REFERENCES ts_transactions(id) ON DELETE SET NULL,
  session_ref TEXT,
  device_ref TEXT,
  ip_hash TEXT,
  ip_masked TEXT,
  user_agent TEXT,
  correlation_id TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ts_security_events_created
  ON ts_security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ts_security_events_tx
  ON ts_security_events(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ts_security_events_actor
  ON ts_security_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ts_security_events_type
  ON ts_security_events(event_type);

-- First-party device tokens (hash only)
CREATE TABLE IF NOT EXISTS ts_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  actor_id UUID REFERENCES ts_profiles(id),
  browser_family TEXT,
  os_family TEXT,
  device_category TEXT
    CHECK (device_category IS NULL OR device_category IN ('desktop', 'tablet', 'mobile', 'unknown')),
  user_agent TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ts_device_tokens_actor ON ts_device_tokens(actor_id);

-- User-reported incidents
CREATE TABLE IF NOT EXISTS ts_security_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  transaction_id UUID REFERENCES ts_transactions(id) ON DELETE SET NULL,
  reporter_id UUID REFERENCES ts_profiles(id),
  category TEXT NOT NULL
    CHECK (category IN (
      'scam', 'impersonation', 'suspicious', 'unauthorized_access',
      'payment', 'abuse', 'compromised_invite', 'other'
    )),
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'triage', 'investigating', 'escalated', 'resolved', 'closed')),
  triage TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (triage IN ('unreviewed', 'low', 'medium', 'high')),
  assigned_to UUID REFERENCES ts_profiles(id),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ts_security_incidents_status
  ON ts_security_incidents(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ts_security_incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES ts_security_incidents(id) ON DELETE CASCADE,
  author_id UUID REFERENCES ts_profiles(id),
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin audit (who viewed/changed what)
CREATE TABLE IF NOT EXISTS ts_admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES ts_profiles(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ts_security_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_security_incident_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_admin_audit ENABLE ROW LEVEL SECURITY;

-- Deny all direct client access; service role bypasses
DROP POLICY IF EXISTS ts_security_consents_deny ON ts_security_consents;
CREATE POLICY ts_security_consents_deny ON ts_security_consents FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ts_security_events_deny ON ts_security_events;
CREATE POLICY ts_security_events_deny ON ts_security_events FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ts_device_tokens_deny ON ts_device_tokens;
CREATE POLICY ts_device_tokens_deny ON ts_device_tokens FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ts_security_incidents_deny ON ts_security_incidents;
CREATE POLICY ts_security_incidents_deny ON ts_security_incidents FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ts_security_incident_notes_deny ON ts_security_incident_notes;
CREATE POLICY ts_security_incident_notes_deny ON ts_security_incident_notes FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS ts_admin_audit_deny ON ts_admin_audit;
CREATE POLICY ts_admin_audit_deny ON ts_admin_audit FOR ALL USING (false) WITH CHECK (false);
