// Sound effects, synthesised with Web Audio so there are no audio files to ship.

const MUTE_KEY = "shrimpillion-muted";

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (muted || typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Browsers only start audio from a user gesture; warm it up on the first one.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => audio(), { once: true, capture: true });

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** One enveloped oscillator note, optionally gliding to another pitch. */
function tone(a: AudioContext, o: { at?: number; freq: number; to?: number; dur: number; type?: OscillatorType; gain?: number }) {
  const t = a.currentTime + (o.at ?? 0);
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

// A major pentatonic run, so pings and chimes always sound in tune with each other.
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];
const TIER_STEP: Record<string, number> = { plankton: 0, tooclever: 1, schooler: 2, rare: 3, deepcut: 4, shrimpillion: 5 };

export const sfx = {
  /** Submitting a guess: a bubble. */
  guess() {
    const a = audio();
    if (!a) return;
    tone(a, { freq: 260, to: 720, dur: 0.11, gain: 0.22 });
    tone(a, { at: 0.07, freq: 380, to: 900, dur: 0.08, gain: 0.12 });
  },
  /** A guess that didn't match anything. */
  reject() {
    const a = audio();
    if (!a) return;
    tone(a, { freq: 150, to: 90, dur: 0.16, type: "triangle", gain: 0.25 });
  },
  /** The sinking answer passes a tier line: a sonar ping, higher for each line. */
  tierLine(index: number) {
    const a = audio();
    if (!a) return;
    const f = NOTES[Math.min(index, NOTES.length - 1)]!;
    tone(a, { freq: f, dur: 0.35, gain: 0.13 });
    tone(a, { at: 0.12, freq: f, dur: 0.3, gain: 0.04 }); // echo
  },
  /** Points revealed: a chime that climbs further for rarer answers. */
  points(tier: string) {
    const a = audio();
    if (!a) return;
    const top = (TIER_STEP[tier] ?? 0) + 3;
    for (let i = 0; i <= top; i += tier === "shrimpillion" ? 1 : 2) {
      tone(a, { at: i * 0.055, freq: NOTES[Math.min(i, NOTES.length - 1)]!, dur: 0.4, type: "triangle", gain: 0.12 });
    }
    if (tier === "shrimpillion") tone(a, { at: 0.5, freq: NOTES[8]! * 2, dur: 0.8, gain: 0.06 });
  },
  /** Passed or timed out: nothing landed. */
  miss() {
    const a = audio();
    if (!a) return;
    tone(a, { freq: 330, to: 165, dur: 0.45, type: "triangle", gain: 0.18 });
  },
  /** DESCEND / BEGIN DESCENT: a soft downward whoosh. */
  descend() {
    const a = audio();
    if (!a) return;
    tone(a, { freq: 520, to: 140, dur: 0.6, gain: 0.08 });
  },
};
