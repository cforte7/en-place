import { app } from "./app";

const port = Number(Bun.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Backend listening on ${server.url}`);
