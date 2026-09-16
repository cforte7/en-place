import {
  validateRecipeDocument,
  type RecipeDocument,
  type RecipeDocumentValidationError,
} from "@en-place/contracts";

import { sql } from "drizzle-orm";

import { database } from "../../database";
import type { FoodState, Operation, OperationInput, OperationOutput } from "../../database/schema";
import {
  RecipeGraphRepository,
  type CreateFoodStateValues,
  type CreateOperationValues,
  type OperationConnectionValues,
  type UpdateFoodStateValues,
  type UpdateOperationValues,
} from "./recipe-graph-repository";
import {
  validateRecipeGraph,
  type GraphValidationError,
  type RecipeGraph,
} from "./recipe-graph";

export type CreateOperationRequest = CreateOperationValues & {
  inputs: OperationConnectionValues[];
  outputs: OperationConnectionValues[];
};

export class RecipeGraphNotFoundError extends Error {
  constructor(readonly recipeId: string) {
    super(`Recipe graph not found: ${recipeId}`);
    this.name = "RecipeGraphNotFoundError";
  }
}

export class RecipeGraphEntityNotFoundError extends Error {
  constructor(
    readonly entity: "foodState" | "operation" | "operationInput" | "operationOutput",
    readonly id: string,
  ) {
    super(`Recipe graph ${entity} not found: ${id}`);
    this.name = "RecipeGraphEntityNotFoundError";
  }
}

export class RecipeGraphValidationError extends Error {
  constructor(readonly errors: GraphValidationError[]) {
    super(`Recipe graph mutation violates ${errors.length} graph invariant(s)`);
    this.name = "RecipeGraphValidationError";
  }
}

export class InvalidRecipeDocumentError extends Error {
  constructor(readonly errors: RecipeDocumentValidationError[]) {
    super("Recipe document validation failed");
    this.name = "InvalidRecipeDocumentError";
  }
}

class RecipeGraphService {
  load(recipeId: string): Promise<RecipeGraph | null> {
    return database.transaction((transaction) =>
      new RecipeGraphRepository(transaction).loadRecipeGraph(recipeId),
    );
  }

  async create(ownerId: string, input: RecipeDocument): Promise<RecipeGraph> {
    const document = requireValidRecipeDocument(input);

    return database.transaction(async (transaction) => {
      const repository = new RecipeGraphRepository(transaction);
      const recipe = await repository.createRecipe(ownerId, document.name);
      await repository.replaceRecipeGraphRows(recipe.id, document);
      return requireValidPersistedGraph(repository, recipe.id);
    });
  }

  loadOwned(ownerId: string, recipeId: string): Promise<RecipeGraph | null> {
    return database.transaction((transaction) =>
      new RecipeGraphRepository(transaction).loadRecipeGraph(recipeId, ownerId),
    );
  }

