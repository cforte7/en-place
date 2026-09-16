import { describe, expect, test } from "bun:test";

import type {
  FoodState,
  Operation,
  OperationInput,
  OperationOutput,
  Recipe,
} from "../../database/schema";
import {
  getDownstreamFoodStates,
  getOperationDependencies,
  getRootFoodStates,
  getTerminalFoodStates,
  getUpstreamFoodStates,
  topologicallySortFoodStates,
  validateRecipeGraph,
  type GraphValidationError,
  type RecipeGraph,
} from "./recipe-graph";

const recipeId = "recipe-a";
const now = new Date(0);

describe("validateRecipeGraph", () => {
  test("accepts a linear graph", () => {
    expectValidation(
      makeGraph([
        { id: "op1", inputs: ["A"], outputs: ["B"] },
        { id: "op2", inputs: ["B"], outputs: ["C"] },
      ]),
      true,
    );
  });

  test("accepts a many-to-one graph", () => {
    expectValidation(
      makeGraph([{ id: "op1", inputs: ["A", "B", "C"], outputs: ["D"] }]),
      true,
    );
  });

  test("accepts a one-to-many graph", () => {
    expectValidation(
      makeGraph([{ id: "op1", inputs: ["A"], outputs: ["B", "C"] }]),
      true,
    );
  });

  test("accepts a diamond graph", () => {
    expectValidation(
      makeGraph([
        { id: "op1", inputs: ["A"], outputs: ["B"] },
        { id: "op2", inputs: ["A"], outputs: ["C"] },
        { id: "op3", inputs: ["B", "C"], outputs: ["D"] },
      ]),
      true,
    );
  });

  test("rejects a direct cycle", () => {
    expectErrorCodes(
      makeGraph([{ id: "op1", inputs: ["A"], outputs: ["A"] }]),
      "CYCLE_DETECTED",
    );
  });

  test("rejects an indirect cycle", () => {
    expectErrorCodes(
      makeGraph([
        { id: "op1", inputs: ["A"], outputs: ["B"] },
        { id: "op2", inputs: ["B"], outputs: ["C"] },
        { id: "op3", inputs: ["C"], outputs: ["A"] },
      ]),
      "CYCLE_DETECTED",
    );
  });

  test("rejects multiple producing operations", () => {
    expectErrorCodes(
      makeGraph([
        { id: "op1", inputs: ["A"], outputs: ["C"] },
        { id: "op2", inputs: ["B"], outputs: ["C"] },
      ]),
      "MULTIPLE_PRODUCERS",
    );
  });

  test("rejects operations without inputs or outputs", () => {
    expectErrorCodes(
      makeGraph([
        { id: "no-input", inputs: [], outputs: ["A"] },
        { id: "no-output", inputs: ["B"], outputs: [] },
      ]),
      "OPERATION_HAS_NO_INPUTS",
      "OPERATION_HAS_NO_OUTPUTS",
    );
  });

  test("rejects missing endpoints and duplicate connections", () => {
    const graph = makeGraph([{ id: "op1", inputs: ["A"], outputs: ["B"] }]);
    graph.inputs.push({ ...graph.inputs[0]!, position: 1 });
    graph.outputs.push(makeOutput("missing-operation", "missing-food", 1));

    expectErrorCodes(
      graph,
      "DUPLICATE_INPUT",
      "MISSING_OPERATION",
      "MISSING_FOOD_STATE",
    );
  });

  test("rejects entities and connections from another recipe", () => {
    const graph = makeGraph([{ id: "op1", inputs: ["A"], outputs: ["B"] }]);
    graph.foodStates[0] = { ...graph.foodStates[0]!, recipeId: "recipe-b" };

    expectErrorCodes(graph, "CROSS_RECIPE_ENTITY", "CROSS_RECIPE_CONNECTION");
  });
});

