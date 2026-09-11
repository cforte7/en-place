import { drizzle } from "drizzle-orm/bun-sql";

const databaseUrl = Bun.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to connect to PostgreSQL");
}

export const database = drizzle(databaseUrl);

export type Database = typeof database;
