# Database Operations Guide

The local database runs PostgreSQL 18 through Docker Compose. Drizzle Kit manages migration generation, validation, and execution. Run all commands in this guide from the repository root.

The cooking graph schema, invariants, and mutation boundary are documented in [`cooking-dag.md`](cooking-dag.md).

## First-time setup

Requirements:

- Bun 1.4.2
- Docker with Docker Compose

From the repository root:

```sh
cp .env.example .env
bun install
bun run dev
```
`bun run dev` starts PostgreSQL, waits for it to become healthy, and then starts the backend in watch mode at `http://localhost:3000`. Pressing Ctrl-C stops the backend; PostgreSQL remains available for the next run.

The default local database is available at:

```text
postgresql://en_place:en_place@localhost:5433/en_place
```

Stop PostgreSQL without deleting its data:

```sh
bun run db:down
```

## Database tooling locations

```text
apps/backend/
├── drizzle/                    # Generated migration directories
├── drizzle.config.ts           # Drizzle Kit configuration
└── src/database/
    ├── index.ts                # Database client
    └── schema/                 # Drizzle schema source

infra/compose.yaml              # Local PostgreSQL service
.env.example                    # Environment template
```

## Common commands

Run these commands from the repository root.

| Command                    | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `bun run dev`              | Start PostgreSQL and the backend            |
| `bun run db:up`            | Start local PostgreSQL                      |
| `bun run db:down`          | Stop local PostgreSQL without deleting data |
| `bun run db:generate`      | Generate a migration from schema changes    |
| `bun run db:check`         | Check migration metadata for consistency    |
| `bun run db:migrate`       | Apply pending migrations                    |
| `bun run db:studio`        | Open Drizzle Studio                         |
| `bun run check:typescript` | Type-check all TypeScript workspaces        |

## Preparing a schema change

1. Edit the relevant file under `apps/backend/src/database/schema/`.
2. Export any new schema objects from `apps/backend/src/database/schema/index.ts`.
3. Type-check the workspace:

```sh
bun run check:typescript
```

Do not generate a migration until the schema change is ready for review.

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

## Environment variables

The database configuration comes from the root `.env` file.
The root database scripts explicitly load this file before running Drizzle from `apps/backend`.

| Variable            | Default development value                                | Purpose                               |
| ------------------- | -------------------------------------------------------- | ------------------------------------- |
| `POSTGRES_PORT`     | `5433`                                                   | Host port exposed by Docker           |
| `POSTGRES_DB`       | `en_place`                                               | PostgreSQL database name              |
| `POSTGRES_USER`     | `en_place`                                               | PostgreSQL user                       |
| `POSTGRES_PASSWORD` | `en_place`                                               | PostgreSQL password                   |
| `DATABASE_URL`      | `postgresql://en_place:en_place@localhost:5433/en_place` | Backend and Drizzle connection string |

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
