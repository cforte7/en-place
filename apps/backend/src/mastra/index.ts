import { Mastra } from "@mastra/core";

import { recipeIngestionAgent } from "./agents/recipe-ingestion-agent";
import { recipeIngestionWorkflow } from "./workflows/recipe-ingestion-workflow";

export const mastra = new Mastra({
  agents: { recipeIngestionAgent },
  workflows: { recipeIngestionWorkflow },
});
