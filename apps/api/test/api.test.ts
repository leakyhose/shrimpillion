import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize } from "@shrimpillion/core";
import { DEFAULT_DATA_DIR, buildBank } from "../scripts/import-bank.ts";
import { createApp } from "../src/app.ts";
import { Bank } from "../src/bank/bank.ts";
import { openDb } from "../src/db/index.ts";

// These tests play real prompts, so they need the raw data in research/ (not part of the repo).
const hasData = existsSync(DEFAULT_DATA_DIR);

let clock = Date.parse("2026-10-17T12:00:00Z");
let bank: Bank;
let app: ReturnType<typeof createApp>;
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  if (!hasData) return;
  bank = new Bank(buildBank(undefined, () => {}));
  const db = await openDb({ pgliteDir: "memory://" });
  close = db.close;
  app = createApp({ db: db.db, bank, now: () => new Date(clock) });
});
afterAll(() => close?.());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function newPlayer(name?: string) {
  const r = await call("POST", "/api/players", undefined, name ? { name } : {});
  expect(r.status).toBe(201);
  return r.body.token as string;
}

/** A guess one typo away from a long single-word answer (should come back as a correction). */
function typoFor(promptId: string) {
  const answer = bank.prompt(promptId)!.answers.find((a) => /^[a-z]{9,}$/.test(normalize(a.name)))!;
  const n = normalize(answer.name);
  return { answer: answer.name, typo: n.slice(0, 4) + (n[4] === "q" ? "z" : "q") + n.slice(5) };
}

