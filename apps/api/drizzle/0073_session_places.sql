ALTER TABLE "directory"."refresh_tokens" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "directory"."refresh_tokens" ADD COLUMN "ip" text;