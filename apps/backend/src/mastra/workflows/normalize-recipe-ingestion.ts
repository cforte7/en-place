import {
  recipeDocumentSchema,
  validateRecipeDocument,
  type RecipeDocument,
  type RecipeIngestionCandidate,
  type RecipeIngestionPreview,
} from "@en-place/contracts";

const horizontalSpacing = 280;
const verticalSpacing = 160;
const verticalOffset = 100;

export class InvalidRecipeIngestionCandidateError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Recipe ingestion candidate is invalid: ${reasons.join("; ")}`);
    this.name = "InvalidRecipeIngestionCandidateError";
  }
}

export function normalizeRecipeIngestionCandidate(
  candidate: RecipeIngestionCandidate,
  createId: () => string = () => crypto.randomUUID(),
): RecipeIngestionPreview {
  const errors: string[] = [];
  const foodStateByKey = uniqueByKey("food state", candidate.foodStates, errors);
  uniqueByKey("operation", candidate.operations, errors);

  const producerByFoodStateKey = new Map<string, string>();
  for (const operation of candidate.operations) {
    validateConnections(
      "input",
      operation.key,
      operation.inputs.map(({ foodStateKey }) => foodStateKey),
      foodStateByKey,
      errors,
    );
    validateConnections(
      "output",
      operation.key,
      operation.outputs.map(({ foodStateKey }) => foodStateKey),
      foodStateByKey,
      errors,
    );

    for (const { foodStateKey } of operation.outputs) {
      const existingProducer = producerByFoodStateKey.get(foodStateKey);
      if (existingProducer) {
        errors.push(
          `Food state "${foodStateKey}" is produced by both "${existingProducer}" and "${operation.key}".`,
        );
      } else {
        producerByFoodStateKey.set(foodStateKey, operation.key);
      }
    }
  }

  if (errors.length > 0) {
    throw new InvalidRecipeIngestionCandidateError(errors);
  }

  const foodStateLayers = calculateFoodStateLayers(
    candidate,
    producerByFoodStateKey,
  );
  const operationLayers = calculateOperationLayers(candidate, foodStateLayers);
  const foodStateIdByKey = new Map(
    candidate.foodStates.map(({ key }) => [key, createId()]),
  );
  const occupiedSlotsByLayer = new Map<number, number>();
  const positionForLayer = (layer: number) => {
    const slot = occupiedSlotsByLayer.get(layer) ?? 0;
    occupiedSlotsByLayer.set(layer, slot + 1);
    return {
      x: layer * horizontalSpacing,
      y: verticalOffset + slot * verticalSpacing,
    };
  };

  const document: RecipeDocument = recipeDocumentSchema.parse({
    name: candidate.name,
    description: candidate.description,
    foodStates: candidate.foodStates.map((foodState) => ({
      id: requireValue(foodStateIdByKey, foodState.key),
      name: foodState.name,
      description: foodState.description,
      metadata: {},
      position: positionForLayer(requireValue(foodStateLayers, foodState.key)),
    })),
    operations: candidate.operations.map((operation) => ({
      id: createId(),
      type: operation.type,
      name: operation.name,
      instructions: operation.instructions,
      estimatedDurationSeconds: operation.estimatedDurationSeconds,
      config: { sourceStepNumbers: operation.sourceStepNumbers },
      position: positionForLayer(requireValue(operationLayers, operation.key)),
      inputs: operation.inputs.map((connection) =>
        normalizeConnection(connection, foodStateIdByKey),
      ),
      outputs: operation.outputs.map((connection) =>
        normalizeConnection(connection, foodStateIdByKey),
      ),
    })),
  });

  const validation = validateRecipeDocument(document);
  if (!validation.valid) {
    throw new InvalidRecipeIngestionCandidateError(
      validation.errors.map(({ message }) => message),
    );
  }

  return {
    recipe: validation.document,
    warnings: [...new Set(candidate.warnings)],
  };
}

function uniqueByKey<T extends { key: string }>(
  entityName: string,
  entities: T[],
  errors: string[],
): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const entity of entities) {
    if (byKey.has(entity.key)) {
      errors.push(`Duplicate ${entityName} key "${entity.key}".`);
    } else {
      byKey.set(entity.key, entity);
    }
  }
  return byKey;
}

function validateConnections(
  direction: "input" | "output",
  operationKey: string,
  foodStateKeys: string[],
  foodStateByKey: ReadonlyMap<string, unknown>,
  errors: string[],
): void {
  const connectedKeys = new Set<string>();
  for (const foodStateKey of foodStateKeys) {
    if (!foodStateByKey.has(foodStateKey)) {
      errors.push(
        `Operation "${operationKey}" has ${direction} "${foodStateKey}" that does not exist.`,
      );
    }
    if (connectedKeys.has(foodStateKey)) {
      errors.push(
        `Operation "${operationKey}" repeats ${direction} "${foodStateKey}".`,
      );
    }
    connectedKeys.add(foodStateKey);
  }
}

function calculateFoodStateLayers(
  candidate: RecipeIngestionCandidate,
  producerByFoodStateKey: ReadonlyMap<string, string>,
): Map<string, number> {
  const foodStateLayers = new Map<string, number>();
  for (const { key } of candidate.foodStates) {
    if (!producerByFoodStateKey.has(key)) {
      foodStateLayers.set(key, 0);
    }
  }

  const pending = new Set(candidate.operations.map(({ key }) => key));
  while (pending.size > 0) {
    let progressed = false;
    for (const operation of candidate.operations) {
      if (
        !pending.has(operation.key) ||
        operation.inputs.some(
          ({ foodStateKey }) => !foodStateLayers.has(foodStateKey),
        )
      ) {
        continue;
      }

      const inputLayer = Math.max(
        ...operation.inputs.map(({ foodStateKey }) =>
          requireValue(foodStateLayers, foodStateKey),
        ),
      );
      for (const { foodStateKey } of operation.outputs) {
        foodStateLayers.set(foodStateKey, inputLayer + 2);
      }
      pending.delete(operation.key);
      progressed = true;
    }

    if (!progressed) {
      throw new InvalidRecipeIngestionCandidateError([
        "The candidate contains a cycle or an output that cannot be reached from a root food state.",
      ]);
    }
  }

  return foodStateLayers;
}

function calculateOperationLayers(
  candidate: RecipeIngestionCandidate,
  foodStateLayers: ReadonlyMap<string, number>,
): Map<string, number> {
  return new Map(
    candidate.operations.map((operation) => [
      operation.key,
      Math.max(
        ...operation.inputs.map(({ foodStateKey }) =>
          requireValue(foodStateLayers, foodStateKey),
        ),
      ) + 1,
    ]),
  );
}

function normalizeConnection(
  connection: RecipeIngestionCandidate["operations"][number]["inputs"][number],
  foodStateIdByKey: ReadonlyMap<string, string>,
) {
  return {
    foodStateId: requireValue(foodStateIdByKey, connection.foodStateKey),
    quantity: connection.quantity,
    unit: connection.unit,
    metadata:
      connection.sourceQuantityText === null
        ? {}
        : { sourceQuantityText: connection.sourceQuantityText },
  };
}

function requireValue<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key);
  if (value === undefined) {
    throw new InvalidRecipeIngestionCandidateError([
      `Missing normalized value for "${String(key)}".`,
    ]);
  }
  return value;
}
