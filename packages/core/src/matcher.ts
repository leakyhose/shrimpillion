import { commonAliases, hasSpellingRule } from "./aliases.ts";
import { editDistance } from "./distance.ts";
import { FILLER_WORDS, normalize, singulars, stem, words } from "./normalize.ts";
import { pointsFor } from "./tiers.ts";
import type { Answer } from "./types.ts";

/**
 * How a key was derived from an answer. Lower rank wins ties.
 * - canonical: the answer's own name
 * - derived:   rule-made or curated spellings (filler word dropped, St/Saint, initials, aliases…)
 * - partial:   a word or sub-phrase of the name ("hopper" -> Jim Hopper)
 */
export type KeyKind = "canonical" | "derived" | "partial";
const KIND_RANK: Record<KeyKind, number> = { canonical: 0, derived: 1, partial: 2 };

export interface MatchOptions {
  /** Allowed edits per typed word = floor(len / typoDivisor)… */
  typoDivisor: number;
  /** …and 0 for typed words of this many characters or fewer. */
  shortWordMax: number;
  /** Total edits allowed across the whole guess. */
  editCap: number;
  /** Edits allowed when word counts differ and the guess is compared without spaces. */
  joinedEdits: number;
  /** Count an adjacent letter swap as 1 edit instead of 2. */
  swapsAsOne: boolean;
  /** Match rule-derived spellings and curated aliases. */
  derived: boolean;
  /** Match unique words / sub-phrases of an answer. */
  partial: boolean;
}

export type MatchPreset = "faithful" | "forgiving" | "strict";

export const PRESETS: Record<MatchPreset, MatchOptions> = {
  faithful: {
    typoDivisor: 4, shortWordMax: 4, editCap: 3, joinedEdits: 1,
    swapsAsOne: false, derived: true, partial: true,
  },
  forgiving: {
    typoDivisor: 3, shortWordMax: 3, editCap: 4, joinedEdits: 2,
    swapsAsOne: true, derived: true, partial: true,
  },
  /** No typo tolerance and no partial names; exact names and derived spellings only. */
  strict: {
    typoDivisor: Infinity, shortWordMax: Infinity, editCap: 0, joinedEdits: 0,
    swapsAsOne: false, derived: true, partial: false,
  },
};

export type MatchResult =
  | { status: "accept"; answerIndex: number; answer: Answer; how: "exact" }
  | { status: "correction"; answerIndex: number; answer: Answer; how: KeyKind; distance: number }
  | { status: "reject" };

interface Key {
  words: string[];
  joined: string;
  answerIndex: number;
  kind: KeyKind;
  /** A partial that leaves out the start of the name ("baby tomato" of Belarusian baby tomato). */
  tail: boolean;
}

/** curated: written down on purpose (an alias), as opposed to made by a rule (initials, partials). */
type Entry = { answerIndex: number; kind: KeyKind; tail: boolean; curated?: boolean };

export interface PreparedPrompt {
  answers: readonly Answer[];
  /** Normalized canonical name -> answer index. */
  exact: Map<string, number>;
  /** Sorted by joined length, so a guess only scans keys of similar length. */
  keys: Key[];
}

/** Short words between other words are ignored ("trinidad n tobago"). */
const SHORT_MIDDLE_WORD_MAX = 2;
/** A shared partial word resolves to the one answer at or below this many points, if exactly one. */
const COMMON_POINTS_MAX = 30;
const SWAPS: Record<string, string> = { saint: "st", st: "saint", mount: "mt", mt: "mount" };
const PROMPT_NOISE = new Set(["name", "type", "kind", "like", "someone", "something", "one"]);

function compareForm(ws: string[]): string[] {
  if (ws.length < 3) return ws;
  return ws.filter(
    (w, i) => i === 0 || i === ws.length - 1 || !(w.length <= SHORT_MIDDLE_WORD_MAX && /^[a-z]+$/.test(w)),
  );
}

function promptStems(promptText: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(normalize(promptText))) {
    if (w.length >= 3 && !FILLER_WORDS.has(w) && !PROMPT_NOISE.has(w)) out.add(stem(w));
  }
  return out;
}

