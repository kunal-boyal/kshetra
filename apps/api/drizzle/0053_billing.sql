CREATE TYPE "directory"."billing_cycle" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "directory"."invoice_kind" AS ENUM('monthly', 'annual', 'true_up');--> statement-breakpoint
CREATE TYPE "directory"."invoice_status" AS ENUM('issued', 'paid');--> statement-breakpoint
CREATE TYPE "directory"."mandate_status" AS ENUM('none', 'pending', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "directory"."payment_method" AS ENUM('mandate', 'bank_transfer', 'cheque', 'upi', 'other');--> statement-breakpoint
CREATE TYPE "directory"."subscription_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "directory"."billing_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"address" text NOT NULL,
	"state_code" text NOT NULL,
	"email" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"mandate_status" "directory"."mandate_status" DEFAULT 'none' NOT NULL,
	"mandate_ref" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory"."billing_notices" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_notices_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "directory"."invoice_sequences" (
	"series" text PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "directory"."invoice_kind" NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"gst_rate" numeric(7, 4) NOT NULL,
	"cgst" numeric(18, 2) NOT NULL,
	"sgst" numeric(18, 2) NOT NULL,
	"igst" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"status" "directory"."invoice_status" DEFAULT 'issued' NOT NULL,
	"example" boolean DEFAULT false NOT NULL,
	"charge_failed_at" timestamp with time zone,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "directory"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"method" "directory"."payment_method" NOT NULL,
	"reference" text,
	"received_on" date NOT NULL,
	"provider_ref" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "directory"."platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "directory"."subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"cycle" "directory"."billing_cycle" NOT NULL,
	"committed_seats" integer,
	"status" "directory"."subscription_status" DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"term_start" date,
	"term_end" date,
	"ends_on" date,
	"dunning_stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."billing_accounts" ADD CONSTRAINT "billing_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."billing_notices" ADD CONSTRAINT "billing_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "directory"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "directory"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "directory"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_once" ON "directory"."invoices" USING btree ("subscription_id","kind","period_from");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "directory"."invoices" USING btree ("tenant_id","issued_on");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "directory"."invoices" USING btree ("status","issued_on");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "directory"."payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_active" ON "directory"."subscriptions" USING btree ("tenant_id") WHERE "directory"."subscriptions"."status" = 'active';