ALTER TYPE "cell"."media_kind" ADD VALUE 'location_archive';--> statement-breakpoint
CREATE TABLE "cell"."location_archives" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"part" smallint NOT NULL,
	"media_id" uuid,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "location_archives_tenant_id_date_part_pk" PRIMARY KEY("tenant_id","date","part")
);
--> statement-breakpoint
ALTER TABLE "cell"."location_archives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."location_archives" ADD CONSTRAINT "location_archives_media_fk" FOREIGN KEY ("tenant_id","media_id") REFERENCES "cell"."media"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."location_archives" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);