import {
  recipeIngestionRequestSchema,
  recipeQuantitySchema,
  type RecipeIngestionRequest,
} from "@en-place/contracts";
import { z } from "zod";

const ingredientSourceLineIdSchema = z
  .string()
  .regex(/^I[1-9]\d*$/, "Ingredient source IDs must use the I1 scheme.");
const instructionStepIdSchema = z
  .string()
  .regex(/^S[1-9]\d*$/, "Instruction source IDs must use the S1 scheme.");
const extractedActionIdSchema = z
  .string()
  .regex(
    /^S[1-9]\d*-A[1-9]\d*$/,
    "Extracted action IDs must use the S1-A1 scheme.",
  );
const extractionPositionSchema = z.int().nonnegative();
const warningTextSchema = z.string().trim().min(1).max(1_000);
const sourceQuantityTextSchema = z.string().trim().min(1).max(100).nullable();
const unitSchema = z.string().trim().min(1).max(100).nullable();

const preparedIngredientLineSchema = z
  .object({
    id: ingredientSourceLineIdSchema,
    text: z.string().trim().min(1),
    position: extractionPositionSchema,
  })
  .strict();

const preparedInstructionStepSchema = z
  .object({
    id: instructionStepIdSchema,
    text: z.string().trim().min(1),
    position: extractionPositionSchema,
  })
  .strict();

export const preparedRecipeSourceSchema = z
  .object({
    name: recipeIngestionRequestSchema.shape.name,
    description: recipeIngestionRequestSchema.shape.description,
    ingredientLines: z.array(preparedIngredientLineSchema).min(1),
    instructionSteps: z.array(preparedInstructionStepSchema).min(1),
  })
  .strict()
  .superRefine((source, context) => {
    requireSequentialSourceLines(
      source.ingredientLines,
      "I",
      "ingredientLines",
      context,
    );
    requireSequentialSourceLines(
      source.instructionSteps,
      "S",
      "instructionSteps",
      context,
    );
  });

export type PreparedRecipeSource = z.infer<typeof preparedRecipeSourceSchema>;

export function prepareRecipeSource(
  input: RecipeIngestionRequest,
): PreparedRecipeSource {
  const request = recipeIngestionRequestSchema.parse(input);

  return preparedRecipeSourceSchema.parse({
    name: request.name,
    description: request.description,
    ingredientLines: splitSourceLines(request.ingredientsText).map(
      (text, position) => ({
        id: `I${position + 1}`,
        text,
        position,
      }),
    ),
    instructionSteps: splitSourceLines(request.instructionsText).map(
      (text, position) => ({
        id: `S${position + 1}`,
        text,
        position,
      }),
    ),
  });
}

export function createExtractedIngredientId(
  sourceLineId: string,
  position: number,
): string {
  return `${ingredientSourceLineIdSchema.parse(sourceLineId)}-${ordinal(position)}`;
}

export function createExtractedActionId(
  sourceStepId: string,
  position: number,
): string {
  return `${instructionStepIdSchema.parse(sourceStepId)}-A${ordinal(position)}`;
}

export function createInputMentionId(
  actionId: string,
  position: number,
): string {
  return `${extractedActionIdSchema.parse(actionId)}-M${ordinal(position)}`;
}

export function createActionOutputId(
  actionId: string,
  position: number,
): string {
  return `${extractedActionIdSchema.parse(actionId)}-O${ordinal(position)}`;
}

const ingredientExtractionItemSchema = z
  .object({
    sourceLineId: ingredientSourceLineIdSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000).nullable(),
    quantity: recipeQuantitySchema.nullable(),
    sourceQuantityText: sourceQuantityTextSchema,
    unit: unitSchema,
    preparationText: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine(requireSourceTextForNormalizedQuantity);

export const ingredientExtractionSchema = z
  .object({
    ingredients: z.array(ingredientExtractionItemSchema),
    warnings: z.array(warningTextSchema),
  })
  .strict();

export type IngredientExtraction = z.infer<typeof ingredientExtractionSchema>;

const inputMentionSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    quantity: recipeQuantitySchema.nullable(),
    sourceQuantityText: sourceQuantityTextSchema,
    unit: unitSchema,
  })
  .strict()
  .superRefine(requireSourceTextForNormalizedQuantity);

