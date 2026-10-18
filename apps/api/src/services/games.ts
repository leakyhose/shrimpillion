import { and, asc, count, desc, eq, exists, gt, inArray, lt, sql } from "drizzle-orm";
import { MAX_POINTS_PER_PROMPT, PRESETS, TIERS, grade, pointsFor, type Tier } from "@shrimpillion/core";
import type { Services } from "../context.ts";
import { schema, type Db } from "../db/index.ts";
import type { GuessResult, RoundSettings, SlotStatus } from "../db/schema.ts";
import { ApiError, withShortId } from "../util.ts";
import { displayName } from "./players.ts";
import { requireRound, type Round } from "./rounds.ts";

type Game = typeof schema.games.$inferSelect;
type Slot = typeof schema.gameSlots.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Extra time after the visible timer, to absorb network latency. */
export const GRACE_MS = 2000;
/** Guesses allowed per prompt; rejected guesses are free, so this only stops abuse. */
export const MAX_GUESSES_PER_PROMPT = 200;

const { games, gameSlots, guesses, players } = schema;
const isClosed = (status: SlotStatus) => status === "answered" || status === "timeout";

/** A slot's status as of `now`, counting an expired active slot as timed out. */
function effectiveStatus(slot: Slot, now: Date): SlotStatus {
  return slot.status === "active" && slot.deadline && now > slot.deadline ? "timeout" : slot.status;
}

// ───────────────────────────── starting and loading ─────────────────────────────

/** Start (or resume) the player's game for a round. One game per player per round. */
export async function startGame(s: Services, roundId: string, playerId: string, autoAccept = false): Promise<string> {
  const round = await requireRound(s, roundId);
  return withShortId((id) =>
    s.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(games)
        .values({ id, roundId, playerId, autoAccept, startedAt: s.now() })
        .onConflictDoNothing({ target: [games.roundId, games.playerId] })
        .returning();
      if (!created) {
        const [existing] = await tx
          .select({ id: games.id })
          .from(games)
          .where(and(eq(games.roundId, roundId), eq(games.playerId, playerId)));
        return existing!.id;
      }
      await tx.insert(gameSlots).values(
        round.promptIds.map((promptId, i) => ({
          gameId: created.id,
          slot: i + 1,
          promptId,
          promptVersion: s.bank.prompt(promptId)?.version ?? "missing",
        })),
      );
      return created.id;
    }),
  );
}

interface GameState {
  game: Game;
  round: Round;
  slots: Slot[];
}

async function loadState(db: Db | Tx, gameId: string, lock: boolean): Promise<GameState> {
  const q = db.select().from(games).where(eq(games.id, gameId));
  const [game] = lock ? await q.for("update") : await q;
  if (!game) throw new ApiError(404, "game_not_found", "Game not found");
  const [round] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, game.roundId));
  const slots = await db.select().from(gameSlots).where(eq(gameSlots.gameId, gameId)).orderBy(asc(gameSlots.slot));
  return { game, round: round!, slots };
}

/** Lock the game, check ownership, and apply any timeout or completion that is due. */
async function lockOwned(s: Services, tx: Tx, gameId: string, playerId: string): Promise<GameState> {
  const state = await loadState(tx, gameId, true);
  if (state.game.playerId !== playerId) throw new ApiError(403, "not_your_game", "This game belongs to another player");
  await settle(s, tx, state);
  return state;
}

async function settle(s: Services, tx: Tx, state: GameState): Promise<void> {
  const now = s.now();
  for (const slot of state.slots) {
    if (slot.status === "active" && effectiveStatus(slot, now) === "timeout") {
      await tx
        .update(gameSlots)
        .set({ status: "timeout", endedAt: slot.deadline })
        .where(and(eq(gameSlots.gameId, slot.gameId), eq(gameSlots.slot, slot.slot)));
      slot.status = "timeout";
      slot.endedAt = slot.deadline;
    }
  }
  if (state.game.status === "active" && state.slots.every((x) => isClosed(x.status))) {
    const score = state.slots.reduce((n, x) => n + x.score, 0);
    await tx.update(games).set({ status: "finished", score, finishedAt: now }).where(eq(games.id, state.game.id));
    Object.assign(state.game, { status: "finished", score, finishedAt: now });
  }
}

