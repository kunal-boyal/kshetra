-- Expense policies move from the held configuration to the expenses module (decision D83): each
-- tenant's policies in the order configuration lists them, each as its first version, in force
-- from 2000-01-01 so claims for any day find it.
INSERT INTO "cell"."expense_policies" ("tenant_id", "key", "current_version", "active", "position")
SELECT h."tenant_id",
       p.value->>'key',
       1,
       coalesce((p.value->>'active')::boolean, true),
       p.ordinality - 1
  FROM "cell"."held_configuration" h,
       jsonb_array_elements(h."people"->'expensePolicies') WITH ORDINALITY AS p
 WHERE h."people" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "cell"."expense_policy_versions" ("tenant_id", "policy_key", "version", "definition", "valid_from")
SELECT h."tenant_id", p->>'key', 1, p, DATE '2000-01-01'
  FROM "cell"."held_configuration" h,
       jsonb_array_elements(h."people"->'expensePolicies') AS p
 WHERE h."people" IS NOT NULL
ON CONFLICT DO NOTHING;
