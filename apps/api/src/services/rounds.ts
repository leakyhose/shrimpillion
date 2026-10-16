import { and, avg, count, eq, max, ne } from "drizzle-orm";
import type { PoolFilter } from "../bank/bank.ts";
import type { Services } from "../context.ts";
import { schema } from "../db/index.ts";
import type { RoundSettings } from "../db/schema.ts";
import { ApiError, shuffle, withShortId } from "../util.ts";
import { displayName } from "./players.ts";

export type Round = typeof schema.rounds.$inferSelect;

export const DEFAULT_SETTINGS: RoundSettings = { timerSeconds: 25, previewSeconds: 3, matcher: "faithful" };

const isDefault = (s: RoundSettings) =>
  s.timerSeconds === DEFAULT_SETTINGS.timerSeconds &&
  s.previewSeconds === DEFAULT_SETTINGS.previewSeconds &&
  s.matcher === DEFAULT_SETTINGS.matcher;

export interface RandomRoundOptions extends PoolFilter {
  count: number;
  /** Fail instead of reusing prompts the player has already played. */
  unseenOnly?: boolean;
}

/** Prompts the player has been shown (any slot that was started). */
export async function seenPromptIds(s: Services, playerId: string): Promise<Set<string>> {
  const rows = await s.db
    .selectDistinct({ promptId: schema.gameSlots.promptId })
    .from(schema.gameSlots)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameSlots.gameId))
    .where(and(eq(schema.games.playerId, playerId), ne(schema.gameSlots.status, "pending")));
  return new Set(rows.map((r) => r.promptId));
}

/** Draw a random round, unseen prompts first. */
export async function createRandomRound(
  s: Services,
  playerId: string,
  opts: RandomRoundOptions,
  settings: RoundSettings,
): Promise<Round> {
  const { count: n, unseenOnly, ...filter } = opts;
  const pool = s.bank.pool(filter);
  if (!pool.length) throw new ApiError(400, "empty_pool", "No prompts match these filters");
  const seen = await seenPromptIds(s, playerId);
  const fresh = shuffle(pool.filter((p) => !seen.has(p.id)));
  const reused = unseenOnly ? [] : shuffle(pool.filter((p) => seen.has(p.id)));
  const promptIds = [...fresh, ...reused].slice(0, n).map((p) => p.id);
  if (!promptIds.length) throw new ApiError(409, "no_unseen_prompts", "You have played every prompt matching these filters");

  return withShortId(async (id) => {
    const [round] = await s.db
      .insert(schema.rounds)
      .values({
        id,
        mode: "random",
        title: "Random dive",
        promptIds,
        settings,
        filters: opts as unknown as Record<string, unknown>,
        bankVersion: s.bank.version,
        createdBy: playerId,
      })
      .returning();
    return round!;
  });
}

/**
 * A round replaying a bank set (a daily dive, Unlimited game or pack game). With default
 * settings everyone shares one round per set (id "set-d094"), so they share a leaderboard.
 */
export async function createSetRound(s: Services, playerId: string, setId: string, settings: RoundSettings): Promise<Round> {
  const set = s.bank.sets.get(setId);
  if (!set) throw new ApiError(404, "unknown_set", `No set ${setId}`);
  const shared = isDefault(settings);
  const values = {
    mode: "set" as const,
    setId: set.id,
    title: set.title,
    promptIds: set.promptIds,
    settings,
    bankVersion: s.bank.version,
    createdBy: shared ? null : playerId,
  };
  if (!shared) return withShortId(async (id) => (await s.db.insert(schema.rounds).values({ id, ...values }).returning())[0]!);
  const id = `set-${set.id}`;
  await s.db.insert(schema.rounds).values({ id, ...values }).onConflictDoNothing();
  return (await getRound(s, id))!;
}

export async function getRound(s: Services, id: string): Promise<Round | undefined> {
  const [r] = await s.db.select().from(schema.rounds).where(eq(schema.rounds.id, id));
  return r;
}

export async function requireRound(s: Services, id: string): Promise<Round> {
  const r = await getRound(s, id);
  if (!r) throw new ApiError(404, "round_not_found", "Round not found");
  return r;
}

/** Public round info. Prompt texts stay hidden so a shared link doesn't spoil the round. */
export async function roundView(s: Services, round: Round, viewerId?: string) {
  const g = schema.games;
  const [stats] = await s.db
    .select({ plays: count(), best: max(g.score), avg: avg(g.score) })
    .from(g)
    .where(and(eq(g.roundId, round.id), eq(g.status, "finished")));
  let creator: string | null = null;
  if (round.createdBy) {
    const [p] = await s.db.select().from(schema.players).where(eq(schema.players.id, round.createdBy));
    if (p) creator = displayName(p);
  }
  let yourGame = null;
  if (viewerId) {
    const [mine] = await s.db
      .select({ id: g.id, status: g.status, score: g.score })
      .from(g)
      .where(and(eq(g.roundId, round.id), eq(g.playerId, viewerId)));
    yourGame = mine ?? null;
  }
  return {
    id: round.id,
    mode: round.mode,
    setId: round.setId,
    title: round.title,
    promptCount: round.promptIds.length,
    maxScore: round.promptIds.length * 100,
    settings: round.settings,
    filters: round.filters,
    createdBy: creator,
    createdAt: round.createdAt,
    stats: {
      finishedPlays: stats?.plays ?? 0,
      bestScore: stats?.best ?? null,
      averageScore: stats?.avg == null ? null : Math.round(Number(stats.avg)),
    },
    yourGame,
  };
}
