CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_credentials_hash_not_blank" CHECK (length(trim("password_hash")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"display_name" text,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_not_blank" CHECK (length(trim("email")) > 0),
	CONSTRAINT "users_email_normalized" CHECK ("email" = lower(trim("email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;