export type Tier = "plankton" | "tooclever" | "schooler" | "rare" | "deepcut" | "shrimpillion";

export interface Answer {
  name: string;
  tier: Tier;
  quip?: string;
  /** Extra accepted spellings (curated or imported). Matched as "derived" keys. */
  aliases?: string[];
}

export type SourceKind = "daily" | "unlimited" | "pack";

export interface PromptSource {
  kind: SourceKind;
  /** Set this prompt belongs to, e.g. "d094", "u001", "movies01". */
  setId: string;
  /** 1-based position within the set. */
  slot: number;
  /** Dive number (daily) or game number (unlimited/pack). */
  number: number;
  /** Pack name for kind "pack". */
  pack?: string;
  /** Calendar date for daily dives. */
  date?: string;
  /** Where the answer list came from. */
  origin: string;
  capturedAt?: string;
}

export interface Prompt {
  /** Stable, URL-safe, never reused. e.g. "d094-1". */
  id: string;
  text: string;
  source: PromptSource;
  /** Hash of the answer list; changes when the list changes. */
  version: string;
  /** Set when an identical prompt exists under another id; excluded from random draws. */
  duplicateOf?: string;
  answers: Answer[];
}
