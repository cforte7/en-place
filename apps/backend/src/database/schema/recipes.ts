import { sql } from "drizzle-orm";
import {
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    summary: text("summary"),
    servings: integer("servings").default(1).notNull(),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("recipes_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check("recipes_servings_positive", sql`${table.servings} > 0`),
    check(
      "recipes_prep_minutes_nonnegative",
      sql`${table.prepMinutes} is null or ${table.prepMinutes} >= 0`,
    ),
    check(
      "recipes_cook_minutes_nonnegative",
      sql`${table.cookMinutes} is null or ${table.cookMinutes} >= 0`,
    ),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 3 }),
    unit: text("unit"),
    name: text("name").notNull(),
    preparation: text("preparation"),
  },
  (table) => [
    uniqueIndex("recipe_ingredients_recipe_position_unique").on(
      table.recipeId,
      table.position,
    ),
    check("recipe_ingredients_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "recipe_ingredients_quantity_positive",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
    check(
      "recipe_ingredients_name_not_blank",
      sql`length(trim(${table.name})) > 0`,
    ),
  ],
);

export const recipeSteps = pgTable(
  "recipe_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    instruction: text("instruction").notNull(),
    durationMinutes: integer("duration_minutes"),
  },
  (table) => [
    uniqueIndex("recipe_steps_recipe_position_unique").on(
      table.recipeId,
      table.position,
    ),
    check("recipe_steps_position_nonnegative", sql`${table.position} >= 0`),
    check(
      "recipe_steps_duration_minutes_nonnegative",
      sql`${table.durationMinutes} is null or ${table.durationMinutes} >= 0`,
    ),
    check(
      "recipe_steps_instruction_not_blank",
      sql`length(trim(${table.instruction})) > 0`,
    ),
  ],
);

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredient = typeof recipeIngredients.$inferInsert;
export type RecipeStep = typeof recipeSteps.$inferSelect;
export type NewRecipeStep = typeof recipeSteps.$inferInsert;
