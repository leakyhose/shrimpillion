import { useId } from "react";
import { useApi } from "./api.ts";

type Distribution = { total: number; binSize: number; maxScore: number; counts: number[] };

const W = 320, BASE = 78, PEAK = 18, MAX = 700, STEP = 5;
const x = (score: number) => (score / MAX) * W;

// Until there are plenty of dives, the curve leans on a typical spread (most dives land
// around 210, with a long tail toward 700), worth this many dives.
const PRIOR_WEIGHT = 30;
const PRIOR_SHAPE = 6, PRIOR_SCALE = 42; // gamma: mode 210, mean 252

const gamma = (s: number) => (s <= 0 ? 0 : s ** (PRIOR_SHAPE - 1) * Math.exp(-s / PRIOR_SCALE));

/** Smoothing per real dive, in points: Silverman's rule, never so narrow the curve turns lumpy. */
function bandwidth(dist: Distribution) {
  const mid = (bin: number) => (bin + 0.5) * dist.binSize;
  const mean = dist.counts.reduce((a, n, bin) => a + n * mid(bin), 0) / dist.total;
  const sd = Math.sqrt(dist.counts.reduce((a, n, bin) => a + n * (mid(bin) - mean) ** 2, 0) / dist.total);
  return Math.max(45, 1.06 * sd * dist.total ** -0.2);
}

/** Density sampled every STEP points from 0 to 700, each part normalised before blending. */
function density(dist: Distribution) {
  const xs = Array.from({ length: MAX / STEP + 1 }, (_, i) => i * STEP);
  const norm = (ys: number[]) => {
    const sum = ys.reduce((a, b) => a + b, 0);
    return sum ? ys.map((y) => y / sum) : ys;
  };
  const prior = norm(xs.map(gamma));
  const h = dist.total ? bandwidth(dist) : 1;
  const gauss = (d: number) => Math.exp(-0.5 * (d / h) ** 2);
  const real = norm(xs.map((s) => dist.counts.reduce((acc, n, bin) => acc + (n ? n * gauss(s - (bin + 0.5) * dist.binSize) : 0), 0)));
  return xs.map((s, i) => ({ s, y: (PRIOR_WEIGHT * prior[i]! + dist.total * real[i]!) / (PRIOR_WEIGHT + dist.total) }));
}

/** The bell curve of every dive anyone has finished, with you marked on it. */
export function ScoreCurve({ score, maxScore }: { score: number; maxScore: number }) {
  const id = useId();
  const { data } = useApi<Distribution>("/api/stats/scores");
  if (!data) return <div className="curve" style={{ height: 120 }} />;

  const pts = density(data);
  const top = Math.max(...pts.map((p) => p.y));
  const y = (d: number) => BASE - (d / top) * (BASE - PEAK);
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(p.s).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${BASE} L 0 ${BASE} Z`;

  const you = Math.min(MAX, (score / maxScore) * MAX);
  const below = pts.reduce((acc, p) => acc + (p.s < you ? p.y : p.s === you ? p.y / 2 : 0), 0);
  const total = pts.reduce((acc, p) => acc + p.y, 0);
  const beats = Math.round((below / total) * 100);
  const youY = y(pts[Math.round(you / STEP)]!.y);

  return (
    <div className="curve">
      <svg viewBox={`0 0 ${W} 96`} role="img" aria-label={`Score distribution of every dive; your score beats ${beats}% of them`}>
        <defs>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="c-stop-top" />
            <stop offset="100%" className="c-stop-bottom" />
          </linearGradient>
          <clipPath id={`${id}c`}>
            <rect x="0" y="0" width={x(you)} height="96" />
          </clipPath>
        </defs>
        <path d={area} fill={`url(#${id}f)`} opacity="0.28" />
        <path d={area} fill={`url(#${id}f)`} clipPath={`url(#${id}c)`} />
        <path d={line} className="c-line" />
        <line x1="0" y1={BASE} x2={W} y2={BASE} className="c-axis" />
        {[100, 200, 300, 400, 500, 600].map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={BASE} x2={x(t)} y2={BASE + 3.5} className="c-tick" />
            {Math.abs(t - you) > 45 && <text x={x(t)} y="90" textAnchor="middle" className="c-label">{t}</text>}
          </g>
        ))}
        <text x="0" y="90" className="c-label">0</text>
        <text x={W} y="90" textAnchor="end" className="c-label">{MAX}</text>
        <line x1={x(you)} y1={youY - 3} x2={x(you)} y2={BASE} className="c-you" />
        <circle cx={x(you)} cy={youY} r="2.6" className="c-dot" />
        <text x={x(you)} y="90" textAnchor="middle" className="c-you-label">YOU</text>
      </svg>
      <p className="curve-caption">better than {beats}% of all dives</p>
    </div>
  );
}
