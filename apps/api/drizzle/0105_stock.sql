CREATE TYPE "cell"."stock_count_flag" AS ENUM('beyond_tolerance', 'was_negative');--> statement-breakpoint
CREATE TYPE "cell"."stock_movement_kind" AS ENUM('opening', 'received', 'sold', 'returned_in', 'returned_out', 'counted', 'corrected');--> statement-breakpoint
CREATE TYPE "cell"."stock_source_type" AS ENUM('order', 'count', 'entry', 'import');--> statement-breakpoint
CREATE TABLE "cell"."stock_count_lines" (
	"tenant_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"counted" numeric(18, 3) NOT NULL,
	"expected" numeric(18, 3) NOT NULL,
	"difference" numeric(18, 3) NOT NULL,
	"flags" "cell"."stock_count_flag"[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "stock_count_lines_tenant_id_count_id_item_id_pk" PRIMARY KEY("tenant_id","count_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."stock_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."stock_counts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"counted_by" uuid,
	"note" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."stock_levels" (
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"on_hand" numeric(18, 3) NOT NULL,
	"moved_at" timestamp with time zone,
	"counted_on" date,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "stock_levels_tenant_id_account_id_item_id_pk" PRIMARY KEY("tenant_id","account_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."stock_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."stock_movements" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "cell"."stock_movement_kind" NOT NULL,
	"units" numeric(18, 3) NOT NULL,
	"occurred_on" date NOT NULL,
	"source_type" "cell"."stock_source_type" NOT NULL,
	"source_id" uuid,
	"source_line_id" uuid,
	"source_key" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("tenant_id","count_id") REFERENCES "cell"."stock_counts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_counts" ADD CONSTRAINT "stock_counts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_counts" ADD CONSTRAINT "stock_counts_user_fk" FOREIGN KEY ("tenant_id","counted_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_levels" ADD CONSTRAINT "stock_levels_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_levels" ADD CONSTRAINT "stock_levels_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_movements" ADD CONSTRAINT "stock_movements_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_movements" ADD CONSTRAINT "stock_movements_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "cell"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."stock_movements" ADD CONSTRAINT "stock_movements_user_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_counts_tenant_account_counted" ON "cell"."stock_counts" USING btree ("tenant_id","account_id","counted_at");--> statement-breakpoint
CREATE INDEX "stock_levels_tenant_row_version" ON "cell"."stock_levels" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_account_item" ON "cell"."stock_movements" USING btree ("tenant_id","account_id","item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_occurred" ON "cell"."stock_movements" USING btree ("tenant_id","occurred_on");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_line" ON "cell"."stock_movements" USING btree ("tenant_id","source_line_id") WHERE "cell"."stock_movements"."source_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_source_key" ON "cell"."stock_movements" USING btree ("tenant_id","source_key") WHERE "cell"."stock_movements"."source_key" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."stock_count_lines" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."stock_counts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."stock_levels" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."stock_movements" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);