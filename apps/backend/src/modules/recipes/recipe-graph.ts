import type {
  FoodState,
  Operation,
  OperationInput,
  OperationOutput,
  Recipe,
} from "../../database/schema";

export type RecipeGraph = {
  recipe: Recipe;
  foodStates: FoodState[];
  operations: Operation[];
  inputs: OperationInput[];
  outputs: OperationOutput[];
};

export type RecipeGraphIndex = {
  foodStatesById: Map<string, FoodState>;
  operationsById: Map<string, Operation>;
  inputsByOperationId: Map<string, OperationInput[]>;
  outputsByOperationId: Map<string, OperationOutput[]>;
  consumersByFoodStateId: Map<string, Operation[]>;
  producerByFoodStateId: Map<string, Operation>;
};

export type GraphValidationError =
  | { code: "CROSS_RECIPE_ENTITY"; entity: "foodState" | "operation"; id: string }
  | {
      code: "CROSS_RECIPE_CONNECTION";
      connection: "input" | "output";
      operationId: string;
      foodStateId: string;
    }
  | { code: "MISSING_FOOD_STATE"; connection: "input" | "output"; foodStateId: string }
  | { code: "MISSING_OPERATION"; connection: "input" | "output"; operationId: string }
  | { code: "OPERATION_HAS_NO_INPUTS"; operationId: string }
  | { code: "OPERATION_HAS_NO_OUTPUTS"; operationId: string }
  | {
      code: "MULTIPLE_PRODUCERS";
      foodStateId: string;
      operationIds: [string, string];
    }
  | {
      code: "DUPLICATE_INPUT" | "DUPLICATE_OUTPUT";
      operationId: string;
      foodStateId: string;
    }
  | { code: "CYCLE_DETECTED" };

export type GraphValidationResult =
  | { valid: true }
  | { valid: false; errors: GraphValidationError[] };

type FoodStateAdjacency = Map<string, Set<string>>;

export function buildRecipeGraphIndex(graph: RecipeGraph): RecipeGraphIndex {
  const foodStatesById = new Map(graph.foodStates.map((foodState) => [foodState.id, foodState]));
  const operationsById = new Map(graph.operations.map((operation) => [operation.id, operation]));
  const inputsByOperationId = new Map<string, OperationInput[]>();
  const outputsByOperationId = new Map<string, OperationOutput[]>();
  const consumersByFoodStateId = new Map<string, Operation[]>();
  const producerByFoodStateId = new Map<string, Operation>();

  for (const input of graph.inputs) {
    appendToMap(inputsByOperationId, input.operationId, input);
    const operation = operationsById.get(input.operationId);
    if (operation) {
      appendToMap(consumersByFoodStateId, input.foodStateId, operation);
    }
  }

  for (const output of graph.outputs) {
    appendToMap(outputsByOperationId, output.operationId, output);
    const operation = operationsById.get(output.operationId);
    if (operation && !producerByFoodStateId.has(output.foodStateId)) {
      producerByFoodStateId.set(output.foodStateId, operation);
    }
  }

  return {
    foodStatesById,
    operationsById,
    inputsByOperationId,
    outputsByOperationId,
    consumersByFoodStateId,
    producerByFoodStateId,
  };
}

export function getRootFoodStates(graph: RecipeGraph): FoodState[] {
  const { producerByFoodStateId } = buildRecipeGraphIndex(graph);
  return graph.foodStates.filter((foodState) => !producerByFoodStateId.has(foodState.id));
}

export function getTerminalFoodStates(graph: RecipeGraph): FoodState[] {
  const { consumersByFoodStateId } = buildRecipeGraphIndex(graph);
  return graph.foodStates.filter((foodState) => !consumersByFoodStateId.has(foodState.id));
}

export function getOperationDependencies(
  graph: RecipeGraph,
  operationId: string,
): Operation[] {
  const index = buildRecipeGraphIndex(graph);
  const dependencies = new Map<string, Operation>();

  for (const input of index.inputsByOperationId.get(operationId) ?? []) {
    const producer = index.producerByFoodStateId.get(input.foodStateId);
    if (producer) {
      dependencies.set(producer.id, producer);
    }
  }

  return [...dependencies.values()];
}

