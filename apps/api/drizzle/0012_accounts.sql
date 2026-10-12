CREATE TYPE "cell"."account_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "cell"."location_status" AS ENUM('unverified', 'verified');--> statement-breakpoint
CREATE TYPE "cell"."proposal_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "cell"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "cell"."request_type" AS ENUM('leave', 'regularisation', 'expense', 'order', 'new_account', 'account_location_change', 'journey_plan', 'target_lock');--> statement-breakpoint
CREATE TYPE "cell"."step_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TABLE "cell"."account_location_proposals" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"point" geography(Point, 4326) NOT NULL,
	"accuracy" double precision NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"workflow_instance_id" uuid,
	"status" "cell"."proposal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "account_location_proposals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."account_location_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."account_slots" (
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "account_slots_tenant_id_account_id_slot_key_valid_from_pk" PRIMARY KEY("tenant_id","account_id","slot_key","valid_from"),
	CONSTRAINT "account_slots_valid_range" CHECK ("cell"."account_slots"."valid_to" is null or "cell"."account_slots"."valid_to" > "cell"."account_slots"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "cell"."account_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."account_type_versions" (
	"tenant_id" uuid NOT NULL,
	"account_type_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "account_type_versions_tenant_id_account_type_id_version_pk" PRIMARY KEY("tenant_id","account_type_id","version")
);
--> statement-breakpoint
ALTER TABLE "cell"."account_type_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."account_types" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "account_types_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."account_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."accounts" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"territory_id" uuid NOT NULL,
	"parent_account_id" uuid,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"location" geography(Point, 4326),
	"geofence_radius_m" integer,
	"location_status" "cell"."location_status" DEFAULT 'unverified' NOT NULL,
	"status" "cell"."account_status" NOT NULL,
	"segments" text[] DEFAULT '{}'::text[] NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "accounts_geofence_range" CHECK ("cell"."accounts"."geofence_radius_m" is null or "cell"."accounts"."geofence_radius_m" between 50 and 5000)
);
--> statement-breakpoint
ALTER TABLE "cell"."accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."contacts" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" bigint DEFAULT (pg_current_xact_id()::text)::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "contacts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."workflow_instances" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid,
	"request_type" "cell"."request_type" NOT NULL,
	"request_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" "cell"."approval_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "workflow_instances_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."workflow_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."workflow_steps" (
	"tenant_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"approver_ids" uuid[] NOT NULL,
	"status" "cell"."step_status" NOT NULL,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"note" text,
	"due_at" timestamp with time zone,
	CONSTRAINT "workflow_steps_tenant_id_instance_id_step_index_pk" PRIMARY KEY("tenant_id","instance_id","step_index")
);
--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."account_location_proposals" ADD CONSTRAINT "account_location_proposals_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."account_location_proposals" ADD CONSTRAINT "account_location_proposals_user_fk" FOREIGN KEY ("tenant_id","proposed_by") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."account_location_proposals" ADD CONSTRAINT "account_location_proposals_instance_fk" FOREIGN KEY ("tenant_id","workflow_instance_id") REFERENCES "cell"."workflow_instances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."account_slots" ADD CONSTRAINT "account_slots_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."account_slots" ADD CONSTRAINT "account_slots_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."account_type_versions" ADD CONSTRAINT "account_type_versions_type_fk" FOREIGN KEY ("tenant_id","account_type_id") REFERENCES "cell"."account_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."accounts" ADD CONSTRAINT "accounts_type_fk" FOREIGN KEY ("tenant_id","type_id") REFERENCES "cell"."account_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."accounts" ADD CONSTRAINT "accounts_territory_fk" FOREIGN KEY ("tenant_id","territory_id") REFERENCES "cell"."territories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("tenant_id","parent_account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."contacts" ADD CONSTRAINT "contacts_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "cell"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."workflow_instances" ADD CONSTRAINT "workflow_instances_requester_fk" FOREIGN KEY ("tenant_id","requester_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."workflow_steps" ADD CONSTRAINT "workflow_steps_instance_fk" FOREIGN KEY ("tenant_id","instance_id") REFERENCES "cell"."workflow_instances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_location_proposals_account" ON "cell"."account_location_proposals" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "account_slots_user" ON "cell"."account_slots" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_types_tenant_key" ON "cell"."account_types" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_code" ON "cell"."accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "accounts_tenant_territory" ON "cell"."accounts" USING btree ("tenant_id","territory_id");--> statement-breakpoint
CREATE INDEX "accounts_tenant_type_name" ON "cell"."accounts" USING btree ("tenant_id","type_id","name");--> statement-breakpoint
CREATE INDEX "accounts_tenant_row_version" ON "cell"."accounts" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE INDEX "accounts_location" ON "cell"."accounts" USING gist ("location");--> statement-breakpoint
CREATE INDEX "accounts_name_trgm" ON "cell"."accounts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_tenant_account" ON "cell"."contacts" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "contacts_tenant_row_version" ON "cell"."contacts" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE INDEX "workflow_instances_request" ON "cell"."workflow_instances" USING btree ("tenant_id","request_type","request_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_requester" ON "cell"."workflow_instances" USING btree ("tenant_id","requester_id");--> statement-breakpoint
CREATE INDEX "workflow_steps_approvers" ON "cell"."workflow_steps" USING gin ("approver_ids");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."account_location_proposals" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."account_slots" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."account_type_versions" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."account_types" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."accounts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."contacts" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."workflow_instances" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."workflow_steps" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);