import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import { createUserHandler, createUserRoute } from "./create-user";

export function registerUserRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(createUserRoute, createUserHandler);
}
