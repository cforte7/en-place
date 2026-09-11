import {
  serviceHealthSchema,
  type ServiceHealth,
} from "@en-place/contracts";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createUserHandler, createUserRoute } from "./modules/users/routes";

const health = {
  service: "en-place-backend",
  status: "ok",
} satisfies ServiceHealth;

const healthRoute = createRoute({
  method: "get",
  path: "/health",
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

export const app = new OpenAPIHono({
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

app.openapi(healthRoute, (context) => context.json(health, 200));
app.openapi(createUserRoute, createUserHandler);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "En Place API",
    version: "0.0.0",
  },
});

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
  console.error(error);

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
