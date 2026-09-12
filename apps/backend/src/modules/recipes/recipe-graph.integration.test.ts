import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { database } from "../../database";
import { recipes, type Recipe } from "../../database/schema";
import {
  RecipeGraphValidationError,
  recipeGraphService,
} from "./recipe-graph-service";

const createdRecipeIds: string[] = [];

afterEach(async () => {
  for (const recipeId of createdRecipeIds.splice(0)) {
    await database.delete(recipes).where(eq(recipes.id, recipeId));
  }
});

describe.serial("RecipeGraphService", () => {
  test("creates and loads an operation atomically", async () => {
    const recipe = await createRecipe("Atomic operation");
    const input = await recipeGraphService.createFoodState(recipe.id, { name: "raw" });
    const output = await recipeGraphService.createFoodState(recipe.id, { name: "cooked" });

    const operation = await recipeGraphService.createOperation(recipe.id, {
      type: "cook",
      instructions: "Cook it.",
      inputs: [{ foodStateId: input.id, quantity: "2", unit: "lb" }],
      outputs: [{ foodStateId: output.id }],
    });

    const graph = await recipeGraphService.load(recipe.id);
    expect(graph?.operations).toEqual([operation]);
    expect(graph?.inputs).toMatchObject([
      {
        recipeId: recipe.id,
        operationId: operation.id,
        foodStateId: input.id,
        position: 0,
        quantity: "2",
        unit: "lb",
      },
    ]);
    expect(graph?.outputs).toMatchObject([
      {
        recipeId: recipe.id,
        operationId: operation.id,
        foodStateId: output.id,
        position: 0,
      },
    ]);
  });

  test("rolls back a mutation that would create a cycle", async () => {
    const recipe = await createRecipe("Cycle rollback");
    const a = await recipeGraphService.createFoodState(recipe.id, { name: "A" });
    const b = await recipeGraphService.createFoodState(recipe.id, { name: "B" });
    const c = await recipeGraphService.createFoodState(recipe.id, { name: "C" });
    await recipeGraphService.createOperation(recipe.id, {
      type: "first",
      inputs: [{ foodStateId: a.id }],
      outputs: [{ foodStateId: b.id }],
    });
    await recipeGraphService.createOperation(recipe.id, {
      type: "second",
      inputs: [{ foodStateId: b.id }],
      outputs: [{ foodStateId: c.id }],
    });

    await expect(
      recipeGraphService.createOperation(recipe.id, {
        type: "cycle",
        inputs: [{ foodStateId: c.id }],
        outputs: [{ foodStateId: a.id }],
      }),
    ).rejects.toBeInstanceOf(RecipeGraphValidationError);

    const graph = await recipeGraphService.load(recipe.id);
    expect(graph?.operations).toHaveLength(2);
    expect(graph?.operations.some(({ type }) => type === "cycle")).toBeFalse();
  });

  test("rolls back removing an operation's last input", async () => {
    const recipe = await createRecipe("Required input");
    const input = await recipeGraphService.createFoodState(recipe.id, { name: "input" });
    const output = await recipeGraphService.createFoodState(recipe.id, { name: "output" });
    const operation = await recipeGraphService.createOperation(recipe.id, {
      type: "transform",
      inputs: [{ foodStateId: input.id }],
      outputs: [{ foodStateId: output.id }],
    });

    await expect(
      recipeGraphService.removeOperationInput(recipe.id, operation.id, input.id),
    ).rejects.toBeInstanceOf(RecipeGraphValidationError);

    const graph = await recipeGraphService.load(recipe.id);
    expect(graph?.inputs).toHaveLength(1);
  });

  test("rejects a connection across recipe boundaries", async () => {
    const firstRecipe = await createRecipe("First recipe");
    const secondRecipe = await createRecipe("Second recipe");
    const firstFoodState = await recipeGraphService.createFoodState(firstRecipe.id, {
      name: "first",
    });
    const secondFoodState = await recipeGraphService.createFoodState(secondRecipe.id, {
      name: "second",
    });

    await expect(
      recipeGraphService.createOperation(firstRecipe.id, {
        type: "invalid",
        inputs: [{ foodStateId: secondFoodState.id }],
        outputs: [{ foodStateId: firstFoodState.id }],
      }),
    ).rejects.toThrow();

    const graph = await recipeGraphService.load(firstRecipe.id);
    expect(graph?.operations).toEqual([]);
  });

  test("rejects a second producer for a food state", async () => {
    const recipe = await createRecipe("One producer");
    const firstInput = await recipeGraphService.createFoodState(recipe.id, { name: "first" });
    const secondInput = await recipeGraphService.createFoodState(recipe.id, { name: "second" });
    const output = await recipeGraphService.createFoodState(recipe.id, { name: "output" });
    await recipeGraphService.createOperation(recipe.id, {
      type: "first",
      inputs: [{ foodStateId: firstInput.id }],
      outputs: [{ foodStateId: output.id }],
    });

    await expect(
      recipeGraphService.createOperation(recipe.id, {
        type: "second",
        inputs: [{ foodStateId: secondInput.id }],
        outputs: [{ foodStateId: output.id }],
      }),
    ).rejects.toThrow();

    const graph = await recipeGraphService.load(recipe.id);
    expect(graph?.operations).toHaveLength(1);
  });
});

async function createRecipe(name: string): Promise<Recipe> {
  const [recipe] = await database.insert(recipes).values({ name }).returning();
  if (!recipe) {
    throw new Error("Failed to create test recipe");
  }
  createdRecipeIds.push(recipe.id);
  return recipe;
}
