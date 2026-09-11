import { app } from "./app";
import {
  applicationLogger,
  configureLogging,
} from "./observability/logging";
await configureLogging();

const port = Number(Bun.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

applicationLogger.info("Backend listening on {url}", {
  event: "application.started",
  url: server.url.toString(),
  port: server.port,
});
