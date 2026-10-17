/**
 * The packs on the home screen. Each entry is one card; `round` is the body posted to
 * POST /api/rounds to create a fresh round for it. Add more packs here as plain entries.
 */
export type Pack = {
  id: string;
  title: string;
  /** One line under the title. */
  blurb: string;
  /** Small boxed label in the corner of the art. */
  badge: string;
  /** Call to action at the bottom of the card. */
  cta: string;
  /** Tagline on the begin-descent screen. */
  tagline: string;
  round: Record<string, unknown>;
};

/** A random 7-prompt round from every source, with the default timer and matching. */
const ALL: Pack = {
  id: "all",
  title: "All",
  blurb: "7 random prompts · from every source we have",
  badge: "EVERY SOURCE",
  cta: "TAKE THE PLUNGE →",
  tagline: "THE BOTTOMLESS DIVE",
  round: { mode: "random" },
};

export const PACKS: Pack[] = [ALL];

/** Which pack a round came from. Random rounds are "All"; anything else falls back to the round title. */
export function packForRound(round: { mode: string; title: string }): Pack {
  if (round.mode === "random") return ALL;
  return { ...ALL, id: round.mode, title: round.title, tagline: round.title.toUpperCase() };
}
