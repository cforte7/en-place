# Logging

The backend uses LogTape and writes logs to stdout/stderr. Development output is readable text; `NODE_ENV=production` emits JSON Lines.

Set verbosity with `LOG_LEVEL`: `trace`, `debug`, `info`, `warning`, `error`, or `fatal`. Defaults are `debug` in development and `info` in production.

Use the categorized loggers exported from `apps/backend/src/observability/logging.ts`:

```ts
usersLogger.info("Created user {userId}", {
  event: "user.created",
  userId,
  requestId,
});
```

Use stable `event` names and include `requestId` for request-related work. Hono already logs request method, route, status, duration, and returns `X-Request-Id`; do not duplicate those logs inside handlers.

Never log passwords, hashes, tokens, authorization headers, cookies, request bodies, connection strings, or raw email addresses.
