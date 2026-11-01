CREATE TABLE "cell"."forecast_lines" (
	"tenant_id" uuid NOT NULL,
	"forecast_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	CONSTRAINT "forecast_lines_tenant_id_forecast_id_item_id_pk" PRIMARY KEY("tenant_id","forecast_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."forecast_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."forecasts" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"version" integer NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"after_lock" boolean DEFAULT false NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "forecasts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."forecasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."forecast_lines" ADD CONSTRAINT "forecast_lines_forecast_fk" FOREIGN KEY ("tenant_id","forecast_id") REFERENCES "cell"."forecasts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."forecast_lines" ADD CONSTRAINT "forecast_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."forecasts" ADD CONSTRAINT "forecasts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."forecasts" ADD CONSTRAINT "forecasts_user_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecasts_tenant_account_period_version" ON "cell"."forecasts" USING btree ("tenant_id","account_id","period","version");--> statement-breakpoint
CREATE INDEX "forecasts_tenant_period_account" ON "cell"."forecasts" USING btree ("tenant_id","period","account_id");--> statement-breakpoint
CREATE INDEX "forecasts_tenant_row_version" ON "cell"."forecasts" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."forecast_lines" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."forecasts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);