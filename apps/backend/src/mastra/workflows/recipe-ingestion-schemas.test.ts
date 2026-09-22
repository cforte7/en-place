import { describe, expect, test } from "bun:test";

import {
  actionExtractionSchema,
  createActionExtractionSchema,
  createActionOutputId,
  createExtractedActionId,
  createExtractedIngredientId,
  createIngredientExtractionSchema,
  createInputMentionId,
  ingredientExtractionSchema,
  prepareRecipeSource,
  preparedRecipeSourceSchema,
} from "./recipe-ingestion-schemas";

function makePreparedSource() {
  return prepareRecipeSource({
    name: "  Onion soup  ",
    description: "  A simple soup.  ",
    ingredientsText: "  1/3 cup olive oil\r\n\r\n  2 onions  ",
    instructionsText: "Dice the onions.\n\nCook until soft.",
  });
}

function makeIngredientExtraction(sourceLineId = "I1") {
  return {
    ingredients: [
      {
        sourceLineId,
        name: "olive oil",
        description: null,
        quantity: null,
        sourceQuantityText: "1/3",
        unit: "cup",
        preparationText: null,
      },
    ],
    warnings: [],
  };
}

function makeActionExtraction(sourceStepId = "S1") {
  return {
    actions: [
      {
        sourceStepId,
        name: "Dice onions",
        instructions: "Dice the onions.",
        estimatedDurationSeconds: null,
        inputMentions: [
          {
            text: "the onions",
            quantity: null,
            sourceQuantityText: null,
            unit: null,
          },
        ],
        outputs: [{ name: "diced onions", description: null }],
      },
    ],
    warnings: [],
  };
}

describe("prepareRecipeSource", () => {
  test("assigns stable IDs and positions to trimmed nonblank source lines", () => {
    const source = makePreparedSource();

    expect(source).toEqual({
      name: "Onion soup",
      description: "A simple soup.",
      ingredientLines: [
        { id: "I1", text: "1/3 cup olive oil", position: 0 },
        { id: "I2", text: "2 onions", position: 1 },
      ],
      instructionSteps: [
        { id: "S1", text: "Dice the onions.", position: 0 },
        { id: "S2", text: "Cook until soft.", position: 1 },
      ],
    });
  });

  test("rejects prepared sources whose IDs or positions are not sequential", () => {
    const invalidId = makePreparedSource();
    invalidId.ingredientLines[0]!.id = "I2";
    const invalidPosition = makePreparedSource();
    invalidPosition.instructionSteps[0]!.position = 1;

    expect(preparedRecipeSourceSchema.safeParse(invalidId).success).toBeFalse();
    expect(
      preparedRecipeSourceSchema.safeParse(invalidPosition).success,
    ).toBeFalse();
  });

  test("derives child IDs from source references and array positions", () => {
    const actionId = createExtractedActionId("S4", 0);

    expect(createExtractedIngredientId("I3", 1)).toBe("I3-2");
    expect(actionId).toBe("S4-A1");
    expect(createInputMentionId(actionId, 1)).toBe("S4-A1-M2");
    expect(createActionOutputId(actionId, 0)).toBe("S4-A1-O1");
  });
});

describe("ingredientExtractionSchema", () => {
  test("preserves inexact source quantities without treating them as decimals", () => {
    const extraction = makeIngredientExtraction();

    expect(ingredientExtractionSchema.parse(extraction)).toEqual(extraction);
    expect(
      ingredientExtractionSchema.safeParse({
        ...extraction,
        ingredients: [
          {
            ...extraction.ingredients[0],
            quantity: "1/3",
          },
        ],
      }).success,
    ).toBeFalse();
    expect(
      ingredientExtractionSchema.safeParse({
        ...extraction,
        ingredients: [
          {
            ...extraction.ingredients[0],
            quantity: "0.5",
            sourceQuantityText: null,
          },
        ],
      }).success,
    ).toBeFalse();
  });

  test("rejects source references not present in the prepared input", () => {
    const sourceSchema = createIngredientExtractionSchema(makePreparedSource());

    expect(
      sourceSchema.safeParse(makeIngredientExtraction("I1")).success,
    ).toBeTrue();
    expect(
      sourceSchema.safeParse(makeIngredientExtraction("I3")).success,
    ).toBeFalse();
  });

  test("rejects model-generated child identifiers", () => {
    const extraction = makeIngredientExtraction();

    expect(
      ingredientExtractionSchema.safeParse({
        ...extraction,
        ingredients: [
          {
            ...extraction.ingredients[0],
            id: "I1-1",
          },
        ],
      }).success,
    ).toBeFalse();
  });
});

describe("actionExtractionSchema", () => {
  test("requires every extracted action to produce at least one output", () => {
    const extraction = makeActionExtraction();

    expect(actionExtractionSchema.parse(extraction)).toEqual(extraction);
    expect(
      actionExtractionSchema.safeParse({
        ...extraction,
        actions: [{ ...extraction.actions[0], outputs: [] }],
      }).success,
    ).toBeFalse();
  });

  test("rejects source references not present in the prepared input", () => {
    const sourceSchema = createActionExtractionSchema(makePreparedSource());

    expect(
      sourceSchema.safeParse(makeActionExtraction("S2")).success,
    ).toBeTrue();
    expect(
      sourceSchema.safeParse(makeActionExtraction("S3")).success,
    ).toBeFalse();
  });

  test("rejects graph decisions and identifiers from model output", () => {
    const extraction = makeActionExtraction();

    expect(
      actionExtractionSchema.safeParse({
        ...extraction,
        actions: [
          {
            ...extraction.actions[0],
            id: "S1-A1",
            type: "prepare",
            position: { x: 0, y: 0 },
          },
        ],
      }).success,
    ).toBeFalse();
    expect(
      actionExtractionSchema.safeParse({
        ...extraction,
        actions: [
          {
            ...extraction.actions[0],
            outputs: [
              {
                ...extraction.actions[0]!.outputs[0],
                foodStateId: "00000000-0000-4000-8000-000000000001",
              },
            ],
          },
        ],
      }).success,
    ).toBeFalse();
  });
});
