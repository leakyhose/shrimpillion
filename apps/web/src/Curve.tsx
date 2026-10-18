import { useId } from "react";

const W = 320, BASE = 78, HEIGHT = 68; // the tallest point sits at y = 10

// A typical spread of dive scores, out of 700: most land around 240, with a long tail toward the deep end.
// It's a fixed shape rather than live data, so the curve always reads like a real crowd.
const BINS = 20;
const SHAPE = 7, SCALE = 40; // gamma distribution: mode 240, mean 280
const density = (s: number) => (s <= 0 ? 0 : s ** (SHAPE - 1) * Math.exp(-s / SCALE));
const TYPICAL = Array.from({ length: BINS }, (_, i) => density(((i + 0.5) / BINS) * 700));

/** Share of that spread scoring below `score` (out of 700), in whole percent. */
function betterThan(score: number) {
  let below = 0, total = 0;
  for (let s = 0.5; s < 700; s++) {
    total += density(s);
    if (s < score) below += density(s);
  }
  return Math.round((100 * below) / total);
}

// Each bin is averaged with two neighbours either side, re-weighted where the edge cuts the window off.
const KERNEL = [0.06, 0.24, 0.4, 0.24, 0.06];

function smooth(dist: number[]) {
  return dist.map((_, i) => {
    let sum = 0, weight = 0;
    KERNEL.forEach((k, j) => {
      const n = dist[i + j - 2];
      if (n === undefined) return;
      sum += n * k;
      weight += k;
    });
    return weight ? sum / weight : 0;
  });
}

type Pt = [number, number];

/** A Catmull-Rom spline through the points as cubic Béziers, with end points repeated as their own neighbours. */
function spline(pts: Pt[]) {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b, c, e] = [pts[Math.max(0, i - 1)]!, pts[i]!, pts[i + 1]!, pts[Math.min(pts.length - 1, i + 2)]!];
    d += ` C ${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6}, ${c[0] - (e[0] - b[0]) / 6} ${c[1] - (e[1] - b[1]) / 6}, ${c[0]} ${c[1]}`;
  }
  return d;
}

/** Height of the straight line between the points either side of x. */
function heightAt(pts: Pt[], x: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [[x0, y0], [x1, y1]] = [pts[i]!, pts[i + 1]!];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x1 === x0 ? 0 : (x - x0) / (x1 - x0));
  }
  return BASE;
}

/** Where your score sits on a typical spread of dives. */
export function ScoreCurve({ score, maxScore }: { score: number; maxScore: number }) {
  const id = useId();
  const bins = smooth(TYPICAL);
  const top = Math.max(...bins);

  const max = maxScore;
  const x = (s: number) => (s / max) * W;
  const pts: Pt[] = [[0, BASE], ...bins.map((n, i): Pt => [((i + 0.5) / bins.length) * W, BASE - (n / top) * HEIGHT]), [W, BASE]];
  const line = spline(pts);
  const area = `${line} L ${W} ${BASE} L 0 ${BASE} Z`;

  const you = x(Math.min(score, max));
  const youY = heightAt(pts, you);
  const step = 100 * Math.ceil(max / 700); // 100s on a 7-prompt round, never more than six ticks
  const ticks = Array.from({ length: Math.ceil(max / step) - 1 }, (_, i) => (i + 1) * step);
  const beats = betterThan((Math.min(score, max) / max) * 700);

  return (
    <div className="curve">
      <svg
        viewBox={`0 0 ${W} 96`}
        role="img"
        aria-label={`Score distribution of divers; your score beats ${beats}% of them`}
      >
        <defs>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="c-stop-top" />
            <stop offset="100%" className="c-stop-bottom" />
          </linearGradient>
          <clipPath id={`${id}c`}>
            <rect x="0" y="0" width={you} height="96" />
          </clipPath>
        </defs>
        <path d={area} fill={`url(#${id}f)`} opacity="0.28" />
        <path d={area} fill={`url(#${id}f)`} clipPath={`url(#${id}c)`} />
        <path d={line} className="c-line" />
        <line x1="0" y1={BASE} x2={W} y2={BASE} className="c-axis" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={BASE} x2={x(t)} y2={BASE + 3.5} className="c-tick" />
            {Math.abs(x(t) - you) >= 18 && <text x={x(t)} y="90" textAnchor="middle" className="c-label c-tick-label">{t}</text>}
          </g>
        ))}
        <line x1={you} y1={Math.min(youY, 74) - 3} x2={you} y2={BASE} className="c-you" />
        <circle cx={you} cy={youY} r="2.6" className="c-dot" />
        <text x={Math.min(Math.max(you, 14), W - 14)} y="90" textAnchor="middle" className="c-you-label">YOU</text>
        <text x="0" y="90" className="c-label">0</text>
        <text x={W} y="90" textAnchor="end" className="c-label">{max}</text>
      </svg>
      <p className="curve-caption">better than {beats}% of divers</p>
    </div>
  );
}
