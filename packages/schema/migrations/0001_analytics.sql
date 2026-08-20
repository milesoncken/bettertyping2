CREATE TABLE "bigram_stats" (
	"user_id" uuid NOT NULL,
	"pair" text NOT NULL,
	"from_code" text NOT NULL,
	"to_code" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"latency_sum_ms" real DEFAULT 0 NOT NULL,
	"latency_runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bigram_stats_user_id_pair_pk" PRIMARY KEY("user_id","pair")
);
--> statement-breakpoint
CREATE TABLE "key_stats" (
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"legend" text DEFAULT '' NOT NULL,
	"struck" integer DEFAULT 0 NOT NULL,
	"intruded" integer DEFAULT 0 NOT NULL,
	"wanted" integer DEFAULT 0 NOT NULL,
	"missed" integer DEFAULT 0 NOT NULL,
	"flight_sum_ms" real DEFAULT 0 NOT NULL,
	"flight_runs" integer DEFAULT 0 NOT NULL,
	"dwell_sum_ms" real DEFAULT 0 NOT NULL,
	"dwell_runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "key_stats_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
ALTER TABLE "bigram_stats" ADD CONSTRAINT "bigram_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_stats" ADD CONSTRAINT "key_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bigram_stats_user_n_idx" ON "bigram_stats" USING btree ("user_id","n");