import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { TIER_LABELS, api, fullUrl, newDive, startGame, useApi } from "../api.ts";
import { ScoreCurve } from "../Curve.tsx";
import { type MascotSpot, Ocean, PX_PER_M, type Shot, sinkMs, sinkProgress, Wordmark } from "../Ocean.tsx";
import { packForRound } from "../packs.ts";
import { isMuted, setMuted, sfx } from "../sound.ts";
import { TierIcon } from "../sprites.tsx";

const TIERS: [string, number][] = [
  ["plankton", 10], ["tooclever", 15], ["schooler", 30], ["rare", 60], ["deepcut", 85], ["shrimpillion", 100],
];
/** Line under an accepted answer that has no quip of its own. */
const TIER_SUB: Record<string, string> = {
  plankton: "Everyone and their nan said that.",
  tooclever: "The 'obscure' pick the whole school reached for.",
  schooler: "Swims with the school. Respectable.",
  rare: "Off the beaten reef. Nice.",
  deepcut: "Down where the light gives up.",
  shrimpillion: "One in a shrimpillion. Absurd.",
};
const MISS_SUB: Record<string, string> = {
  timeout: "the clock got there first.",
  passed: "you let this one swim by.",
};
const TIER_EMOJI: Record<string, string> = {
  plankton: "🫧", tooclever: "🤡", schooler: "🐟", rare: "🦑", deepcut: "🏮", shrimpillion: "🌟", miss: "⬛",
};
const tierColor = (tier: string | null) => ({ "--tc": `var(--tier-${tier ?? "miss"})` }) as CSSProperties;
const metres = (m: number) => `${m.toLocaleString("en-US")}m`;

