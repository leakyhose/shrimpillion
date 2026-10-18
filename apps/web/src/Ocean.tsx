import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sfx } from "./sound.ts";
import { Boat, Cloud, Fish, Shrimp } from "./sprites.tsx";

/** 2 px of world per metre. */
export const PX_PER_M = 2;
const FLOOR_M = 7000;

export type View = "title" | "dive" | "results";

/**
 * What the camera frames. `y` values are world px below the surface.
 * - title: the surface, low on screen, under the wordmark.
 * - prompt: the prompt card's depth line near the top (the card hangs below it).
 * - sink: follow an answer chip falling from `chip` to `to` over `ms`.
 * - landed: the depth an answer landed on, a little above the middle.
 * - results: rise back to the surface.
 */
export type Shot =
  | { kind: "title" }
  | { kind: "prompt"; y: number }
  | { kind: "sink"; to: number; chip: number; ms: number; tier: string }
  | { kind: "landed"; y: number; miss?: boolean }
  | { kind: "results" };

/** Where a framed depth line sits on screen (px from the top), for a viewport of w × h. */
const titleLine = (h: number) => h / 2 + 90;
/**
 * Short screens (a phone on its side, or the on-screen keyboard up) pull the prompt card up under the HUD
 * and the landed banner down from it, sliding smoothly from the normal framing below about 560 px.
 */
const SHORT = 560;
const TINY = 315;
const promptLine = (w: number, h: number) => {
  // Tiny (a sideways phone with the keyboard up): the HUD steps aside and the prompt text goes right to the top.
  const underHud = (w < 700 ? 70 : 82) - Math.min(1, Math.max(0, (TINY + 30 - h) / 30)) * (w < 700 ? 100 : 112);
  return Math.min(w < 700 ? 177 : 210, h * 0.3, Math.max(underHud, underHud + (h - 380) * 0.55));
};
const landLine = (h: number) => h / 2 - 62 + Math.max(0, SHORT - h) * 0.2;
const missLine = (h: number) => h / 2 - 142 + Math.max(0, SHORT - h) * 0.45;

/** A CSS-style cubic-bezier easing, solved by bisection. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const EASE_IO = bezier(0.65, 0, 0.35, 1);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOutCubic = (t: number) => (t = clamp01(t)) < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;

/** Camera glide to the next prompt, starting the moment DESCEND is pressed. */
const DESCEND_MS = 2200;

/** How long an answer takes to sink, by tier: rarer answers fall further but not much longer. */
const SINK_MS: Record<string, number> = { plankton: 3400, tooclever: 3000, schooler: 3000, rare: 3400, deepcut: 4300, shrimpillion: 4600 };
export const sinkMs = (tier: string) => SINK_MS[tier] ?? 3400;
/** Plankton drifts down gently; everything else accelerates away and settles. */
export const sinkProgress = (t: number, ms: number, tier: string) => (tier === "plankton" ? easeInOutSine : easeInOutCubic)(t / ms);

/** Depth notes on the way down: alternate sides, majors are zone names. */
const AMBIENT: [number, "L" | "R", string, boolean?][] = [
  [55, "L", "the light starts to thin"],
  [195, "R", "most sunlight gives up here"],
  [330, "R", "scuba record, give or take: 332m"],
  [480, "L", "shrimp hide down here by day"],
  [700, "R", "elephant seals nap at this depth"],
  [1000, "L", "THE MIDNIGHT ZONE", true],
  [1250, "R", "anglerfish switch their lures on"],
  [1700, "L", "giant squid country"],
  [2300, "R", "2°C, pitch black, zero vibes"],
  [3000, "L", "a whale fall feeds a crowd here"],
  [3800, "R", "the Titanic rests at 3,800m"],
  [4000, "L", "THE ABYSSAL ZONE", true],
  [4800, "R", "the abyssal plain goes on and on"],
  [5500, "L", "most submarines tap out here"],
  [6000, "R", "THE HADAL ZONE", true],
  [6500, "L", "named for Hades. fair enough."],
  [7000, "R", "the trench floor. a perfect dive.", true],
];

