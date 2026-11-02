ALTER TABLE "cell"."erp_connections" ADD COLUMN "structure" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."erp_links" ADD COLUMN "external_name" text;--> statement-breakpoint
ALTER TABLE "cell"."erp_runs" ADD COLUMN "file_media_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."erp_runs" ADD COLUMN "file_name" text;