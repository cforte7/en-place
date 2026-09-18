import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import {
  previewRecipeImportHandler,
  previewRecipeImportRoute,
} from "./preview-recipe-import";

export function registerRecipeImportRoutes(
  app: OpenAPIHono<AppEnvironment>,
): void {
  app.openapi(previewRecipeImportRoute, previewRecipeImportHandler);
}
