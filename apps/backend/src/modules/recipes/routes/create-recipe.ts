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
import { recipeGraphService } from "../recipe-graph-service";
import {
  invalidRecipeErrorResponse,
  isInvalidRecipeError,
} from "./shared";

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
      return context.json(invalidRecipeErrorResponse, 422);
    }
    throw error;
  }
};