describe("recipe graph traversal", () => {
  const graph = makeGraph([
    { id: "peel", inputs: ["raw"], outputs: ["peeled"] },
    { id: "chop", inputs: ["peeled"], outputs: ["chopped"] },
    { id: "season", inputs: ["chopped", "salt"], outputs: ["seasoned"] },
  ]);

  test("derives roots, terminals, and operation dependencies", () => {
    expect(getRootFoodStates(graph).map(({ id }) => id)).toEqual(["raw", "salt"]);
    expect(getTerminalFoodStates(graph).map(({ id }) => id)).toEqual(["seasoned"]);
    expect(getOperationDependencies(graph, "season").map(({ id }) => id)).toEqual([
      "chop",
    ]);
  });

  test("traverses forward and backward", () => {
    expect(getDownstreamFoodStates(graph, "raw").map(({ id }) => id)).toEqual([
      "peeled",
      "chopped",
      "seasoned",
    ]);
    expect(getUpstreamFoodStates(graph, "seasoned").map(({ id }) => id)).toEqual([
      "chopped",
      "salt",
      "peeled",
      "raw",
    ]);
  });

  test("produces an order respecting every dependency", () => {
    const order = topologicallySortFoodStates(graph);
    expect(order).not.toBeNull();
    const positions = new Map(order!.map(({ id }, position) => [id, position]));

    for (const [before, after] of [
      ["raw", "peeled"],
      ["peeled", "chopped"],
      ["chopped", "seasoned"],
      ["salt", "seasoned"],
    ] as const) {
      expect(positions.get(before)!).toBeLessThan(positions.get(after)!);
    }
  });
});

type OperationSpec = {
  id: string;
  inputs: string[];
  outputs: string[];
};

function makeGraph(specs: OperationSpec[]): RecipeGraph {
  const foodStateIds = new Set<string>();
  for (const spec of specs) {
    for (const id of [...spec.inputs, ...spec.outputs]) {
      foodStateIds.add(id);
    }
  }

  const recipe: Recipe = {
    id: recipeId,
    ownerId: "owner-a",
    name: "Test recipe",
    description: null,
    createdAt: now,
    updatedAt: now,
  };
  const foodStates = [...foodStateIds].map(makeFoodState);
  const operations = specs.map(makeOperation);
  const inputs = specs.flatMap((spec) => spec.inputs.map((id, index) => makeInput(spec.id, id, index)));
  const outputs = specs.flatMap((spec) =>
    spec.outputs.map((id, index) => makeOutput(spec.id, id, index)),
  );

  return { recipe, foodStates, operations, inputs, outputs };
}

function makeFoodState(id: string): FoodState {
  return {
    id,
    recipeId,
    name: id,
    positionX: 0,
    positionY: 0,
    description: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function makeOperation(spec: OperationSpec): Operation {
  return {
    id: spec.id,
    recipeId,
    type: "test",
    positionX: 0,
    positionY: 0,
    name: null,
    instructions: null,
    estimatedDurationSeconds: null,
    config: {},
    createdAt: now,
    updatedAt: now,
  };
}

function makeInput(operationId: string, foodStateId: string, position: number): OperationInput {
  return {
    recipeId,
    operationId,
    foodStateId,
    position,
    quantity: null,
    unit: null,
    metadata: {},
  };
}

function makeOutput(operationId: string, foodStateId: string, position: number): OperationOutput {
  return {
    recipeId,
    operationId,
    foodStateId,
    position,
    quantity: null,
    unit: null,
    metadata: {},
  };
}

function expectValidation(graph: RecipeGraph, valid: boolean): void {
  expect(validateRecipeGraph(graph).valid).toBe(valid);
}

function expectErrorCodes(
  graph: RecipeGraph,
  ...expectedCodes: GraphValidationError["code"][]
): void {
  const validation = validateRecipeGraph(graph);
  expect(validation.valid).toBeFalse();
  if (validation.valid) {
    return;
  }
  const codes = validation.errors.map(({ code }) => code);
  for (const code of expectedCodes) {
    expect(codes).toContain(code);
  }
}