function deadlineFor(settings: RoundSettings, start: Date): Date | null {
  if (!settings.timerSeconds) return null;
  return new Date(start.getTime() + (settings.previewSeconds + settings.timerSeconds) * 1000 + GRACE_MS);
}

// ───────────────────────────────────── play ─────────────────────────────────────

/** Open the next prompt (idempotent while one is open). */
export async function nextPrompt(s: Services, gameId: string, playerId: string) {
  await s.db.transaction(async (tx) => {
    const state = await lockOwned(s, tx, gameId, playerId);
    if (state.game.status === "finished" || state.slots.some((x) => x.status === "active")) return;
    const pending = state.slots.find((x) => x.status === "pending");
    if (!pending) return;
    const now = s.now();
    await tx
      .update(gameSlots)
      .set({ status: "active", startedAt: now, deadline: deadlineFor(state.round.settings, now) })
      .where(and(eq(gameSlots.gameId, gameId), eq(gameSlots.slot, pending.slot)));
  });
  return getOwnerView(s, gameId, playerId);
}

export interface GuessOutcome {
  /** "closed": the prompt had already timed out (or was answered) before this guess. */
  result: GuessResult | "closed";
  /** For "correction": the answer to resubmit to confirm ("did you mean …?"). */
  correction?: string;
  answer?: { name: string; tier: Tier; points: number; quip: string | null };
}

export async function submitGuess(s: Services, gameId: string, playerId: string, text: string, slotNo?: number) {
  const outcome = await s.db.transaction(async (tx): Promise<GuessOutcome> => {
    const state = await lockOwned(s, tx, gameId, playerId);
    const slot = state.slots.find((x) => x.status === "active");
    if (!slot || (slotNo !== undefined && slot.slot !== slotNo)) {
      if (slotNo !== undefined && state.slots.some((x) => x.slot === slotNo && isClosed(x.status))) {
        return { result: "closed" };
      }
      throw new ApiError(409, "no_active_prompt", "No prompt is open; call /next first");
    }
    if (slot.guessCount >= MAX_GUESSES_PER_PROMPT) throw new ApiError(429, "too_many_guesses", "Guess limit reached for this prompt");

    const match = grade(s.bank.prepared(slot.promptId), text, PRESETS[state.round.settings.matcher]);
    const result: GuessResult =
      match.status === "correction" && state.game.autoAccept ? "accept" : match.status;
    const matched = match.status === "reject" ? null : match.answer;

    await tx.insert(guesses).values({
      gameId, slot: slot.slot, promptId: slot.promptId, input: text, result, matched: matched?.name ?? null,
      createdAt: s.now(),
    });
    const where = and(eq(gameSlots.gameId, gameId), eq(gameSlots.slot, slot.slot));
    if (result !== "accept" || !matched) {
      await tx.update(gameSlots).set({ guessCount: sql`${gameSlots.guessCount} + 1` }).where(where);
      return result === "correction" ? { result, correction: matched!.name } : { result };
    }

    const points = pointsFor(matched.tier);
    await tx
      .update(gameSlots)
      .set({
        status: "answered", answer: matched.name, tier: matched.tier, score: points, endedAt: s.now(),
        guessCount: sql`${gameSlots.guessCount} + 1`,
      })
      .where(where);
    await tx.update(games).set({ score: sql`${games.score} + ${points}` }).where(eq(games.id, gameId));
    Object.assign(slot, { status: "answered", score: points });
    await settle(s, tx, state);
    return { result, answer: { name: matched.name, tier: matched.tier, points, quip: matched.quip ?? null } };
  });
  return { ...outcome, game: await getOwnerView(s, gameId, playerId) };
}

// ───────────────────────────────────── views ─────────────────────────────────────

function slotTimes(slot: Slot, settings: RoundSettings) {
  if (!slot.startedAt) return { timerStartsAt: null, timerEndsAt: null };
  const t0 = slot.startedAt.getTime() + settings.previewSeconds * 1000;
  return {
    timerStartsAt: new Date(t0),
    timerEndsAt: settings.timerSeconds ? new Date(t0 + settings.timerSeconds * 1000) : null,
  };
}

function roundSummary(round: Round) {
  return { id: round.id, title: round.title, mode: round.mode, setId: round.setId, settings: round.settings };
}

