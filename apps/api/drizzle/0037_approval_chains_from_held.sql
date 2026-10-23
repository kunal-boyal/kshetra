-- Approval chains move from the held configuration to the workflow module (decision D74). Each
-- tenant's chains become version 1 of their request types, made by nobody (provisioning).
INSERT INTO "cell"."workflow_settings" ("tenant_id", "fallback_role")
SELECT "tenant_id", "workflows"->>'fallbackRole'
  FROM "cell"."held_configuration"
 WHERE "workflows" IS NOT NULL
ON CONFLICT ("tenant_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "cell"."workflow_definitions" ("id", "tenant_id", "request_type", "version", "steps")
SELECT uuidv7(), h."tenant_id", (d->>'requestType')::"cell"."request_type", 1, d->'steps'
  FROM "cell"."held_configuration" h,
       jsonb_array_elements(h."workflows"->'definitions') AS d
 WHERE h."workflows" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Steps waiting now began when their request did, so reminders count from then.
UPDATE "cell"."workflow_steps" s
   SET "started_at" = i."created_at"
  FROM "cell"."workflow_instances" i
 WHERE i."tenant_id" = s."tenant_id"
   AND i."id" = s."instance_id"
   AND s."status" = 'pending'
   AND s."started_at" IS NULL;
