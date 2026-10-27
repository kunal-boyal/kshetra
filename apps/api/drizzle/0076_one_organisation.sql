-- A number is active in one organisation at a time (decision D103). Before launch only local and
-- demo cells can hold a number active in several; each keeps its newest membership (UUID v7 ids
-- grow with time) and the others stop signing in.
UPDATE "directory"."memberships" AS "m" SET "status" = 'inactive'
WHERE "m"."status" = 'active' AND EXISTS (
	SELECT 1 FROM "directory"."memberships" AS "newer"
	WHERE "newer"."identity_id" = "m"."identity_id" AND "newer"."status" = 'active' AND "newer"."id" > "m"."id"
);--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_active_organisation" ON "directory"."memberships" USING btree ("identity_id") WHERE "directory"."memberships"."status" = 'active';
