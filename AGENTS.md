# Repository Guidance

Human-facing database instructions live in `docs/database.md`.
Cooking graph data-model and mutation rules live in `docs/cooking-dag.md`.

## Backend HTTP architecture

- Treat `apps/backend/src/app.ts` as the HTTP composition root. It owns the `OpenAPIHono<AppEnvironment>` instance, global middleware, shared OpenAPI components, module registration, the OpenAPI document endpoint, and global not-found/error handlers.
- Route modules must not import the application singleton or mutate it as an import side effect. Each module's `routes/index.ts` exports a `register<Module>Routes(app: OpenAPIHono<AppEnvironment>): void` function; `app.ts` imports and calls those functions explicitly so dependencies and registration order remain visible.
- Keep process startup in `apps/backend/src/index.ts`. `app.ts` must remain importable without starting a server so tests and `export-openapi.ts` can use the same configured application.
- Put one HTTP operation in each route file. Export its `createRoute` definition and a handler typed as `RouteHandler<typeof route, AppEnvironment>`, then pair them with `app.openapi(route, handler)` in the module's route registrar.
- Use `AppEnvironment` as the source of truth for typed Hono context variables. Add shared request context there rather than introducing untyped context access.
- Use schemas from `@en-place/contracts` for public request and response bodies. Colocate transport-only schemas such as path parameters with the owning module, consume validated input through `context.req.valid(...)`, and do not duplicate validation in handlers.
- A protected operation must declare both its OpenAPI `security` requirement and `requireAuthentication` middleware. Authentication middleware populates the typed context values that handlers consume.
- Route definitions must document every response status the handler or its middleware can return. Translate expected domain failures into those documented API responses at the HTTP boundary; allow unexpected errors to reach the global error handler.
- Keep wire-format conversion in module `presentation.ts` functions instead of returning database rows or domain objects directly.
- Keep handlers focused on HTTP concerns and orchestration. Direct typed-database access is acceptable for a small endpoint-specific operation; move reusable business rules or multi-step domain mutations into a module service, and isolate substantial persistence logic in a repository. Do not add service/repository layers that only forward arguments.

## Database ownership

- PostgreSQL is the only application database.
- Drizzle schema definitions in `apps/backend/src/database/schema/` are the schema source of truth.
- Export every table, enum, relation, and model from `apps/backend/src/database/schema/index.ts` so Drizzle Kit can discover it.
- Use the typed client exported from `apps/backend/src/database/index.ts` for backend database access.
- Keep runtime database dependencies in `apps/backend/package.json`; keep repository-wide TypeScript tooling at the root.
- Do not generate or apply a migration unless the task explicitly requests it. The repository owner manages migration timing.

## Local environment

Create the ignored local environment file before using PostgreSQL or Drizzle:

```sh
cp .env.example .env
bun install
```

`DATABASE_URL` is required by both the backend database client and `apps/backend/drizzle.config.ts`.

Start and stop local PostgreSQL from the repository root:

```sh
bun run db:up
bun run db:down
```

## Schema workflow

For an ordinary schema-only change:

1. Edit the appropriate file under `apps/backend/src/database/schema/`.
2. Re-export new schema objects from `schema/index.ts`.
3. Infer application model types from Drizzle tables with `$inferSelect` and `$inferInsert`; do not duplicate them as handwritten interfaces.
4. Run `bun run check:typescript`.
5. Stop without generating a migration unless migration work was explicitly requested.

When migration work is explicitly requested:

1. Start PostgreSQL with `bun run db:up` when the change needs database verification.
2. Generate artifacts with `bun run db:generate`.
3. Review the generated SQL and snapshot under `apps/backend/drizzle/`.
4. Run `bun run db:check`.
5. Apply the migration with `bun run db:migrate` against a disposable local database first.
6. Exercise the affected read/write path through Drizzle, not only through direct SQL.
7. Commit the schema change, migration SQL, and snapshot together.

Never use `drizzle-kit push` for shared or persistent databases; it bypasses the reviewed migration history. Never edit an already-applied migration. Add a new migration instead. If an unapplied generated migration is wrong, correct the schema and regenerate it rather than hand-editing its snapshot.

## Modeling conventions

- Use camelCase identifiers in TypeScript and explicit snake_case names in PostgreSQL.
- Prefer database-enforced invariants: `NOT NULL`, foreign keys, unique constraints, and check constraints.
- Add an index for foreign-key access paths unless an existing index already has that key as its leading column.
- Use `timestamp with time zone` for persisted instants.
- Use transactions for writes
- Use raw SQL only when Drizzle cannot express the required PostgreSQL behavior; keep such SQL parameterized and localized to the database boundary.

## Logging

Human-facing logging instructions live in `docs/logging.md`.

- Use LogTape loggers from `apps/backend/src/observability/logging.ts`; never add ad hoc `console` calls.
- Log structured events with stable `event` names and IDs. The HTTP middleware owns request completion logs.
- Include `requestId` when logging work performed for a request.
- Never log passwords, hashes, tokens, authorization headers, cookies, request bodies, connection strings, or raw email addresses.
- Write logs only to stdout/stderr. Use `LOG_LEVEL` for verbosity and `NODE_ENV=production` for JSON Lines output.
