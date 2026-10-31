CREATE TABLE "cell"."approval_delegations" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "approval_delegations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."approval_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "on_behalf_of" uuid;--> statement-breakpoint
ALTER TABLE "cell"."approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_fk" FOREIGN KEY ("tenant_id","delegator_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_fk" FOREIGN KEY ("tenant_id","delegate_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegator" ON "cell"."approval_delegations" USING btree ("tenant_id","delegator_id","ends_on");--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate" ON "cell"."approval_delegations" USING btree ("tenant_id","delegate_id","ends_on");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."approval_delegations" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);