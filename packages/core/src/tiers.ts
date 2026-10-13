import type { Tier } from "./types.ts";

export const TIER_POINTS: Record<Tier, number> = {
  plankton: 10,
  tooclever: 15,
  schooler: 30,
  rare: 60,
  deepcut: 85,
  shrimpillion: 100,
};

export const TIER_LABELS: Record<Tier, string> = {
  plankton: "Plankton",
  tooclever: "Too Clever",
  schooler: "Schooler",
  rare: "Rare",
  deepcut: "Deep Cut",
  shrimpillion: "One in a Shrimpillion",
};

export const TIERS = Object.keys(TIER_POINTS) as Tier[];

export const MAX_POINTS_PER_PROMPT = 100;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && value in TIER_POINTS;
}

export function pointsFor(tier: Tier): number {
  return TIER_POINTS[tier];
}
