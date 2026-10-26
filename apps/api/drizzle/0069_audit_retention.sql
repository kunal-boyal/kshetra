-- Audit retention (BR-41, decision D95): a tenant's audit entries older than its keeping time, 3
-- years by default, are removed each night. The log is append-only for the application, so the
-- removal runs as the log's owner, for one tenant and only before the cutoff it is given.
CREATE FUNCTION "cell"."purge_audit_log"("p_tenant" uuid, "p_before" timestamptz) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  removed bigint;
BEGIN
  IF p_before > now() - interval '1 year' THEN
    RAISE EXCEPTION 'The audit log is kept for a year at least';
  END IF;
  DELETE FROM cell.audit_log WHERE tenant_id = p_tenant AND created_at < p_before;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."purge_audit_log"(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."purge_audit_log"(uuid, timestamptz) TO "cell_app";