const actionExtractionItemSchema = z
  .object({
    sourceStepId: instructionStepIdSchema,
    name: z.string().trim().min(1).max(200).nullable(),
    instructions: z.string().trim().min(1).max(10_000),
    estimatedDurationSeconds: z.int().nonnegative().nullable(),
    inputMentions: z.array(inputMentionSchema),
    outputs: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            description: z.string().trim().min(1).max(2_000).nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const actionExtractionSchema = z
  .object({
    actions: z.array(actionExtractionItemSchema),
    warnings: z.array(warningTextSchema),
  })
  .strict();

export type ActionExtraction = z.infer<typeof actionExtractionSchema>;

export const extractedRecipePartsSchema = z
  .object({
    source: preparedRecipeSourceSchema,
    ingredientExtraction: ingredientExtractionSchema,
    actionExtraction: actionExtractionSchema,
  })
  .strict();

export type ExtractedRecipeParts = z.infer<typeof extractedRecipePartsSchema>;

export const recipeIngestionRepairSchema = z
  .object({
    ingredientRevisions: z.array(ingredientExtractionItemSchema),
    actionRevisions: z.array(actionExtractionItemSchema),
    warnings: z.array(warningTextSchema),
  })
  .strict();

export type RecipeIngestionRepair = z.infer<
  typeof recipeIngestionRepairSchema
>;

export function createIngredientExtractionSchema(
  source: PreparedRecipeSource,
) {
  const preparedSource = preparedRecipeSourceSchema.parse(source);
  const sourceLineIds = new Set(
    preparedSource.ingredientLines.map(({ id }) => id),
  );

  return ingredientExtractionSchema.superRefine((extraction, context) => {
    extraction.ingredients.forEach(({ sourceLineId }, position) => {
      if (!sourceLineIds.has(sourceLineId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown ingredient source line ID "${sourceLineId}".`,
          path: ["ingredients", position, "sourceLineId"],
        });
      }
    });
  });
}

export function createActionExtractionSchema(source: PreparedRecipeSource) {
  const preparedSource = preparedRecipeSourceSchema.parse(source);
  const sourceStepIds = new Set(
    preparedSource.instructionSteps.map(({ id }) => id),
  );

  return actionExtractionSchema.superRefine((extraction, context) => {
    extraction.actions.forEach(({ sourceStepId }, position) => {
      if (!sourceStepIds.has(sourceStepId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown instruction source step ID "${sourceStepId}".`,
          path: ["actions", position, "sourceStepId"],
        });
      }
    });
  });
}

const recipeIngestionEntityKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Keys must contain lowercase letters, numbers, and single hyphens.",
  );

export const recipeIngestionCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5_000).nullable(),
    foodStates: z
      .array(
        z
          .object({
            key: recipeIngestionEntityKeySchema,
            name: z.string().trim().min(1).max(200),
            description: z.string().trim().min(1).max(2_000).nullable(),
          })
          .strict(),
      )
      .min(1),
    operations: z
      .array(
        z
          .object({
            key: recipeIngestionEntityKeySchema,
            type: z.enum([
              "prepare",
              "combine",
              "cook",
              "rest",
              "serve",
              "other",
            ]),
            name: z.string().trim().min(1).max(200).nullable(),
            instructions: z.string().trim().min(1).max(10_000),
            estimatedDurationSeconds: z.int().nonnegative().nullable(),
            inputs: z
              .array(
                z
                  .object({
                    foodStateKey: recipeIngestionEntityKeySchema,
                    quantity: recipeQuantitySchema.nullable(),
                    sourceQuantityText: sourceQuantityTextSchema,
                    unit: unitSchema,
                  })
                  .strict(),
              )
              .min(1),
            outputs: z
              .array(
                z
                  .object({
                    foodStateKey: recipeIngestionEntityKeySchema,
                    quantity: recipeQuantitySchema.nullable(),
                    sourceQuantityText: sourceQuantityTextSchema,
                    unit: unitSchema,
                  })
                  .strict(),
              )
              .min(1),
            sourceStepNumbers: z.array(z.int().positive()).min(1),
          })
          .strict(),
      )
      .min(1),
    warnings: z.array(warningTextSchema),
  })
  .strict();

export type RecipeIngestionCandidate = z.infer<
  typeof recipeIngestionCandidateSchema
>;

function splitSourceLines(text: string): string[] {
  return text
    .split(/\r\n|[\n\r]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ordinal(position: number): number {
  return extractionPositionSchema.parse(position) + 1;
}

function requireSequentialSourceLines(
  lines: ReadonlyArray<{ id: string; position: number }>,
  idPrefix: "I" | "S",
  path: "ingredientLines" | "instructionSteps",
  context: z.RefinementCtx,
): void {
  lines.forEach((line, position) => {
    if (line.id !== `${idPrefix}${position + 1}`) {
      context.addIssue({
        code: "custom",
        message: `Source IDs must be sequential from ${idPrefix}1.`,
        path: [path, position, "id"],
      });
    }
    if (line.position !== position) {
      context.addIssue({
        code: "custom",
        message: "Source positions must be zero-based and sequential.",
        path: [path, position, "position"],
      });
    }
  });
}

function requireSourceTextForNormalizedQuantity(
  value: { quantity: string | null; sourceQuantityText: string | null },
  context: z.RefinementCtx,
): void {
  if (value.quantity !== null && value.sourceQuantityText === null) {
    context.addIssue({
      code: "custom",
      message: "sourceQuantityText is required when quantity is normalized.",
      path: ["sourceQuantityText"],
    });
  }
}