/** Full view for the game's owner. Prompts are only revealed once opened. */
export async function getOwnerView(s: Services, gameId: string, playerId: string) {
  const state = await s.db.transaction((tx) => lockOwned(s, tx, gameId, playerId));
  return ownerView(s, state);
}

function ownerView(s: Services, { game, round, slots }: GameState) {
  const finished = game.status === "finished";
  return {
    id: game.id,
    roundId: game.roundId,
    round: roundSummary(round),
    status: game.status,
    autoAccept: game.autoAccept,
    score: game.score,
    maxScore: slots.length * MAX_POINTS_PER_PROMPT,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    currentSlot: slots.find((x) => x.status === "active")?.slot ?? null,
    slots: slots.map((x) => {
      const prompt = s.bank.prompt(x.promptId);
      const shown = finished || x.status !== "pending";
      return {
        slot: x.slot,
        status: x.status,
        prompt: shown && prompt ? { id: prompt.id, text: prompt.text, answerCount: prompt.answers.length } : null,
        ...slotTimes(x, round.settings),
        answer: x.answer,
        tier: x.tier,
        score: x.score,
        guessCount: x.guessCount,
      };
    }),
  };
}

async function hasFinishedRound(s: Services, roundId: string, playerId?: string): Promise<boolean> {
  if (!playerId) return false;
  const [row] = await s.db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.roundId, roundId), eq(games.playerId, playerId), eq(games.status, "finished")));
  return !!row;
}

/**
 * Someone else's game (e.g. from a "beat my score" link). Prompts and answers are hidden until the
 * viewer has finished the same round; tiers and scores are always visible.
 */
export async function getGameView(s: Services, gameId: string, viewerId?: string) {
  const [g] = await s.db.select({ playerId: games.playerId }).from(games).where(eq(games.id, gameId));
  if (!g) throw new ApiError(404, "game_not_found", "Game not found");
  if (viewerId && g.playerId === viewerId) return { owner: true as const, ...(await getOwnerView(s, gameId, viewerId)) };

  const { game, round, slots } = await loadState(s.db, gameId, false);
  const [player] = await s.db.select().from(players).where(eq(players.id, game.playerId));
  const reveal = await hasFinishedRound(s, round.id, viewerId);
  const now = s.now();
  return {
    owner: false as const,
    id: game.id,
    roundId: round.id,
    round: roundSummary(round),
    player: { displayName: displayName(player!) },
    status: game.status,
    score: game.score,
    maxScore: slots.length * MAX_POINTS_PER_PROMPT,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    answersVisible: reveal,
    slots: slots.map((x) => ({
      slot: x.slot,
      status: effectiveStatus(x, now),
      tier: x.tier,
      score: x.score,
      prompt: reveal ? { id: x.promptId, text: s.bank.prompt(x.promptId)?.text ?? null } : null,
      answer: reveal ? x.answer : null,
    })),
  };
}

// ──────────────────────────────── history & boards ────────────────────────────────

/** Games with at least one submitted guess. Opening a game and leaving doesn't put it in the history. */
const hasGuesses = (s: Services) =>
  exists(s.db.select({ one: sql`1` }).from(guesses).where(eq(guesses.gameId, games.id)));

/** The player's past and in-progress games, newest first. Paginate with `before` = last startedAt. */
export async function listPlayerGames(s: Services, playerId: string, limit: number, before?: Date) {
  const rows = await s.db
    .select({ game: games, round: schema.rounds })
    .from(games)
    .innerJoin(schema.rounds, eq(schema.rounds.id, games.roundId))
    .where(and(eq(games.playerId, playerId), hasGuesses(s), before ? lt(games.startedAt, before) : undefined))
    .orderBy(desc(games.startedAt))
    .limit(limit);
  const ids = rows.map((r) => r.game.id);
  const slotRows = ids.length
    ? await s.db.select().from(gameSlots).where(inArray(gameSlots.gameId, ids)).orderBy(asc(gameSlots.slot))
    : [];
  const now = s.now();
  const items = rows.map(({ game, round }) => {
    const mine = slotRows.filter((x) => x.gameId === game.id);
    const finished = game.status === "finished";
    return {
      id: game.id,
      roundId: game.roundId,
      round: roundSummary(round),
      status: game.status,
      score: game.score,
      maxScore: mine.length * MAX_POINTS_PER_PROMPT,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
      slots: mine.map((x) => {
        const status = effectiveStatus(x, now);
        const shown = finished || status !== "pending";
        return {
          slot: x.slot,
          status,
          prompt: shown ? { id: x.promptId, text: s.bank.prompt(x.promptId)?.text ?? null } : null,
          answer: x.answer,
          tier: x.tier,
          score: x.score,
        };
      }),
    };
  });
  const last = rows.at(-1);
  return { items, nextBefore: rows.length === limit && last ? last.game.startedAt.toISOString() : null };
}

