CREATE TABLE "food_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipe_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_states_name_not_blank" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_inputs" (
	"recipe_id" uuid NOT NULL,
	"operation_id" uuid,
	"food_state_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"quantity" numeric,
	"unit" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "operation_inputs_primary_key" PRIMARY KEY("operation_id","food_state_id"),
	CONSTRAINT "operation_inputs_quantity_positive" CHECK ("quantity" is null or "quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_outputs" (
	"recipe_id" uuid NOT NULL,
	"operation_id" uuid,
	"food_state_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"quantity" numeric,
	"unit" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "operation_outputs_primary_key" PRIMARY KEY("operation_id","food_state_id"),
	CONSTRAINT "operation_outputs_quantity_positive" CHECK ("quantity" is null or "quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipe_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"instructions" text,
	"estimated_duration_seconds" integer,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_type_not_blank" CHECK (length(trim("type")) > 0),
	CONSTRAINT "operations_estimated_duration_nonnegative" CHECK ("estimated_duration_seconds" is null or "estimated_duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_name_not_blank" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "food_states_recipe_id_id_unique" ON "food_states" ("recipe_id","id");--> statement-breakpoint
CREATE INDEX "food_states_recipe_id_index" ON "food_states" ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_inputs_operation_id_position_unique" ON "operation_inputs" ("operation_id","position");--> statement-breakpoint
CREATE INDEX "operation_inputs_food_state_index" ON "operation_inputs" ("recipe_id","food_state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_outputs_operation_id_position_unique" ON "operation_outputs" ("operation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_outputs_recipe_food_state_unique" ON "operation_outputs" ("recipe_id","food_state_id");--> statement-breakpoint
CREATE INDEX "operation_outputs_operation_index" ON "operation_outputs" ("recipe_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_recipe_id_id_unique" ON "operations" ("recipe_id","id");--> statement-breakpoint
CREATE INDEX "operations_recipe_id_index" ON "operations" ("recipe_id");--> statement-breakpoint
ALTER TABLE "food_states" ADD CONSTRAINT "food_states_recipe_id_recipes_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operation_inputs" ADD CONSTRAINT "operation_inputs_recipe_operation_foreign_key" FOREIGN KEY ("recipe_id","operation_id") REFERENCES "operations"("recipe_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operation_inputs" ADD CONSTRAINT "operation_inputs_recipe_food_state_foreign_key" FOREIGN KEY ("recipe_id","food_state_id") REFERENCES "food_states"("recipe_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operation_outputs" ADD CONSTRAINT "operation_outputs_recipe_operation_foreign_key" FOREIGN KEY ("recipe_id","operation_id") REFERENCES "operations"("recipe_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operation_outputs" ADD CONSTRAINT "operation_outputs_recipe_food_state_foreign_key" FOREIGN KEY ("recipe_id","food_state_id") REFERENCES "food_states"("recipe_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_recipe_id_recipes_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE;