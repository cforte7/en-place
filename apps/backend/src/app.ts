import {
  serviceHealthSchema,
  type ServiceHealth,
} from "@en-place/contracts";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";

import type { AppEnvironment } from "./http/environment";
import { requestLogging } from "./http/request-logging";
import {
  getCurrentUserHandler,
  getCurrentUserRoute,
  loginHandler,
  loginRoute,
  logoutHandler,
  logoutRoute,
} from "./modules/auth/routes";
import { createUserHandler, createUserRoute } from "./modules/users/routes";
import { httpLogger } from "./observability/logging";

const health = {
  service: "en-place-backend",
  status: "ok",
} satisfies ServiceHealth;

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: serviceHealthSchema,
        },
      },
      description: "The backend is available",
    },
  },
});

export const app = new OpenAPIHono<AppEnvironment>({
  defaultHook: (result, context) => {
    if (!result.success) {
      return context.json(
        {
          error: {
            code: "invalid_request" as const,
            message: "The request is invalid.",
          },
        },
        400,
      );
    }
  },
});

app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
});
app.use("*", requestId({ limitLength: 128 }));
app.use("*", requestLogging);

app.openapi(healthRoute, (context) => context.json(health, 200));
app.openapi(createUserRoute, createUserHandler);
app.openapi(loginRoute, loginHandler);
app.openapi(getCurrentUserRoute, getCurrentUserHandler);
app.openapi(logoutRoute, logoutHandler);

export const openApiDocumentConfig = {
  openapi: "3.0.0",
  info: {
    title: "En Place API",
    version: "0.0.0",
  },
} as const;

app.doc("/openapi.json", openApiDocumentConfig);

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "not_found" as const,
        message: "The requested resource was not found.",
      },
    },
    404,
  ),
);

app.onError((error, context) => {
  httpLogger.error("Unhandled request error", {
    event: "http.request.failed",
    requestId: context.get("requestId"),
    method: context.req.method,
    path: context.req.path,
    error,
  });

  return context.json(
    {
      error: {
        code: "internal_error" as const,
        message: "An unexpected error occurred.",
      },
    },
    500,
  );
});
