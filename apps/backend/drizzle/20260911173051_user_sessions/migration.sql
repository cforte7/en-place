CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_length" CHECK (length("token_hash") = 43),
	CONSTRAINT "user_sessions_expiration_after_creation" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_unique" ON "user_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_index" ON "user_sessions" ("user_id");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;