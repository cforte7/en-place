import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  UnprocessableEntityError,
  type Fetch,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

const defaultDecisionModel = "jev-1.13";
const defaultDecisionTimeoutMs = 5_000;
const pinnedJevModelPattern = /^jev-\d+(?:\.\d+)+$/;

type RecipeDecisionEnvironment = Record<string, string | undefined>;

export type RecipeDecisionErrorKind =
  | "aborted"
  | "authentication"
  | "invalid_request"
  | "rate_limited"
  | "timeout"
  | "unavailable";

const errorMessages: Record<RecipeDecisionErrorKind, string> = {
  aborted: "The recipe decision request was aborted.",
  authentication: "The recipe decision provider rejected its credentials.",
  invalid_request: "The recipe decision provider rejected the request.",
  rate_limited: "The recipe decision provider rate limit was exceeded.",
  timeout: "The recipe decision provider timed out.",
  unavailable: "The recipe decision provider is unavailable.",
};

export class RecipeDecisionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeDecisionConfigurationError";
  }
}

export class RecipeDecisionError extends Error {
  readonly providerRequestId: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    readonly kind: RecipeDecisionErrorKind,
    cause: TypeSafeError,
  ) {
    super(errorMessages[kind]);
    this.name = "RecipeDecisionError";
    this.providerRequestId =
      cause instanceof APIError ? (cause.requestId ?? null) : null;
    this.retryAfterMs =
      cause instanceof RateLimitError ? (cause.retryAfterMs ?? null) : null;
  }
}

let sharedClient: TypeSafeClient | undefined;

export function getTypeSafeClient(): TypeSafeClient {
  sharedClient ??= createTypeSafeClient(Bun.env);
  return sharedClient;
}

export function createTypeSafeClient(
  environment: RecipeDecisionEnvironment,
  fetch?: Fetch,
): TypeSafeClient {
  const apiKey = environment.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new RecipeDecisionConfigurationError(
      "TYPESAFE_API_KEY is required for recipe decisions.",
    );
  }

  const model = (
    environment.RECIPE_DECISION_MODEL ?? defaultDecisionModel
  ).trim();
  if (!pinnedJevModelPattern.test(model)) {
    throw new RecipeDecisionConfigurationError(
      "RECIPE_DECISION_MODEL must be a pinned Jev version such as jev-1.13.",
    );
  }

  const timeoutValue =
    environment.RECIPE_DECISION_TIMEOUT_MS ??
    String(defaultDecisionTimeoutMs);
  const timeout = Number(timeoutValue);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new RecipeDecisionConfigurationError(
      "RECIPE_DECISION_TIMEOUT_MS must be a positive integer.",
    );
  }

  return new TypeSafeClient({
    apiKey,
    defaultModel: model,
    timeout,
    logLevel: "warn",
    ...(fetch ? { fetch } : {}),
  });
}

export async function requestRecipeDecision<const Q extends Questions>(
  request: Omit<SystemOneRequest<Q>, "model">,
  signal?: AbortSignal,
  client: TypeSafeClient = getTypeSafeClient(),
): Promise<SystemOneResult<Q>> {
  try {
    return await client.systemOne(
      { ...request, model: client.defaultModel },
      signal ? { signal } : undefined,
    );
  } catch (error) {
    throwLocalizedTypeSafeError(error);
  }
}

function throwLocalizedTypeSafeError(error: unknown): never {
  if (error instanceof APIUserAbortError) {
    throw new RecipeDecisionError("aborted", error);
  }
  if (error instanceof APITimeoutError) {
    throw new RecipeDecisionError("timeout", error);
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    throw new RecipeDecisionError("authentication", error);
  }
  if (error instanceof RateLimitError) {
    throw new RecipeDecisionError("rate_limited", error);
  }
  if (
    error instanceof BadRequestError ||
    error instanceof UnprocessableEntityError
  ) {
    throw new RecipeDecisionError("invalid_request", error);
  }
  if (error instanceof APIConnectionError || error instanceof APIError) {
    throw new RecipeDecisionError("unavailable", error);
  }
  if (error instanceof TypeSafeError) {
    throw new RecipeDecisionError("invalid_request", error);
  }
  throw error;
}
