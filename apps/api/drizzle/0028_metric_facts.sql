CREATE TABLE "cell"."metric_fact_accounts" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metric_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "metric_fact_accounts_tenant_id_user_id_date_metric_key_account_id_pk" PRIMARY KEY("tenant_id","user_id","date","metric_key","account_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."metric_fact_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."metric_facts_daily" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"numerator" numeric(18, 3),
	"denominator" numeric(18, 3),
	"pending" numeric(18, 3),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_facts_daily_tenant_id_user_id_date_metric_key_pk" PRIMARY KEY("tenant_id","user_id","date","metric_key")
);
--> statement-breakpoint
ALTER TABLE "cell"."metric_facts_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."score_definitions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell"."score_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."score_snapshots" (
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"user_id" uuid NOT NULL,
	"score" integer,
	"rank" integer,
	"group_key" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_snapshots_tenant_id_period_user_id_pk" PRIMARY KEY("tenant_id","period","user_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."score_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."metric_fact_accounts" ADD CONSTRAINT "metric_fact_accounts_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."metric_fact_accounts" ADD CONSTRAINT "metric_fact_accounts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."metric_facts_daily" ADD CONSTRAINT "metric_facts_daily_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."score_snapshots" ADD CONSTRAINT "score_snapshots_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_fact_accounts_tenant_metric_date" ON "cell"."metric_fact_accounts" USING btree ("tenant_id","metric_key","date");--> statement-breakpoint
CREATE INDEX "metric_facts_daily_tenant_date" ON "cell"."metric_facts_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."metric_fact_accounts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."metric_facts_daily" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."score_definitions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."score_snapshots" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);