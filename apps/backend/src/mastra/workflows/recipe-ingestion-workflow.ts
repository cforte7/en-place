import {
  recipeIngestionCandidateSchema,
  recipeIngestionPreviewSchema,
  recipeIngestionRequestSchema,
} from "@en-place/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { normalizeRecipeIngestionCandidate } from "./normalize-recipe-ingestion";

export const recipeIngestionRequestContextSchema = z.object({
  userId: z.string().uuid(),
  requestId: z.string().min(1),
});

export type RecipeIngestionRequestContext = z.infer<
  typeof recipeIngestionRequestContextSchema
>;

const extractRecipe = createStep({
  id: "extract-recipe",
  description: "Extract a symbolic cooking graph from recipe ingredients and instructions",
  inputSchema: recipeIngestionRequestSchema,
  outputSchema: recipeIngestionCandidateSchema,
  execute: async ({ inputData, mastra, requestContext, abortSignal }) => {
    const agent = mastra.getAgent("recipeIngestionAgent");
    const response = await agent.generate(
      JSON.stringify({
        sourceRecipe: {
          name: inputData.name,
          description: inputData.description,
          ingredients: inputData.ingredientsText,
          instructions: inputData.instructionsText,
        },
      }),
      {
        requestContext,
        abortSignal,
      },
    );

    if (!response.object) {
      throw new Error("Recipe ingestion agent returned no structured output");
    }

    const candidate = recipeIngestionCandidateSchema.parse(response.object);

    return {
      ...candidate,
      name: inputData.name,
      description: inputData.description,
    };
  },
});

const normalizeRecipe = createStep({
  id: "normalize-recipe",
  description: "Resolve graph references, lay out nodes, and validate the recipe",
  inputSchema: recipeIngestionCandidateSchema,
  outputSchema: recipeIngestionPreviewSchema,
  execute: async ({ inputData }) => normalizeRecipeIngestionCandidate(inputData),
});

export const recipeIngestionWorkflow = createWorkflow({
  id: "recipe-ingestion-workflow",
  inputSchema: recipeIngestionRequestSchema,
  outputSchema: recipeIngestionPreviewSchema,
  requestContextSchema: recipeIngestionRequestContextSchema,
})
  .then(extractRecipe)
  .then(normalizeRecipe)
  .commit();
