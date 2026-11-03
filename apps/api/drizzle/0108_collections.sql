CREATE TYPE "cell"."collection_mode" AS ENUM('cash', 'upi', 'cheque', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "cell"."collection_status" AS ENUM('recorded', 'confirmed', 'rejected', 'bounced', 'in_books');--> statement-breakpoint
ALTER TYPE "cell"."media_kind" ADD VALUE 'collection' BEFORE 'import_file';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'collection.rejected' BEFORE 'erp.reconnect';--> statement-breakpoint
ALTER TYPE "cell"."notification_event" ADD VALUE 'collection.bounced' BEFORE 'erp.reconnect';--> statement-breakpoint
CREATE TABLE "cell"."collection_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cell"."collection_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."collections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"visit_id" uuid,
	"shift_id" uuid,
	"collected_on" date NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"mode" "cell"."collection_mode" NOT NULL,
	"reference" text,
	"cheque_number" text,
	"cheque_bank" text,
	"cheque_date" date,
	"note" text,
	"point" geography(Point, 4326),
	"accuracy" double precision,
	"in_geofence" boolean,
	"status" "cell"."collection_status" DEFAULT 'recorded' NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"receipt_id" uuid,
	"matched_by_hand" boolean DEFAULT false NOT NULL,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "collections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "collections_amount" CHECK ("cell"."collections"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cell"."collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."collections" ADD CONSTRAINT "collections_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."collections" ADD CONSTRAINT "collections_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."collections" ADD CONSTRAINT "collections_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."collections" ADD CONSTRAINT "collections_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "cell"."receipts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_tenant_number" ON "cell"."collections" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_tenant_receipt" ON "cell"."collections" USING btree ("tenant_id","receipt_id") WHERE "cell"."collections"."receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "collections_tenant_account_status" ON "cell"."collections" USING btree ("tenant_id","account_id","status");--> statement-breakpoint
CREATE INDEX "collections_tenant_user_day" ON "cell"."collections" USING btree ("tenant_id","user_id","collected_on");--> statement-breakpoint
CREATE INDEX "collections_tenant_status_day" ON "cell"."collections" USING btree ("tenant_id","status","collected_on");--> statement-breakpoint
CREATE INDEX "collections_tenant_row_version" ON "cell"."collections" USING btree ("tenant_id","row_version","id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."collection_counters" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."collections" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);