import ELK, { type ElkNode } from "elkjs";

import {
  recipeDocumentSchema,
  validateRecipeDocument,
  type RecipeDocument,
  type RecipeIngestionCandidate,
  type RecipeIngestionPreview,
} from "@en-place/contracts";

const recipeNodeWidth = 220;
const recipeNodeHeight = 116;
const elkWorkerUrl = Bun.resolveSync(
  "elkjs/lib/elk-worker.min.js",
  import.meta.dir,
);

export class InvalidRecipeIngestionCandidateError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Recipe ingestion candidate is invalid: ${reasons.join("; ")}`);
    this.name = "InvalidRecipeIngestionCandidateError";
  }
}

export async function normalizeRecipeIngestionCandidate(
  candidate: RecipeIngestionCandidate,
  createId: () => string = () => crypto.randomUUID(),
): Promise<RecipeIngestionPreview> {
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

  const foodStateIdByKey = new Map(
    candidate.foodStates.map(({ key }) => [key, createId()]),
  );
  const operationIdByKey = new Map(
    candidate.operations.map(({ key }) => [key, createId()]),
  );
  const document: RecipeDocument = recipeDocumentSchema.parse({
    name: candidate.name,
    description: candidate.description,
    foodStates: candidate.foodStates.map((foodState) => ({
      id: requireValue(foodStateIdByKey, foodState.key),
      name: foodState.name,
      description: foodState.description,
      metadata: {},
      position: { x: 0, y: 0 },
    })),
    operations: candidate.operations.map((operation) => ({
      id: requireValue(operationIdByKey, operation.key),
      type: operation.type,
      name: operation.name,
      instructions: operation.instructions,
      estimatedDurationSeconds: operation.estimatedDurationSeconds,
      config: { sourceStepNumbers: operation.sourceStepNumbers },
      position: { x: 0, y: 0 },
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
    recipe: await layoutRecipeDocument(validation.document),
    warnings: [...new Set(candidate.warnings)].map((message) => ({
      code: "model_assumption",
      message,
      operationId: null,
      foodStateId: null,
      alternatives: [],
    })),
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

async function layoutRecipeDocument(
  document: RecipeDocument,
): Promise<RecipeDocument> {
  const layout = await new ELK({ workerUrl: elkWorkerUrl }).layout({
    id: "recipe",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    },
    children: [...document.foodStates, ...document.operations].map(({ id }) => ({
      id,
      width: recipeNodeWidth,
      height: recipeNodeHeight,
    })),
    edges: document.operations.flatMap((operation) => [
      ...operation.inputs.map(({ foodStateId }, index) => ({
        id: `${operation.id}:input:${index}`,
        sources: [foodStateId],
        targets: [operation.id],
      })),
      ...operation.outputs.map(({ foodStateId }, index) => ({
        id: `${operation.id}:output:${index}`,
        sources: [operation.id],
        targets: [foodStateId],
      })),
    ]),
  });
  const positionById = new Map(
    (layout.children ?? []).map((node) => [node.id, elkPosition(node)]),
  );

  return {
    ...document,
    foodStates: document.foodStates.map((foodState) => ({
      ...foodState,
      position: requireValue(positionById, foodState.id),
    })),
    operations: document.operations.map((operation) => ({
      ...operation,
      position: requireValue(positionById, operation.id),
    })),
  };
}

function elkPosition(node: ElkNode): { x: number; y: number } {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
    throw new InvalidRecipeIngestionCandidateError([
      `ELK did not produce a position for node "${node.id}".`,
    ]);
  }

  return {
    x: node.x as number,
    y: (node.y as number) + recipeNodeHeight / 2,
  };
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
