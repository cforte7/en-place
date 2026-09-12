import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("recipes_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const foodStates = pgTable(
  "food_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("food_states_recipe_id_id_unique").on(table.recipeId, table.id),
    index("food_states_recipe_id_index").on(table.recipeId),
    check("food_states_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    name: text("name"),
    instructions: text("instructions"),
    estimatedDurationSeconds: integer("estimated_duration_seconds"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("operations_recipe_id_id_unique").on(table.recipeId, table.id),
    index("operations_recipe_id_index").on(table.recipeId),
    check("operations_type_not_blank", sql`length(trim(${table.type})) > 0`),
    check(
      "operations_estimated_duration_nonnegative",
      sql`${table.estimatedDurationSeconds} is null or ${table.estimatedDurationSeconds} >= 0`,
    ),
  ],
);

export const operationInputs = pgTable(
  "operation_inputs",
  {
    recipeId: uuid("recipe_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    foodStateId: uuid("food_state_id").notNull(),
    position: integer("position").default(0).notNull(),
    quantity: numeric("quantity"),
    unit: text("unit"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "operation_inputs_primary_key",
      columns: [table.operationId, table.foodStateId],
    }),
    uniqueIndex("operation_inputs_operation_id_position_unique").on(
      table.operationId,
      table.position,
    ),
    foreignKey({
      name: "operation_inputs_recipe_operation_foreign_key",
      columns: [table.recipeId, table.operationId],
      foreignColumns: [operations.recipeId, operations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "operation_inputs_recipe_food_state_foreign_key",
      columns: [table.recipeId, table.foodStateId],
      foreignColumns: [foodStates.recipeId, foodStates.id],
    }).onDelete("cascade"),
    index("operation_inputs_food_state_index").on(table.recipeId, table.foodStateId),
    check(
      "operation_inputs_quantity_positive",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
  ],
);

export const operationOutputs = pgTable(
  "operation_outputs",
  {
    recipeId: uuid("recipe_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    foodStateId: uuid("food_state_id").notNull(),
    position: integer("position").default(0).notNull(),
    quantity: numeric("quantity"),
    unit: text("unit"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "operation_outputs_primary_key",
      columns: [table.operationId, table.foodStateId],
    }),
    uniqueIndex("operation_outputs_operation_id_position_unique").on(
      table.operationId,
      table.position,
    ),
    foreignKey({
      name: "operation_outputs_recipe_operation_foreign_key",
      columns: [table.recipeId, table.operationId],
      foreignColumns: [operations.recipeId, operations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "operation_outputs_recipe_food_state_foreign_key",
      columns: [table.recipeId, table.foodStateId],
      foreignColumns: [foodStates.recipeId, foodStates.id],
    }).onDelete("cascade"),
    uniqueIndex("operation_outputs_recipe_food_state_unique").on(
      table.recipeId,
      table.foodStateId,
    ),
    index("operation_outputs_operation_index").on(table.recipeId, table.operationId),
    check(
      "operation_outputs_quantity_positive",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
  ],
);


export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type FoodState = typeof foodStates.$inferSelect;
export type NewFoodState = typeof foodStates.$inferInsert;
export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type OperationInput = typeof operationInputs.$inferSelect;
export type NewOperationInput = typeof operationInputs.$inferInsert;
export type OperationOutput = typeof operationOutputs.$inferSelect;
export type NewOperationOutput = typeof operationOutputs.$inferInsert;
