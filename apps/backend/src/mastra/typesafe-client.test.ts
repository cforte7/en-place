import { describe, expect, test } from "bun:test";
import {
  TypeSafeClient,
  noul,
  type Fetch,
} from "@typesafe-ai/sdk";

import {
  RecipeDecisionConfigurationError,
  createTypeSafeClient,
  getTypeSafeClient,
  requestRecipeDecision,
} from "./typesafe-client";

const decisionRequest = {
  state: { action: "test action" },
  questions: {
    supported: noul("Is this action supported?"),
  },
};

function makeClient(fetch: Fetch, timeout = 1_000) {
  return new TypeSafeClient({
    apiKey: "test-api-key",
    defaultModel: "jev-1.13",
    timeout,
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch,
  });
}

describe("createTypeSafeClient", () => {
  test("uses the pinned default model, configured timeout, and warning logging", () => {
    const client = createTypeSafeClient({
      TYPESAFE_API_KEY: " test-api-key ",
      RECIPE_DECISION_MODEL: "jev-2.4",
      RECIPE_DECISION_TIMEOUT_MS: "7500",
    });

    expect(client.defaultModel).toBe("jev-2.4");
    expect(client.timeout).toBe(7_500);
    expect(client.logLevel).toBe("warn");
  });

  test("rejects missing credentials without exposing a client", () => {
    expect(() =>
      createTypeSafeClient({ TYPESAFE_API_KEY: "  " }),
    ).toThrow(RecipeDecisionConfigurationError);
  });

  test("rejects unpinned model aliases", () => {
    expect(() =>
      createTypeSafeClient({
        TYPESAFE_API_KEY: "test-api-key",
        RECIPE_DECISION_MODEL: "jev-latest",
      }),
    ).toThrow(/pinned Jev version/);
  });

  test("rejects nonpositive and noninteger timeouts", () => {
    expect(() =>
      createTypeSafeClient({
        TYPESAFE_API_KEY: "test-api-key",
        RECIPE_DECISION_TIMEOUT_MS: "0",
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      createTypeSafeClient({
        TYPESAFE_API_KEY: "test-api-key",
        RECIPE_DECISION_TIMEOUT_MS: "1.5",
      }),
    ).toThrow(/positive integer/);
  });

  test("initializes the shared client only when first requested", () => {
    const previous = {
      apiKey: Bun.env.TYPESAFE_API_KEY,
      model: Bun.env.RECIPE_DECISION_MODEL,
      timeout: Bun.env.RECIPE_DECISION_TIMEOUT_MS,
    };

    try {
      delete Bun.env.TYPESAFE_API_KEY;
      Bun.env.RECIPE_DECISION_MODEL = "jev-1.13";
      Bun.env.RECIPE_DECISION_TIMEOUT_MS = "5000";
      expect(() => getTypeSafeClient()).toThrow(
        RecipeDecisionConfigurationError,
      );

      Bun.env.TYPESAFE_API_KEY = "test-api-key";
      const client = getTypeSafeClient();
      expect(getTypeSafeClient()).toBe(client);
    } finally {
      restoreEnvironment("TYPESAFE_API_KEY", previous.apiKey);
      restoreEnvironment("RECIPE_DECISION_MODEL", previous.model);
      restoreEnvironment("RECIPE_DECISION_TIMEOUT_MS", previous.timeout);
    }
  });
});

describe("requestRecipeDecision", () => {
  test("uses the configured model for the request", async () => {
    let requestBody: unknown;
    const client = makeClient(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "jev-1.13",
        answers: { supported: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 4, output_tokens: 1 },
      });
    });

    const result = await requestRecipeDecision(
      decisionRequest,
      undefined,
      client,
    );

    expect(requestBody).toMatchObject({ model: "jev-1.13" });
    expect(result.answers.supported.noul).toBe(0.9);
  });

  test("forwards cancellation and translates the SDK abort error", async () => {
    const client = makeClient(pendingFetch);
    const controller = new AbortController();
    const result = requestRecipeDecision(
      decisionRequest,
      controller.signal,
      client,
    );

    await Promise.resolve();
    controller.abort();

    await expect(result).rejects.toMatchObject({
      kind: "aborted",
      message: "The recipe decision request was aborted.",
    });
  });

  test("translates SDK timeouts without exposing provider details", async () => {
    const client = makeClient(pendingFetch, 5);

    await expect(
      requestRecipeDecision(decisionRequest, undefined, client),
    ).rejects.toMatchObject({
      kind: "timeout",
      message: "The recipe decision provider timed out.",
    });
  });

  test("localizes API errors and retains safe provider metadata", async () => {
    const client = makeClient(async () =>
      Response.json(
        { error: "provider detail" },
        {
          status: 401,
          headers: { "x-typesafe-request-id": "request-123" },
        },
      ),
    );

    await expect(
      requestRecipeDecision(decisionRequest, undefined, client),
    ).rejects.toMatchObject({
      kind: "authentication",
      message: "The recipe decision provider rejected its credentials.",
      providerRequestId: "request-123",
    });
  });
});

const pendingFetch: Fetch = async (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("Expected an abort signal"));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[name];
  } else {
    Bun.env[name] = value;
  }
}