/** /g/:gameId — play your own game, or view someone else's. */
export function Game() {
  const { gameId } = useParams();
  const { data, setData, error, reload } = useApi(`/api/games/${gameId}`);
  if (error) {
    return (
      <div className="page">
        <div className="page-inner">
          <Link to="/"><Wordmark small /></Link>
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }
  // Stay dark until the game is in hand, so the scene fades in once, fully built.
  if (!data) return <div className="ds-root" />;
  const game = data.game;
  if (!game.owner) return <OtherGame key={game.id} game={game} />;
  return <Play key={game.id} game={game} setGame={(g: any) => setData({ game: { owner: true, ...g } })} reload={reload} />;
}

type Landing = {
  slot: number;
  quip: string | null;
  fromScore: number;
  sinking: boolean;
  tier: string;
  answer: string;
  /** How long the answer takes to sink. */
  ms: number;
  /** World y the answer chip starts falling from (just under the prompt card). */
  chip: number;
};
/** Something on its way out: a prompt card fading after it closes, or a landed banner after DESCEND. */
type Ghost = { key: number; kind: "card" | "banner"; y: number; slot: any; quip: string | null };

const depthPx = (score: number) => score * 10 * PX_PER_M;

function Play({ game, setGame, reload }: { game: any; setGame: (g: any) => void; reload: () => void }) {
  const pack = packForRound(game.round);
  const active = game.slots.find((s: any) => s.status === "active");
  const closed = game.slots.filter((s: any) => s.status !== "pending" && s.status !== "active");
  const last = closed.at(-1);
  const total = game.slots.length;

  const [surfaced, setSurfaced] = useState(game.status === "finished");
  const [landing, setLanding] = useState<Landing | null>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase = active ? "prompt" : closed.length === 0 ? "begin" : game.status === "finished" && surfaced ? "results" : "landed";
  const sinking = phase === "landed" && !!landing?.sinking && landing.slot === last?.slot;
  const y = depthPx(game.score);
  const sinkFor = sinking ? landing!.ms : 0;
  const shownDepth = useTween(game.score * 10, sinking ? sinkFor : 300, sinking ? (k) => sinkProgress(k * sinkFor, sinkFor, landing!.tier) : undefined);
  const shownScore = useTween(sinking ? landing!.fromScore : game.score, 450);
  const quip = landing && last && landing.slot === last.slot ? landing.quip : null;
  const missed = phase === "landed" && last && last.status !== "answered";

  // Whatever just closed fades out where it stood instead of vanishing.
  const prev = useRef<{ phase: string; active: any; last: any; y: number; quip: string | null } | null>(null);
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { phase, active, last, y, quip };
    if (!p) return;
    const add: Ghost[] = [];
    const key = performance.now();
    const closedAs = game.slots.find((s: any) => s.slot === p.active?.slot)?.status;
    if (p.active && p.active.slot !== active?.slot && closedAs !== "timeout") add.push({ key, kind: "card", y: p.y, slot: p.active, quip: null });
    if (p.phase === "landed" && phase !== "landed" && p.last) add.push({ key: key + 1, kind: "banner", y: p.y, slot: p.last, quip: p.quip });
    if (!add.length) return;
    setGhosts((g) => [...g, ...add]);
    setTimeout(() => setGhosts((g) => g.filter((x) => !add.includes(x))), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, active?.slot]);

  // Points chime when a sinking answer lands; a droop when a prompt closes empty.
  const was = useRef({ phase, sinking });
  useEffect(() => {
    const w = was.current;
    was.current = { phase, sinking };
    if (w.sinking && !sinking && last?.status === "answered") sfx.land(last.tier);
    else if (w.phase === "prompt" && phase === "landed" && missed) sfx.miss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sinking]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const next = () =>
    act(async () => {
      sfx.descend();
      setGame((await api("POST", `/api/games/${game.id}/next`)).game);
    });

  async function guess(text: string, slot: number): Promise<any> {
    setBusy(true);
    setError(null);
    try {
      const r = await api("POST", `/api/games/${game.id}/guess`, { text, slot });
      if (r.result === "accept") {
        sfx.sink();
        const gained = Math.max(1, r.game.score - game.score);
        const ms = sinkMs(r.answer.tier);
        // The chip starts at most 180 px under the card's depth line.
        const chip = y + Math.min(180, depthPx(gained));
        setLanding({ slot, quip: r.answer.quip, fromScore: game.score, sinking: true, tier: r.answer.tier, answer: r.answer.name, ms, chip });
        setTimeout(() => setLanding((l) => (l && l.slot === slot ? { ...l, sinking: false } : l)), ms);
      }
      setGame(r.game);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const pass = (slot: number) =>
    act(async () => {
      setGame((await api("POST", `/api/games/${game.id}/pass`, { slot })).game);
    });

  const view = phase === "begin" ? "title" : phase === "results" ? "results" : "dive";
  const gold = game.slots.some((s: any) => s.tier === "shrimpillion");

  const shot: Shot =
    phase === "begin"
      ? { kind: "title" }
      : phase === "results"
        ? { kind: "results" }
        : phase === "prompt"
          ? { kind: "prompt", y }
          : sinking
            ? { kind: "sink", to: y, chip: landing!.chip, ms: landing!.ms, tier: landing!.tier }
            : { kind: "landed", y, miss: !!missed };
  const mascot: MascotSpot =
    phase === "begin" ? "title" : phase === "results" ? "results" : phase === "prompt" ? (previewing ? "card" : "dock") : sinking ? "chase" : last?.tier === "shrimpillion" ? "icon" : "perch";

  const world = (
    <>
      {phase === "prompt" && <PromptCard key={active.slot} slot={active} total={total} y={y} />}
      {ghosts.map((g) =>
        g.kind === "card" ? (
          <PromptCard key={g.key} slot={g.slot} total={total} y={g.y} gone />
        ) : (
          <Landed key={g.key} slot={g.slot} quip={g.quip} y={g.y} gone />
        ),
      )}
      {sinking && landing && (
        <>
          {TIERS.map(([t, pts]) => {
            const at = depthPx(landing.fromScore + pts);
            return (
              <div key={t} className="ds-tierline" data-y={at} style={{ top: at, ...tierColor(t) }}>
                <span className="tag">
                  <TierIcon tier={t} />
                  {TIER_LABELS[t]!.toUpperCase()} · {pts}
                </span>
              </div>
            );
          })}
          <div className="ds-chip" style={{ ...tierColor(landing.tier), transform: `translate3d(-50%, ${landing.chip}px, 0)` }}>
            <span className={`ds-chip-in${landing.tier === "shrimpillion" ? " gold" : ""}`}>
              “{landing.answer.toUpperCase()}”
              <Trail />
            </span>
          </div>
        </>
      )}
      {phase === "landed" && !sinking && last && <Landed key={last.slot} slot={last} quip={quip} y={y} />}
    </>
  );

  const title = (
    <>
      <Wordmark />
      <div className="tagline">{pack.tagline}</div>
      <div className="subline">{total} prompts · 25 seconds each · rarer answers sink deeper</div>
    </>
  );

  return (
    <Ocean
      view={view}
      shot={shot}
      depth={view === "dive" ? shownDepth : 0}
      reveal={sinking}
      world={world}
      title={title}
      mascot={mascot}
      gold={gold}
      shake={!!missed}
    >
      <Hud
        depth={shownDepth}
        score={shownScore}
        slam={phase === "landed" && !sinking && landing?.slot === last?.slot}
        done={closed.length}
        total={total}
        finished={game.status === "finished"}
      />

      {phase === "begin" && (
        <div className="ds-begin">
          <div className="ds-begin-inner">
            <button className="btn-begin" disabled={busy} onClick={next} autoFocus>
              ▼ BEGIN DESCENT ▼
            </button>
            <div className="ds-begin-foot">
              <span>{pack.title.toUpperCase()} · {total} PROMPTS</span>
              <nav>
                <Link className="btn-box" to="/">← PACKS</Link>
              </nav>
            </div>
          </div>
        </div>
      )}

      {phase === "prompt" && (
        <ActivePrompt
          key={active.slot}
          slot={active}
          busy={busy}
          onGuess={(t) => guess(t, active.slot)}
          onPass={() => pass(active.slot)}
          onExpired={reload}
          onPreview={setPreviewing}
        />
      )}

      {phase === "landed" && !sinking && last && (
        <div className="ds-next-wrap">
          {game.status === "finished" ? (
            <button
              className="ds-next-btn"
              onClick={() => {
                sfx.surface();
                setSurfaced(true);
              }}
              autoFocus
            >
              SURFACE ▲
            </button>
          ) : (
            <button className="ds-next-btn" disabled={busy} onClick={next} autoFocus>
              DESCEND ▼
            </button>
          )}
        </div>
      )}

      {phase === "results" && <Results game={game} />}
      {phase !== "results" && <MuteButton />}

      {error && <p className="ds-error" role="alert">{error}</p>}
    </Ocean>
  );
}

function MuteButton() {
  const [muted, setState] = useState(isMuted);
  return (
    <button
      className="ds-mute"
      aria-label={muted ? "turn sound on" : "turn sound off"}
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted);
        setState(!muted);
      }}
    >
      <svg viewBox="0 0 20 16" shapeRendering="crispEdges" fill="currentColor" aria-hidden>
        <path d="M2 6h3l4-4v12l-4-4H2z" />
        {muted ? <path d="M12 5h2v2h2V5h2v2h-2v2h2v2h-2V9h-2v2h-2V9h2V7h-2z" /> : <><rect x="11" y="6" width="2" height="4" /><rect x="15" y="3" width="2" height="10" /></>}
      </svg>
    </button>
  );
}

