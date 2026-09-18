import type {
  RecipeIngestionPreview,
  RecipeIngestionRequest,
} from "@en-place/contracts";
import { RequestContext } from "@mastra/core/request-context";

import { mastra } from "../../mastra";
import type { RecipeIngestionRequestContext } from "../../mastra/workflows/recipe-ingestion-workflow";
import type { UserId } from "../users/user-id";

export class RecipeIngestionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Recipe ingestion could not produce a valid preview", { cause });
    this.name = "RecipeIngestionUnavailableError";
  }
}

export async function previewRecipeIngestion(
  ownerId: UserId,
  requestId: string,
  input: RecipeIngestionRequest,
): Promise<RecipeIngestionPreview> {
  const requestContext = new RequestContext<RecipeIngestionRequestContext>();
  requestContext.set("userId", ownerId);
  requestContext.set("requestId", requestId);

  try {
    const workflow = mastra.getWorkflow("recipeIngestionWorkflow");
    const run = await workflow.createRun();
    const result = await run.start({ inputData: input, requestContext });

    if (result.status !== "success") {
      const cause = result.status === "failed" ? result.error : result.status;
      throw new RecipeIngestionUnavailableError(cause);
    }

    return result.result;
  } catch (error) {
    if (error instanceof RecipeIngestionUnavailableError) {
      throw error;
    }
    throw new RecipeIngestionUnavailableError(error);
  }
}
