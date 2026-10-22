-- Lock down client RLS: no self-grant of is_admin; no client status/role mutations.
-- Mutations go through the service-role API (server.mjs).

-- ---------------------------------------------------------------------------
-- Profiles: clients may update display_name / avatar_url only (not is_admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ts_profiles_prevent_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'is_admin can only be changed by service role';
      END IF;
    END IF;
    IF NEW.is_guest IS DISTINCT FROM OLD.is_guest THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'is_guest can only be changed by service role';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ts_profiles_no_priv_escalation ON ts_profiles;
CREATE TRIGGER ts_profiles_no_priv_escalation
  BEFORE UPDATE ON ts_profiles
  FOR EACH ROW
  EXECUTE FUNCTION ts_profiles_prevent_privilege_escalation();

DROP POLICY IF EXISTS ts_profiles_update ON ts_profiles;
CREATE POLICY ts_profiles_update ON ts_profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
-- Privilege columns locked by ts_profiles_no_priv_escalation trigger above.

-- ---------------------------------------------------------------------------
-- Transactions / participants: deny client UPDATEs (API uses service role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ts_tx_update ON ts_transactions;
CREATE POLICY ts_tx_update ON ts_transactions FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS ts_part_update ON ts_participants;
CREATE POLICY ts_part_update ON ts_participants FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- Invites: default to single use
-- ---------------------------------------------------------------------------
ALTER TABLE ts_invitations
  ALTER COLUMN max_uses SET DEFAULT 1;

ALTER TABLE ts_invitations
  ALTER COLUMN single_use SET DEFAULT true;
