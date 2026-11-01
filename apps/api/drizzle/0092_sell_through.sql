CREATE TYPE "cell"."sell_through_flag" AS ENUM('negative_sold', 'opening_changed', 'no_price');--> statement-breakpoint
CREATE TABLE "cell"."sell_through_lines" (
	"tenant_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"opening" numeric(18, 3) NOT NULL,
	"received" numeric(18, 3) NOT NULL,
	"returned" numeric(18, 3) NOT NULL,
	"closing" numeric(18, 3) NOT NULL,
	"sold" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 2),
	"value" numeric(18, 2),
	"flags" "cell"."sell_through_flag"[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "sell_through_lines_tenant_id_statement_id_item_id_pk" PRIMARY KEY("tenant_id","statement_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."sell_through_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."sell_through_statements" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"version" integer NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credited_on" date NOT NULL,
	"value" numeric(18, 2),
	"flags" "cell"."sell_through_flag"[] DEFAULT '{}' NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "sell_through_statements_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."sell_through_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."sell_through_lines" ADD CONSTRAINT "sell_through_lines_statement_fk" FOREIGN KEY ("tenant_id","statement_id") REFERENCES "cell"."sell_through_statements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."sell_through_lines" ADD CONSTRAINT "sell_through_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."sell_through_statements" ADD CONSTRAINT "sell_through_statements_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."sell_through_statements" ADD CONSTRAINT "sell_through_statements_user_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sell_through_statements_tenant_account_period_version" ON "cell"."sell_through_statements" USING btree ("tenant_id","account_id","period","version");--> statement-breakpoint
CREATE INDEX "sell_through_statements_tenant_period_account" ON "cell"."sell_through_statements" USING btree ("tenant_id","period","account_id");--> statement-breakpoint
CREATE INDEX "sell_through_statements_tenant_credited" ON "cell"."sell_through_statements" USING btree ("tenant_id","recorded_by","credited_on");--> statement-breakpoint
CREATE INDEX "sell_through_statements_tenant_row_version" ON "cell"."sell_through_statements" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."sell_through_lines" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."sell_through_statements" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);