import {
  apiErrorSchema,
  createUserRequestSchema,
  userResponseSchema,
} from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import { database } from "../../database";
import { users } from "../../database/schema";

export const createUserRoute = createRoute({
  method: "post",
  path: "/users",
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
          schema: userResponseSchema,
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

export const createUserHandler: RouteHandler<typeof createUserRoute> = async (
  context,
) => {
  const input = context.req.valid("json");
  const passwordHash = await Bun.password.hash(input.password, {
    algorithm: "argon2id",
  });

  const user = await database.transaction(async (transaction) => {
    const [createdUser] = await transaction
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      })
      .onConflictDoNothing({ target: users.email })
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    return createdUser;
  });

  if (!user) {
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

  return context.json(
    {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    201,
  );
};
