import {
  apiErrorSchema,
  recipeIngestionPreviewSchema,
  recipeIngestionRequestSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { recipeIngestionLogger } from "../../../observability/logging";
import { requireAuthentication } from "../../auth/middleware";
import {
  previewRecipeIngestion,
  RecipeIngestionUnavailableError,
} from "../recipe-ingestion-service";

const ingestionUnavailableResponse = {
  error: {
    code: "recipe_ingestion_unavailable",
    message: "The recipe could not be converted into a valid preview.",
  },
} as const;

export const previewRecipeImportRoute = createRoute({
  method: "post",
  path: "/recipe-imports/preview",
  operationId: "previewRecipeImport",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  request: {
    body: {
      content: {
        "application/json": { schema: recipeIngestionRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: recipeIngestionPreviewSchema } },
      description: "An unsaved recipe graph preview",
    },
    400: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The recipe ingestion request is invalid",
    },
    401: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "Authentication is required",
    },
    502: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "The configured model could not produce a valid recipe graph",
    },
    500: {
      content: { "application/json": { schema: apiErrorSchema } },
      description: "An unexpected error occurred",
    },
  },
});

export const previewRecipeImportHandler: RouteHandler<
  typeof previewRecipeImportRoute,
  AppEnvironment
> = async (context) => {
  try {
    const body = context.req.valid("json");
    const preview = await previewRecipeIngestion(
      context.get("authenticatedUserId"),
      context.get("requestId"),
      body,
    );

    recipeIngestionLogger.info("Generated recipe ingestion preview", {
      event: "recipe_ingestion.preview.generated",
      userId: context.get("authenticatedUserId"),
      requestId: context.get("requestId"),
      foodStateCount: preview.recipe.foodStates.length,
      operationCount: preview.recipe.operations.length,
      warningCount: preview.warnings.length,
    });

    return context.json(preview, 200);
  } catch (error) {
    if (error instanceof RecipeIngestionUnavailableError) {
      recipeIngestionLogger.warning("Recipe ingestion preview failed", {
        event: "recipe_ingestion.preview.failed",
        userId: context.get("authenticatedUserId"),
        requestId: context.get("requestId"),
        errorName:
          error.cause instanceof Error ? error.cause.name : "UnknownError",
      });
      return context.json(ingestionUnavailableResponse, 502);
    }
    throw error;
  }
};
