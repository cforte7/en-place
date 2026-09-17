import { apiErrorSchema, recipeListResponseSchema } from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { requireAuthentication } from "../../auth/middleware";
import { presentRecipeSummary } from "../presentation";
import { recipeGraphService } from "../recipe-graph-service";

export const listRecipesRoute = createRoute({
  method: "get",
  path: "/recipes",
  operationId: "listRecipes",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  responses: {
    200: {
      content: { "application/json": { schema: recipeListResponseSchema } },
      description: "The authenticated user's recipes",
    },
    401: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "Authentication is required",
    },
    500: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "An unexpected error occurred",
    },
  },
});

export const listRecipesHandler: RouteHandler<
  typeof listRecipesRoute,
  AppEnvironment
> = async (context) => {
  const recipes = await recipeGraphService.listOwned(
    context.get("authenticatedUserId"),
  );

  return context.json(recipes.map(presentRecipeSummary), 200);
};