function Hud(props: { depth: number; score: number; slam: boolean; done: number; total: number; finished: boolean }) {
  const { done, total, finished } = props;
  return (
    <div className="ds-hud">
      <div className="ds-pod">
        <div className="label">DEPTH</div>
        <div className="num">{metres(props.depth)}</div>
      </div>
      <div className="ds-hud-mid">
        <div className="ds-dots">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < done ? "done" : i === done && !finished ? "cur" : ""} />
          ))}
        </div>
        <div className="ds-count">{finished ? "DIVE COMPLETE" : `PROMPT ${Math.min(done + 1, total)} OF ${total}`}</div>
      </div>
      <div className="ds-pod right">
        <div className="label">SCORE</div>
        <div className={`num${props.slam ? " slam" : ""}`}>{props.score}</div>
      </div>
    </div>
  );
}

/** The prompt card. It hangs in the water at its depth, so it travels with the camera. */
function PromptCard({ slot, total, y, gone = false }: { slot: any; total: number; y: number; gone?: boolean }) {
  // A card that arrives during the preview pops in after the camera starts moving,
  // and fades a second after its clock runs out.
  const [late] = useState(() => Date.now() < Date.parse(slot.timerStartsAt));
  const [fadeIn] = useState(() => Date.parse(slot.timerEndsAt) + 1000 - Date.now());
  const style: CSSProperties = { top: y };
  if (!gone) style.animationDelay = `${late ? 0.45 : 0}s, ${fadeIn}ms`;
  return (
    <div className={`ds-card${gone ? " gone" : " live"}`} style={style}>
      <div className="rnd">PROMPT {slot.slot} OF {total}</div>
      <div className="prompt">{slot.prompt.text}</div>
      <div className="hint"><b>▼</b> rarer answers sink deeper <b>▼</b></div>
    </div>
  );
}

