import type { RecipeSummary, SavedRecipeDocument } from "@en-place/contracts";

import type { Recipe } from "../../database/schema";
import type { RecipeGraph } from "./recipe-graph";

export function presentRecipeSummary(recipe: Recipe): RecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

export function presentRecipeGraph(graph: RecipeGraph): SavedRecipeDocument {
  return {
    id: graph.recipe.id,
    name: graph.recipe.name,
    createdAt: graph.recipe.createdAt.toISOString(),
    updatedAt: graph.recipe.updatedAt.toISOString(),
    foodStates: graph.foodStates.map((foodState) => ({
      id: foodState.id,
      name: foodState.name,
      position: { x: foodState.positionX, y: foodState.positionY },
    })),
    operations: graph.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      position: { x: operation.positionX, y: operation.positionY },
      inputs: graph.inputs
        .filter((input) => input.operationId === operation.id)
        .map(({ foodStateId }) => ({ foodStateId })),
      outputs: graph.outputs
        .filter((output) => output.operationId === operation.id)
        .map(({ foodStateId }) => ({ foodStateId })),
    })),
  };
}
