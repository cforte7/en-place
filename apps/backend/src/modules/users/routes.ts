import {
  apiErrorSchema,
  authenticatedSessionResponseSchema,
  createUserRequestSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import { database } from "../../database";
import { users, userSessions } from "../../database/schema";
import type { AppEnvironment } from "../../http/environment";
import { usersLogger } from "../../observability/logging";
import { createSessionMaterial } from "../auth/session";
import { presentUser, publicUserColumns } from "./presentation";

export const createUserRoute = createRoute({
  method: "post",
  path: "/users",
  operationId: "createUser",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createUserRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: authenticatedSessionResponseSchema,
        },
      },
      description: "The newly created user",
    },
    400: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "The request body is invalid",
    },
    409: {
      content: {
        "application/json": {
          schema: apiErrorSchema,
        },
      },
      description: "A user with this email already exists",
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

export const createUserHandler: RouteHandler<
  typeof createUserRoute,
  AppEnvironment
> = async (context) => {
  const input = context.req.valid("json");
  const passwordHash = await Bun.password.hash(input.password, {
    algorithm: "argon2id",
  });
  const sessionMaterial = createSessionMaterial();

  const creation = await database.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      })
      .onConflictDoNothing({ target: users.email })
      .returning(publicUserColumns);

    if (!user) {
      return undefined;
    }

    const [session] = await transaction
      .insert(userSessions)
      .values({
        userId: user.id,
        tokenHash: sessionMaterial.tokenHash,
        expiresAt: sessionMaterial.expiresAt,
      })
      .returning({ id: userSessions.id });

    if (!session) {
      throw new Error("Session insert did not return a row");
    }

    return { session, user };
  });

  if (!creation) {
    return context.json(
      {
        error: {
          code: "email_taken" as const,
          message: "A user with this email already exists.",
        },
      },
      409,
    );
  }

  usersLogger.info("Created user {userId}", {
    event: "user.created",
    userId: creation.user.id,
    sessionId: creation.session.id,
    requestId: context.get("requestId"),
  });

  context.header("Cache-Control", "no-store");

  return context.json(
    {
      sessionToken: sessionMaterial.token,
      expiresAt: sessionMaterial.expiresAt.toISOString(),
      user: presentUser(creation.user),
    },
    201,
  );
};
