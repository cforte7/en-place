import {
  recipeIngestionPreviewSchema,
  recipeIngestionRequestSchema,
} from "@en-place/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  createActionExtractionSchema,
  createIngredientExtractionSchema,
  extractedRecipePartsSchema,
  prepareRecipeSource,
  recipeIngestionCandidateSchema,
  type ExtractedRecipeParts,
  type PreparedRecipeSource,
} from "./recipe-ingestion-schemas";
import { normalizeRecipeIngestionCandidate } from "./normalize-recipe-ingestion";

export const recipeIngestionRequestContextSchema = z.object({
  userId: z.string().uuid(),
  requestId: z.string().min(1),
});

export type RecipeIngestionRequestContext = z.infer<
  typeof recipeIngestionRequestContextSchema
>;

export async function extractRecipeParts(
  source: PreparedRecipeSource,
  extractors: {
    ingredients: () => Promise<unknown>;
    actions: () => Promise<unknown>;
  },
): Promise<ExtractedRecipeParts> {
  const [ingredientOutput, actionOutput] = await Promise.all([
    extractors.ingredients(),
    extractors.actions(),
  ]);

  return extractedRecipePartsSchema.parse({
    source,
    ingredientExtraction:
      createIngredientExtractionSchema(source).parse(ingredientOutput),
    actionExtraction:
      createActionExtractionSchema(source).parse(actionOutput),
  });
}

const extractRecipePartsStep = createStep({
  id: "extract-recipe-parts",
  description: "Extract ingredient and action facts concurrently",
  inputSchema: recipeIngestionRequestSchema,
  outputSchema: extractedRecipePartsSchema,
  execute: async ({ inputData, mastra, requestContext, abortSignal }) => {
    const source = prepareRecipeSource(inputData);
    const ingredientAgent = mastra.getAgent("ingredientExtractionAgent");
    const actionAgent = mastra.getAgent("actionExtractionAgent");

    return extractRecipeParts(source, {
      ingredients: async () => {
        const response = await ingredientAgent.generate(
          JSON.stringify({ ingredientLines: source.ingredientLines }),
          { requestContext, abortSignal },
        );
        if (!response.object) {
          throw new Error(
            "Ingredient extraction agent returned no structured output",
          );
        }
        return response.object;
      },
      actions: async () => {
        const response = await actionAgent.generate(
          JSON.stringify({
            instructionSteps: source.instructionSteps,
            ingredientLines: source.ingredientLines,
          }),
          { requestContext, abortSignal },
        );
        if (!response.object) {
          throw new Error(
            "Action extraction agent returned no structured output",
          );
        }
        return response.object;
      },
    });
  },
});

const assembleCandidate = createStep({
  id: "assemble-recipe-candidate",
  description: "Assemble a temporary graph candidate during staged cutover",
  inputSchema: extractedRecipePartsSchema,
  outputSchema: recipeIngestionCandidateSchema,
  execute: async ({ inputData, mastra, requestContext, abortSignal }) => {
    const agent = mastra.getAgent("recipeIngestionAgent");
    const response = await agent.generate(JSON.stringify(inputData), {
      requestContext,
      abortSignal,
    });

    if (!response.object) {
      throw new Error(
        "Recipe graph assembly agent returned no structured output",
      );
    }

    const candidate = recipeIngestionCandidateSchema.parse(response.object);
    return {
      ...candidate,
      name: inputData.source.name,
      description: inputData.source.description,
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
  .then(extractRecipePartsStep)
  .then(assembleCandidate)
  .then(normalizeRecipe)
  .commit();