function derivedForms(ws: string[], stems: Set<string>): string[][] {
  const out: string[][] = [];
  if (ws.some((w) => w in SWAPS)) out.push(ws.map((w) => SWAPS[w] ?? w));
  for (let i = 1; i < ws.length - 1; i++) {
    if (FILLER_WORDS.has(ws[i]!)) out.push(ws.filter((_, j) => j !== i));
  }
  const withoutPrompt = ws.filter((w) => !stems.has(stem(w)));
  if (withoutPrompt.length && withoutPrompt.length < ws.length) out.push(withoutPrompt);
  const significant = ws.filter((w) => !FILLER_WORDS.has(w));
  if (significant.length >= 2 && significant.every((w) => /^[a-z]/.test(w))) {
    out.push([significant.map((w) => w[0]).join("")]);
  }
  return out;
}

function partialForms(ws: string[], stems: Set<string>): { gram: string[]; tail: boolean }[] {
  const out: { gram: string[]; tail: boolean }[] = [];
  for (let n = 1; n < ws.length; n++) {
    for (let i = 0; i + n <= ws.length; i++) {
      const gram = ws.slice(i, i + n);
      if (FILLER_WORDS.has(gram[0]!) || FILLER_WORDS.has(gram[n - 1]!)) continue;
      if (gram.every((w) => stems.has(stem(w)))) continue;
      if (n === 1 && (gram[0]!.length < 3 || /^\d+$/.test(gram[0]!))) continue;
      out.push({ gram, tail: i > 0 });
    }
  }
  return out;
}

/** The phrase with its last word made singular, one per possible singular ("wenises" -> wenis, wenise). */
function singularForms(ws: string[]): string[][] {
  const last = ws[ws.length - 1];
  return last ? singulars(last).map((s) => [...ws.slice(0, -1), s]) : [];
}

/** Build the lookup structures for one prompt. Do this once per prompt and cache it. */
export function preparePrompt(promptText: string, answers: readonly Answer[]): PreparedPrompt {
  const stems = promptStems(promptText);
  const spellingRule = hasSpellingRule(promptText);
  const exact = new Map<string, number>();
  const candidates = new Map<string, { words: string[]; entries: Entry[] }>();

  const add = (ws: string[], answerIndex: number, kind: KeyKind, tail = false, curated = false) => {
    const cf = compareForm(ws);
    if (!cf.length) return;
    const text = cf.join(" ");
    let c = candidates.get(text);
    if (!c) candidates.set(text, (c = { words: cf, entries: [] }));
    c.entries.push({ answerIndex, kind, tail, curated });
  };

  answers.forEach((answer, i) => {
    const canonical = normalize(answer.name);
    if (!exact.has(canonical)) exact.set(canonical, i);
    const bases = [words(canonical)];
    const bracketless = normalize(answer.name.replace(/\([^)]*\)/g, " "));
    if (bracketless && bracketless !== canonical) bases.push(words(bracketless));
    // Aliases count only as whole names (or their singular): "hopper" must not find Eleven through "Jane Hopper".
    const aliases = (spellingRule ? [] : [...commonAliases(answer.name), ...(answer.aliases ?? [])])
      .map((a) => words(normalize(a)))
      .filter((a) => a.length);

    add(bases[0]!, i, "canonical");
    for (const alias of aliases) {
      for (const f of [alias, ...singularForms(alias)]) add(f, i, "derived", false, true);
    }
    bases.slice(1).forEach((b) => add(b, i, "derived"));
    for (const b of bases) {
      for (const f of singularForms(b)) add(f, i, "derived");
      for (const f of derivedForms(b, stems)) add(f, i, "derived");
      for (const { gram, tail } of partialForms(b, stems)) add(gram, i, "partial", tail);
    }
  });

  const keys: Key[] = [];
  for (const { words: ws, entries } of candidates.values()) {
    const owner = resolveOwner(entries, answers);
    if (owner) keys.push({ words: ws, joined: ws.join(""), ...owner });
  }
  keys.sort((a, b) => a.joined.length - b.joined.length);
  return { answers, exact, keys };
}

/**
 * Decide which answer a key belongs to. The best kind present wins; if several answers share
 * it, the key goes to the single common-tier answer among them, or to nobody
 * ("byers" fits four Stranger Things characters and is rejected; "hopper" goes to Jim Hopper).
 */
function resolveOwner(entries: Entry[], answers: readonly Answer[]): Entry | undefined {
  const bestRank = Math.min(...entries.map((e) => KIND_RANK[e.kind]));
  const best = entries.filter((e) => KIND_RANK[e.kind] === bestRank);
  const kind = best[0]!.kind;
  if (kind === "canonical") return best[0];
  let owners = [...new Set(best.map((e) => e.answerIndex))];
  // an alias someone wrote down beats a rule-made clash ("omg" is Oh my god, not the initials of Oh my gosh)
  const curated = [...new Set(best.filter((e) => e.curated).map((e) => e.answerIndex))];
  if (owners.length > 1 && curated.length === 1) owners = curated;
  const common = owners.filter((i) => pointsFor(answers[i]!.tier) <= COMMON_POINTS_MAX);
  const owner = owners.length === 1 ? owners[0] : common.length === 1 ? common[0] : undefined;
  if (owner === undefined) return undefined;
  return { answerIndex: owner, kind, tail: best.every((e) => e.answerIndex !== owner || e.tail) };
}

