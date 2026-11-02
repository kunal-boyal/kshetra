CREATE TABLE "cell"."erp_connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"accounts_server" text,
	"api_domain" text,
	"organization_id" text,
	"organization_name" text,
	"organizations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refresh_token_sealed" text,
	"settings" jsonb NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"calls_day" text,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "erp_connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."erp_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."erp_links" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"external_id" text NOT NULL,
	"local_key" text,
	"fingerprint" text,
	"external_modified" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erp_links_tenant_id_connection_id_entity_external_id_pk" PRIMARY KEY("tenant_id","connection_id","entity","external_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."erp_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."erp_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"stopped_by" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "erp_runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."erp_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."erp_links" ADD CONSTRAINT "erp_links_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "cell"."erp_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."erp_runs" ADD CONSTRAINT "erp_runs_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "cell"."erp_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erp_connections_tenant_provider" ON "cell"."erp_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_links_local_key" ON "cell"."erp_links" USING btree ("tenant_id","connection_id","entity","local_key") WHERE "cell"."erp_links"."local_key" is not null;--> statement-breakpoint
CREATE INDEX "erp_runs_connection_started" ON "cell"."erp_runs" USING btree ("tenant_id","connection_id","started_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."erp_connections" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."erp_links" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."erp_runs" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);