// Builds the prompt bank from the raw data in research/data (not part of the repo).
// Idempotent: rerun it whenever raw data is added. Usage: npm run bank [-- <out path>]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTier, normalize, type Answer, type Prompt, type PromptSource } from "@shrimpillion/core";
import type { BankFile, BankSet } from "../src/bank/types.ts";
import { DEFAULT_BANK_PATH } from "../src/config.ts";

export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../research/data/", import.meta.url));
const PACK_TITLES: Record<string, string> = {
  movies: "Movies", sports: "Sports", geography: "Geography", lexicon: "Lexicon",
};

interface RawAnswer { answer: string; tier: string; score?: number; quip?: string }
interface RawPrompt { id?: string; round?: string; text: string; answers: RawAnswer[] }

/** The source data names the top tier "krillion". */
const tierOf = (raw: string) => (raw === "krillion" ? "shrimpillion" : raw);

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export function buildBank(dataDir = DEFAULT_DATA_DIR, log: (msg: string) => void = console.log): BankFile {
  const sets = new Map<string, BankSet>();
  const prompts = new Map<string, Prompt>();
  const warnings: string[] = [];

  function addSet(set: Omit<BankSet, "promptIds">, raw: RawPrompt[], origin: string, capturedAt?: string) {
    const promptIds: string[] = [];
    raw.forEach((rp, i) => {
      const slot = i + 1;
      const id = `${set.id}-${slot}`;
      const source: PromptSource = {
        kind: set.kind, setId: set.id, slot, number: set.number, origin,
        ...(set.pack && { pack: set.pack }),
        ...(set.date && { date: set.date }),
        ...(capturedAt && { capturedAt }),
      };
      const answers = cleanAnswers(rp.answers, id, warnings);
      const version = sha(answers.map((a) => `${a.name}|${a.tier}`).sort().join("\n"));
      prompts.set(id, { id, text: rp.text.trim(), source, version, answers });
      promptIds.push(id);
    });
    if (raw.length !== 7) warnings.push(`${set.id}: ${raw.length} prompts (expected 7)`);
    sets.set(set.id, { ...set, promptIds });
  }

  // 1. Daily dives from the mirror.
  const mirror = readJson<{ dives: { date: string; dive: number; prompts: RawPrompt[] }[] }>(
    join(dataDir, "krilliongame-dives.json"),
  );
  const diveByDate = new Map<string, number>();
  for (const d of mirror.dives) {
    diveByDate.set(d.date, d.dive);
    addSet({ id: `d${pad(d.dive, 3)}`, kind: "daily", number: d.dive, date: d.date, title: `Dive #${d.dive}` },
      d.prompts, "mirror", d.date);
  }

  // 2. Official files override mirrors (they are authoritative and carry quips).
  const officialDir = join(dataDir, "official");
  const files = existsSync(officialDir) ? readdirSync(officialDir) : [];
  const today = files.includes("today.json")
    ? readJson<{ date: string; dayNumber: number }>(join(officialDir, "today.json"))
    : undefined;
  if (today) diveByDate.set(today.date, today.dayNumber);

  for (const file of files.sort()) {
    let m: RegExpMatchArray | null;
    if ((m = file.match(/^reveal_(\d{4}-\d{2}-\d{2})\.json$/))) {
      const date = m[1]!;
      const dive = diveByDate.get(date);
      if (!dive) { warnings.push(`${file}: unknown dive number for ${date}`); continue; }
      const reveal = readJson<{ prompts: RawPrompt[] }>(join(officialDir, file));
      addSet({ id: `d${pad(dive, 3)}`, kind: "daily", number: dive, date, title: `Dive #${dive}` },
        reveal.prompts, "official", date);
    } else if ((m = file.match(/^unlimited_(\d+)_reveal\.json$/))) {
      const n = Number(m[1]);
      const reveal = readJson<{ rounds: RawPrompt[] }>(join(officialDir, file));
      addSet({ id: `u${pad(n, 3)}`, kind: "unlimited", number: n, title: `Unlimited #${n}` },
        reveal.rounds, "official");
    } else if ((m = file.match(/^packs_([a-z]+)_(\d+)_reveal\.json$/))) {
      const pack = m[1]!;
      const n = Number(m[2]);
      const reveal = readJson<{ rounds: RawPrompt[] }>(join(officialDir, file));
      addSet({ id: `${pack}${pad(n, 2)}`, kind: "pack", number: n, pack, title: `${PACK_TITLES[pack] ?? pack} #${n}` },
        reveal.rounds, "official");
    }
  }

  // 3. The same prompt text can appear in several sources; keep one canonical copy for random draws.
  const byText = new Map<string, Prompt[]>();
  for (const p of prompts.values()) {
    const key = normalize(p.text);
    byText.set(key, [...(byText.get(key) ?? []), p]);
  }
  let duplicates = 0;
  for (const group of byText.values()) {
    if (group.length < 2) continue;
    const [keep, ...rest] = [...group].sort(
      (a, b) =>
        Number(b.source.origin === "official") - Number(a.source.origin === "official") ||
        b.answers.length - a.answers.length ||
        a.id.localeCompare(b.id),
    );
    for (const p of rest) { p.duplicateOf = keep!.id; duplicates++; }
  }

  // 4. Curated aliases ({ promptId: { answerName: [alias, …] } }), shared by prompts with the same text.
  const aliasFile = join(dataDir, "aliases.json");
  let aliasCount = 0;
  if (existsSync(aliasFile)) {
    const byPrompt = readJson<Record<string, Record<string, string[]>>>(aliasFile);
    for (const [id, map] of Object.entries(byPrompt)) {
      const source = prompts.get(id);
      if (!source) { warnings.push(`aliases: unknown prompt ${id}`); continue; }
      for (const p of byText.get(normalize(source.text)) ?? [source]) {
        for (const a of p.answers) {
          const extra = map[a.name];
          if (!extra?.length) continue;
          a.aliases = [...new Set([...(a.aliases ?? []), ...extra])];
          if (p === source) aliasCount += extra.length;
        }
      }
    }
  }

  const promptList = [...prompts.values()].sort((a, b) => a.id.localeCompare(b.id));
  const setList = [...sets.values()].sort((a, b) => a.id.localeCompare(b.id));
  const aliasStamp = promptList.flatMap((p) => p.answers.flatMap((a) => (a.aliases ?? []).map((x) => `${p.id}|${a.name}|${x}`)));
  const bank: BankFile = {
    version: sha([...promptList.map((p) => `${p.id}:${p.version}`), ...aliasStamp].join("\n")),
    builtAt: new Date().toISOString(),
    sets: setList,
    prompts: promptList,
  };

  const answers = promptList.reduce((n, p) => n + p.answers.length, 0);
  log(`bank ${bank.version}: ${setList.length} sets, ${promptList.length} prompts (${duplicates} duplicates), ${answers} answers, ${aliasCount} aliases`);
  for (const w of warnings.slice(0, 20)) log(`  warn: ${w}`);
  if (warnings.length > 20) log(`  … ${warnings.length - 20} more warnings`);
  return bank;
}

function cleanAnswers(raw: RawAnswer[], promptId: string, warnings: string[]): Answer[] {
  const seen = new Set<string>();
  const out: Answer[] = [];
  let dropped = 0;
  for (const a of raw) {
    const name = a.answer?.trim();
    const key = name ? normalize(name) : "";
    const tier = tierOf(a.tier);
    if (!key || !isTier(tier) || seen.has(key)) { dropped++; continue; }
    seen.add(key);
    out.push({ name, tier, ...(a.quip && { quip: a.quip }) });
  }
  if (dropped) warnings.push(`${promptId}: dropped ${dropped} empty/duplicate/unknown-tier answers`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? process.env.BANK_PATH ?? DEFAULT_BANK_PATH;
  const bank = buildBank();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(bank));
  console.log(`wrote ${out}`);
}
