ALTER TABLE "cell"."import_jobs" ADD COLUMN "skipped_rows" integer;--> statement-breakpoint
ALTER TABLE "cell"."import_jobs" ADD COLUMN "planned_create" integer;--> statement-breakpoint
ALTER TABLE "cell"."import_jobs" ADD COLUMN "planned_update" integer;