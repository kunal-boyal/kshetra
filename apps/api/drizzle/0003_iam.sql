CREATE TYPE "cell"."data_scope" AS ENUM('self', 'team', 'territory', 'team_or_territory', 'tenant');--> statement-breakpoint
CREATE TYPE "cell"."device_platform" AS ENUM('android', 'ios', 'web');--> statement-breakpoint
CREATE TYPE "cell"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE SEQUENCE "cell"."row_version" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cell"."designations" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"level" integer NOT NULL,
	"default_role_id" uuid NOT NULL,
	"can_have_reports" boolean NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "designations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "designations_level_range" CHECK ("cell"."designations"."level" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "cell"."designations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."devices" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_key_hash" text NOT NULL,
	"platform" "cell"."device_platform" NOT NULL,
	"model" text,
	"os_version" text,
	"app_version" text,
	"push_token" text,
	"integrity_verdict" text,
	"health" jsonb,
	"bound_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."reporting_closure" (
	"tenant_id" uuid NOT NULL,
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	CONSTRAINT "reporting_closure_tenant_id_ancestor_id_descendant_id_pk" PRIMARY KEY("tenant_id","ancestor_id","descendant_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."reporting_closure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."roles" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"permissions" text[] NOT NULL,
	"scope" "cell"."data_scope" NOT NULL,
	"mobile_only" boolean DEFAULT false NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "roles_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."users" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"designation_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"manager_id" uuid,
	"joining_date" date,
	"exit_date" date,
	"status" "cell"."user_status" DEFAULT 'active' NOT NULL,
	"auth_revision" integer DEFAULT 0 NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" bigint DEFAULT nextval('cell.row_version') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "users_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "users_not_own_manager" CHECK ("cell"."users"."manager_id" <> "cell"."users"."id"),
	CONSTRAINT "users_exit_after_joining" CHECK ("cell"."users"."exit_date" is null or "cell"."users"."joining_date" is null or "cell"."users"."exit_date" >= "cell"."users"."joining_date")
);
--> statement-breakpoint
ALTER TABLE "cell"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."territories" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" bigint DEFAULT nextval('cell.row_version') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "territories_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."territories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."territory_closure" (
	"tenant_id" uuid NOT NULL,
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	CONSTRAINT "territory_closure_tenant_id_ancestor_id_descendant_id_pk" PRIMARY KEY("tenant_id","ancestor_id","descendant_id")
);
--> statement-breakpoint
ALTER TABLE "cell"."territory_closure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."territory_levels" (
	"tenant_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	CONSTRAINT "territory_levels_tenant_id_level_pk" PRIMARY KEY("tenant_id","level"),
	CONSTRAINT "territory_levels_level_range" CHECK ("cell"."territory_levels"."level" between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "cell"."territory_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."user_territories" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "user_territories_tenant_id_user_id_territory_id_valid_from_pk" PRIMARY KEY("tenant_id","user_id","territory_id","valid_from"),
	CONSTRAINT "user_territories_valid_range" CHECK ("cell"."user_territories"."valid_to" is null or "cell"."user_territories"."valid_to" > "cell"."user_territories"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "cell"."user_territories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "directory"."memberships" DROP CONSTRAINT "memberships_identity_tenant_key";--> statement-breakpoint
ALTER TABLE "cell"."designations" ADD CONSTRAINT "designations_default_role_fk" FOREIGN KEY ("tenant_id","default_role_id") REFERENCES "cell"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."devices" ADD CONSTRAINT "devices_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."reporting_closure" ADD CONSTRAINT "reporting_closure_ancestor_fk" FOREIGN KEY ("tenant_id","ancestor_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."reporting_closure" ADD CONSTRAINT "reporting_closure_descendant_fk" FOREIGN KEY ("tenant_id","descendant_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."users" ADD CONSTRAINT "users_designation_fk" FOREIGN KEY ("tenant_id","designation_id") REFERENCES "cell"."designations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."users" ADD CONSTRAINT "users_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "cell"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."users" ADD CONSTRAINT "users_manager_fk" FOREIGN KEY ("tenant_id","manager_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."territories" ADD CONSTRAINT "territories_level_fk" FOREIGN KEY ("tenant_id","level") REFERENCES "cell"."territory_levels"("tenant_id","level") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."territories" ADD CONSTRAINT "territories_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "cell"."territories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."territories" ADD CONSTRAINT "territories_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."territory_closure" ADD CONSTRAINT "territory_closure_ancestor_fk" FOREIGN KEY ("tenant_id","ancestor_id") REFERENCES "cell"."territories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."territory_closure" ADD CONSTRAINT "territory_closure_descendant_fk" FOREIGN KEY ("tenant_id","descendant_id") REFERENCES "cell"."territories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."user_territories" ADD CONSTRAINT "user_territories_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."user_territories" ADD CONSTRAINT "user_territories_territory_fk" FOREIGN KEY ("tenant_id","territory_id") REFERENCES "cell"."territories"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "designations_tenant_key" ON "cell"."designations" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_tenant_user_key" ON "cell"."devices" USING btree ("tenant_id","user_id","device_key_hash");--> statement-breakpoint
CREATE INDEX "reporting_closure_descendant" ON "cell"."reporting_closure" USING btree ("tenant_id","descendant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key" ON "cell"."roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_code" ON "cell"."users" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_phone" ON "cell"."users" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE INDEX "users_tenant_manager" ON "cell"."users" USING btree ("tenant_id","manager_id");--> statement-breakpoint
CREATE INDEX "users_tenant_row_version" ON "cell"."users" USING btree ("tenant_id","row_version");--> statement-breakpoint
CREATE UNIQUE INDEX "territories_tenant_code" ON "cell"."territories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "territories_tenant_parent" ON "cell"."territories" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "territory_closure_descendant" ON "cell"."territory_closure" USING btree ("tenant_id","descendant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_levels_tenant_key" ON "cell"."territory_levels" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "user_territories_territory" ON "cell"."user_territories" USING btree ("tenant_id","territory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_key" ON "directory"."memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_active_identity_tenant_key" ON "directory"."memberships" USING btree ("identity_id","tenant_id") WHERE "directory"."memberships"."status" = 'active';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."designations" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."devices" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."reporting_closure" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."roles" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."users" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."territories" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."territory_closure" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."territory_levels" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."user_territories" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);