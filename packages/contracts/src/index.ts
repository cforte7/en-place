import { z } from "zod";

export const serviceHealthSchema = z.object({
  service: z.literal("en-place-backend"),
  status: z.literal("ok"),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320));

export const passwordSchema = z.string().min(1).max(1024);

export const createUserRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const authenticatedSessionResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  user: userResponseSchema,
});

export type AuthenticatedSessionResponse = z.infer<
  typeof authenticatedSessionResponseSchema
>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "invalid_recipe",
      "email_taken",
      "invalid_credentials",
      "unauthorized",
      "not_found",
      "recipe_ingestion_unavailable",
      "internal_error",
    ]),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

const recipeEntityIdSchema = z.uuid();
const recipeMetadataSchema = z.record(z.string(), z.unknown());
const nullableRecipeTextSchema = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength).nullable().default(null);
export const recipeQuantitySchema = z
  .string()
  .trim()
  .regex(
    /^(?:0*[1-9]\d*(?:\.\d*)?|0*\.\d*[1-9]\d*)$/,
    "Quantity must be a positive decimal string.",
  );

export const recipeNodePositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const recipeFoodStateDocumentSchema = z
  .object({
    id: recipeEntityIdSchema,
    name: z.string().trim().min(1).max(200),
    description: nullableRecipeTextSchema(2_000),
    metadata: recipeMetadataSchema.default({}),
    position: recipeNodePositionSchema,
  })
  .strict();

export const recipeOperationConnectionDocumentSchema = z
  .object({
    foodStateId: recipeEntityIdSchema,
    quantity: recipeQuantitySchema.nullable().default(null),
    unit: nullableRecipeTextSchema(100),
    metadata: recipeMetadataSchema.default({}),
  })
  .strict();

export const recipeOperationDocumentSchema = z
  .object({
    id: recipeEntityIdSchema,
    type: z.string().trim().min(1).max(200),
    name: nullableRecipeTextSchema(200),
    instructions: nullableRecipeTextSchema(10_000),
    estimatedDurationSeconds: z.int().nonnegative().nullable().default(null),
    config: recipeMetadataSchema.default({}),
    position: recipeNodePositionSchema,
    inputs: z.array(recipeOperationConnectionDocumentSchema),
    outputs: z.array(recipeOperationConnectionDocumentSchema),
  })
  .strict();

export const recipeDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: nullableRecipeTextSchema(5_000),
    foodStates: z.array(recipeFoodStateDocumentSchema),
    operations: z.array(recipeOperationDocumentSchema),
  })
  .strict();

export type RecipeDocument = z.infer<typeof recipeDocumentSchema>;

export const recipeIngestionRequestSchema = z
  .object({
    name: recipeDocumentSchema.shape.name,
    description: z.string().trim().min(1).max(5_000).nullable(),
    ingredientsText: z.string().trim().min(1).max(25_000),
    instructionsText: z.string().trim().min(1).max(25_000),
  })
  .strict();

export type RecipeIngestionRequest = z.infer<
  typeof recipeIngestionRequestSchema
>;


export const recipeIngestionWarningSchema = z
  .object({
    code: z.enum([
      "ambiguous_link",
      "unused_ingredient",
      "unlisted_ingredient",
      "inexact_quantity",
      "model_assumption",
      "repair_applied",
    ]),
    message: z.string().trim().min(1).max(1_000),
    operationId: recipeEntityIdSchema.nullable(),
    foodStateId: recipeEntityIdSchema.nullable(),
    alternatives: z.array(
      z
        .object({
          foodStateId: recipeEntityIdSchema,
          label: z.string().trim().min(1).max(200),
        })
        .strict(),
    ),
  })
  .strict();

export type RecipeIngestionWarning = z.infer<
  typeof recipeIngestionWarningSchema
>;

export const recipeIngestionPreviewSchema = z
  .object({
    recipe: recipeDocumentSchema,
    warnings: z.array(recipeIngestionWarningSchema),
  })
  .strict();

export type RecipeIngestionPreview = z.infer<
  typeof recipeIngestionPreviewSchema
>;

export const savedRecipeDocumentSchema = recipeDocumentSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type SavedRecipeDocument = z.infer<typeof savedRecipeDocumentSchema>;

