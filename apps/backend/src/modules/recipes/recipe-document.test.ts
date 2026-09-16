import { describe, expect, test } from "bun:test";

import {
  validateRecipeDocument,
  type RecipeDocument,
  type RecipeDocumentValidationError,
} from "@en-place/contracts";

const rawId = "00000000-0000-4000-8000-000000000001";
const preparedId = "00000000-0000-4000-8000-000000000002";
const cookedId = "00000000-0000-4000-8000-000000000003";
const prepareId = "00000000-0000-4000-8000-000000000101";
const cookId = "00000000-0000-4000-8000-000000000102";

function makeDocument(): RecipeDocument {
  return {
    name: "Roasted ingredient",
    foodStates: [
      { id: rawId, name: "Raw", position: { x: 10.25, y: 20.5 } },
      { id: preparedId, name: "Prepared", position: { x: 300.75, y: 20.5 } },
      { id: cookedId, name: "Cooked", position: { x: 600.125, y: 20.5 } },
    ],
    operations: [
      {
        id: prepareId,
        type: "Prepare",
        position: { x: 150.5, y: 20.5 },
        inputs: [{ foodStateId: rawId }],
        outputs: [{ foodStateId: preparedId }],
      },
      {
        id: cookId,
        type: "Cook",
        position: { x: 450.5, y: 20.5 },
        inputs: [{ foodStateId: preparedId }],
        outputs: [{ foodStateId: cookedId }],
      },
    ],
  };
}

function errorCodes(document: unknown): RecipeDocumentValidationError["code"][] {
  const validation = validateRecipeDocument(document);
  expect(validation.valid).toBeFalse();
  return validation.valid ? [] : validation.errors.map(({ code }) => code);
}

describe("validateRecipeDocument", () => {
  test("accepts a complete acyclic document and preserves fractional positions", () => {
    const validation = validateRecipeDocument(makeDocument());

    expect(validation).toEqual({ valid: true, document: makeDocument() });
  });

  test("rejects incomplete operations and unresolved or duplicate connections", () => {
    const document = makeDocument();
    document.operations[0]!.inputs = [];
    document.operations[0]!.outputs = [
      { foodStateId: "00000000-0000-4000-8000-000000000999" },
      { foodStateId: "00000000-0000-4000-8000-000000000999" },
    ];

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        "OPERATION_HAS_NO_INPUTS",
        "MISSING_FOOD_STATE",
        "DUPLICATE_CONNECTION",
      ]),
    );
  });

  test("rejects cycles and multiple producers", () => {
    const document = makeDocument();
    document.operations.push({
      id: "00000000-0000-4000-8000-000000000103",
      type: "Undo",
      position: { x: 750, y: 20.5 },
      inputs: [{ foodStateId: cookedId }],
      outputs: [{ foodStateId: rawId }],
    });
    document.operations.push({
      id: "00000000-0000-4000-8000-000000000104",
      type: "Alternative",
      position: { x: 450, y: 200 },
      inputs: [{ foodStateId: preparedId }],
      outputs: [{ foodStateId: cookedId }],
    });

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining(["CYCLE_DETECTED", "MULTIPLE_PRODUCERS"]),
    );
  });
});
