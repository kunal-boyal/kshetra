CREATE TABLE "cell"."external_metric_values" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"date" date NOT NULL,
	"month" boolean DEFAULT false NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"credited_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "external_metric_values_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "external_metric_values_subject" UNIQUE NULLS NOT DISTINCT("tenant_id","metric_key","user_id","account_id","date"),
	CONSTRAINT "external_metric_values_one_subject" CHECK (("cell"."external_metric_values"."user_id" is null) <> ("cell"."external_metric_values"."account_id" is null))
);
--> statement-breakpoint
ALTER TABLE "cell"."external_metric_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."external_metric_values" ADD CONSTRAINT "external_metric_values_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."external_metric_values" ADD CONSTRAINT "external_metric_values_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_metric_values_credited" ON "cell"."external_metric_values" USING btree ("tenant_id","credited_user_id","date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."external_metric_values" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);