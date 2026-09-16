import type { OpenAPIHono } from "@hono/zod-openapi";

import type { AppEnvironment } from "../../../http/environment";
import {
  getCurrentUserHandler,
  getCurrentUserRoute,
} from "./get-current-user";
import { loginHandler, loginRoute } from "./login";
import { logoutHandler, logoutRoute } from "./logout";

export function registerAuthRoutes(app: OpenAPIHono<AppEnvironment>): void {
  app.openapi(loginRoute, loginHandler);
  app.openapi(getCurrentUserRoute, getCurrentUserHandler);
  app.openapi(logoutRoute, logoutHandler);
}
