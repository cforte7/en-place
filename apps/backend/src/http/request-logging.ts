import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { routePath } from "hono/route";

import { httpLogger } from "../observability/logging";

export type AppEnvironment = {
  Variables: RequestIdVariables;
};

export const requestLogging = createMiddleware<AppEnvironment>(
  async (context, next) => {
    const startedAt = performance.now();
    const requestId = context.get("requestId");

    context.header("X-Request-Id", requestId);
    await next();

    const properties = {
      event: "http.request.completed",
      requestId,
      method: context.req.method,
      path: context.req.path,
      route: routePath(context, -1),
      status: context.res.status,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };

    if (context.req.path === "/health") {
      httpLogger.debug("Completed health request", properties);
    } else if (context.res.status >= 500) {
      httpLogger.error("Completed request with server error", properties);
    } else {
      httpLogger.info("Completed request", properties);
    }
  },
);
