CREATE TABLE "cell"."schemes" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"kind" text NOT NULL,
	"rule" jsonb NOT NULL,
	"item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"category_ids" uuid[] DEFAULT '{}' NOT NULL,
	"account_type_keys" text[] DEFAULT '{}' NOT NULL,
	"territory_ids" uuid[] DEFAULT '{}' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	CONSTRAINT "schemes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD COLUMN "scheme" jsonb;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD COLUMN "scheme_discount" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."order_lines" ADD COLUMN "free_of_line_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "schemes_tenant_key" ON "cell"."schemes" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "schemes_tenant_row_version" ON "cell"."schemes" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."schemes" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);