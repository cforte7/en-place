# Repository Guidance

Human-facing database instructions live in `docs/database.md`.

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
- Use transactions for writes spanning a recipe and its ingredients or steps.
- Use raw SQL only when Drizzle cannot express the required PostgreSQL behavior; keep such SQL parameterized and localized to the database boundary.
