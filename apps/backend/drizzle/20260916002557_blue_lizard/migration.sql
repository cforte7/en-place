ALTER TABLE "food_states" ADD COLUMN "position_x" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "food_states" ADD COLUMN "position_y" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "position_x" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "position_y" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "recipes_owner_id_index" ON "recipes" ("owner_id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;