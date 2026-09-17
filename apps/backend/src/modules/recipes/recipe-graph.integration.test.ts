import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { RecipeDocument } from "@en-place/contracts";
import { eq } from "drizzle-orm";

import { database } from "../../database";
import { recipes, users, type Recipe } from "../../database/schema";
import type { UserId } from "../users/user-id";
import {
  InvalidRecipeDocumentError,
  RecipeGraphNotFoundError,
  RecipeGraphValidationError,
  recipeGraphService,
} from "./recipe-graph-service";

const createdRecipeIds: string[] = [];
let ownerId: UserId;

beforeAll(async () => {
  const [owner] = await database
    .insert(users)
    .values({
      email: `recipe-graph-${crypto.randomUUID()}@example.com`,
      passwordHash: "integration-test",
    })
    .returning({ id: users.id });
  if (!owner) {
    throw new Error("Failed to create recipe graph test owner");
  }
  ownerId = owner.id as UserId;
});

afterAll(async () => {
  if (ownerId) {
    await database.delete(users).where(eq(users.id, ownerId));
  }
});

afterEach(async () => {
  for (const recipeId of createdRecipeIds.splice(0)) {
    await database.delete(recipes).where(eq(recipes.id, recipeId));
  }
});

describe.serial("recipeGraphService", () => {
  test("creates and loads an operation atomically", async () => {
    const recipe = await createRecipe("Atomic operation");
    const input = await recipeGraphService.createFoodState(recipe.id, {
      name: "raw",
    });
    const output = await recipeGraphService.createFoodState(recipe.id, {
      name: "cooked",
    });

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
    const a = await recipeGraphService.createFoodState(recipe.id, {
      name: "A",
    });
    const b = await recipeGraphService.createFoodState(recipe.id, {
      name: "B",
    });
    const c = await recipeGraphService.createFoodState(recipe.id, {
      name: "C",
    });
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
    const input = await recipeGraphService.createFoodState(recipe.id, {
      name: "input",
    });
    const output = await recipeGraphService.createFoodState(recipe.id, {
      name: "output",
    });
    const operation = await recipeGraphService.createOperation(recipe.id, {
      type: "transform",
      inputs: [{ foodStateId: input.id }],
      outputs: [{ foodStateId: output.id }],
    });

    await expect(
      recipeGraphService.removeOperationInput(
        recipe.id,
        operation.id,
        input.id,
      ),
    ).rejects.toBeInstanceOf(RecipeGraphValidationError);

    const graph = await recipeGraphService.load(recipe.id);
    expect(graph?.inputs).toHaveLength(1);
  });

  test("rejects a connection across recipe boundaries", async () => {
    const firstRecipe = await createRecipe("First recipe");
    const secondRecipe = await createRecipe("Second recipe");
    const firstFoodState = await recipeGraphService.createFoodState(
      firstRecipe.id,
      {
        name: "first",
      },
    );
    const secondFoodState = await recipeGraphService.createFoodState(
      secondRecipe.id,
      {
        name: "second",
      },
    );

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
    const firstInput = await recipeGraphService.createFoodState(recipe.id, {
      name: "first",
    });
    const secondInput = await recipeGraphService.createFoodState(recipe.id, {
      name: "second",
    });
    const output = await recipeGraphService.createFoodState(recipe.id, {
      name: "output",
    });
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

  test("creates, replaces, and loads a complete owned graph with exact positions", async () => {
    const document = makeRecipeDocument("Position round trip");
    const created = await recipeGraphService.create(ownerId, document);
    createdRecipeIds.push(created.recipe.id);

    expect(created.foodStates).toHaveLength(document.foodStates.length);
    expect(created.foodStates).toEqual(
      expect.arrayContaining(
        document.foodStates.map((foodState) =>
          expect.objectContaining({
            id: foodState.id,
            positionX: foodState.position.x,
            positionY: foodState.position.y,
          }),
        ),
      ),
    );
    expect(created.operations[0]).toMatchObject({
      positionX: 310.75,
      positionY: 20.5,
    });

    const replacement: RecipeDocument = {
      ...document,
      name: "Moved recipe",
      foodStates: document.foodStates.map((foodState, index) => ({
        ...foodState,
        position: {
          x: foodState.position.x + index + 0.5,
          y: foodState.position.y + 100.25,
        },
      })),
    };
    await recipeGraphService.replace(ownerId, created.recipe.id, replacement);

    const loaded = await recipeGraphService.loadOwned(
      ownerId,
      created.recipe.id,
    );
    expect(loaded?.recipe.name).toBe("Moved recipe");
    expect(loaded?.foodStates).toHaveLength(replacement.foodStates.length);
    expect(loaded?.foodStates).toEqual(
      expect.arrayContaining(
        replacement.foodStates.map((foodState) =>
          expect.objectContaining({
            id: foodState.id,
            positionX: foodState.position.x,
            positionY: foodState.position.y,
          }),
        ),
      ),
    );
    expect(loaded?.inputs).toHaveLength(1);
    expect(loaded?.outputs).toHaveLength(1);
  });

  test("lists only the owner's recipes with the most recently updated first", async () => {
    const olderRecipe = await createRecipe("Older recipe");
    const newerRecipe = await createRecipe("Newer recipe");
    const [otherOwner] = await database
      .insert(users)
      .values({
        email: `listed-recipe-owner-${crypto.randomUUID()}@example.com`,
        passwordHash: "integration-test",
      })
      .returning({ id: users.id });
    if (!otherOwner) {
      throw new Error("Failed to create recipe list test owner");
    }

    try {
      await database
        .update(recipes)
        .set({ updatedAt: new Date("2025-01-01T00:00:00.000Z") })
        .where(eq(recipes.id, olderRecipe.id));
      await database
        .update(recipes)
        .set({ updatedAt: new Date("2025-02-01T00:00:00.000Z") })
        .where(eq(recipes.id, newerRecipe.id));
      await database.insert(recipes).values({
        ownerId: otherOwner.id,
        name: "Another user's recipe",
        updatedAt: new Date("2025-03-01T00:00:00.000Z"),
      });

      const listedRecipes = await recipeGraphService.listOwned(ownerId);

      expect(listedRecipes.map(({ id }) => id)).toEqual([
        newerRecipe.id,
        olderRecipe.id,
      ]);
    } finally {
      await database.delete(users).where(eq(users.id, otherOwner.id));
    }
  });

  test("rejects an invalid aggregate replacement without changing the saved graph", async () => {
    const document = makeRecipeDocument("Valid aggregate");
    const created = await recipeGraphService.create(ownerId, document);
    createdRecipeIds.push(created.recipe.id);
    const invalid: RecipeDocument = {
      ...document,
      name: "Invalid replacement",
      operations: document.operations.map((operation) => ({
        ...operation,
        outputs: [],
      })),
    };

    await expect(
      recipeGraphService.replace(ownerId, created.recipe.id, invalid),
    ).rejects.toBeInstanceOf(InvalidRecipeDocumentError);

    const loaded = await recipeGraphService.loadOwned(
      ownerId,
      created.recipe.id,
    );
    expect(loaded?.recipe.name).toBe("Valid aggregate");
    expect(loaded?.outputs).toHaveLength(1);
  });

  test("does not load or replace another user's recipe", async () => {
    const [otherOwner] = await database
      .insert(users)
      .values({
        email: `other-recipe-owner-${crypto.randomUUID()}@example.com`,
        passwordHash: "integration-test",
      })
      .returning({ id: users.id });
    if (!otherOwner) {
      throw new Error("Failed to create second recipe owner");
    }
    const otherOwnerId = otherOwner.id as UserId;

    try {
      const document = makeRecipeDocument("Private recipe");
      const created = await recipeGraphService.create(ownerId, document);
      createdRecipeIds.push(created.recipe.id);

      expect(
        await recipeGraphService.loadOwned(otherOwnerId, created.recipe.id),
      ).toBeNull();
      await expect(
        recipeGraphService.replace(otherOwnerId, created.recipe.id, document),
      ).rejects.toBeInstanceOf(RecipeGraphNotFoundError);
    } finally {
      await database.delete(users).where(eq(users.id, otherOwner.id));
    }
  });
});

async function createRecipe(name: string): Promise<Recipe> {
  const [recipe] = await database
    .insert(recipes)
    .values({ ownerId, name })
    .returning();
  if (!recipe) {
    throw new Error("Failed to create test recipe");
  }
  createdRecipeIds.push(recipe.id);
  return recipe;
}

function makeRecipeDocument(name: string): RecipeDocument {
  const inputId = crypto.randomUUID();
  const outputId = crypto.randomUUID();

  return {
    name,
    foodStates: [
      {
        id: inputId,
        name: "Raw",
        position: { x: 10.25, y: 20.5 },
      },
      {
        id: outputId,
        name: "Cooked",
        position: { x: 610.125, y: 20.5 },
      },
    ],
    operations: [
      {
        id: crypto.randomUUID(),
        type: "Cook",
        position: { x: 310.75, y: 20.5 },
        inputs: [{ foodStateId: inputId }],
        outputs: [{ foodStateId: outputId }],
      },
    ],
  };
}
