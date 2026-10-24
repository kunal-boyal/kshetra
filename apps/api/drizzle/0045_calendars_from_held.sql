-- Holiday calendars move from the held configuration to the field module (decision D80): each
-- tenant's calendars, with its default one marked. Leave types and expense policies stay held
-- until their steps.
INSERT INTO "cell"."calendars" ("tenant_id", "key", "name", "weekly_offs", "is_default")
SELECT h."tenant_id",
       c->>'key',
       c->'name',
       ARRAY(SELECT jsonb_array_elements_text(c->'weeklyOffs')::integer),
       (c->>'key') = (h."people"->>'defaultCalendar')
  FROM "cell"."held_configuration" h,
       jsonb_array_elements(h."people"->'calendars') AS c
 WHERE h."people" IS NOT NULL
ON CONFLICT DO NOTHING;
