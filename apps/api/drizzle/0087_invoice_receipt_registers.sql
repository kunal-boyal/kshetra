CREATE TYPE "cell"."receipt_kind" AS ENUM('receipt', 'credit_note');--> statement-breakpoint
CREATE TABLE "cell"."invoices" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invoices_amount" CHECK ("cell"."invoices"."amount" > 0),
	CONSTRAINT "invoices_due" CHECK ("cell"."invoices"."due_date" >= "cell"."invoices"."date")
);
--> statement-breakpoint
ALTER TABLE "cell"."invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."receipts" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"kind" "cell"."receipt_kind" DEFAULT 'receipt' NOT NULL,
	"against" text[] DEFAULT '{}'::text[] NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "receipts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "receipts_amount" CHECK ("cell"."receipts"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cell"."receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."invoices" ADD CONSTRAINT "invoices_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."receipts" ADD CONSTRAINT "receipts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number" ON "cell"."invoices" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_account_due" ON "cell"."invoices" USING btree ("tenant_id","account_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_row_version" ON "cell"."invoices" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_tenant_number" ON "cell"."receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "receipts_tenant_account_date" ON "cell"."receipts" USING btree ("tenant_id","account_id","date");--> statement-breakpoint
CREATE INDEX "receipts_tenant_row_version" ON "cell"."receipts" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."invoices" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."receipts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);