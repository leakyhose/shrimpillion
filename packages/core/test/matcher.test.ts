import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PRESETS, grade, normalize, preparePrompt, type Answer } from "../src/index.ts";
import { DATA, runProbes, type ProbeOutcome } from "../scripts/eval-probes.ts";

const countries: Answer[] = [
  { name: "Iraq", tier: "shrimpillion" },
  { name: "Trinidad and Tobago", tier: "deepcut" },
  { name: "Saint Vincent and the Grenadines", tier: "deepcut" },
  { name: "Republic of the Congo", tier: "deepcut" },
  { name: "DR Congo", tier: "rare" },
  { name: "Guinea-Bissau", tier: "deepcut" },
  { name: "Costa Rica", tier: "schooler" },
  { name: "Iran", tier: "schooler" },
  { name: "Oman", tier: "rare" },
  { name: "Mercury (planet)", tier: "rare", aliases: ["Hermes"] },
];
const p = preparePrompt("Name a country with a coastline", countries);
const name = (input: string) => {
  const r = grade(p, input);
  return r.status === "reject" ? "reject" : `${r.status}:${r.answer.name}`;
};

describe("normalize", () => {
  it("strips accents, punctuation, leading articles and & ", () => {
    expect(normalize("  The Café-au-lait! ")).toBe("cafe au lait");
    expect(normalize("Trinidad & Tobago")).toBe("trinidad and tobago");
    expect(normalize("Dr. Brenner")).toBe("dr brenner");
    expect(normalize("Jack-o'-lantern")).toBe("jack o lantern");
    expect(normalize("Straße")).toBe("strasse");
    expect(normalize("11")).toBe("11");
  });
});

describe("grade (faithful)", () => {
  it("accepts exact names after normalization", () => {
    expect(name("trinidad & tobago")).toBe("accept:Trinidad and Tobago");
    expect(name("THE iraq")).toBe("accept:Iraq");
  });

  it("applies per-word typo budgets", () => {
    expect(name("omqn")).toBe("reject"); // 4 letters: no typos
    expect(name("omqan")).toBe("correction:Oman");
    expect(name("costa ricca")).toBe("correction:Costa Rica");
    expect(name("costa rqca")).toBe("reject");
  });

  it("counts a swap as two edits", () => {
    expect(name("qraiq")).toBe("reject");
  });

  it("handles filler words and junk short words", () => {
    expect(name("trinidad tobago")).toBe("correction:Trinidad and Tobago");
    expect(name("trinidad n tobago")).toBe("correction:Trinidad and Tobago");
    expect(name("trinidad amd tobago")).toBe("reject");
    expect(name("saint vincent grenadines")).toBe("reject");
    expect(name("st vincent and the grenadines")).toBe("correction:Saint Vincent and the Grenadines");
    expect(name("republic congo")).toBe("correction:Republic of the Congo");
  });

  it("compares without spaces when word counts differ", () => {
    expect(name("costarica")).toBe("correction:Costa Rica");
    expect(name("guineabissau")).toBe("correction:Guinea-Bissau");
    expect(name("guieabisau")).toBe("reject");
  });

  it("breaks typo ties towards the more common answer", () => {
    expect(name("iranq")).toBe("correction:Iran");
  });

  it("uses bracket-less names and curated aliases", () => {
    expect(name("mercury")).toBe("correction:Mercury (planet)");
    expect(name("hermes")).toBe("correction:Mercury (planet)");
  });

  it("strict preset has no typos or partials", () => {
    expect(grade(p, "omqan", PRESETS.strict).status).toBe("reject");
    expect(grade(p, "trinidad tobago", PRESETS.strict).status).toBe("correction");
  });
});

describe("partial names", () => {
  const st = preparePrompt("Name a character from Stranger Things", [
    { name: "Will Byers", tier: "plankton" },
    { name: "Jonathan Byers", tier: "schooler" },
    { name: "Jim Hopper", tier: "plankton" },
    { name: "Sara Hopper", tier: "deepcut" },
    { name: "Terry Ives", tier: "rare" },
    { name: "Becky Ives", tier: "deepcut" },
    { name: "Dr. Brenner", tier: "schooler" },
  ]);
  const n = (input: string) => {
    const r = grade(st, input);
    return r.status === "reject" ? "reject" : r.answer.name;
  };
  it("resolves unique and common-tier words, rejects ambiguous ones", () => {
    expect(n("will")).toBe("Will Byers");
    expect(n("hopper")).toBe("Jim Hopper");
    expect(n("brenner")).toBe("Dr. Brenner");
    expect(n("byers")).toBe("reject");
    expect(n("ives")).toBe("reject");
    expect(n("doctor brenner")).toBe("reject");
  });
});

// Needs the raw data in research/, which is not part of the repo.
describe.skipIf(!existsSync(DATA))("probe log", () => {
  let results: ProbeOutcome[];
  beforeAll(() => {
    results = runProbes("faithful");
  });
  it("never accepts a probed reject", () => {
    const rejects = results.filter((r) => r.expected === "reject");
    expect(rejects.filter((r) => !r.ok).map((r) => r.input)).toEqual([]);
  });
  it("matches at least 99 of the 114 accepted guesses (the rest need curated aliases)", () => {
    const matches = results.filter((r) => r.expected !== "reject");
    expect(matches.filter((r) => r.ok).length).toBeGreaterThanOrEqual(99);
  });
});
