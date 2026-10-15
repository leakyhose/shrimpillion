CREATE TABLE "game_slots" (
	"game_id" text NOT NULL,
	"slot" integer NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"answer" text,
	"tier" text,
	"score" integer DEFAULT 0 NOT NULL,
	"guess_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "game_slots_game_id_slot_pk" PRIMARY KEY("game_id","slot")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"player_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auto_accept" boolean DEFAULT false NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guesses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "guesses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" text NOT NULL,
	"slot" integer NOT NULL,
	"prompt_id" text NOT NULL,
	"input" text NOT NULL,
	"result" text NOT NULL,
	"matched" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"set_id" text,
	"title" text NOT NULL,
	"prompt_ids" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"filters" jsonb,
	"bank_version" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_slots" ADD CONSTRAINT "game_slots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_created_by_players_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_slots_prompt_idx" ON "game_slots" USING btree ("prompt_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "games_round_player_idx" ON "games" USING btree ("round_id","player_id");--> statement-breakpoint
CREATE INDEX "games_player_started_idx" ON "games" USING btree ("player_id","started_at");--> statement-breakpoint
CREATE INDEX "games_round_score_idx" ON "games" USING btree ("round_id","score");--> statement-breakpoint
CREATE INDEX "guesses_game_idx" ON "guesses" USING btree ("game_id","slot");--> statement-breakpoint
CREATE INDEX "guesses_rejects_idx" ON "guesses" USING btree ("prompt_id") WHERE "guesses"."result" = 'reject';