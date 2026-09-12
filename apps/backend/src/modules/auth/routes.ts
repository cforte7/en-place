import {
  apiErrorSchema,
  authenticatedSessionResponseSchema,
  loginRequestSchema,
  userResponseSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { database } from "../../database";
import { users, userSessions } from "../../database/schema";
import type { AppEnvironment } from "../../http/environment";
import { authLogger } from "../../observability/logging";
import { presentUser, publicUserColumns } from "../users/presentation";
import { requireAuthentication } from "./middleware";
import { createSessionMaterial } from "./session";

const dummyPasswordHash =
  "$argon2id$v=19$m=65536,t=2,p=1$TAG/WKk2X86pl/aAt4HzJvvVctzPD4WYWku29esQSdQ$H9EYRA6Y1AbAMyN6h2tL90q8YKIpewfR8zuOtGocZlw";

export const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  operationId: "login",
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: authenticatedSessionResponseSchema,
        },
      },
      description: "An authenticated user session",
    },
    400: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "The request body is invalid",
    },
    401: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "The credentials are invalid",
    },
    500: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "An unexpected error occurred",
    },
  },
});

export const getCurrentUserRoute = createRoute({
  method: "get",
  path: "/users/me",
  operationId: "getCurrentUser",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: userResponseSchema,
        },
      },
      description: "The authenticated user",
    },
    401: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "Authentication is required",
    },
    500: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "An unexpected error occurred",
    },
  },
});

export const logoutRoute = createRoute({
  method: "delete",
  path: "/auth/session",
  operationId: "logout",
  security: [{ BearerAuth: [] }],
  middleware: [requireAuthentication] as const,
  responses: {
    204: {
      description: "The current session was revoked",
    },
    401: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "Authentication is required",
    },
    500: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "An unexpected error occurred",
    },
  },
});

export const loginHandler: RouteHandler<
  typeof loginRoute,
  AppEnvironment
> = async (context) => {
  context.header("Cache-Control", "no-store");

  const input = context.req.valid("json");
  const [user] = await database
    .select({
      ...publicUserColumns,
      passwordHash: users.passwordHash,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  const passwordMatches = await Bun.password.verify(
    input.password,
    user?.passwordHash ?? dummyPasswordHash,
  );

  if (!user || !passwordMatches || user.disabledAt) {
    authLogger.info("Rejected login attempt", {
      event: "auth.login.failed",
      requestId: context.get("requestId"),
    });

    return context.json(
      {
        error: {
          code: "invalid_credentials" as const,
          message: "The email or password is incorrect.",
        },
      },
      401,
    );
  }

  const sessionMaterial = createSessionMaterial();
  const [session] = await database.transaction((transaction) =>
    transaction
      .insert(userSessions)
      .values({
        userId: user.id,
        tokenHash: sessionMaterial.tokenHash,
        expiresAt: sessionMaterial.expiresAt,
      })
      .returning({ id: userSessions.id }),
  );

  if (!session) {
    throw new Error("Session insert did not return a row");
  }

  authLogger.info("Authenticated user {userId}", {
    event: "auth.login.succeeded",
    userId: user.id,
    sessionId: session.id,
    requestId: context.get("requestId"),
  });

  return context.json(
    {
      sessionToken: sessionMaterial.token,
      expiresAt: sessionMaterial.expiresAt.toISOString(),
      user: presentUser(user),
    },
    200,
  );
};

export const getCurrentUserHandler: RouteHandler<
  typeof getCurrentUserRoute,
  AppEnvironment
> = (context) => context.json(context.get("authenticatedUser"), 200);

export const logoutHandler: RouteHandler<
  typeof logoutRoute,
  AppEnvironment
> = async (context) => {
  const sessionId = context.get("authenticatedSessionId");

  await database.transaction((transaction) =>
    transaction
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, sessionId)),
  );

  authLogger.info("Revoked user session {sessionId}", {
    event: "auth.logout.succeeded",
    sessionId,
    userId: context.get("authenticatedUser").id,
    requestId: context.get("requestId"),
  });

  return context.body(null, 204);
};
