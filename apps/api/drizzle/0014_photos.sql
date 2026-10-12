CREATE TYPE "cell"."media_source" AS ENUM('camera', 'gallery', 'generated');--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "source" "cell"."media_source";--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "point" geography(Point, 4326);--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "accuracy" double precision;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "mocked" boolean;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "dhash" text;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "derivatives" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "ocr" jsonb;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."media" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_tenant_kind_captured" ON "cell"."media" USING btree ("tenant_id","kind","captured_at");