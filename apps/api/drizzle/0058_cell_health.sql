CREATE TABLE "directory"."cell_health" (
	"cell_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"figures" jsonb NOT NULL,
	CONSTRAINT "cell_health_cell_id_at_pk" PRIMARY KEY("cell_id","at")
);
--> statement-breakpoint
ALTER TABLE "directory"."cell_health" ADD CONSTRAINT "cell_health_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "directory"."cells"("id") ON DELETE no action ON UPDATE no action;