function allowedEdits(len: number, o: MatchOptions): number {
  return len <= o.shortWordMax ? 0 : Math.floor(len / o.typoDivisor);
}

function distanceTo(input: string[], joined: string, key: Key, o: MatchOptions): number {
  if (input.length === key.words.length) {
    let total = 0;
    for (let i = 0; i < input.length; i++) {
      // A lone word's budget comes from what was typed ("qaar" is not Qatar); inside a phrase, from the
      // longer of the typed and answer word ("sri lnka" is Sri Lanka, "baby tomato" is Bamby tomato).
      const len = input.length > 1 ? Math.max(input[i]!.length, key.words[i]!.length) : input[i]!.length;
      const budget = Math.min(allowedEdits(len, o), o.editCap - total);
      const d = editDistance(input[i]!, key.words[i]!, budget, o.swapsAsOne);
      if (d === Infinity) return Infinity;
      total += d;
    }
    return total;
  }
  const budget = Math.min(o.joinedEdits, allowedEdits(joined.length, o), o.editCap);
  return editDistance(joined, key.joined, budget, o.swapsAsOne);
}

/**
 * Grade a guess. "accept" only for an exact canonical match; anything else that matches is a
 * "correction" ("did you mean X?"), which the caller may confirm or auto-accept.
 */
export function grade(prepared: PreparedPrompt, input: string, options: MatchOptions = PRESETS.faithful): MatchResult {
  const n = normalize(input);
  if (!n) return { status: "reject" };

  const exactIndex = prepared.exact.get(n);
  if (exactIndex !== undefined) {
    return { status: "accept", answerIndex: exactIndex, answer: prepared.answers[exactIndex]!, how: "exact" };
  }

  const typed = compareForm(words(n));
  // A plural guess also tries its singular ("toes" -> Toe); that counts as a derived spelling.
  const forms = [typed, ...(options.derived ? singularForms(typed) : [])];
  let best: Candidate | undefined;
  forms.forEach((form, f) => {
    const joined = form.join("");
    const { keys } = prepared;
    const maxLen = joined.length + options.editCap;
    for (let i = firstWithLength(keys, joined.length - options.editCap); i < keys.length; i++) {
      const key = keys[i]!;
      if (key.joined.length > maxLen) break;
      if (key.kind === "derived" && !options.derived) continue;
      if (key.kind === "partial" && !options.partial) continue;
      const distance = distanceTo(form, joined, key, options);
      if (distance === Infinity) continue;
      const kind = f > 0 && key.kind === "canonical" ? "derived" : key.kind;
      const c = { answerIndex: key.answerIndex, kind, tail: key.tail, distance };
      if (!best || isBetter(prepared, c, best)) best = c;
    }
  });
  if (!best) return { status: "reject" };
  const { answerIndex, kind, distance } = best;
  return { status: "correction", answerIndex, answer: prepared.answers[answerIndex]!, how: kind, distance };
}

interface Candidate {
  answerIndex: number;
  kind: KeyKind;
  tail: boolean;
  distance: number;
}

function firstWithLength(keys: Key[], len: number): number {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.joined.length < len) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A whole name, even with a typo, beats the end of another name ("baby tomato" is Bamby tomato, not
 * Belarusian baby tomato); the start of a name still wins on edits ("billy" is Billy Hargrove, not Bill).
 * Then fewer edits, better key kind, the more common answer, list order.
 */
function isBetter(p: PreparedPrompt, a: Candidate, b: Candidate): boolean {
  const aTail = a.kind === "partial" && a.tail, bTail = b.kind === "partial" && b.tail;
  if (aTail !== bTail && (a.kind !== "partial" || b.kind !== "partial")) return bTail;
  if (a.distance !== b.distance) return a.distance < b.distance;
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] < KIND_RANK[b.kind];
  const pa = pointsFor(p.answers[a.answerIndex]!.tier);
  const pb = pointsFor(p.answers[b.answerIndex]!.tier);
  if (pa !== pb) return pa < pb;
  return a.answerIndex < b.answerIndex;
}
