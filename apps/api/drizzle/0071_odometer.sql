ALTER TABLE "cell"."shifts" ADD COLUMN "start_odometer" numeric(12, 1);--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD COLUMN "start_odometer_media_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD COLUMN "end_odometer" numeric(12, 1);--> statement-breakpoint
ALTER TABLE "cell"."shifts" ADD COLUMN "end_odometer_media_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."expense_claims" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "cell"."expense_claims" ADD COLUMN "odometer_changed" boolean DEFAULT false NOT NULL;