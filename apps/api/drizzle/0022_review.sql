CREATE TYPE "cell"."review_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TABLE "cell"."submission_reviews" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision" "cell"."review_decision" NOT NULL,
	"note" text,
	"reviewer_id" uuid,
	"auto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reviews_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "cell"."submission_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cell"."review_rules" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "cell"."review_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell"."submissions" ADD COLUMN "auto_approve_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cell"."submission_reviews" ADD CONSTRAINT "submission_reviews_submission_fk" FOREIGN KEY ("tenant_id","submission_id") REFERENCES "cell"."submissions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell"."submission_reviews" ADD CONSTRAINT "submission_reviews_reviewer_fk" FOREIGN KEY ("tenant_id","reviewer_id") REFERENCES "cell"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_reviews_tenant_submission" ON "cell"."submission_reviews" USING btree ("tenant_id","submission_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_reviews_tenant_reviewer" ON "cell"."submission_reviews" USING btree ("tenant_id","reviewer_id","created_at") WHERE "cell"."submission_reviews"."reviewer_id" is not null;--> statement-breakpoint
CREATE INDEX "submissions_tenant_auto_approve" ON "cell"."submissions" USING btree ("tenant_id","auto_approve_at") WHERE "cell"."submissions"."status" = 'pending' and "cell"."submissions"."auto_approve_at" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."submission_reviews" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cell"."review_rules" AS PERMISSIVE FOR ALL TO "cell_app" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);