import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Services } from "./context.ts";
import type { RoundSettings } from "./db/schema.ts";
import {
  getGameView, getOwnerView, listPlayerGames, nextPrompt, passPrompt, playerStats,
  roundLeaderboard, startGame, submitGuess,
} from "./services/games.ts";
import { createPlayer, playerByToken, playerView, renamePlayer, type Player } from "./services/players.ts";
import { DEFAULT_SETTINGS, createRandomRound, createSetRound, requireRound, roundView } from "./services/rounds.ts";
import { ApiError } from "./util.ts";

type Env = { Variables: { player: Player | undefined } };

// ───────────────────────────── request schemas ─────────────────────────────

const name = z.string().trim().min(1).max(32);

const settingsSchema = z
  .object({
    timerSeconds: z.number().int().min(0).max(600),
    previewSeconds: z.number().int().min(0).max(30),
    matcher: z.enum(["faithful", "forgiving", "strict"]),
  })
  .partial()
  .optional();

const createRoundSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("random"),
    count: z.number().int().min(1).max(50).default(7),
    kinds: z.array(z.enum(["daily", "unlimited", "pack"])).optional(),
    packs: z.array(z.string()).optional(),
    minAnswers: z.number().int().min(0).optional(),
    maxAnswers: z.number().int().min(0).optional(),
    diveFrom: z.number().int().min(1).optional(),
    diveTo: z.number().int().min(1).optional(),
    unseenOnly: z.boolean().optional(),
    settings: settingsSchema,
  }),
  z.object({ mode: z.literal("set"), setId: z.string().min(1), settings: settingsSchema }),
]);

const guessSchema = z.object({ text: z.string().trim().min(1).max(120), slot: z.number().int().min(1).optional() });
const passSchema = z.object({ slot: z.number().int().min(1).optional() }).default({});

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_request", z.prettifyError(parsed.error));
  return parsed.data;
}

function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, "invalid_request", `Expected an integer in ${min}..${max}`);
  return n;
}

// ────────────────────────────────── the app ──────────────────────────────────

export function createApp(s: Services, opts: { corsOrigins?: string[] } = {}) {
  const app = new Hono<Env>();
  const origins = opts.corsOrigins ?? ["*"];

  app.use(
    "/api/*",
    cors({
      origin: origins.includes("*") ? "*" : origins,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      maxAge: 86400,
    }),
  );

  // Identify the player from "Authorization: Bearer <token>" when present.
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("authorization");
    const token = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const player = token ? await playerByToken(s, token) : undefined;
    if (token && !player) throw new ApiError(401, "invalid_token", "Unknown player token");
    c.set("player", player);
    await next();
  });

  const me = (c: Context<Env>): Player => {
    const p = c.get("player");
    if (!p) throw new ApiError(401, "auth_required", "Create a player with POST /api/players and send its token");
    return p;
  };

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return c.json({ error: { code: "internal", message: "Internal error" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such endpoint" } }, 404));

  app.get("/health", (c) => c.json({ ok: true, bank: s.bank.version }));

  // ── bank catalogue ──
  app.get("/api/bank", (c) => {
    const kinds: Record<string, number> = {};
    for (const p of s.bank.prompts.values()) kinds[p.source.kind] = (kinds[p.source.kind] ?? 0) + 1;
    return c.json({
      version: s.bank.version,
      builtAt: s.bank.builtAt,
      prompts: s.bank.prompts.size,
      randomPool: s.bank.pool().length,
      sets: s.bank.sets.size,
      promptsByKind: kinds,
      defaults: DEFAULT_SETTINGS,
    });
  });

  app.get("/api/sets", (c) => {
    const kind = c.req.query("kind");
    const sets = [...s.bank.sets.values()]
      .filter((x) => !kind || x.kind === kind)
      .map(({ promptIds, ...rest }) => ({ ...rest, promptCount: promptIds.length }));
    return c.json({ sets });
  });

  // ── players ──
  app.post("/api/players", async (c) => {
    const { name: n } = await body(c, z.object({ name: name.optional() }));
    const { player, token } = await createPlayer(s, n);
    return c.json({ player: playerView(player), token }, 201);
  });

  app.get("/api/me", (c) => c.json({ player: playerView(me(c)) }));

  app.patch("/api/me", async (c) => {
    const { name: n } = await body(c, z.object({ name: name.nullable() }));
    return c.json({ player: playerView(await renamePlayer(s, me(c).id, n)) });
  });

  app.get("/api/me/games", async (c) => {
    const limit = intParam(c.req.query("limit"), 20, 1, 100);
    const beforeRaw = c.req.query("before");
    const before = beforeRaw ? new Date(beforeRaw) : undefined;
    if (before && Number.isNaN(before.getTime())) throw new ApiError(400, "invalid_request", "Bad `before` timestamp");
    return c.json(await listPlayerGames(s, me(c).id, limit, before));
  });

  app.get("/api/me/stats", async (c) => c.json(await playerStats(s, me(c).id)));

  // ── rounds (shareable) ──
  app.post("/api/rounds", async (c) => {
    const player = me(c);
    const req = await body(c, createRoundSchema);
    const settings: RoundSettings = { ...DEFAULT_SETTINGS, ...req.settings };
    const round =
      req.mode === "random"
        ? await createRandomRound(s, player.id, (({ mode, settings, ...o }) => o)(req), settings)
        : await createSetRound(s, player.id, req.setId, settings);
    return c.json({ round: await roundView(s, round, player.id) }, 201);
  });

  app.get("/api/rounds/:id", async (c) => {
    const round = await requireRound(s, c.req.param("id"));
    return c.json({ round: await roundView(s, round, c.get("player")?.id) });
  });

  app.get("/api/rounds/:id/leaderboard", async (c) => {
    const limit = intParam(c.req.query("limit"), 50, 1, 200);
    return c.json(await roundLeaderboard(s, c.req.param("id"), limit, c.get("player")?.id));
  });

  /** Start (or resume) this player's game for the round. */
  app.post("/api/rounds/:id/games", async (c) => {
    const player = me(c);
    const { autoAccept } = await body(c, z.object({ autoAccept: z.boolean().optional() }));
    const gameId = await startGame(s, c.req.param("id"), player.id, autoAccept);
    return c.json({ game: await getOwnerView(s, gameId, player.id) }, 201);
  });

  // ── games ──
  app.get("/api/games/:id", async (c) => c.json({ game: await getGameView(s, c.req.param("id"), c.get("player")?.id) }));

  app.post("/api/games/:id/next", async (c) => c.json({ game: await nextPrompt(s, c.req.param("id"), me(c).id) }));

  app.post("/api/games/:id/guess", async (c) => {
    const { text, slot } = await body(c, guessSchema);
    return c.json(await submitGuess(s, c.req.param("id"), me(c).id, text, slot));
  });

  app.post("/api/games/:id/pass", async (c) => {
    const { slot } = await body(c, passSchema);
    return c.json({ game: await passPrompt(s, c.req.param("id"), me(c).id, slot) });
  });

  return app;
}
