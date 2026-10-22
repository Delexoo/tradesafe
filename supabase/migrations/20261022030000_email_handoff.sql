-- One-time handoff so the browser that asked for an email link
-- can pick up the session after the link is opened somewhere else.
CREATE TABLE IF NOT EXISTS ts_email_handoffs (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ts_email_handoffs ENABLE ROW LEVEL SECURITY;