describe.skipIf(!hasData)("random round → play → share", () => {
  let alice: string, bob: string, roundId: string, gameId: string;

  it("creates players", async () => {
    alice = await newPlayer("Alice");
    bob = await newPlayer();
    const me = await call("GET", "/api/me", bob);
    expect(me.body.player.displayName).toMatch(/^Diver /);
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("GET", "/api/me", "shr_nope")).status).toBe(401);
  });

  it("creates a random round without leaking prompts", async () => {
    const r = await call("POST", "/api/rounds", alice, { mode: "random", count: 3, kinds: ["unlimited"], settings: { timerSeconds: 30 } });
    expect(r.status).toBe(201);
    roundId = r.body.round.id;
    expect(roundId).toMatch(/^[2-9a-hjkmnp-z]{6}$/); // short, no look-alike characters
    expect(r.body.round).toMatchObject({ mode: "random", promptCount: 3, maxScore: 300, createdBy: "Alice" });
    expect(r.body.round.settings).toEqual({ timerSeconds: 30, previewSeconds: 3, matcher: "faithful" });
    expect(JSON.stringify(r.body)).not.toContain("Name a");
  });

  it("plays a prompt: reject, correction, then accept", async () => {
    const start = await call("POST", `/api/rounds/${roundId}/games`, alice, {});
    expect(start.status).toBe(201);
    gameId = start.body.game.id;
    expect(gameId).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
    expect(start.body.game.slots.every((s: any) => s.status === "pending" && s.prompt === null)).toBe(true);

    // starting again resumes the same game
    expect((await call("POST", `/api/rounds/${roundId}/games`, alice, {})).body.game.id).toBe(gameId);

    expect((await call("POST", `/api/games/${gameId}/guess`, alice, { text: "x" })).status).toBe(409);

    const next = await call("POST", `/api/games/${gameId}/next`, alice);
    const slot1 = next.body.game.slots[0];
    expect(slot1.status).toBe("active");
    expect(slot1.prompt.text).toMatch(/^Name/);
    expect(next.body.game.slots[1].prompt).toBeNull();
    expect(Date.parse(slot1.timerEndsAt) - Date.parse(slot1.timerStartsAt)).toBe(30_000);

    const reject = await call("POST", `/api/games/${gameId}/guess`, alice, { text: "zzzzzzzz qqqqq", slot: 1 });
    expect(reject.body.result).toBe("reject");

    const { answer, typo } = typoFor(slot1.prompt.id);
    const corr = await call("POST", `/api/games/${gameId}/guess`, alice, { text: typo, slot: 1 });
    expect(corr.body.result).toBe("correction");
    expect(corr.body.answer).toBeUndefined();

    const acc = await call("POST", `/api/games/${gameId}/guess`, alice, { text: corr.body.correction, slot: 1 });
    expect(acc.body.result).toBe("accept");
    expect(acc.body.answer.name).toBe(corr.body.correction);
    expect(acc.body.game.slots[0]).toMatchObject({ status: "answered", guessCount: 3, score: acc.body.answer.points });
    expect(acc.body.game.score).toBe(acc.body.answer.points);
    expect(answer).toBeTruthy();
  });

  it("passes and times out, then finishes", async () => {
    await call("POST", `/api/games/${gameId}/next`, alice);
    const pass = await call("POST", `/api/games/${gameId}/pass`, alice, { slot: 2 });
    expect(pass.body.game.slots[1].status).toBe("passed");

    await call("POST", `/api/games/${gameId}/next`, alice);
    clock += 60_000; // past preview + timer + grace
    const late = await call("POST", `/api/games/${gameId}/guess`, alice, { text: "anything", slot: 3 });
    expect(late.body.result).toBe("closed");
    expect(late.body.game.status).toBe("finished");
    expect(late.body.game.slots[2].status).toBe("timeout");
    expect(late.body.game.slots.every((s: any) => s.prompt)).toBe(true);
  });

  it("lists history and stats", async () => {
    const hist = await call("GET", "/api/me/games", alice);
    expect(hist.body.items).toHaveLength(1);
    expect(hist.body.items[0]).toMatchObject({ id: gameId, roundId, status: "finished" });
    expect(hist.body.items[0].slots.map((s: any) => s.status)).toEqual(["answered", "passed", "timeout"]);
    const stats = await call("GET", "/api/me/stats", alice);
    expect(stats.body).toMatchObject({ gamesStarted: 1, gamesFinished: 1, promptsPlayed: 3, answered: 1, passed: 1, timedOut: 1 });
  });

  it("lets a friend open the shared round without spoilers, then compare", async () => {
    const round = await call("GET", `/api/rounds/${roundId}`, bob);
    expect(round.body.round.stats.finishedPlays).toBe(1);
    expect(round.body.round.yourGame).toBeNull();

    const board = await call("GET", `/api/rounds/${roundId}/leaderboard`, bob);
    expect(board.body.answersVisible).toBe(false);
    expect(board.body.entries[0]).toMatchObject({ rank: 1, player: "Alice", gameId });
    expect(board.body.entries[0].slots[0].answer).toBeNull();

    const aliceGame = await call("GET", `/api/games/${gameId}`, bob);
    expect(aliceGame.body.game).toMatchObject({ owner: false, answersVisible: false });
    expect(aliceGame.body.game.slots[0].prompt).toBeNull();
    expect((await call("POST", `/api/games/${gameId}/next`, bob)).status).toBe(403);

    // Bob plays the same prompts
    const g = (await call("POST", `/api/rounds/${roundId}/games`, bob, { autoAccept: true })).body.game;
    const aliceSlots = (await call("GET", `/api/games/${gameId}`, alice)).body.game.slots;
    for (let i = 1; i <= 3; i++) {
      const n = await call("POST", `/api/games/${g.id}/next`, bob);
      expect(n.body.game.slots[i - 1].prompt.id).toBe(aliceSlots[i - 1].prompt.id);
      if (i === 1) {
        // autoAccept turns a correction straight into an accept
        const r = await call("POST", `/api/games/${g.id}/guess`, bob, { text: typoFor(n.body.game.slots[0].prompt.id).typo });
        expect(r.body.result).toBe("accept");
      } else {
        await call("POST", `/api/games/${g.id}/pass`, bob);
      }
    }

    const after = await call("GET", `/api/rounds/${roundId}/leaderboard`, bob);
    expect(after.body.total).toBe(2);
    expect(after.body.answersVisible).toBe(true);
    expect(after.body.entries[0].slots[0].answer).toBeTruthy();
    expect(after.body.you.rank).toBeGreaterThanOrEqual(1);
  });

  it("draws unseen prompts first", async () => {
    const seen = new Set((await call("GET", "/api/me/games", alice)).body.items[0].slots.map((s: any) => s.prompt.id));
    const r = await call("POST", "/api/rounds", alice, { mode: "random", count: 7, kinds: ["unlimited"], unseenOnly: true });
    expect(r.body.round.promptCount).toBe(4); // u001 has 7 prompts, 3 already played
    const g = await call("POST", `/api/rounds/${r.body.round.id}/games`, alice, {});
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = await call("POST", `/api/games/${g.body.game.id}/next`, alice);
      ids.push(n.body.game.slots[i].prompt.id);
      await call("POST", `/api/games/${g.body.game.id}/pass`, alice);
    }
    expect(ids.some((id) => seen.has(id))).toBe(false);
    const none = await call("POST", "/api/rounds", alice, { mode: "random", kinds: ["unlimited"], unseenOnly: true });
    expect(none.status).toBe(409);
  });

  it("leaves games without a guess out of the history", async () => {
    const carol = await newPlayer();
    async function play(guess?: string) {
      const round = (await call("POST", "/api/rounds", carol, { mode: "random", count: 2, kinds: ["unlimited"] })).body.round;
      const game = (await call("POST", `/api/rounds/${round.id}/games`, carol, {})).body.game;
      for (let i = 0; i < 2; i++) {
        await call("POST", `/api/games/${game.id}/next`, carol);
        if (guess && i === 0) await call("POST", `/api/games/${game.id}/guess`, carol, { text: guess });
        await call("POST", `/api/games/${game.id}/pass`, carol);
      }
      return { roundId: round.id as string, gameId: game.id as string };
    }

    const idle = await play();
    expect((await call("GET", "/api/me/games", carol)).body.items).toEqual([]);
    expect((await call("GET", "/api/me/stats", carol)).body).toMatchObject({ gamesStarted: 0, gamesFinished: 0, bestScore: null });
    // still a finished game as far as the round's leaderboard is concerned
    expect((await call("GET", `/api/rounds/${idle.roundId}/leaderboard`)).body.total).toBe(1);

    const played = await play("zzzzzzzz qqqqq");
    expect((await call("GET", "/api/me/games", carol)).body.items.map((g: any) => g.id)).toEqual([played.gameId]);
    expect((await call("GET", "/api/me/stats", carol)).body).toMatchObject({ gamesStarted: 1, gamesFinished: 1, bestScore: 0 });
  });
});