const FISH: { top: number; dur: number; delay: number; size: number; rev?: boolean }[] = [
  { top: 150, dur: 38, delay: -4, size: 22 },
  { top: 162, dur: 38, delay: -7, size: 20 },
  { top: 176, dur: 38, delay: -9, size: 22 },
  { top: 158, dur: 38, delay: -12, size: 18 },
  { top: 180, dur: 38, delay: -14, size: 20 },
  { top: 170, dur: 38, delay: -18, size: 18 },
  { top: 230, dur: 46, delay: -20, size: 26, rev: true },
  { top: 410, dur: 52, delay: -8, size: 26 },
  { top: 960, dur: 60, delay: -30, size: 30, rev: true },
];

/** The depth gauge down the right edge, plus the YOU marker at the diver's depth. */
function Ruler({ you }: { you: number }) {
  const labels = [];
  for (let m = 100; m <= FLOOR_M; m += 100) {
    if (Math.abs(m * PX_PER_M - you) < 16) continue; // the YOU marker covers it
    labels.push(
      <span key={m} style={{ top: m * PX_PER_M }}>
        -{m.toLocaleString("en-US")}m
      </span>,
    );
  }
  return (
    <div className="ds-ruler" style={{ height: FLOOR_M * PX_PER_M }} aria-hidden>
      <span style={{ top: 0 }}>0m</span>
      {labels}
      <div className="ds-you" style={{ top: you }}>
        YOU <i />
      </div>
    </div>
  );
}

export type MascotSpot = "title" | "card" | "dock" | "chase" | "perch" | "icon" | "results";