  async replace(
    ownerId: string,
    recipeId: string,
    input: RecipeDocument,
  ): Promise<RecipeGraph> {
    const document = requireValidRecipeDocument(input);

    return database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${recipeId}::text, 0))`,
      );

      const repository = new RecipeGraphRepository(transaction);
      const recipe = await repository.updateOwnedRecipe(ownerId, recipeId, document.name);
      if (!recipe) {
        throw new RecipeGraphNotFoundError(recipeId);
      }

      await repository.replaceRecipeGraphRows(recipeId, document);
      return requireValidPersistedGraph(repository, recipeId);
    });
  }

  createFoodState(recipeId: string, values: CreateFoodStateValues): Promise<FoodState> {
    return this.withLockedGraphMutation(recipeId, (repository) =>
      repository.createFoodState(recipeId, values),
    );
  }

  updateFoodState(
    recipeId: string,
    foodStateId: string,
    values: UpdateFoodStateValues,
  ): Promise<FoodState> {
    return database.transaction(async (transaction) => {
      const repository = new RecipeGraphRepository(transaction);
      const foodState = await repository.updateFoodState(recipeId, foodStateId, values);
      if (!foodState) {
        throw new RecipeGraphEntityNotFoundError("foodState", foodStateId);
      }
      return foodState;
    });
  }

  deleteFoodState(recipeId: string, foodStateId: string): Promise<FoodState> {
    return this.withLockedGraphMutation(recipeId, async (repository) => {
      const foodState = await repository.deleteFoodState(recipeId, foodStateId);
      if (!foodState) {
        throw new RecipeGraphEntityNotFoundError("foodState", foodStateId);
      }
      return foodState;
    });
  }

  createOperation(recipeId: string, request: CreateOperationRequest): Promise<Operation> {
    requireConnections("inputs", request.inputs);
    requireConnections("outputs", request.outputs);
    const { inputs, outputs, ...values } = request;

    return this.withLockedGraphMutation(recipeId, async (repository) => {
      const operation = await repository.createOperation(recipeId, values);
      await repository.setOperationInputs(recipeId, operation.id, inputs);
      await repository.setOperationOutputs(recipeId, operation.id, outputs);
      return operation;
    });
  }

  updateOperation(
    recipeId: string,
    operationId: string,
    values: UpdateOperationValues,
  ): Promise<Operation> {
    return database.transaction(async (transaction) => {
      const repository = new RecipeGraphRepository(transaction);
      const operation = await repository.updateOperation(recipeId, operationId, values);
      if (!operation) {
        throw new RecipeGraphEntityNotFoundError("operation", operationId);
      }
      return operation;
    });
  }

  deleteOperation(recipeId: string, operationId: string): Promise<Operation> {
    return this.withLockedGraphMutation(recipeId, async (repository) => {
      const operation = await repository.deleteOperation(recipeId, operationId);
      if (!operation) {
        throw new RecipeGraphEntityNotFoundError("operation", operationId);
      }
      return operation;
    });
  }

  setOperationInputs(
    recipeId: string,
    operationId: string,
    inputs: OperationConnectionValues[],
  ): Promise<OperationInput[]> {
    requireConnections("inputs", inputs);
    return this.withLockedGraphMutation(recipeId, (repository) =>
      repository.setOperationInputs(recipeId, operationId, inputs),
    );
  }

  setOperationOutputs(
    recipeId: string,
    operationId: string,
    outputs: OperationConnectionValues[],
  ): Promise<OperationOutput[]> {
    requireConnections("outputs", outputs);
    return this.withLockedGraphMutation(recipeId, (repository) =>
      repository.setOperationOutputs(recipeId, operationId, outputs),
    );
  }

  addOperationInput(
    recipeId: string,
    operationId: string,
    input: OperationConnectionValues,
  ): Promise<OperationInput> {
    return this.withLockedGraphMutation(recipeId, (repository) =>
      repository.addOperationInput(recipeId, operationId, input),
    );
  }

  removeOperationInput(
    recipeId: string,
    operationId: string,
    foodStateId: string,
  ): Promise<OperationInput> {
    return this.withLockedGraphMutation(recipeId, async (repository) => {
      const input = await repository.removeOperationInput(
        recipeId,
        operationId,
        foodStateId,
      );
      if (!input) {
        throw new RecipeGraphEntityNotFoundError(
          "operationInput",
          `${operationId}:${foodStateId}`,
        );
      }
      return input;
    });
  }

  addOperationOutput(
    recipeId: string,
    operationId: string,
    output: OperationConnectionValues,
  ): Promise<OperationOutput> {
    return this.withLockedGraphMutation(recipeId, (repository) =>
      repository.addOperationOutput(recipeId, operationId, output),
    );
  }

  removeOperationOutput(
    recipeId: string,
    operationId: string,
    foodStateId: string,
  ): Promise<OperationOutput> {
    return this.withLockedGraphMutation(recipeId, async (repository) => {
      const output = await repository.removeOperationOutput(
        recipeId,
        operationId,
        foodStateId,
      );
      if (!output) {
        throw new RecipeGraphEntityNotFoundError(
          "operationOutput",
          `${operationId}:${foodStateId}`,
        );
      }
      return output;
    });
  }

  private withLockedGraphMutation<Result>(
    recipeId: string,
    mutation: (repository: RecipeGraphRepository) => Promise<Result>,
  ): Promise<Result> {
    return database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${recipeId}::text, 0))`,
      );

      const repository = new RecipeGraphRepository(transaction);
      const result = await mutation(repository);
      await requireValidPersistedGraph(repository, recipeId);

      return result;
    });
  }
}

export const recipeGraphService = new RecipeGraphService();

function requireConnections(
  connection: "inputs" | "outputs",
  values: OperationConnectionValues[],
): void {
  if (values.length === 0) {
    throw new TypeError(`Operation ${connection} must contain at least one food state`);
  }
}

function requireValidRecipeDocument(input: RecipeDocument): RecipeDocument {
  const validation = validateRecipeDocument(input);
  if (!validation.valid) {
    throw new InvalidRecipeDocumentError(validation.errors);
  }
  return validation.document;
}

async function requireValidPersistedGraph(
  repository: RecipeGraphRepository,
  recipeId: string,
): Promise<RecipeGraph> {
  const graph = await repository.loadRecipeGraph(recipeId);
  if (!graph) {
    throw new RecipeGraphNotFoundError(recipeId);
  }

  const validation = validateRecipeGraph(graph);
  if (!validation.valid) {
    throw new RecipeGraphValidationError(validation.errors);
  }
  return graph;
}