export const recipeSummarySchema = z
  .object({
    id: z.uuid(),
    name: recipeDocumentSchema.shape.name,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

export const recipeListResponseSchema = z.array(recipeSummarySchema);

export type RecipeListResponse = z.infer<typeof recipeListResponseSchema>;

export type RecipeDocumentValidationError =
  | { code: "INVALID_DOCUMENT"; message: string; path: PropertyKey[] }
  | { code: "DUPLICATE_NODE_ID"; nodeId: string; message: string }
  | {
      code: "MISSING_FOOD_STATE";
      operationId: string;
      foodStateId: string;
      message: string;
    }
  | {
      code: "DUPLICATE_CONNECTION";
      connection: "input" | "output";
      operationId: string;
      foodStateId: string;
      message: string;
    }
  | { code: "OPERATION_HAS_NO_INPUTS"; operationId: string; message: string }
  | { code: "OPERATION_HAS_NO_OUTPUTS"; operationId: string; message: string }
  | {
      code: "MULTIPLE_PRODUCERS";
      foodStateId: string;
      operationIds: [string, string];
      message: string;
    }
  | { code: "CYCLE_DETECTED"; message: string };

export type RecipeDocumentValidationResult =
  | { valid: true; document: RecipeDocument }
  | { valid: false; errors: RecipeDocumentValidationError[] };

export function validateRecipeDocument(
  input: unknown,
): RecipeDocumentValidationResult {
  const parsed = recipeDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "INVALID_DOCUMENT",
        message: issue.message,
        path: issue.path,
      })),
    };
  }

  const document = parsed.data;
  const errors: RecipeDocumentValidationError[] = [];
  const nodeIds = new Set<string>();
  const foodStateIds = new Set(document.foodStates.map(({ id }) => id));
  const producerByFoodStateId = new Map<string, string>();
  const adjacency = new Map(
    document.foodStates.map(({ id }) => [id, new Set<string>()]),
  );

  for (const node of [...document.foodStates, ...document.operations]) {
    if (nodeIds.has(node.id)) {
      errors.push({
        code: "DUPLICATE_NODE_ID",
        nodeId: node.id,
        message: "Every ingredient and cooking step must have a unique ID.",
      });
    }
    nodeIds.add(node.id);
  }

  for (const operation of document.operations) {
    if (operation.inputs.length === 0) {
      errors.push({
        code: "OPERATION_HAS_NO_INPUTS",
        operationId: operation.id,
        message: `"${operation.type}" needs at least one ingredient or prior result.`,
      });
    }
    if (operation.outputs.length === 0) {
      errors.push({
        code: "OPERATION_HAS_NO_OUTPUTS",
        operationId: operation.id,
        message: `"${operation.type}" needs at least one result.`,
      });
    }

    const inputIds = validateConnections(
      "input",
      operation.id,
      operation.inputs,
      foodStateIds,
      errors,
    );
    const outputIds = validateConnections(
      "output",
      operation.id,
      operation.outputs,
      foodStateIds,
      errors,
    );

    for (const foodStateId of outputIds) {
      const existingProducerId = producerByFoodStateId.get(foodStateId);
      if (existingProducerId && existingProducerId !== operation.id) {
        errors.push({
          code: "MULTIPLE_PRODUCERS",
          foodStateId,
          operationIds: [existingProducerId, operation.id],
          message:
            "An ingredient or result can only be produced by one cooking step.",
        });
      } else {
        producerByFoodStateId.set(foodStateId, operation.id);
      }
    }

    for (const inputId of inputIds) {
      const downstream = adjacency.get(inputId);
      if (!downstream) {
        continue;
      }
      for (const outputId of outputIds) {
        if (foodStateIds.has(outputId)) {
          downstream.add(outputId);
        }
      }
    }
  }

  if (hasCycle(adjacency)) {
    errors.push({
      code: "CYCLE_DETECTED",
      message: "Cooking steps cannot form a cycle.",
    });
  }

  return errors.length === 0
    ? { valid: true, document }
    : { valid: false, errors };
}

function validateConnections(
  connection: "input" | "output",
  operationId: string,
  connections: Array<{ foodStateId: string }>,
  foodStateIds: Set<string>,
  errors: RecipeDocumentValidationError[],
): Set<string> {
  const connectedIds = new Set<string>();

  for (const { foodStateId } of connections) {
    if (!foodStateIds.has(foodStateId)) {
      errors.push({
        code: "MISSING_FOOD_STATE",
        operationId,
        foodStateId,
        message:
          "A connection points to an ingredient or result that does not exist.",
      });
    }
    if (connectedIds.has(foodStateId)) {
      errors.push({
        code: "DUPLICATE_CONNECTION",
        connection,
        operationId,
        foodStateId,
        message: "The same nodes cannot be connected more than once.",
      });
    }
    connectedIds.add(foodStateId);
  }

  return connectedIds;
}

function hasCycle(adjacency: Map<string, Set<string>>): boolean {
  const visited = new Set<string>();
  const active = new Set<string>();

  function visit(foodStateId: string): boolean {
    if (active.has(foodStateId)) {
      return true;
    }
    if (visited.has(foodStateId)) {
      return false;
    }

    visited.add(foodStateId);
    active.add(foodStateId);
    for (const downstreamId of adjacency.get(foodStateId) ?? []) {
      if (visit(downstreamId)) {
        return true;
      }
    }
    active.delete(foodStateId);
    return false;
  }

  return [...adjacency.keys()].some(visit);
}
