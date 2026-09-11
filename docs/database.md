# Database Guide

The backend uses PostgreSQL 18 with Drizzle ORM and Bun's native SQL driver. Drizzle schema files are the source of truth for database structure and inferred TypeScript models.

No migration is currently checked in. Generate the initial migration when the schema is ready to be committed.

## First-time setup

Requirements:

- Bun 1.4.2
- Docker with Docker Compose

From the repository root:

```sh
cp .env.example .env
bun install
bun run db:up
```

The default local database is available at:

```text
postgresql://en_place:en_place@localhost:5433/en_place
```

Stop PostgreSQL without deleting its data:

```sh
bun run db:down
```

## Database files

```text
apps/backend/
├── drizzle.config.ts          # Drizzle Kit configuration
└── src/database/
    ├── index.ts               # Typed database client
    └── schema/
        ├── index.ts           # Schema exports
        └── recipes.ts         # Recipe, ingredient, and step tables

infra/compose.yaml             # Local PostgreSQL service
.env.example                   # Local environment template
```

The initial schema defines:

- `recipes`
- `recipe_ingredients`
- `recipe_steps`

Ingredients and steps belong to a recipe and are deleted automatically when their recipe is deleted.

## Common commands

Run these commands from the repository root.

| Command | Purpose |
| --- | --- |
| `bun run db:up` | Start local PostgreSQL |
| `bun run db:down` | Stop local PostgreSQL without deleting data |
| `bun run db:generate` | Generate a migration from schema changes |
| `bun run db:check` | Check migration metadata for consistency |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run check:typescript` | Type-check all TypeScript workspaces |

## Changing the schema

Edit the relevant file under:

```text
apps/backend/src/database/schema/
```

For a new schema file, export its tables and other schema objects from:

```text
apps/backend/src/database/schema/index.ts
```

Infer TypeScript models from the table instead of maintaining duplicate interfaces:

```ts
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
```

Type-check the schema before generating a migration:

```sh
bun run check:typescript
```

## Creating and applying a migration

When the schema change is ready:

```sh
bun run db:generate
```

Drizzle writes a timestamped directory under `apps/backend/drizzle/`. Review both generated files:

```text
apps/backend/drizzle/<timestamp>_<name>/
├── migration.sql
└── snapshot.json
```

Check the migration metadata:

```sh
bun run db:check
```

Start PostgreSQL and apply the migration:

```sh
bun run db:up
bun run db:migrate
```

Exercise the affected backend read and write paths after applying it. Commit the schema changes, generated SQL, and snapshot together.

Do not use `drizzle-kit push` for a shared or persistent database. It changes the database without creating reviewed migration history.

Do not edit a migration after it has been applied. Create a follow-up migration instead. If a newly generated migration has not been applied, correct the TypeScript schema and regenerate it rather than editing its snapshot by hand.

## Using the database in backend code

Import the shared typed client and schema tables:

```ts
import { eq } from "drizzle-orm";

import { database } from "./database";
import { recipes } from "./database/schema";

const recipe = await database
  .select()
  .from(recipes)
  .where(eq(recipes.id, recipeId));
```

Use a transaction when one operation writes a recipe together with its ingredients or steps.

## Environment variables

The database configuration comes from the root `.env` file.

| Variable | Default development value | Purpose |
| --- | --- | --- |
| `POSTGRES_PORT` | `5433` | Host port exposed by Docker |
| `POSTGRES_DB` | `en_place` | PostgreSQL database name |
| `POSTGRES_USER` | `en_place` | PostgreSQL user |
| `POSTGRES_PASSWORD` | `en_place` | PostgreSQL password |
| `DATABASE_URL` | `postgresql://en_place:en_place@localhost:5433/en_place` | Backend and Drizzle connection string |

Never commit `.env`. Commit `.env.example` when the required environment-variable contract changes.

## Resetting the local database

The following command deletes the local PostgreSQL container and all data stored in its named volume:

```sh
docker compose -f infra/compose.yaml down --volumes
```

Run it only when local data loss is intentional. Start a fresh database afterward with:

```sh
bun run db:up
```

Apply committed migrations with `bun run db:migrate` once migrations exist.

## Troubleshooting

### `DATABASE_URL is required`

Create the local environment file:

```sh
cp .env.example .env
```

Then rerun the command from the repository root.

### Connection refused

Confirm PostgreSQL is running:

```sh
bun run db:up
docker compose -f infra/compose.yaml ps
```

If port `5433` is already in use, choose another free port and change both `POSTGRES_PORT` and the port in `DATABASE_URL` inside `.env`.

### Migration metadata is inconsistent

Run:

```sh
bun run db:check
```

Do not repair generated snapshots manually. Restore missing migration artifacts or regenerate an unapplied migration from the schema.