export async function playerStats(s: Services, playerId: string) {
  const [g] = await s.db
    .select({
      started: count(),
      finished: sql<number>`count(*) filter (where ${games.status} = 'finished')`.mapWith(Number),
      best: sql<number | null>`max(${games.score}) filter (where ${games.status} = 'finished')`,
      avg: sql<string | null>`avg(${games.score}) filter (where ${games.status} = 'finished')`,
    })
    .from(games)
    .where(and(eq(games.playerId, playerId), hasGuesses(s)));
  const slotRows = await s.db
    .select({ status: gameSlots.status, tier: gameSlots.tier, n: count(), points: sql<number>`sum(${gameSlots.score})`.mapWith(Number) })
    .from(gameSlots)
    .innerJoin(games, eq(games.id, gameSlots.gameId))
    .where(and(eq(games.playerId, playerId), inArray(gameSlots.status, ["answered", "timeout"])))
    .groupBy(gameSlots.status, gameSlots.tier);
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  let answered = 0, timedOut = 0, points = 0;
  for (const r of slotRows) {
    points += r.points ?? 0;
    if (r.status === "answered") { answered += r.n; if (r.tier) tiers[r.tier as Tier] += r.n; }
    if (r.status === "timeout") timedOut += r.n;
  }
  return {
    gamesStarted: g?.started ?? 0,
    gamesFinished: g?.finished ?? 0,
    bestScore: g?.best == null ? null : Number(g.best),
    averageScore: g?.avg == null ? null : Math.round(Number(g.avg)),
    promptsPlayed: answered + timedOut,
    answered, timedOut,
    totalPoints: points,
    tiers,
  };
}

/** Finished games for a round, best first. Answers only shown to viewers who finished it too. */
export async function roundLeaderboard(s: Services, roundId: string, limit: number, viewerId?: string) {
  await requireRound(s, roundId);
  const finished = and(eq(games.roundId, roundId), eq(games.status, "finished"));
  const rows = await s.db
    .select({ game: games, player: players })
    .from(games)
    .innerJoin(players, eq(players.id, games.playerId))
    .where(finished)
    .orderBy(desc(games.score), asc(games.finishedAt))
    .limit(limit);
  const ids = rows.map((r) => r.game.id);
  const slotRows = ids.length
    ? await s.db.select().from(gameSlots).where(inArray(gameSlots.gameId, ids)).orderBy(asc(gameSlots.slot))
    : [];
  const reveal = await hasFinishedRound(s, roundId, viewerId);
  const [{ total } = { total: 0 }] = await s.db.select({ total: count() }).from(games).where(finished);

  let you = null;
  if (viewerId) {
    const [mine] = await s.db.select().from(games).where(and(eq(games.roundId, roundId), eq(games.playerId, viewerId)));
    if (mine?.status === "finished") {
      const [{ better } = { better: 0 }] = await s.db
        .select({ better: count() })
        .from(games)
        .where(and(finished, gt(games.score, mine.score)));
      you = { gameId: mine.id, score: mine.score, rank: better + 1 };
    }
  }

  return {
    total,
    answersVisible: reveal,
    you,
    entries: rows.map(({ game, player }, i) => ({
      rank: i + 1,
      gameId: game.id,
      player: displayName(player),
      score: game.score,
      finishedAt: game.finishedAt,
      slots: slotRows
        .filter((x) => x.gameId === game.id)
        .map((x) => ({ slot: x.slot, status: x.status, tier: x.tier, score: x.score, answer: reveal ? x.answer : null })),
    })),
  };
}
