// Letters NFD does not decompose into base + accent.
const FOLD: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i", ħ: "h",
};

/**
 * Normalize text before comparing: strip accents, lowercase,
 * "&" -> "and", apostrophes removed, other punctuation -> space, collapse spaces, drop a
 * leading "the/a/an". Digits stay digits ("11" is not "eleven").
 */
export function normalize(input: string): string {
  let s = input.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  s = s.replace(/[ßæœøłđðþıħ]/g, (c) => FOLD[c] ?? c);
  s = s.replace(/&/g, " and ");
  s = s.replace(/['’ʼ‘`´]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^(the|a|an) (?=\S)/, "");
  return s;
}

export function words(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

/** Words that may be omitted from multi-word answers ("Trinidad Tobago"). */
export const FILLER_WORDS = new Set([
  "and", "of", "the", "de", "la", "le", "les", "del", "da", "di", "du", "des", "von", "van",
  "der", "den", "das", "und", "et", "y", "e", "for", "in", "on", "at", "to", "with", "a", "an",
]);

/** Very rough singular form, used only to compare answer words with prompt words. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ches|shes|sses|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const IRREGULAR_PLURALS: Record<string, string> = {
  feet: "foot", teeth: "tooth", geese: "goose", mice: "mouse", lice: "louse", men: "man", women: "woman",
  children: "child", people: "person", oxen: "ox", knives: "knife", wives: "wife", lives: "life", leaves: "leaf",
  halves: "half", calves: "calf", wolves: "wolf", shelves: "shelf", loaves: "loaf", thieves: "thief", hooves: "hoof",
};

/**
 * Possible singular forms of a plural-looking word, so "ear" finds Ears and "wenis" finds Wenises.
 * Words ending in -ss, -us or -is are left alone (glass, cactus, pelvis).
 */
export function singulars(word: string): string[] {
  const irregular = IRREGULAR_PLURALS[word];
  if (irregular) return [irregular];
  if (word.length <= 3 || !word.endsWith("s") || /(ss|us|is)$/.test(word)) return [];
  const out = [word.slice(0, -1)];
  if (word.length > 4 && word.endsWith("ies")) out.push(word.slice(0, -3) + "y");
  else if (/(s|x|z|ch|sh|o)es$/.test(word) && word.length > 4) out.push(word.slice(0, -2));
  return out;
}
