import { z } from "@hono/zod-openapi";

import {
  InvalidRecipeDocumentError,
  RecipeGraphValidationError,
} from "../recipe-graph-service";

export const recipeIdParamsSchema = z.object({ recipeId: z.uuid() });

export const invalidRecipeErrorResponse = {
  error: {
    code: "invalid_recipe",
    message: "The recipe graph is invalid.",
  },
} as const;

export const recipeNotFoundErrorResponse = {
  error: {
    code: "not_found",
    message: "The recipe was not found.",
  },
} as const;

export function isInvalidRecipeError(error: unknown): boolean {
  return (
    error instanceof InvalidRecipeDocumentError ||
    error instanceof RecipeGraphValidationError
  );
}
