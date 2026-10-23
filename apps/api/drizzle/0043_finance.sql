CREATE TABLE "cell"."finance_snapshots" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"outstanding" numeric(18, 2) NOT NULL,
	"credit_limit" numeric(18, 2),
	"inventory_value" numeric(18, 2),
	"ageing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "finance_snapshots_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "finance_snapshots_amounts" CHECK ("cell"."finance_snapshots"."outstanding" >= 0
        and coalesce("cell"."finance_snapshots"."credit_limit", 0) >= 0 and coalesce("cell"."finance_snapshots"."inventory_value", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "cell"."finance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."ledger_entries" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reference" text NOT NULL,
	"description" text,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ledger_entries_one_side" CHECK ("cell"."ledger_entries"."debit" >= 0 and "cell"."ledger_entries"."credit" >= 0 and ("cell"."ledger_entries"."debit" > 0) <> ("cell"."ledger_entries"."credit" > 0))
);
--> statement-breakpoint
ALTER TABLE "cell"."ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."finance_snapshots" ADD CONSTRAINT "finance_snapshots_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_snapshots_tenant_account_as_of" ON "cell"."finance_snapshots" USING btree ("tenant_id","account_id","as_of" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "finance_snapshots_tenant_row_version" ON "cell"."finance_snapshots" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_tenant_reference" ON "cell"."ledger_entries" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_account_date" ON "cell"."ledger_entries" USING btree ("tenant_id","account_id","date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."finance_snapshots" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."ledger_entries" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);