function ActivePrompt(props: {
  slot: any;
  busy: boolean;
  onGuess: (text: string) => Promise<any>;
  onPass: () => void;
  onExpired: () => void;
  onPreview: (previewing: boolean) => void;
}) {
  const { slot, busy } = props;
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "reject"; text: string; n: number } | { kind: "correction"; from: string; to: string } | null>(null);
  const now = useNow(200);
  const input = useRef<HTMLInputElement>(null);

  const startsAt = Date.parse(slot.timerStartsAt);
  const endsAt = Date.parse(slot.timerEndsAt);
  const inPreview = now < startsAt;
  const left = endsAt - now;
  const over = left <= 0;
  const remaining = Math.max(0, Math.ceil(left / 1000));
  const duration = endsAt - startsAt;
  const urgent = !inPreview && remaining <= 5;
  // Three ticks over the last fifth of the clock.
  const elapsed = (now - startsAt) / duration;
  const tick = !inPreview && elapsed > 0.8 && elapsed < 1 ? Math.ceil((1 - elapsed) * 15) : 0;
  useEffect(() => {
    if (tick) sfx.tick();
  }, [tick]);

  const onPreview = props.onPreview;
  // The mascot heads for the dock a moment before the clock starts.
  const nearlyLive = now >= startsAt - 800;
  useEffect(() => onPreview(!nearlyLive), [nearlyLive, onPreview]);

  // When the timer runs out, ask the server again once its grace period has passed.
  const onExpired = props.onExpired;
  useEffect(() => {
    const t = setTimeout(onExpired, Math.max(0, endsAt - Date.now()) + 2200);
    return () => clearTimeout(t);
  }, [endsAt, onExpired]);

  // preventScroll: focusing the dock must never scroll the stage.
  useEffect(() => {
    if (!inPreview && !over && !busy) input.current?.focus({ preventScroll: true });
  }, [inPreview, over, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || over || inPreview) return;
    sfx.submit();
    const r = await props.onGuess(t);
    if (r?.result === "reject") sfx.reject();
    if (r?.result === "reject") setFeedback((f) => ({ kind: "reject", text: t, n: (f?.kind === "reject" ? f.n : 0) + 1 }));
    else if (r?.result === "correction") {
      setFeedback({ kind: "correction", from: t, to: r.correction });
      setText(r.correction);
    }
  }

  return (
    <>
      {inPreview && (
        <div className="ds-pill" aria-live="polite">
          descending · the clock starts in <b>{Math.ceil((startsAt - now) / 1000)}</b>
        </div>
      )}
      {over && <div className="ds-pill">time's up · reeling in…</div>}
      {urgent && !over && <div className="ds-edge" aria-hidden />}

      <div className="ds-feedback" role="status" aria-live="polite">
        {feedback?.kind === "reject" && !over && (
          <div key={feedback.n} className="ds-reject">
            “{feedback.text}”: no bites. try again
            <Bubbles />
          </div>
        )}
        {feedback?.kind === "correction" && text === feedback.to && !over && (
          <div className="ds-correction">
            <div className="ds-correction-panel">
              <span className="change">
                <span>“{feedback.from}”</span>
                <span className="arrow"> → </span>
                <b>“{feedback.to}”</b>
              </span>
              <small>submit again to confirm · or edit</small>
            </div>
          </div>
        )}
      </div>

      <form className={`ds-dock${!inPreview && !over ? " up" : ""}${urgent ? " hot" : ""}`} onSubmit={submit}>
        <div key={feedback?.kind === "reject" ? feedback.n : 0} className={`ds-dock-inner${feedback?.kind === "reject" ? " jolt" : ""}`}>
          <div className="ds-sonar" aria-label={`${remaining} seconds left`}>
            <div className="ds-sonar-scope"><div className="ds-sweep" /></div>
            <div className="ds-time">{inPreview ? Math.round(duration / 1000) : remaining}</div>
          </div>
          <div className="ds-input-col">
            <input
              ref={input}
              className="ds-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={inPreview || over}
              placeholder="type one answer…"
              aria-label="Your answer"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              maxLength={256}
            />
            <div className="ds-fuse"><i style={{ transform: `scaleX(${inPreview ? 1 : Math.max(0, left / duration)})` }} /></div>
          </div>
          <button type="submit" className="btn-pink ds-dive" disabled={!text.trim() || busy || inPreview || over}>
            DIVE
          </button>
          <button type="button" className="ds-pass" onClick={props.onPass} disabled={busy || inPreview || over}>
            PASS ▸
          </button>
        </div>
      </form>
    </>
  );
}

