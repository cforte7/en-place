import type { RecipeDocument } from "@en-place/contracts";

import { and, asc, desc, eq } from "drizzle-orm";

import { database, type Database } from "../../database";
import {
  foodStates,
  operationInputs,
  operationOutputs,
  operations,
  recipes,
  type Recipe,
  type FoodState,
  type NewFoodState,
  type NewOperation,
  type Operation,
  type OperationInput,
  type OperationOutput,
} from "../../database/schema";
import type { UserId } from "../users/user-id";
import type { RecipeGraph } from "./recipe-graph";

export type RecipeGraphTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type CreateFoodStateValues = Pick<NewFoodState, "name"> &
  Partial<
    Pick<NewFoodState, "description" | "metadata" | "positionX" | "positionY">
  >;
export type UpdateFoodStateValues = Partial<
  Pick<
    NewFoodState,
    "name" | "description" | "metadata" | "positionX" | "positionY"
  >
>;
export type CreateOperationValues = Pick<NewOperation, "type"> &
  Partial<
    Pick<
      NewOperation,
      | "name"
      | "instructions"
      | "estimatedDurationSeconds"
      | "config"
      | "positionX"
      | "positionY"
    >
  >;
export type UpdateOperationValues = Partial<
  Pick<
    NewOperation,
    | "type"
    | "name"
    | "instructions"
    | "estimatedDurationSeconds"
    | "config"
    | "positionX"
    | "positionY"
  >
>;

export type OperationConnectionValues = {
  foodStateId: string;
  position?: number;
  quantity?: string | null;
  unit?: string | null;
  metadata?: Record<string, unknown>;
};

export async function loadRecipeGraph(
  recipeId: string,
): Promise<RecipeGraph | null> {
  return database.transaction((transaction) =>
    new RecipeGraphRepository(transaction).loadRecipeGraph(recipeId),
  );
}

export async function loadOwnedRecipeGraph(
  ownerId: UserId,
  recipeId: string,
): Promise<RecipeGraph | null> {
  return database.transaction((transaction) =>
    new RecipeGraphRepository(transaction).loadRecipeGraph(recipeId, ownerId),
  );
}

export class RecipeGraphRepository {
  constructor(private readonly transaction: RecipeGraphTransaction) {}

  listOwnedRecipes(ownerId: UserId): Promise<Recipe[]> {
    return this.transaction
      .select()
      .from(recipes)
      .where(eq(recipes.ownerId, ownerId))
      .orderBy(
        desc(recipes.updatedAt),
        desc(recipes.createdAt),
        asc(recipes.id),
      );
  }

  async loadRecipeGraph(
    recipeId: string,
    ownerId?: UserId,
  ): Promise<RecipeGraph | null> {
    const [recipe] = await this.transaction
      .select()
      .from(recipes)
      .where(
        ownerId
          ? and(eq(recipes.id, recipeId), eq(recipes.ownerId, ownerId))
          : eq(recipes.id, recipeId),
      )
      .limit(1);

    if (!recipe) {
      return null;
    }

    const loadedFoodStates = await this.transaction
      .select()
      .from(foodStates)
      .where(eq(foodStates.recipeId, recipeId))
      .orderBy(asc(foodStates.createdAt), asc(foodStates.id));
    const loadedOperations = await this.transaction
      .select()
      .from(operations)
      .where(eq(operations.recipeId, recipeId))
      .orderBy(asc(operations.createdAt), asc(operations.id));
    const inputs = await this.transaction
      .select()
      .from(operationInputs)
      .where(eq(operationInputs.recipeId, recipeId))
      .orderBy(asc(operationInputs.operationId), asc(operationInputs.position));
    const outputs = await this.transaction
      .select()
      .from(operationOutputs)
      .where(eq(operationOutputs.recipeId, recipeId))
      .orderBy(
        asc(operationOutputs.operationId),
        asc(operationOutputs.position),
      );

    return {
      recipe,
      foodStates: loadedFoodStates,
      operations: loadedOperations,
      inputs,
      outputs,
    };
  }

