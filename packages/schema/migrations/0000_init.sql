CREATE TABLE "issued_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"seed" text NOT NULL,
	"mode" text NOT NULL,
	"duration" smallint,
	"count" smallint,
	"punctuation" boolean NOT NULL,
	"numbers" boolean NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_bests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"length" smallint NOT NULL,
	"wpm" real NOT NULL,
	"achieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issued_test_id" uuid NOT NULL,
	"user_id" uuid,
	"mode" text NOT NULL,
	"length" smallint NOT NULL,
	"punctuation" boolean NOT NULL,
	"numbers" boolean NOT NULL,
	"wpm" real NOT NULL,
	"raw_wpm" real NOT NULL,
	"accuracy" real NOT NULL,
	"consistency" real NOT NULL,
	"duration_ms" integer NOT NULL,
	"chars" jsonb NOT NULL,
	"verification" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issued_tests" ADD CONSTRAINT "issued_tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_bests" ADD CONSTRAINT "personal_bests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_bests" ADD CONSTRAINT "personal_bests_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_issued_test_id_issued_tests_id_fk" FOREIGN KEY ("issued_test_id") REFERENCES "public"."issued_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issued_tests_user_idx" ON "issued_tests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_provider_account_key" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pb_user_mode_length_key" ON "personal_bests" USING btree ("user_id","mode","length");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tests_issued_key" ON "tests" USING btree ("issued_test_id");--> statement-breakpoint
CREATE INDEX "tests_user_created_idx" ON "tests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tests_board_idx" ON "tests" USING btree ("mode","length","wpm") WHERE "tests"."verification" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");