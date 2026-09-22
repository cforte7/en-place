const stepTimeoutMs = Number(
  Bun.env.RECIPE_INGESTION_TIMEOUT_MS ?? 180_000,
);
if (
  !Number.isSafeInteger(stepTimeoutMs) ||
  stepTimeoutMs < 10_000 ||
  stepTimeoutMs > 600_000
) {
  throw new Error(
    "RECIPE_INGESTION_TIMEOUT_MS must be an integer between 10000 and 600000",
  );
}

export const recipeIngestionModel = (Bun.env.RECIPE_INGESTION_MODEL ??
  "openai/gpt-5.6-terra") as `${string}/${string}`;

export const recipeIngestionModelSettings = {
  temperature: 0,
  maxRetries: 1,
  timeout: { totalMs: stepTimeoutMs + 10_000, stepMs: stepTimeoutMs },
} as const;

export const recipeIngestionProviderOptions = {
  openai: {
    reasoningEffort: "low",
    textVerbosity: "low",
    store: false,
  },
} as const;