export function getDownstreamFoodStates(
  graph: RecipeGraph,
  foodStateId: string,
): FoodState[] {
  return collectReachableFoodStates(graph, foodStateId, buildInducedFoodStateGraph(graph));
}

export function getUpstreamFoodStates(
  graph: RecipeGraph,
  foodStateId: string,
): FoodState[] {
  return collectReachableFoodStates(
    graph,
    foodStateId,
    reverseAdjacency(buildInducedFoodStateGraph(graph)),
  );
}

export function topologicallySortFoodStates(graph: RecipeGraph): FoodState[] | null {
  const adjacency = buildInducedFoodStateGraph(graph);
  const foodStatesById = new Map(
    graph.foodStates.map((foodState) => [foodState.id, foodState]),
  );
  const indegrees = new Map(graph.foodStates.map((foodState) => [foodState.id, 0]));

  for (const destinations of adjacency.values()) {
    for (const destination of destinations) {
      const indegree = indegrees.get(destination);
      if (indegree !== undefined) {
        indegrees.set(destination, indegree + 1);
      }
    }
  }

  const ready = graph.foodStates
    .filter((foodState) => indegrees.get(foodState.id) === 0)
    .map((foodState) => foodState.id);
  const ordered: FoodState[] = [];

  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const foodStateId = ready[cursor];
    if (!foodStateId) {
      continue;
    }

    const foodState = foodStatesById.get(foodStateId);
    if (foodState) {
      ordered.push(foodState);
    }

    for (const destination of adjacency.get(foodStateId) ?? []) {
      const nextIndegree = (indegrees.get(destination) ?? 0) - 1;
      indegrees.set(destination, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(destination);
      }
    }
  }

  return ordered.length === graph.foodStates.length ? ordered : null;
}

export function hasRecipeGraphCycle(graph: RecipeGraph): boolean {
  return topologicallySortFoodStates(graph) === null;
}

