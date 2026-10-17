/**
 * Pixel art drawn as SVG rects from character maps.
 * One character = one pixel; "." is transparent.
 */
import type { CSSProperties } from "react";

type Palette = Record<string, string>;

function Pixels({ map, palette, className, style }: { map: string[]; palette: Palette; className?: string; style?: CSSProperties }) {
  const w = Math.max(...map.map((r) => r.length));
  const rects: React.ReactNode[] = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === "." || c === " " || !palette[c]) {
        x++;
        continue;
      }
      let run = 1;
      while (row[x + run] === c) run++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={run} height={1.04} fill={palette[c]} />);
      x += run;
    }
  });
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${w} ${map.length}`}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {rects}
    </svg>
  );
}

/**
 * The mascot: a curled shrimp in a too-big snorkel mask. Facing left, tail tucked under.
 * a antenna · r rostrum · p body · l highlight · d segment/shadow · g legs · m mask · w glint · e eye · s snorkel · t tail fan
 */
const SHRIMP = [
  "a........ss.........",
  ".a.......s..........",
  "..a......s..........",
  "...a..llllllll......",
  "....mmmmpppdpplll...",
  "...mmwemmppdppppl...",
  ".rrmmeemmppdpppppl..",
  "aa.pmmmmp...ppppdpl.",
  "...a.g.g.g...pppdppl",
  "......g.g.g..dddddpl",
  ".............ppppppl",
  "............ppppppl.",
  "...tt.....ddddppl...",
  "..ttttpppppdppl.....",
  ".tttttpdppppl.......",
  "..ttt.ddddd.........",
  "...t................",
];

const SHRIMP_PINK: Palette = {
  a: "#ff9fb8", r: "#ff9fb8", p: "#ff5d8f", l: "#ffb0c6", d: "#c22f62", g: "#ff8fb0",
  m: "#4de3ff", w: "#e8f1ff", e: "#050a14", s: "#ffd166", t: "#ff86aa",
};
const SHRIMP_GOLD: Palette = {
  a: "#ffe7a3", r: "#ffe7a3", p: "#ffd166", l: "#fff1c4", d: "#b8862a", g: "#ffe08f",
  m: "#4de3ff", w: "#e8f1ff", e: "#050a14", s: "#ff5d8f", t: "#ffdf8a",
};

export function Shrimp({ gold = false, className, style }: { gold?: boolean; className?: string; style?: CSSProperties }) {
  return <Pixels map={SHRIMP} palette={gold ? SHRIMP_GOLD : SHRIMP_PINK} className={className} style={style} />;
}

/** One small creature per tier, used for the landed reveal, the dive log and the catch list. */
const TIER_ICONS: Record<string, { map: string[]; palette: Palette }> = {
  plankton: {
    map: [
      "............",
      "..o.....o...",
      ".oxo...oxo..",
      "..o..o..o...",
      ".....x......",
      "...o.....o..",
      "..oxo...oxo.",
      "...o..o..o..",
      "......x.....",
      "..o.........",
      ".oxo....o...",
      "..o.........",
    ],
    palette: { o: "#8fa3c4", x: "#e8f1ff" },
  },
  tooclever: {
    map: [
      "............",
      "...oooo.....",
      "..owoooo..o.",
      ".owoooeoo.oo",
      ".owwoooooooo",
      ".owoooooo.oo",
      "..owoooo..o.",
      "...oooo.....",
      "............",
    ],
    palette: { o: "#ff9f43", w: "#e8f1ff", e: "#050a14" },
  },
  schooler: {
    map: [
      "............",
      "....ccc.....",
      "..cccccc..c.",
      ".cceccccc.cc",
      "cccccccccccc",
      ".cclllllc.cc",
      "..cccccc..c.",
      "....ccc.....",
    ],
    palette: { c: "#4de3ff", l: "#b8f4ff", e: "#050a14" },
  },
  rare: {
    map: [
      "....rrrr....",
      "...rrrrrr...",
      "..rrrrrrrr..",
      "..rreerrer..",
      "..rrrrrrrr..",
      "...rrrrrr...",
      "..r.r..r.r..",
      ".r..r..r..r.",
      ".r.r....r.r.",
      "r..r....r..r",
      "...r....r...",
    ],
    palette: { r: "#ff5252", e: "#050a14" },
  },
  deepcut: {
    map: [
      "......yy....",
      ".....y......",
      "....v.......",
      "...vvvvvv...",
      "..vvvvvvvv.v",
      ".veevvvvvvvv",
      "vvvvvvvvvvvv",
      "wvwvwvvvvvvv",
      ".vvvvvvvv..v",
      "..vvvvvv....",
    ],
    palette: { v: "#9d7bff", y: "#ffd166", e: "#e8f1ff", w: "#e8f1ff" },
  },
  miss: {
    map: [
      "....oooo....",
      "..oo....oo..",
      ".o........o.",
      ".o........o.",
      "o..........o",
      "o..........o",
      ".o........o.",
      ".o........o.",
      "..oo....oo..",
      "....oooo....",
    ],
    palette: { o: "#3d4f6e" },
  },
};

export function TierIcon({ tier, className, style }: { tier: string | null; className?: string; style?: CSSProperties }) {
  if (tier === "shrimpillion") return <Shrimp gold className={className} style={style} />;
  const icon = TIER_ICONS[tier ?? "miss"] ?? TIER_ICONS.miss!;
  return <Pixels map={icon.map} palette={icon.palette} className={className} style={style} />;
}

const BOAT = [
  "..........m.........",
  "......fffff.........",
  "........fffm........",
  "..........m.........",
  "..........m.........",
  "........hhhhhh......",
  "........hwhwhh......",
  "........hhhhhh..hhh.",
  ".bbbbbbbbbbbbbbbbbbb",
  "..bbbbbbbbbbbbbbbbb.",
  "...bbbbbbbbbbbbbbb..",
];
export function Boat({ className }: { className?: string }) {
  return <Pixels map={BOAT} palette={{ m: "#12233a", f: "#ff5d8f", h: "#12233a", w: "#6f9cc4", b: "#12233a" }} className={className} />;
}

const CLOUD = [
  "..........wwww..............",
  "......wwwwwwwwww............",
  "....wwwwwwwwwwwwww..wwww....",
  "..wwwwwwwwwwwwwwwwwwwwwwww..",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwww",
  "sswwwwwwwwwwwwwwwwwwwwwwwwss",
  "..ssssssssssssssssssssssss..",
];
export function Cloud({ className, style }: { className?: string; style?: CSSProperties }) {
  return <Pixels map={CLOUD} palette={{ w: "#ffffff", s: "#cfe6f3" }} className={className} style={style} />;
}

const FISH = ["..fff....", ".ffffff.f", "f.fffffff", ".ffffff.f", "..fff...."];
export function Fish({ className, style }: { className?: string; style?: CSSProperties }) {
  return <Pixels map={FISH} palette={{ f: "currentColor" }} className={className} style={style} />;
}
