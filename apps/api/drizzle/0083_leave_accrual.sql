CREATE TABLE "cell"."leave_year_closings" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_key" text NOT NULL,
	"year_from" date NOT NULL,
	"year_to" date NOT NULL,
	"credited" numeric(6, 1) NOT NULL,
	"carried_in" numeric(6, 1) NOT NULL,
	"taken" numeric(6, 1) NOT NULL,
	"carried_out" numeric(6, 1) NOT NULL,
	"lapsed" numeric(6, 1) NOT NULL,
	"cap" numeric(5, 1) NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_year_closings_tenant_id_user_id_leave_type_key_year_from_pk" PRIMARY KEY("tenant_id","user_id","leave_type_key","year_from"),
	CONSTRAINT "leave_year_closings_range" CHECK ("cell"."leave_year_closings"."year_to" >= "cell"."leave_year_closings"."year_from")
);
--> statement-breakpoint
ALTER TABLE "cell"."leave_year_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."leave_types" ADD COLUMN "accrual" text DEFAULT 'yearly' NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."leave_types" ADD COLUMN "carry_forward_max" numeric(5, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cell"."leave_year_closings" ADD CONSTRAINT "leave_year_closings_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."leave_year_closings" ADD CONSTRAINT "leave_year_closings_type_fk" FOREIGN KEY ("tenant_id","leave_type_key") REFERENCES "cell"."leave_types"("tenant_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."leave_types" ADD CONSTRAINT "leave_types_accrual" CHECK ("cell"."leave_types"."accrual" in ('yearly', 'monthly'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."leave_year_closings" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);