/** A little burst of bubbles for a guess that found nothing. */
function Bubbles() {
  const [seed] = useState(() => Array.from({ length: 9 }, () => [Math.random() * 160 - 80, 4 + Math.random() * 9, Math.random() * 0.4] as const));
  return (
    <span className="ds-bubbles" aria-hidden>
      {seed.map(([dx, size, delay], i) => (
        <i key={i} style={{ "--dx": `${dx}px`, width: size, height: size, left: dx / 3, animationDelay: `${delay}s` } as CSSProperties} />
      ))}
    </span>
  );
}

/** Bubbles streaming up behind a sinking answer. */
function Trail() {
  const [seed] = useState(() => Array.from({ length: 10 }, (_, i) => [Math.random() * 40 - 20, 3 + Math.random() * 6, i * 0.16] as const));
  return (
    <span className="ds-trail" aria-hidden>
      {seed.map(([dx, size, delay], i) => (
        <i key={i} style={{ left: dx, width: size, height: size, animationDelay: `${delay}s` }} />
      ))}
    </span>
  );
}

/** Where an answer came to rest (or didn't). Hangs in the water at its depth. */
function Landed({ slot, quip, y, gone = false }: { slot: any; quip: string | null; y: number; gone?: boolean }) {
  const answered = slot.status === "answered";
  const tier = answered ? slot.tier : "miss";
  return (
    <div className={`ds-landed${answered ? "" : " miss"}${gone ? " gone" : ""}`} style={{ top: y, ...tierColor(tier) }} role={gone ? undefined : "status"}>
      {/* On a one-in-a-shrimpillion the gold mascot itself perches here instead of an icon. */}
      {answered && <TierIcon tier={tier} className={`icon${tier === "shrimpillion" && !gone ? " perched" : ""}`} />}
      <div className="tname">{answered ? TIER_LABELS[slot.tier]!.toUpperCase() : "NOTHING LANDED"}</div>
      <div className="tans">{answered ? `“${slot.answer}”` : "—"}</div>
      <div className="tpts">
        <b>+{slot.score} PTS</b>
        {answered && <> · sink {metres(slot.score * 10)}</>}
      </div>
      <div className="tsub">{answered ? (quip ?? TIER_SUB[slot.tier]) : MISS_SUB[slot.status]}</div>
    </div>
  );
}

/* ── end of the dive ───────────────────────────────── */

function ScoreBlock({ game }: { game: any }) {
  return (
    <div className="big-score">
      <span className="n">{game.score}</span>
      <span className="of">/{game.maxScore}</span>
      <span className="m">-{metres(game.score * 10)}</span>
    </div>
  );
}

