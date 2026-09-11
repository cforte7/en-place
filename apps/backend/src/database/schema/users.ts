import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_email_not_blank", sql`length(trim(${table.email})) > 0`),
    check("users_email_normalized", sql`${table.email} = lower(trim(${table.email}))`),
  ],
);

export const passwordCredentials = pgTable(
  "password_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "password_credentials_hash_not_blank",
      sql`length(trim(${table.passwordHash})) > 0`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PasswordCredential = typeof passwordCredentials.$inferSelect;
export type NewPasswordCredential = typeof passwordCredentials.$inferInsert;
