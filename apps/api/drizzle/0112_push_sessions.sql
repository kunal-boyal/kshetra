ALTER TYPE "cell"."notification_event" ADD VALUE 'support.second_factor_reset' BEFORE 'data_request.received';--> statement-breakpoint
ALTER TABLE "cell"."push_tokens" ADD COLUMN "auth_revision" integer;--> statement-breakpoint
-- Phones registered before this count as registered at their user's current auth revision (BR-39).
UPDATE "cell"."push_tokens" AS "p" SET "auth_revision" = "u"."auth_revision" FROM "cell"."users" AS "u" WHERE "u"."tenant_id" = "p"."tenant_id" AND "u"."id" = "p"."user_id";
