import { Mastra } from "@mastra/core";

import { actionExtractionAgent } from "./agents/action-extraction-agent";
import { ingredientExtractionAgent } from "./agents/ingredient-extraction-agent";
import { recipeIngestionAgent } from "./agents/recipe-ingestion-agent";
import { recipeIngestionWorkflow } from "./workflows/recipe-ingestion-workflow";

export const mastra = new Mastra({
  agents: {
    actionExtractionAgent,
    ingredientExtractionAgent,
    recipeIngestionAgent,
  },
  workflows: { recipeIngestionWorkflow },
});
