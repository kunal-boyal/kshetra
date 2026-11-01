CREATE TABLE "cell"."dashboard_layouts" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"cards" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "dashboard_layouts_tenant_id_role_id_pk" PRIMARY KEY("tenant_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."dashboard_layouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "cell"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."dashboard_layouts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);