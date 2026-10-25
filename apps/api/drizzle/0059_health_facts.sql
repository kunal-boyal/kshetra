-- What the cell's health needs from every tenant's rows at once (decision D93): the outbox's
-- backlog and its oldest undelivered event, and the phones heard from in the last half hour, with
-- uploads waiting, refused, and the oldest still waiting. Only counts and ages leave it, nothing
-- of any tenant's records. The scheduler calls it as cell_app; it runs as the migrator, which owns
-- the tables and sees every tenant's rows.
CREATE FUNCTION "cell"."health_facts"()
RETURNS TABLE (
  outbox_backlog bigint,
  outbox_oldest_seconds integer,
  phones_seen bigint,
  phones_waiting bigint,
  phones_parked bigint,
  phones_oldest_queued_seconds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM cell.outbox_events WHERE dispatched_at IS NULL),
    (SELECT extract(epoch FROM now() - min(created_at))::integer
       FROM cell.outbox_events WHERE dispatched_at IS NULL),
    count(*),
    count(*) FILTER (WHERE (health -> 'queue' ->> 'queued')::integer > 0),
    count(*) FILTER (WHERE (health -> 'queue' ->> 'parked')::integer > 0),
    extract(epoch FROM now() - min((health -> 'queue' ->> 'oldestQueuedAt')::timestamptz))::integer
  FROM cell.devices
  WHERE revoked_at IS NULL
    AND last_seen_at > now() - interval '30 minutes'
    AND health IS NOT NULL;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "cell"."health_facts"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "cell"."health_facts"() TO "cell_app";
