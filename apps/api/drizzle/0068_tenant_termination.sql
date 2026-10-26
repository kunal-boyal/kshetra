ALTER TABLE "directory"."tenants" ADD COLUMN "terminated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "directory"."tenants" ADD COLUMN "deleted_at" timestamp with time zone;