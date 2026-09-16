import {
  apiErrorSchema,
  recipeDocumentSchema,
  savedRecipeDocumentSchema,
  type SavedRecipeDocument,
} from "@en-place/contracts";
import { createRoute, type RouteHandler, z } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../http/environment";
import { recipesLogger } from "../../observability/logging";
import { requireAuthentication } from "../auth/middleware";
import {
  InvalidRecipeDocumentError,
  RecipeGraphNotFoundError,
  RecipeGraphValidationError,
  recipeGraphService,
} from "./recipe-graph-service";
import type { RecipeGraph } from "./recipe-graph";

const recipeIdParamsSchema = z.object({ recipeId: z.uuid() });

export const createRecipeRoute = createRoute({
  method: "post",
  path: "/recipes",
  operationId: "createRecipe",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  request: {
    body: {
      content: {
        "application/json": { schema: recipeDocumentSchema },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: savedRecipeDocumentSchema } },
      description: "The saved recipe",
    },
    400: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The request is invalid",
    },
    401: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "Authentication is required",
    },
    422: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe graph is invalid",
    },
    500: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "An unexpected error occurred",
    },
  },
});

export const getRecipeRoute = createRoute({
  method: "get",
  path: "/recipes/{recipeId}",
  operationId: "getRecipe",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: savedRecipeDocumentSchema } },
      description: "The saved recipe",
    },
    400: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe ID is invalid",
    },
    401: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "Authentication is required",
    },
    404: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe does not exist",
    },
    500: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "An unexpected error occurred",
    },
  },
});

export const updateRecipeRoute = createRoute({
  method: "put",
  path: "/recipes/{recipeId}",
  operationId: "updateRecipe",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  request: {
    params: recipeIdParamsSchema,
    body: {
      content: {
        "application/json": { schema: recipeDocumentSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: savedRecipeDocumentSchema } },
      description: "The updated recipe",
    },
    400: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The request is invalid",
    },
    401: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "Authentication is required",
    },
    404: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe does not exist",
    },
    422: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe graph is invalid",
    },
    500: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "An unexpected error occurred",
    },
  },
});

export const createRecipeHandler: RouteHandler<
  typeof createRecipeRoute,
  AppEnvironment
> = async (context) => {
  try {
    const graph = await recipeGraphService.create(
      context.get("authenticatedUserId"),
      context.req.valid("json"),
    );

    recipesLogger.info("Created recipe {recipeId}", {
      event: "recipe.created",
      recipeId: graph.recipe.id,
      userId: context.get("authenticatedUserId"),
      requestId: context.get("requestId"),
    });

    return context.json(presentRecipeGraph(graph), 201);
  } catch (error) {
    if (isInvalidRecipeError(error)) {
      return invalidRecipeResponse(context);
    }
    throw error;
  }
};

export const getRecipeHandler: RouteHandler<
  typeof getRecipeRoute,
  AppEnvironment
> = async (context) => {
  const graph = await recipeGraphService.loadOwned(
    context.get("authenticatedUserId"),
    context.req.valid("param").recipeId,
  );

  if (!graph) {
    return notFoundResponse(context);
  }

  return context.json(presentRecipeGraph(graph), 200);
};

export const updateRecipeHandler: RouteHandler<
  typeof updateRecipeRoute,
  AppEnvironment
> = async (context) => {
  const recipeId = context.req.valid("param").recipeId;

  try {
    const graph = await recipeGraphService.replace(
      context.get("authenticatedUserId"),
      recipeId,
      context.req.valid("json"),
    );

    recipesLogger.info("Updated recipe {recipeId}", {
      event: "recipe.updated",
      recipeId,
      userId: context.get("authenticatedUserId"),
      requestId: context.get("requestId"),
    });

    return context.json(presentRecipeGraph(graph), 200);
  } catch (error) {
    if (error instanceof RecipeGraphNotFoundError) {
      return notFoundResponse(context);
    }
    if (isInvalidRecipeError(error)) {
      return invalidRecipeResponse(context);
    }
    throw error;
  }
};

function presentRecipeGraph(graph: RecipeGraph): SavedRecipeDocument {
  return {
    id: graph.recipe.id,
    name: graph.recipe.name,
    createdAt: graph.recipe.createdAt.toISOString(),
    updatedAt: graph.recipe.updatedAt.toISOString(),
    foodStates: graph.foodStates.map((foodState) => ({
      id: foodState.id,
      name: foodState.name,
      position: { x: foodState.positionX, y: foodState.positionY },
    })),
    operations: graph.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      position: { x: operation.positionX, y: operation.positionY },
      inputs: graph.inputs
        .filter((input) => input.operationId === operation.id)
        .map(({ foodStateId }) => ({ foodStateId })),
      outputs: graph.outputs
        .filter((output) => output.operationId === operation.id)
        .map(({ foodStateId }) => ({ foodStateId })),
    })),
  };
}

function isInvalidRecipeError(error: unknown): boolean {
  return (
    error instanceof InvalidRecipeDocumentError ||
    error instanceof RecipeGraphValidationError
  );
}

function invalidRecipeResponse(
  context: Parameters<typeof createRecipeHandler>[0],
) {
  return context.json(
    {
      error: {
        code: "invalid_recipe" as const,
        message: "The recipe graph is invalid.",
      },
    },
    422,
  );
}

function notFoundResponse(context: Parameters<typeof getRecipeHandler>[0]) {
  return context.json(
    {
      error: {
        code: "not_found" as const,
        message: "The recipe was not found.",
      },
    },
    404,
  );
}
