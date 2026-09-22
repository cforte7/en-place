import { describe, expect, test } from "bun:test";

import { prepareRecipeSource } from "./recipe-ingestion-schemas";
import { extractRecipeParts } from "./recipe-ingestion-workflow";

function makeSource() {
  return prepareRecipeSource({
    name: "Onions",
    description: null,
    ingredientsText: "1 onion",
    instructionsText: "Dice the onion.",
  });
}

const ingredientExtraction = {
  ingredients: [
    {
      sourceLineId: "I1",
      name: "onion",
      description: null,
      quantity: "1",
      sourceQuantityText: "1",
      unit: null,
      preparationText: null,
    },
  ],
  warnings: [],
};

const actionExtraction = {
  actions: [
    {
      sourceStepId: "S1",
      name: "Dice onion",
      instructions: "Dice the onion.",
      estimatedDurationSeconds: null,
      inputMentions: [
        {
          text: "the onion",
          quantity: null,
          sourceQuantityText: null,
          unit: null,
        },
      ],
      outputs: [{ name: "diced onion", description: null }],
    },
  ],
  warnings: [],
};

describe("extractRecipeParts", () => {
  test("starts ingredient and action extraction before either finishes", async () => {
    const starts: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = extractRecipeParts(makeSource(), {
      ingredients: async () => {
        starts.push("ingredients");
        await gate;
        return ingredientExtraction;
      },
      actions: async () => {
        starts.push("actions");
        await gate;
        return actionExtraction;
      },
    });

    await Promise.resolve();
    expect(starts).toEqual(["ingredients", "actions"]);
    release!();

    const result = await resultPromise;
    expect(result.ingredientExtraction).toEqual(ingredientExtraction);
    expect(result.actionExtraction).toEqual(actionExtraction);
  });

  test("fails the extraction stage when either extractor fails", async () => {
    const failure = new Error("ingredient extraction failed");
    let actionStarted = false;

    const result = extractRecipeParts(makeSource(), {
      ingredients: async () => {
        throw failure;
      },
      actions: async () => {
        actionStarted = true;
        return actionExtraction;
      },
    });

    await expect(result).rejects.toBe(failure);
    expect(actionStarted).toBeTrue();
  });
});
