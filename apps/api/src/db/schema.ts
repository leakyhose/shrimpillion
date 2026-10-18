import { sql } from "drizzle-orm";
import {
  bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { MatchPreset } from "@shrimpillion/core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Anonymous player identity. The client keeps the token; we store only its hash. */
export const players = pgTable("players", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export interface RoundSettings {
  /** Seconds to answer each prompt; 0 = untimed. */
  timerSeconds: number;
  /** Seconds the prompt is shown before the timer starts. */
  previewSeconds: number;
  matcher: MatchPreset;
}

export type RoundMode = "random" | "set";

/** An immutable, shareable list of prompts. Share links point here. */
export const rounds = pgTable("rounds", {
  id: text("id").primaryKey(),
  mode: text("mode").$type<RoundMode>().notNull(),
  /** Source set for mode "set" (e.g. "d094"). */
  setId: text("set_id"),
  title: text("title").notNull(),
  promptIds: jsonb("prompt_ids").$type<string[]>().notNull(),
  settings: jsonb("settings").$type<RoundSettings>().notNull(),
  /** Options used to draw a random round. */
  filters: jsonb("filters").$type<Record<string, unknown>>(),
  bankVersion: text("bank_version").notNull(),
  createdBy: text("created_by").references(() => players.id),
  createdAt: createdAt(),
});

export type GameStatus = "active" | "finished";

/** One player's attempt at a round. A player has at most one game per round. */
export const games = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => rounds.id),
    playerId: text("player_id").notNull().references(() => players.id),
    status: text("status").$type<GameStatus>().notNull().default("active"),
    autoAccept: boolean("auto_accept").notNull().default(false),
    score: integer("score").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("games_round_player_idx").on(t.roundId, t.playerId),
    index("games_player_started_idx").on(t.playerId, t.startedAt),
    index("games_round_score_idx").on(t.roundId, t.score),
  ],
);

export type SlotStatus = "pending" | "active" | "answered" | "timeout";

export const gameSlots = pgTable(
  "game_slots",
  {
    gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    promptId: text("prompt_id").notNull(),
    /** Answer-list version when played. */
    promptVersion: text("prompt_version").notNull(),
    status: text("status").$type<SlotStatus>().notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Last moment a guess is accepted (timer + preview + grace); null when untimed. */
    deadline: timestamp("deadline", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    answer: text("answer"),
    tier: text("tier"),
    score: integer("score").notNull().default(0),
    guessCount: integer("guess_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.slot] }),
    index("game_slots_prompt_idx").on(t.promptId, t.status),
  ],
);

export type GuessResult = "accept" | "correction" | "reject";

/** Every submission. Rejects are indexed so missed answers can be turned into aliases. */
export const guesses = pgTable(
  "guesses",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    promptId: text("prompt_id").notNull(),
    input: text("input").notNull(),
    result: text("result").$type<GuessResult>().notNull(),
    /** Matched answer name, for accepts and corrections. */
    matched: text("matched"),
    createdAt: createdAt(),
  },
  (t) => [
    index("guesses_game_idx").on(t.gameId, t.slot),
    index("guesses_rejects_idx").on(t.promptId).where(sql`${t.result} = 'reject'`),
  ],
);
