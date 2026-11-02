ALTER TABLE "cell"."erp_connections" ADD COLUMN "endpoint" text;--> statement-breakpoint
ALTER TABLE "cell"."erp_connections" ADD COLUMN "company_db" text;--> statement-breakpoint
ALTER TABLE "cell"."erp_connections" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "cell"."erp_connections" ADD COLUMN "credentials_sealed" text;--> statement-breakpoint
ALTER TABLE "cell"."erp_connections" ADD COLUMN "cursors" jsonb DEFAULT '{}'::jsonb NOT NULL;