describe.skipIf(!hasData)("set rounds", () => {
  it("shares one round per set with default settings", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const r1 = await call("POST", "/api/rounds", a, { mode: "set", setId: "d094" });
    const r2 = await call("POST", "/api/rounds", b, { mode: "set", setId: "d094" });
    expect(r1.body.round.id).toBe("set-d094");
    expect(r2.body.round.id).toBe("set-d094");
    expect(r1.body.round.title).toBe("Dive #94");
    const custom = await call("POST", "/api/rounds", a, { mode: "set", setId: "d094", settings: { timerSeconds: 0 } });
    expect(custom.body.round.id).not.toBe("set-d094");
    expect((await call("POST", "/api/rounds", a, { mode: "set", setId: "nope" })).status).toBe(404);
  });

  it("untimed rounds never time out", async () => {
    const a = await newPlayer();
    const r = await call("POST", "/api/rounds", a, { mode: "set", setId: "u001", settings: { timerSeconds: 0 } });
    const g = (await call("POST", `/api/rounds/${r.body.round.id}/games`, a, {})).body.game;
    const n = await call("POST", `/api/games/${g.id}/next`, a);
    expect(n.body.game.slots[0].timerEndsAt).toBeNull();
    clock += 3_600_000;
    const v = await call("GET", `/api/games/${g.id}`, a);
    expect(v.body.game.slots[0].status).toBe("active");
  });

  it("lists the catalogue", async () => {
    const sets = await call("GET", "/api/sets?kind=pack");
    expect(sets.body.sets.map((s: any) => s.id)).toEqual(["geography01", "lexicon01", "movies01", "sports01"]);
    const info = await call("GET", "/api/bank");
    expect(info.body.prompts).toBe(bank.prompts.size);
  });

  it("validates input", async () => {
    const a = await newPlayer();
    expect((await call("POST", "/api/rounds", a, { mode: "random", count: 0 })).status).toBe(400);
    expect((await call("POST", "/api/rounds", a, { mode: "nope" })).status).toBe(400);
    expect((await call("GET", "/api/rounds/doesnotexist")).status).toBe(404);
  });
});

describe("short ids", () => {
  it("draws a new id when one is taken", async () => {
    const { withShortId } = await import("../src/util.ts");
    const tried: string[] = [];
    const id = await withShortId(async (id) => {
      tried.push(id);
      if (tried.length < 3) throw Object.assign(new Error("duplicate key"), { cause: { code: "23505" } });
      return id;
    });
    expect(tried).toHaveLength(3);
    expect(id).toBe(tried[2]);
    await expect(withShortId(async () => { throw new Error("other"); })).rejects.toThrow("other");
  });
});
