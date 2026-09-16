import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { createRecipeHandler, createRecipeRoute } from "./create-recipe";
import { getRecipeHandler, getRecipeRoute } from "./get-recipe";
import { updateRecipeHandler, updateRecipeRoute } from "./update-recipe";

export function registerRecipeRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(createRecipeRoute, createRecipeHandler);
  app.openapi(getRecipeRoute, getRecipeHandler);
  app.openapi(updateRecipeRoute, updateRecipeHandler);
}
