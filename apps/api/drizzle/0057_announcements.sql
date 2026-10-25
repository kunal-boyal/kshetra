CREATE TYPE "directory"."announcement_tone" AS ENUM('info', 'warning');--> statement-breakpoint
CREATE TABLE "directory"."announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"tone" "directory"."announcement_tone" NOT NULL,
	"surfaces" text[] NOT NULL,
	"tenant_ids" uuid[],
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid
);
--> statement-breakpoint
ALTER TABLE "directory"."announcements" ADD CONSTRAINT "announcements_created_by_platform_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."announcements" ADD CONSTRAINT "announcements_withdrawn_by_platform_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "directory"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_ends_idx" ON "directory"."announcements" USING btree ("ends_at");