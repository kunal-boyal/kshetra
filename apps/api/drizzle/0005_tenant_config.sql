CREATE TABLE "cell"."tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "cell"."tenant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."terminology_overrides" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "terminology_overrides_tenant_id_key_locale_pk" PRIMARY KEY("tenant_id","key","locale")
);
--> statement-breakpoint
ALTER TABLE "cell"."terminology_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."tenant_settings" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."terminology_overrides" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);