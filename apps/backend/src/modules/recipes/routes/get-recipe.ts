import {
  apiErrorSchema,
  savedRecipeDocumentSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { requireAuthentication } from "../../auth/middleware";
import { presentRecipeGraph } from "../presentation";
import { recipeGraphService } from "../recipe-graph-service";
import {
  recipeIdParamsSchema,
  recipeNotFoundErrorResponse,
} from "./shared";

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

export const getRecipeHandler: RouteHandler<
  typeof getRecipeRoute,
  AppEnvironment
> = async (context) => {
  const graph = await recipeGraphService.loadOwned(
    context.get("authenticatedUserId"),
    context.req.valid("param").recipeId,
  );

  if (!graph) {
    return context.json(recipeNotFoundErrorResponse, 404);
  }

  return context.json(presentRecipeGraph(graph), 200);
};
