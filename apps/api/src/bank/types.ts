import type { Prompt, SourceKind } from "@shrimpillion/core";

/** A numbered group of prompts: a daily dive, an Unlimited game or a pack game. */
export interface BankSet {
  id: string;
  kind: SourceKind;
  number: number;
  pack?: string;
  date?: string;
  title: string;
  promptIds: string[];
}

export interface BankFile {
  /** Hash of every prompt version; changes whenever any list changes. */
  version: string;
  builtAt: string;
  sets: BankSet[];
  prompts: Prompt[];
}
