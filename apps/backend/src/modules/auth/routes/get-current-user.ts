import { apiErrorSchema, userResponseSchema } from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { requireAuthentication } from "../middleware";

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

export const getCurrentUserHandler: RouteHandler<
  typeof getCurrentUserRoute,
  AppEnvironment
> = (context) => context.json(context.get("authenticatedUser"), 200);
