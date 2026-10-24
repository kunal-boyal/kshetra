-- Leave types move from the held configuration to the leave module (decision D81), in the order
-- configuration lists them. Expense policies stay held until their step.
INSERT INTO "cell"."leave_types" ("tenant_id", "key", "name", "paid", "annual_quota", "quota_year",
                                  "half_day_allowed", "attachment_after_days", "active", "position")
SELECT h."tenant_id",
       t.value->>'key',
       t.value->'name',
       (t.value->>'paid')::boolean,
       (t.value->>'annualQuota')::numeric,
       t.value->>'quotaYear',
       (t.value->>'halfDayAllowed')::boolean,
       (t.value->>'attachmentAfterDays')::integer,
       coalesce((t.value->>'active')::boolean, true),
       t.ordinality - 1
  FROM "cell"."held_configuration" h,
       jsonb_array_elements(h."people"->'leaveTypes') WITH ORDINALITY AS t
 WHERE h."people" IS NOT NULL
ON CONFLICT DO NOTHING;
