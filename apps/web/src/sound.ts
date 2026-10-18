// Sound effects, synthesised with Web Audio so there are no audio files to ship.

const MUTE_KEY = "shrimpillion-muted";

type Out = { a: AudioContext; out: GainNode };

let out: Out | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

function audio(): Out | null {
  if (muted || typeof AudioContext === "undefined") return null;
  if (!out) {
    const a = new AudioContext();
    const gain = a.createGain();
    gain.gain.value = 0.75;
    gain.connect(a.destination);
    out = { a, out: gain };
  }
  if (out.a.state === "suspended") void out.a.resume();
  return out;
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

/** Quick linear attack, then an exponential tail. */
function envelope(g: GainNode, t: number, attack: number, peak: number, dur: number) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(1e-4, t + attack + dur);
}

function filter(a: AudioContext, type: BiquadFilterType, hz: number, t: number) {
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(hz, t);
  return f;
}

/** One oscillator note, optionally gliding from f0 to f1. */
function tone(
  { a, out }: Out,
  o: { f0: number; f1?: number; dur?: number; type?: OscillatorType; attack?: number; peak?: number; lp?: number; delay?: number },
) {
  const { f0, f1, dur = 0.2, type = "sine", attack = 0.005, peak = 0.3, lp, delay = 0 } = o;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = a.createGain();
  envelope(g, t, attack, peak, dur);
  (lp ? osc.connect(filter(a, "lowpass", lp, t)) : osc).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + attack + 0.05);
}

/** Filtered white noise: water, splashes, whooshes. */
function noise(
  { a, out }: Out,
  o: { dur?: number; lp?: number; hp?: number; sweepTo?: number; peak?: number; attack?: number; delay?: number },
) {
  const { dur = 0.3, lp = 1200, hp, sweepTo, peak = 0.25, attack = 0.003, delay = 0 } = o;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * (dur + 0.1)), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const low = filter(a, "lowpass", lp, t);
  if (sweepTo) low.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = a.createGain();
  envelope(g, t, attack, peak, dur);
  src.connect(low);
  (hp ? low.connect(filter(a, "highpass", hp, t)) : low).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.1);
}

const play = (fn: (o: Out) => void) => () => {
  const o = audio();
  if (o) fn(o);
};

export const sfx = {
  /** Submitting a guess. */
  submit: play((o) => tone(o, { f0: 1150, dur: 0.16, attack: 0.003, peak: 0.16 })),
  /** A guess that didn't match anything. */
  reject: play((o) => {
    noise(o, { dur: 0.22, lp: 420, peak: 0.2 });
    tone(o, { f0: 150, f1: 62, dur: 0.36, peak: 0.22, lp: 700 });
  }),
  /** BEGIN DESCENT / DESCEND: water rushing past, a deep drop and a two-note bell. */
  descend: play((o) => {
    noise(o, { dur: 1.1, lp: 2000, sweepTo: 240, peak: 0.15 });
    tone(o, { f0: 110, f1: 48, dur: 1.2, peak: 0.32 });
    tone(o, { type: "triangle", f0: 784, dur: 0.5, peak: 0.12, lp: 3000 });
    tone(o, { type: "triangle", f0: 523, dur: 0.75, peak: 0.12, lp: 3000, delay: 0.22 });
  }),
  /** An accepted answer starts to sink. */
  sink: play((o) => {
    tone(o, { f0: 1150, dur: 0.7, attack: 0.01, peak: 0.1 });
    noise(o, { dur: 1.3, lp: 1400, sweepTo: 180, peak: 0.16 });
    tone(o, { f0: 300, f1: 60, dur: 1.3, peak: 0.1 });
  }),
  /** The sinking answer passes a tier line. */
  tierLine: play((o) => tone(o, { type: "triangle", f0: 780, f1: 1560, dur: 0.07, peak: 0.13, lp: 2500 })),
  /** The answer lands: a soft bump for common tiers, a boom for rare ones, a fanfare for the top tier. */
  land(tier: string) {
    const o = audio();
    if (!o) return;
    if (tier === "shrimpillion") {
      tone(o, { f0: 60, f1: 40, dur: 1.2, peak: 0.34 });
      [784, 988, 1175, 1568].forEach((f, i) => tone(o, { type: "triangle", f0: f, dur: 0.7, peak: 0.15, lp: 3000, delay: i * 0.13 }));
      noise(o, { dur: 1.4, lp: 2500, hp: 1200, peak: 0.05, delay: 0.3 });
    } else if (tier === "plankton" || tier === "tooclever") {
      tone(o, { f0: 140, f1: 70, dur: 0.25, peak: 0.28, lp: 600 });
      noise(o, { dur: 0.14, lp: 500, peak: 0.1 });
    } else {
      tone(o, { f0: 80, f1: 45, dur: 0.6, peak: 0.38 });
      noise(o, { dur: 0.7, lp: 900, sweepTo: 200, peak: 0.18, delay: 0.02 });
      tone(o, { type: "triangle", f0: 523, dur: 0.4, peak: 0.09, delay: 0.15 });
    }
  },
  /** Timed out: nothing landed. */
  miss: play((o) => {
    tone(o, { f0: 220, f1: 52, dur: 0.7, peak: 0.24 });
    noise(o, { dur: 0.5, lp: 400, peak: 0.14, delay: 0.05 });
  }),
  /** Tapping the shrimp: a bubble at a slightly different pitch each time. */
  blub: play((o) => {
    const k = 0.85 + 0.45 * Math.random();
    tone(o, { f0: 260 * k, f1: 720 * k, dur: 0.13, peak: 0.22, lp: 2200 });
    noise(o, { dur: 0.05, lp: 1800, hp: 700, peak: 0.05 });
  }),
  /** The clock is running out. */
  tick: play((o) => {
    tone(o, { f0: 880, dur: 0.07, peak: 0.16 });
    tone(o, { f0: 880, dur: 0.05, peak: 0.06, delay: 0.12 });
  }),
  /** SURFACE: rising back up through the water. */
  surface: play((o) => {
    noise(o, { dur: 1.6, lp: 300, sweepTo: 3000, peak: 0.16 });
    tone(o, { f0: 80, f1: 600, dur: 1.5, peak: 0.08 });
  }),
};
