import { apiErrorSchema } from "@en-place/contracts";
import { createRoute, type RouteHandler } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { database } from "../../../database";
import { userSessions } from "../../../database/schema";
import type { AppEnvironment } from "../../../http/environment";
import { authLogger } from "../../../observability/logging";
import { requireAuthentication } from "../middleware";

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
    userId: context.get("authenticatedUserId"),
    requestId: context.get("requestId"),
  });

  return context.body(null, 204);
};
