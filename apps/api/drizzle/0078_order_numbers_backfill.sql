-- Orders placed before order numbers get theirs in placing order, from 1001 in each tenant
-- (decision D104), and each tenant's counter starts after its last. Phase U runs before launch,
-- with no live tenant's orders, so this is one statement rather than a batched job.
UPDATE "cell"."orders" AS o
SET "number" = n."number"
FROM (
  SELECT "tenant_id", "id",
    1000 + row_number() OVER (PARTITION BY "tenant_id" ORDER BY "placed_at", "id") AS "number"
  FROM "cell"."orders"
) AS n
WHERE o."tenant_id" = n."tenant_id" AND o."id" = n."id";
--> statement-breakpoint
INSERT INTO "cell"."order_counters" ("tenant_id", "last")
SELECT "tenant_id", max("number") FROM "cell"."orders" GROUP BY "tenant_id"
ON CONFLICT ("tenant_id") DO UPDATE SET "last" = excluded."last";
