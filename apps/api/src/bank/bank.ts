import { readFileSync } from "node:fs";
import { preparePrompt, type PreparedPrompt, type Prompt, type SourceKind } from "@shrimpillion/core";
import type { BankFile, BankSet } from "./types.ts";

export interface PoolFilter {
  kinds?: SourceKind[];
  packs?: string[];
  minAnswers?: number;
  maxAnswers?: number;
  diveFrom?: number;
  diveTo?: number;
}

/** The read-only prompt bank, held in memory. Prepared matchers are cached per prompt. */
export class Bank {
  readonly version: string;
  readonly builtAt: string;
  readonly sets: ReadonlyMap<string, BankSet>;
  readonly prompts: ReadonlyMap<string, Prompt>;
  private readonly preparedCache = new Map<string, PreparedPrompt>();

  constructor(file: BankFile, private readonly cacheSize = 128) {
    this.version = file.version;
    this.builtAt = file.builtAt;
    this.sets = new Map(file.sets.map((s) => [s.id, s]));
    this.prompts = new Map(file.prompts.map((p) => [p.id, p]));
  }

  static load(path: string): Bank {
    return new Bank(JSON.parse(readFileSync(path, "utf8")) as BankFile);
  }

  prompt(id: string): Prompt | undefined {
    return this.prompts.get(id);
  }

  /** Matcher structures for a prompt, LRU-cached (big prompts take a few ms to prepare). */
  prepared(id: string): PreparedPrompt {
    const hit = this.preparedCache.get(id);
    if (hit) {
      this.preparedCache.delete(id);
      this.preparedCache.set(id, hit);
      return hit;
    }
    const p = this.prompts.get(id);
    if (!p) throw new Error(`unknown prompt ${id}`);
    const prepared = preparePrompt(p.text, p.answers);
    this.preparedCache.set(id, prepared);
    if (this.preparedCache.size > this.cacheSize) {
      this.preparedCache.delete(this.preparedCache.keys().next().value!);
    }
    return prepared;
  }

  /** Prompts eligible for random rounds (duplicates excluded). */
  pool(f: PoolFilter = {}): Prompt[] {
    return [...this.prompts.values()].filter((p) => {
      if (p.duplicateOf) return false;
      if (f.kinds?.length && !f.kinds.includes(p.source.kind)) return false;
      if (f.packs?.length && p.source.kind === "pack" && !f.packs.includes(p.source.pack!)) return false;
      if (f.minAnswers !== undefined && p.answers.length < f.minAnswers) return false;
      if (f.maxAnswers !== undefined && p.answers.length > f.maxAnswers) return false;
      if (p.source.kind === "daily") {
        if (f.diveFrom !== undefined && p.source.number < f.diveFrom) return false;
        if (f.diveTo !== undefined && p.source.number > f.diveTo) return false;
      }
      return true;
    });
  }
}