function DiveLog({ slots }: { slots: any[] }) {
  return (
    <section className="section">
      <div className="section-h">Dive log <small>deeper = rarer</small></div>
      <div className="divelog">
        {[0, 25, 50, 75, 100].map((v) => (
          <div key={v} className="grid" style={{ top: v * 2.4 }}>
            <span>{v === 0 ? "0m" : `-${v}`}</span>
          </div>
        ))}
        <div className="cols">
          {slots.map((s) => {
            const tier = s.status === "answered" ? s.tier : "miss";
            const y = Math.max(4, (s.score ?? 0) * 2.4);
            return (
              <div key={s.slot} className="col" style={tierColor(tier)}>
                {s.score > 0 && <div className="line" style={{ height: y, animationDelay: `${s.slot * 0.08}s` }} />}
                <TierIcon tier={s.status === "pending" || s.status === "active" ? null : tier} style={{ top: y }} />
                <div className="x">{s.slot}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const BANDS: [number, number, string, string][] = [
  [0, 150, "plankton", "Plankton. Still in sight of the boat."],
  [151, 250, "schooler", "Schooler. Comfortably mid-water."],
  [251, 350, "rare", "Rare. Properly dark down here."],
  [351, 449, "deepcut", "Deep cut. The anglerfish know your name."],
  [450, Infinity, "shrimpillion", "One in a shrimpillion. Trench royalty."],
];

function Bearing({ score }: { score: number }) {
  return (
    <section className="section">
      <div className="section-h">The bearing</div>
      <div className="bearing">
        {BANDS.map(([lo, hi, tier, text]) => (
          <div key={tier} className={score >= lo && score <= hi ? "on" : ""}>
            <TierIcon tier={tier} />
            <span className="r" style={{ color: `var(--tier-${tier})` }}>{hi === Infinity ? `${lo}+` : `${lo}–${hi}`}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Catch({ slots, hiddenNote }: { slots: any[]; hiddenNote?: string }) {
  return (
    <section className="section">
      <div className="section-h">The catch {hiddenNote && <small>{hiddenNote}</small>}</div>
      <ul className="catch">
        {slots.map((s) => {
          const answered = s.status === "answered";
          const tier = answered ? s.tier : "miss";
          return (
            <li key={s.slot}>
              <span className="no">{s.slot}</span>
              <TierIcon tier={s.status === "pending" ? null : tier} />
              <div className="txt">
                <div className={`q${s.prompt ? "" : " hidden"}`}>{s.prompt ? s.prompt.text : "▒▒▒▒ hidden ▒▒▒▒"}</div>
                <div className="a">
                  {answered ? (s.answer ?? <span className="hidden">▒▒▒▒▒▒</span>) : s.status === "pending" ? <span className="hidden">not reached</span> : "—"}
                </div>
              </div>
              <span className="pts" style={{ color: `var(--tier-${tier})` }}>{s.score}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RankLine({ roundId }: { roundId: string }) {
  const board = useApi(`/api/rounds/${roundId}/leaderboard`);
  const you = board.data?.you;
  return (
    <Link className="rankline" to={`/r/${roundId}`}>
      {you ? `#${you.rank} of ${board.data.total} divers on these prompts ›` : "Leaderboard ›"}
    </Link>
  );
}

function ResultsFrame({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <>
      <div className="ds-dim" />
      <div className="results">
        <div className="results-inner">
          <div className="results-head">
            <Link to="/" aria-label="Shrimpillion home"><Wordmark small /></Link>
            <span className="eyebrow">{eyebrow}</span>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

function Results({ game }: { game: any }) {
  const pack = packForRound(game.round);
  const navigate = useNavigate();
  const url = fullUrl(`/g/${game.id}`);
  const [copied, setCopied] = useState<"link" | "result" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emoji = game.slots.map((s: any) => TIER_EMOJI[s.status === "answered" ? s.tier : "miss"]).join("");
  const text = `Shrimpillion · ${pack.title} 🦐\n${game.score}\n\n${emoji}\nDive the same prompts: ${url}`;

  async function copy(what: "link" | "result", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Couldn't copy. Select the link above instead.");
    }
  }
  // The system share sheet on phones and tablets; on desktop (where it's often missing or silent), copy the link.
  async function share() {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: "Shrimpillion", text: `I scored ${game.score} on Shrimpillion. Dive the same prompts:`, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return;
      }
    }
    await copy("link", url);
  }
  async function again() {
    setBusy(true);
    try {
      navigate(`/g/${await newDive(pack.round)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ResultsFrame eyebrow={`${pack.title} · dive complete`}>
      <ScoreBlock game={game} />
      <ScoreCurve roundId={game.roundId} score={game.score} />
      <RankLine roundId={game.roundId} />
      <section className="share-box">
        <div className="share-title">Challenge a friend</div>
        <p className="share-how">
          Send this link. Whoever opens it dives <b>the exact same {game.slots.length} prompts</b>, then you can compare scores.
        </p>
        <div className="share-link">
          <a href={url}>{url.replace(/^https?:\/\//, "")}</a>
          <button className="btn-box" onClick={() => copy("link", url)}>{copied === "link" ? "COPIED ✓" : "COPY LINK"}</button>
        </div>
        <div className="share-row">
          <button className="btn-pink" onClick={share}>{copied === "link" ? "LINK COPIED ✓" : "SHARE LINK"}</button>
          <button className="btn-quiet" onClick={() => copy("result", text)}>{copied === "result" ? "COPIED ✓" : "COPY RESULT"}</button>
        </div>
      </section>
      <button className="btn-begin dive-again" onClick={again} disabled={busy}>{busy ? "DESCENDING…" : "▼ NEW DIVE ▼"}</button>
      {error && <p className="error">{error}</p>}
      <DiveLog slots={game.slots} />
      <Bearing score={game.score} />
      <Catch slots={game.slots} />
      <div className="foot-links">
        <div className="row">
          <Link className="btn-quiet" to={`/r/${game.roundId}`}>LEADERBOARD</Link>
          <Link className="btn-quiet" to="/">← PACKS</Link>
        </div>
      </div>
    </ResultsFrame>
  );
}

/** Someone else's result link. It doubles as the challenge: dive the same prompts from here. */
function OtherGame({ game }: { game: any }) {
  const navigate = useNavigate();
  const round = useApi(`/api/rounds/${game.roundId}`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const yours = round.data?.round.yourGame;

  async function play() {
    setBusy(true);
    try {
      navigate(`/g/${await startGame(game.roundId)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Ocean view="results" shot={{ kind: "results" }} depth={0} mascot="results">
      <ResultsFrame eyebrow={`${game.player.displayName}'s dive`}>
        <ScoreBlock game={game} />
        {game.status !== "finished" && <p className="note" style={{ textAlign: "left" }}>still diving…</p>}
        <DiveLog slots={game.slots} />
        <div className="section">
          {round.data &&
            (yours ? (
              <Link className="btn-begin" to={`/g/${yours.id}`}>
                {yours.status === "finished" ? `YOUR RESULT: ${yours.score} →` : "▼ CONTINUE YOUR DIVE ▼"}
              </Link>
            ) : (
              <>
                <button className="btn-begin" onClick={play} disabled={busy}>▼ DIVE THE SAME PROMPTS ▼</button>
                <p className="note" style={{ marginTop: 18 }}>Their prompts and answers stay hidden until you finish.</p>
              </>
            ))}
          {error && <p className="error">{error}</p>}
        </div>
        <Catch slots={game.slots} hiddenNote={game.answersVisible ? undefined : "hidden until you finish"} />
        <div className="foot-links">
          <div className="row">
            <Link className="btn-quiet" to={`/r/${game.roundId}`}>LEADERBOARD</Link>
            <Link className="btn-quiet" to="/">← PACKS</Link>
          </div>
        </div>
      </ResultsFrame>
    </Ocean>
  );
}

function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Ease a number toward its target, for the depth and score counters. */
function useTween(target: number, ms: number, ease: (k: number) => number = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  const easeRef = useRef(ease);
  easeRef.current = ease;
  useEffect(() => {
    const from = current.current;
    if (from === target || ms <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      current.current = Math.round(from + (target - from) * easeRef.current(k));
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
