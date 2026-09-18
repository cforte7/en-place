import { describe, expect, test } from "bun:test";
import {
  recipeIngestionCandidateSchema,
  validateRecipeDocument,
  type RecipeIngestionCandidate,
} from "@en-place/contracts";

import {
  InvalidRecipeIngestionCandidateError,
  normalizeRecipeIngestionCandidate,
} from "./normalize-recipe-ingestion";

function makeCandidate(): RecipeIngestionCandidate {
  return recipeIngestionCandidateSchema.parse({
    name: "Sauteed onion",
    description: "A simple onion side.",
    foodStates: [
      { key: "raw-onion", name: "raw onion", description: null },
      { key: "oil", name: "olive oil", description: null },
      { key: "diced-onion", name: "diced onion", description: null },
      { key: "sauteed-onion", name: "sauteed onion", description: null },
    ],
    operations: [
      {
        key: "saute-onion",
        type: "cook",
        name: "Saute onion",
        instructions: "Saute the diced onion in oil until soft.",
        estimatedDurationSeconds: 480,
        inputs: [
          {
            foodStateKey: "diced-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
          {
            foodStateKey: "oil",
            quantity: "15",
            sourceQuantityText: "1 tbsp",
            unit: "ml",
          },
        ],
        outputs: [
          {
            foodStateKey: "sauteed-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
        sourceStepNumbers: [2],
      },
      {
        key: "dice-onion",
        type: "prepare",
        name: "Dice onion",
        instructions: "Dice the onion.",
        estimatedDurationSeconds: null,
        inputs: [
          {
            foodStateKey: "raw-onion",
            quantity: "1",
            sourceQuantityText: null,
            unit: "large onion",
          },
        ],
        outputs: [
          {
            foodStateKey: "diced-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
        sourceStepNumbers: [1],
      },
    ],
    warnings: ["Heat level is qualitative.", "Heat level is qualitative."],
  });
}

describe("normalizeRecipeIngestionCandidate", () => {
  test("resolves symbolic references into a valid, topologically laid-out document", async () => {
    let nextId = 0;
    const preview = await normalizeRecipeIngestionCandidate(
      makeCandidate(),
      () =>
        `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    );

    expect(validateRecipeDocument(preview.recipe).valid).toBeTrue();
    expect(preview.warnings).toEqual(["Heat level is qualitative."]);

    const positionByName = new Map(
      [...preview.recipe.foodStates, ...preview.recipe.operations].map(
        ({ name, position }) => [name, position],
      ),
    );
    const rawOnion = positionByName.get("raw onion")!;
    const oil = positionByName.get("olive oil")!;
    const diceOnion = positionByName.get("Dice onion")!;
    const dicedOnion = positionByName.get("diced onion")!;
    const sauteOnion = positionByName.get("Saute onion")!;
    const sauteedOnion = positionByName.get("sauteed onion")!;

    expect(rawOnion.x).toBeLessThan(diceOnion.x);
    expect(diceOnion.x).toBeLessThan(dicedOnion.x);
    expect(dicedOnion.x).toBeLessThan(sauteOnion.x);
    expect(oil.x).toBeLessThan(sauteOnion.x);
    expect(sauteOnion.x).toBeLessThan(sauteedOnion.x);
    expect(rawOnion.y).not.toBe(oil.y);
    expect(preview.recipe.operations[0]?.inputs[1]).toMatchObject({
      quantity: "15",
      unit: "ml",
      metadata: { sourceQuantityText: "1 tbsp" },
    });
    expect(preview.recipe.operations[0]?.config).toEqual({
      sourceStepNumbers: [2],
    });
  });

  test("rejects unresolved food-state references before creating a document", async () => {
    const candidate = makeCandidate();
    candidate.operations[0]!.inputs[0]!.foodStateKey = "missing-onion";

    await expect(normalizeRecipeIngestionCandidate(candidate)).rejects.toThrow(
      InvalidRecipeIngestionCandidateError,
    );
  });

  test("rejects candidates whose dependencies contain a cycle", async () => {
    const candidate = makeCandidate();
    candidate.operations = [
      {
        ...candidate.operations[0]!,
        key: "first",
        inputs: [
          {
            foodStateKey: "diced-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
        outputs: [
          {
            foodStateKey: "raw-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
      },
      {
        ...candidate.operations[1]!,
        key: "second",
        inputs: [
          {
            foodStateKey: "raw-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
        outputs: [
          {
            foodStateKey: "diced-onion",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
      },
    ];

    await expect(normalizeRecipeIngestionCandidate(candidate)).rejects.toThrow(
      /cycle/i,
    );
  });
});