export function Ocean(props: {
  view: View;
  shot: Shot;
  /** The diver's depth in metres (the YOU marker and how dark the water is). */
  depth: number;
  /** Show the depth notes (the camera is travelling). */
  reveal?: boolean;
  /** Things placed in world coordinates (px from the surface). */
  world?: ReactNode;
  /** The surface title block (title screen and results). */
  title?: ReactNode;
  mascot?: MascotSpot;
  gold?: boolean;
  shake?: boolean;
  children?: ReactNode;
}) {
  const { view, depth } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef({ W: Number.NaN, from: Number.NaN, t0: 0, shot: props.shot, h: Number.NaN, w: 0 });

  // A new shot starts a move from wherever the camera is now.
  const shotKey = JSON.stringify(props.shot);
  useLayoutEffect(() => {
    const c = cam.current;
    c.from = c.W;
    c.t0 = performance.now();
    c.shot = props.shot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotKey]);

  useEffect(() => {
    let raf = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (now: number) => {
      const root = rootRef.current;
      const world = worldRef.current;
      const c = cam.current;
      if (root && world) {
        const w = root.clientWidth;
        // When the screen height changes (keyboard up or down, rotation) the framing glides instead of jumping.
        const rawH = root.clientHeight;
        const h = (c.h = Number.isNaN(c.h) || still.matches || Math.abs(rawH - c.h) < 0.5 || w !== c.w ? rawH : c.h + (rawH - c.h) * 0.18);
        c.w = w;
        const short = h < SHORT;
        if (root.classList.contains("short") !== short) root.classList.toggle("short", short);
        if (root.classList.contains("tiny") !== h < TINY) root.classList.toggle("tiny", h < TINY);
        const anchor = `${Math.round(promptLine(w, h))}px`;
        if (root.style.getPropertyValue("--anchor") !== anchor) root.style.setProperty("--anchor", anchor);
        const land = `${Math.round(landLine(h))}px`;
        if (root.style.getPropertyValue("--land") !== land) root.style.setProperty("--land", land);
        const s = c.shot;
        const t = now - c.t0;
        let target: number;
        let k: number;
        let chipY: number | null = null;
        switch (s.kind) {
          case "title":
            target = titleLine(h);
            k = EASE_IO(t / 1200);
            break;
          case "results":
            target = titleLine(h);
            k = EASE_IO(t / 4500);
            break;
          case "prompt":
            target = promptLine(w, h) - s.y;
            k = easeInOutCubic(t / DESCEND_MS);
            break;
          case "landed":
            target = (s.miss ? missLine(h) : landLine(h)) - s.y;
            k = easeOut(t / 700);
            break;
          case "sink":
            // The chip falls through the world; the camera re-frames on it quickly, then rides along.
            chipY = s.chip + (s.to - s.chip) * sinkProgress(t, s.ms, s.tier);
            target = landLine(h) - chipY;
            k = easeOut(t / 700);
            break;
        }
        const W = Number.isNaN(c.from) || still.matches ? target : c.from + (target - c.from) * clamp01(k);
        c.W = W;
        const bob = still.matches ? 0 : 3 * Math.sin((now / 8000) * 2 * Math.PI);
        world.style.transform = `translate3d(0, ${(W + bob).toFixed(2)}px, 0)`;
        if (chipY !== null) {
          const chip = world.querySelector<HTMLElement>(".ds-chip");
          if (chip) chip.style.transform = `translate3d(-50%, ${chipY.toFixed(2)}px, 0)`;
          world.querySelectorAll<HTMLElement>(".ds-tierline").forEach((line) => {
            const passed = chipY! + 24 >= Number(line.dataset.y);
            if (passed && !line.classList.contains("passed")) sfx.tierLine();
            line.classList.toggle("passed", passed);
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const dark = Math.min(1, depth / 1500);
  return (
    <div ref={rootRef} className={`ds-root view-${view}`}>
      <div className={`ds-stage${props.shake ? " shake" : ""}`}>
        <div ref={worldRef} className={`ds-world${props.reveal ? " reveal" : ""}`}>
          <div className="ds-sky">
            <div className="ds-sun" />
            <Cloud className="ds-cloud c1" />
            <Cloud className="ds-cloud c2" />
            <Cloud className="ds-cloud c3" />
            <Cloud className="ds-cloud c4" />
            <Cloud className="ds-cloud c5" />
          </div>
          <div className="ds-title-block">{props.title}</div>
          <Boat className="ds-boat" />
          <svg className="ds-wave" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden>
            <path d="M0 6 Q 25 1 50 5 T 100 6 T 150 5 T 200 6 T 250 4 T 300 6 T 350 5 T 400 6 V 12 H 0 Z" />
          </svg>
          <div className="ds-water" style={{ height: (FLOOR_M + 400) * PX_PER_M }} />
          <div className="ds-rays" />
          <div className="ds-kelp L" />
          <div className="ds-kelp R" />
          <div className="ds-rocks L" />
          <div className="ds-rocks R" />
          {FISH.map((f, i) => (
            <div
              key={i}
              className={`ds-fish${f.rev ? " rev" : ""}`}
              style={{ top: f.top, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }}
            >
              <Fish style={{ width: f.size }} />
            </div>
          ))}
          {AMBIENT.map(([m, side, text, major]) => (
            <div key={m} className={`ds-amb ${side}${major ? " major" : ""}`} style={{ top: m * PX_PER_M }}>
              {side === "L" && <span className="dash">── </span>}
              {text}
              {side === "R" && <span className="dash"> ──</span>}
            </div>
          ))}
          <Ruler you={depth * PX_PER_M} />
          {props.world}
        </div>
        <div className="ds-snow" />
        <div className="ds-vignette" style={{ opacity: 0.25 + 0.5 * dark }} />
        <Mascot spot={props.mascot ?? "title"} gold={!!props.gold} />
        <div className="ds-crt" />
      </div>
      {props.children}
    </div>
  );
}

/** The glitchy wordmark. Letters bob one after another. */
/** The shrimp. Tap it and it blubs. */
function Mascot({ spot, gold }: { spot: MascotSpot; gold: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pokes, setPokes] = useState(0);
  // Hit-tested by position, so it still answers when the (transparent) results layer is on top of it.
  useEffect(() => {
    let reset = 0;
    const onDown = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      if ((e.target as Element).closest("button, a, input, textarea, select, label")) return;
      sfx.blub();
      setPokes((n) => n + 1);
      clearTimeout(reset);
      reset = window.setTimeout(() => setPokes(0), 950);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      clearTimeout(reset);
    };
  }, []);
  return (
    // preventDefault on mousedown: a poke mustn't take focus from the answer box (that would drop a phone's keyboard)
    <div ref={ref} className={`ds-mascot at-${spot}${gold ? " gold" : ""}${pokes ? " poked" : ""}`} aria-hidden onMouseDown={(e) => e.preventDefault()}>
      <div className="ds-mascot-swim">
        <Shrimp gold={gold} className="ds-mascot-sprite" />
      </div>
      <span key={pokes} className={`ds-blub${pokes ? " tapped" : ""}`}>blub!</span>
    </div>
  );
}

export function Wordmark({ small = false }: { small?: boolean }) {
  const name = "SHRIMPILLION";
  return (
    <div className={small ? "wordmark small" : "wordmark"} aria-label="Shrimpillion" role="img">
      {[...name].map((ch, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.18}s` }} aria-hidden>
          {ch}
        </span>
      ))}
    </div>
  );
}