  async createRecipe(ownerId: UserId, name: string): Promise<Recipe> {
    const [recipe] = await this.transaction
      .insert(recipes)
      .values({ ownerId, name })
      .returning();
    return requireRow(recipe, "Failed to create recipe");
  }

  async updateOwnedRecipe(
    ownerId: UserId,
    recipeId: string,
    name: string,
  ): Promise<Recipe | null> {
    const [recipe] = await this.transaction
      .update(recipes)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(recipes.id, recipeId), eq(recipes.ownerId, ownerId)))
      .returning();
    return recipe ?? null;
  }

  async replaceRecipeGraphRows(
    recipeId: string,
    document: RecipeDocument,
  ): Promise<void> {
    await this.transaction
      .delete(operations)
      .where(eq(operations.recipeId, recipeId));
    await this.transaction
      .delete(foodStates)
      .where(eq(foodStates.recipeId, recipeId));

    if (document.foodStates.length > 0) {
      await this.transaction.insert(foodStates).values(
        document.foodStates.map((foodState) => ({
          id: foodState.id,
          recipeId,
          name: foodState.name,
          positionX: foodState.position.x,
          positionY: foodState.position.y,
        })),
      );
    }

    if (document.operations.length === 0) {
      return;
    }

    await this.transaction.insert(operations).values(
      document.operations.map((operation) => ({
        id: operation.id,
        recipeId,
        type: operation.type,
        positionX: operation.position.x,
        positionY: operation.position.y,
      })),
    );

    const inputRows = document.operations.flatMap((operation) =>
      operation.inputs.map(({ foodStateId }, position) => ({
        recipeId,
        operationId: operation.id,
        foodStateId,
        position,
      })),
    );
    if (inputRows.length > 0) {
      await this.transaction.insert(operationInputs).values(inputRows);
    }

    const outputRows = document.operations.flatMap((operation) =>
      operation.outputs.map(({ foodStateId }, position) => ({
        recipeId,
        operationId: operation.id,
        foodStateId,
        position,
      })),
    );
    if (outputRows.length > 0) {
      await this.transaction.insert(operationOutputs).values(outputRows);
    }
  }

  async createFoodState(
    recipeId: string,
    values: CreateFoodStateValues,
  ): Promise<FoodState> {
    const [foodState] = await this.transaction
      .insert(foodStates)
      .values({ recipeId, ...values })
      .returning();
    return requireRow(foodState, "Failed to create food state");
  }

  async updateFoodState(
    recipeId: string,
    foodStateId: string,
    values: UpdateFoodStateValues,
  ): Promise<FoodState | null> {
    const [foodState] = await this.transaction
      .update(foodStates)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(eq(foodStates.recipeId, recipeId), eq(foodStates.id, foodStateId)),
      )
      .returning();
    return foodState ?? null;
  }

  async deleteFoodState(
    recipeId: string,
    foodStateId: string,
  ): Promise<FoodState | null> {
    const [foodState] = await this.transaction
      .delete(foodStates)
      .where(
        and(eq(foodStates.recipeId, recipeId), eq(foodStates.id, foodStateId)),
      )
      .returning();
    return foodState ?? null;
  }

  async createOperation(
    recipeId: string,
    values: CreateOperationValues,
  ): Promise<Operation> {
    const [operation] = await this.transaction
      .insert(operations)
      .values({ recipeId, ...values })
      .returning();
    return requireRow(operation, "Failed to create operation");
  }

  async updateOperation(
    recipeId: string,
    operationId: string,
    values: UpdateOperationValues,
  ): Promise<Operation | null> {
    const [operation] = await this.transaction
      .update(operations)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(eq(operations.recipeId, recipeId), eq(operations.id, operationId)),
      )
      .returning();
    return operation ?? null;
  }

  async deleteOperation(
    recipeId: string,
    operationId: string,
  ): Promise<Operation | null> {
    const [operation] = await this.transaction
      .delete(operations)
      .where(
        and(eq(operations.recipeId, recipeId), eq(operations.id, operationId)),
      )
      .returning();
    return operation ?? null;
  }

  async setOperationInputs(
    recipeId: string,
    operationId: string,
    connections: OperationConnectionValues[],
  ): Promise<OperationInput[]> {
    await this.transaction
      .delete(operationInputs)
      .where(
        and(
          eq(operationInputs.recipeId, recipeId),
          eq(operationInputs.operationId, operationId),
        ),
      );

    return this.transaction
      .insert(operationInputs)
      .values(toConnectionRows(recipeId, operationId, connections))
      .returning();
  }

  async setOperationOutputs(
    recipeId: string,
    operationId: string,
    connections: OperationConnectionValues[],
  ): Promise<OperationOutput[]> {
    await this.transaction
      .delete(operationOutputs)
      .where(
        and(
          eq(operationOutputs.recipeId, recipeId),
          eq(operationOutputs.operationId, operationId),
        ),
      );

    return this.transaction
      .insert(operationOutputs)
      .values(toConnectionRows(recipeId, operationId, connections))
      .returning();
  }

  async addOperationInput(
    recipeId: string,
    operationId: string,
    connection: OperationConnectionValues,
  ): Promise<OperationInput> {
    const position =
      connection.position ??
      (await this.nextConnectionPosition("input", recipeId, operationId));
    const [input] = await this.transaction
      .insert(operationInputs)
      .values(toConnectionRow(recipeId, operationId, connection, position))
      .returning();
    return requireRow(input, "Failed to add operation input");
  }

  async removeOperationInput(
    recipeId: string,
    operationId: string,
    foodStateId: string,
  ): Promise<OperationInput | null> {
    const [input] = await this.transaction
      .delete(operationInputs)
      .where(
        and(
          eq(operationInputs.recipeId, recipeId),
          eq(operationInputs.operationId, operationId),
          eq(operationInputs.foodStateId, foodStateId),
        ),
      )
      .returning();
    return input ?? null;
  }

  async addOperationOutput(
    recipeId: string,
    operationId: string,
    connection: OperationConnectionValues,
  ): Promise<OperationOutput> {
    const position =
      connection.position ??
      (await this.nextConnectionPosition("output", recipeId, operationId));
    const [output] = await this.transaction
      .insert(operationOutputs)
      .values(toConnectionRow(recipeId, operationId, connection, position))
      .returning();
    return requireRow(output, "Failed to add operation output");
  }

  async removeOperationOutput(
    recipeId: string,
    operationId: string,
    foodStateId: string,
  ): Promise<OperationOutput | null> {
    const [output] = await this.transaction
      .delete(operationOutputs)
      .where(
        and(
          eq(operationOutputs.recipeId, recipeId),
          eq(operationOutputs.operationId, operationId),
          eq(operationOutputs.foodStateId, foodStateId),
        ),
      )
      .returning();
    return output ?? null;
  }

  private async nextConnectionPosition(
    connection: "input" | "output",
    recipeId: string,
    operationId: string,
  ): Promise<number> {
    const table = connection === "input" ? operationInputs : operationOutputs;
    const rows = await this.transaction
      .select({ position: table.position })
      .from(table)
      .where(
        and(eq(table.recipeId, recipeId), eq(table.operationId, operationId)),
      );
    return (
      rows.reduce((maximum, row) => Math.max(maximum, row.position), -1) + 1
    );
  }
}

function toConnectionRows(
  recipeId: string,
  operationId: string,
  connections: OperationConnectionValues[],
) {
  return connections.map((connection, index) =>
    toConnectionRow(
      recipeId,
      operationId,
      connection,
      connection.position ?? index,
    ),
  );
}

function toConnectionRow(
  recipeId: string,
  operationId: string,
  connection: OperationConnectionValues,
  position: number,
) {
  return {
    ...connection,
    recipeId,
    operationId,
    position,
  };
}

function requireRow<Row>(row: Row | undefined, message: string): Row {
  if (!row) {
    throw new Error(message);
  }
  return row;
}
