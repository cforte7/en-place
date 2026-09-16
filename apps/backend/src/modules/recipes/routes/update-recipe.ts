import {
  apiErrorSchema,
  recipeDocumentSchema,
  savedRecipeDocumentSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { recipesLogger } from "../../../observability/logging";
import { requireAuthentication } from "../../auth/middleware";
import { presentRecipeGraph } from "../presentation";
import {
  RecipeGraphNotFoundError,
  recipeGraphService,
} from "../recipe-graph-service";
import {
  invalidRecipeErrorResponse,
  isInvalidRecipeError,
  recipeIdParamsSchema,
  recipeNotFoundErrorResponse,
} from "./shared";

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
      return context.json(recipeNotFoundErrorResponse, 404);
    }
    if (isInvalidRecipeError(error)) {
      return context.json(invalidRecipeErrorResponse, 422);
    }
    throw error;
  }
};
