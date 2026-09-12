import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { database } from "../../database";
import { users, userSessions } from "../../database/schema";
import type { AppEnvironment } from "../../http/environment";
import { presentUser, publicUserColumns } from "../users/presentation";
import { hashSessionToken } from "./session";

const bearerTokenPattern = /^Bearer ([A-Za-z0-9_-]{43})$/i;

export const requireAuthentication = createMiddleware<AppEnvironment>(
  async (context, next) => {
    const authorization = context.req.header("Authorization");
    const token = authorization?.match(bearerTokenPattern)?.[1];

    if (!token) {
      return unauthorized(context);
    }

    const [authentication] = await database
      .select({
        ...publicUserColumns,
        sessionId: userSessions.id,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(
        and(
          eq(userSessions.tokenHash, hashSessionToken(token)),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
          isNull(users.disabledAt),
        ),
      )
      .limit(1);

    if (!authentication) {
      return unauthorized(context);
    }

    const { sessionId, ...user } = authentication;
    context.set("authenticatedSessionId", sessionId);
    context.set("authenticatedUser", presentUser(user));

    await next();
  },
);

function unauthorized(context: Context<AppEnvironment>) {
  context.header("WWW-Authenticate", "Bearer");

  return context.json(
    {
      error: {
        code: "unauthorized" as const,
        message: "Authentication is required.",
      },
    },
    401,
  );
}
