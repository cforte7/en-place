import type { ServiceHealth } from "@en-place/contracts";

const port = Number(Bun.env.PORT ?? 3000);

const health = {
  service: "en-place-backend",
  status: "ok",
} satisfies ServiceHealth;

const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json(health);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Backend listening on ${server.url}`);
