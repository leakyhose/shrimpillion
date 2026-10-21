// Replays a log of probed guesses (research/data, not in the repo) through the matcher.
// Usage: npm run eval:matcher [-- faithful|forgiving|strict]
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRESETS, grade, preparePrompt, type MatchPreset, type PreparedPrompt, type Tier } from "../src/index.ts";

export const DATA = fileURLToPath(new URL("../../../research/data/", import.meta.url));

export interface ProbeOutcome {
  round: string;
  input: string;
  expected: string; // "reject" | answer name
  got: string;
  ok: boolean;
}

export function runProbes(preset: MatchPreset = "faithful"): ProbeOutcome[] {
  const reveal = JSON.parse(readFileSync(DATA + "official/unlimited_1_reveal.json", "utf8")) as {
    rounds: { round: string; text: string; answers: { answer: string; tier: string }[] }[];
  };
  // The source data names the top tier "krillion".
  const tierOf = (t: string) => (t === "krillion" ? "shrimpillion" : t) as Tier;
  // Curated aliases, keyed by bank prompt id; round "r3" of Unlimited #1 is "u001-3".
  const aliases: Record<string, Record<string, string[]>> = existsSync(DATA + "aliases.json")
    ? JSON.parse(readFileSync(DATA + "aliases.json", "utf8"))
    : {};
  const prepared = new Map<string, PreparedPrompt>();
  for (const r of reveal.rounds) {
    const extra = aliases[`u001-${r.round.slice(1)}`] ?? {};
    prepared.set(r.round, preparePrompt(r.text, r.answers.map((a) => ({
      name: a.answer, tier: tierOf(a.tier), ...(extra[a.answer] && { aliases: extra[a.answer] }),
    }))));
  }

  const lines = readFileSync(DATA + "krillion-probe-log.jsonl", "utf8").trim().split("\n");
  return lines.map((line) => {
    const probe = JSON.parse(line) as {
      round: string; answer: string; preview: boolean;
      resp: { accepted: boolean; answer?: string; correction?: string };
    };
    const expected = probe.resp.answer ?? probe.resp.correction ?? "reject";
    const result = grade(prepared.get(probe.round)!, probe.answer, PRESETS[preset]);
    const got = result.status === "reject" ? "reject" : result.answer.name;
    // With preview on, the log tells exact accepts from corrections; check that too.
    const sameKind = !probe.preview || result.status === "reject" || (result.status === "accept") === probe.resp.accepted;
    return { round: probe.round, input: probe.answer, expected, got, ok: got === expected && sameKind };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preset = (process.argv[2] ?? "faithful") as MatchPreset;
  const results = runProbes(preset);
  const rejects = results.filter((r) => r.expected === "reject");
  const matches = results.filter((r) => r.expected !== "reject");
  const pct = (xs: ProbeOutcome[]) => `${xs.filter((x) => x.ok).length}/${xs.length}`;
  console.log(`preset=${preset}  overall ${pct(results)}  correct rejects ${pct(rejects)}  correct matches ${pct(matches)}`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  ${r.round} ${JSON.stringify(r.input).padEnd(34)} expected ${r.expected.padEnd(28)} got ${r.got}`);
  }
}