export function validateRecipeGraph(graph: RecipeGraph): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const recipeId = graph.recipe.id;
  const foodStatesById = new Map(graph.foodStates.map((foodState) => [foodState.id, foodState]));
  const operationsById = new Map(graph.operations.map((operation) => [operation.id, operation]));
  const inputCounts = new Map<string, number>();
  const outputCounts = new Map<string, number>();
  const inputKeys = new Set<string>();
  const outputKeys = new Set<string>();
  const producerByFoodStateId = new Map<string, string>();

  for (const foodState of graph.foodStates) {
    if (foodState.recipeId !== recipeId) {
      errors.push({ code: "CROSS_RECIPE_ENTITY", entity: "foodState", id: foodState.id });
    }
  }

  for (const operation of graph.operations) {
    if (operation.recipeId !== recipeId) {
      errors.push({ code: "CROSS_RECIPE_ENTITY", entity: "operation", id: operation.id });
    }
  }

  for (const input of graph.inputs) {
    const operation = operationsById.get(input.operationId);
    const foodState = foodStatesById.get(input.foodStateId);
    inputCounts.set(input.operationId, (inputCounts.get(input.operationId) ?? 0) + 1);

    if (!operation) {
      errors.push({ code: "MISSING_OPERATION", connection: "input", operationId: input.operationId });
    }
    if (!foodState) {
      errors.push({ code: "MISSING_FOOD_STATE", connection: "input", foodStateId: input.foodStateId });
    }
    if (
      input.recipeId !== recipeId ||
      (operation !== undefined && operation.recipeId !== input.recipeId) ||
      (foodState !== undefined && foodState.recipeId !== input.recipeId)
    ) {
      errors.push({
        code: "CROSS_RECIPE_CONNECTION",
        connection: "input",
        operationId: input.operationId,
        foodStateId: input.foodStateId,
      });
    }

    const key = `${input.operationId}:${input.foodStateId}`;
    if (inputKeys.has(key)) {
      errors.push({
        code: "DUPLICATE_INPUT",
        operationId: input.operationId,
        foodStateId: input.foodStateId,
      });
    }
    inputKeys.add(key);
  }

  for (const output of graph.outputs) {
    const operation = operationsById.get(output.operationId);
    const foodState = foodStatesById.get(output.foodStateId);
    outputCounts.set(output.operationId, (outputCounts.get(output.operationId) ?? 0) + 1);

    if (!operation) {
      errors.push({ code: "MISSING_OPERATION", connection: "output", operationId: output.operationId });
    }
    if (!foodState) {
      errors.push({ code: "MISSING_FOOD_STATE", connection: "output", foodStateId: output.foodStateId });
    }
    if (
      output.recipeId !== recipeId ||
      (operation !== undefined && operation.recipeId !== output.recipeId) ||
      (foodState !== undefined && foodState.recipeId !== output.recipeId)
    ) {
      errors.push({
        code: "CROSS_RECIPE_CONNECTION",
        connection: "output",
        operationId: output.operationId,
        foodStateId: output.foodStateId,
      });
    }

    const key = `${output.operationId}:${output.foodStateId}`;
    if (outputKeys.has(key)) {
      errors.push({
        code: "DUPLICATE_OUTPUT",
        operationId: output.operationId,
        foodStateId: output.foodStateId,
      });
    }
    outputKeys.add(key);

    const existingProducerId = producerByFoodStateId.get(output.foodStateId);
    if (existingProducerId && existingProducerId !== output.operationId) {
      errors.push({
        code: "MULTIPLE_PRODUCERS",
        foodStateId: output.foodStateId,
        operationIds: [existingProducerId, output.operationId],
      });
    } else {
      producerByFoodStateId.set(output.foodStateId, output.operationId);
    }
  }

  for (const operation of graph.operations) {
    if (!inputCounts.has(operation.id)) {
      errors.push({ code: "OPERATION_HAS_NO_INPUTS", operationId: operation.id });
    }
    if (!outputCounts.has(operation.id)) {
      errors.push({ code: "OPERATION_HAS_NO_OUTPUTS", operationId: operation.id });
    }
  }

  if (hasRecipeGraphCycle(graph)) {
    errors.push({ code: "CYCLE_DETECTED" });
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function buildInducedFoodStateGraph(graph: RecipeGraph): FoodStateAdjacency {
  const adjacency = new Map(
    graph.foodStates.map((foodState) => [foodState.id, new Set<string>()]),
  );
  const inputsByOperationId = new Map<string, string[]>();
  const outputsByOperationId = new Map<string, string[]>();

  for (const input of graph.inputs) {
    appendToMap(inputsByOperationId, input.operationId, input.foodStateId);
  }
  for (const output of graph.outputs) {
    appendToMap(outputsByOperationId, output.operationId, output.foodStateId);
  }

  for (const operation of graph.operations) {
    const inputs = inputsByOperationId.get(operation.id) ?? [];
    const outputs = outputsByOperationId.get(operation.id) ?? [];
    for (const input of inputs) {
      const destinations = adjacency.get(input);
      if (!destinations) {
        continue;
      }
      for (const output of outputs) {
        if (adjacency.has(output)) {
          destinations.add(output);
        }
      }
    }
  }

  return adjacency;
}

function reverseAdjacency(adjacency: FoodStateAdjacency): FoodStateAdjacency {
  const reversed = new Map([...adjacency.keys()].map((foodStateId) => [foodStateId, new Set<string>()]));
  for (const [source, destinations] of adjacency) {
    for (const destination of destinations) {
      reversed.get(destination)?.add(source);
    }
  }
  return reversed;
}

function collectReachableFoodStates(
  graph: RecipeGraph,
  foodStateId: string,
  adjacency: FoodStateAdjacency,
): FoodState[] {
  if (!adjacency.has(foodStateId)) {
    return [];
  }

  const foodStatesById = new Map(graph.foodStates.map((foodState) => [foodState.id, foodState]));
  const visited = new Set<string>([foodStateId]);
  const pending = [foodStateId];
  const reachable: FoodState[] = [];

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const current = pending[cursor];
    if (!current) {
      continue;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      pending.push(next);
      const foodState = foodStatesById.get(next);
      if (foodState) {
        reachable.push(foodState);
      }
    }
  }

  return reachable;
}

function appendToMap<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}
