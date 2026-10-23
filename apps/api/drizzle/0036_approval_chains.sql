CREATE TYPE "cell"."skip_reason" AS ENUM('condition', 'no_approver', 'requester', 'repeated');--> statement-breakpoint
CREATE TABLE "cell"."workflow_definitions" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_type" "cell"."request_type" NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "workflow_definitions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."workflow_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."workflow_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"fallback_role" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "cell"."workflow_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."held_configuration" ALTER COLUMN "workflows" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "skip_reason" "cell"."skip_reason";--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "escalated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "remind_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "escalate_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "escalate_to" text;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD COLUMN "line_decisions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_version" ON "cell"."workflow_definitions" USING btree ("tenant_id","request_type","version");--> statement-breakpoint
ALTER TABLE "cell"."workflow_instances" ADD CONSTRAINT "workflow_instances_definition_fk" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "cell"."workflow_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."workflow_definitions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."workflow_settings" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);