import { normalize } from "./normalize.ts";

/**
 * Names for the same thing. An answer named by any entry also matches the others in its group
 * (as a "did you mean"). Only unambiguous names belong here: "England" is not the United Kingdom.
 */
const GROUPS: string[][] = [
  // countries
  ["United States", "USA", "US", "U.S.A.", "America", "United States of America", "The States", "US of A"],
  ["United Kingdom", "UK", "Britain", "Great Britain", "GB", "United Kingdom of Great Britain and Northern Ireland"],
  ["United Arab Emirates", "UAE", "Emirates"],
  ["DR Congo", "Democratic Republic of the Congo", "Democratic Republic of Congo", "DRC", "Congo-Kinshasa", "Zaire"],
  ["Republic of the Congo", "Congo-Brazzaville", "Congo Republic"],
  ["North Korea", "DPRK", "N Korea", "Democratic People's Republic of Korea"],
  ["South Korea", "S Korea", "Republic of Korea", "ROK", "Korea South"],
  ["Timor-Leste", "East Timor"],
  ["Myanmar", "Burma"],
  ["Netherlands", "Holland"],
  ["Ivory Coast", "Côte d'Ivoire", "Cote d Ivoire"],
  ["Eswatini", "Swaziland"],
  ["Czechia", "Czech Republic"],
  ["North Macedonia", "Macedonia"],
  ["Cape Verde", "Cabo Verde"],
  ["Turkey", "Türkiye"],
  ["Vatican City", "Vatican", "Holy See"],
  ["Iran", "Persia"],
  ["Sri Lanka", "Ceylon"],
  ["Thailand", "Siam"],
  ["Bosnia and Herzegovina", "Bosnia", "Bosnia-Herzegovina"],
  ["Papua New Guinea", "PNG"],
  ["Saint Kitts and Nevis", "St Kitts", "Saint Kitts", "St Kitts and Nevis"],
  ["Saint Vincent and the Grenadines", "St Vincent", "Saint Vincent"],
  ["Russia", "Russian Federation"],
  ["China", "PRC", "People's Republic of China", "Mainland China"],
  ["Taiwan", "Republic of China", "ROC"],
  ["Micronesia", "Federated States of Micronesia", "FSM"],
  ["New Zealand", "NZ", "Aotearoa"],
  ["South Africa", "RSA"],
  ["Central African Republic", "CAR"],
  ["Vietnam", "Viet Nam"],
  ["Laos", "Lao"],
  ["Brunei", "Brunei Darussalam"],
  ["Syria", "Syrian Arab Republic"],
  ["Trinidad and Tobago", "Trinidad", "Trinidad & Tobago"],
  ["Saudi Arabia", "KSA"],
  ["Philippines", "The Philippines"],
  // food and drink
  ["Hot chocolate", "Hot cocoa", "Cocoa", "Drinking chocolate"],
  ["Mac and cheese", "Macaroni and cheese", "Mac n cheese", "Mac 'n' cheese"],
  ["Cabernet Sauvignon", "Cab Sauv", "Cab"],
  ["Sauvignon Blanc", "Sauv Blanc"],
  ["Gewürztraminer", "Gewurz", "Gewürz"],
  ["Rosé", "Rose wine", "Rosé wine"],
  ["Chai", "Chai tea", "Masala chai"],
  ["Earl Grey", "Earl Grey tea"],
  ["Chow mein", "Chow men"],
  ["Pad see ew", "Pad se ew", "Pad si ew"],
  // renamed products and services
  ["Prime for Young Adults", "Prime Student", "Amazon Prime Student"],
  // interjections
  ["Oh my god", "OMG"],
  ["Ah", "Ahh", "Aah"],
  ["Aw", "Aww", "Awww"],
  ["Hmm", "Hmmm", "Hm"],
  ["Shh", "Shhh", "Sh"],
  ["Ooh", "Oooh"],
  ["Eek", "Eeek"],
  ["Whoa", "Woah"],
  ["Oops", "Oopsie", "Whoops"],
];

/** Short names that point one way only: "Korea" finds South Korea, but South Korea is not "Korea" for North Korea's sake. */
const ONE_WAY: Record<string, string[]> = {
  "South Korea": ["Korea"],
  "DR Congo": ["Congo"],
  "Democratic Republic of the Congo": ["Congo"],
};

/** Official long forms ("Republic of Iraq", "Kingdom of Spain") for every country above or listed here. */
const COUNTRIES = [
  "Albania", "Algeria", "Angola", "Argentina", "Australia", "Austria", "Bahrain", "Bangladesh", "Belgium", "Benin",
  "Bolivia", "Brazil", "Bulgaria", "Burundi", "Cambodia", "Cameroon", "Canada", "Chad", "Chile", "China", "Colombia",
  "Croatia", "Cuba", "Cyprus", "Denmark", "Djibouti", "Ecuador", "Egypt", "Estonia", "Ethiopia", "Fiji", "Finland",
  "France", "Gabon", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Guinea", "Haiti", "Honduras", "Hungary",
  "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Liberia", "Libya", "Lithuania", "Madagascar", "Malawi",
  "Malaysia", "Mali", "Malta", "Mauritania", "Mexico", "Moldova", "Mongolia", "Morocco", "Mozambique", "Namibia", "Nepal",
  "Nicaragua", "Niger", "Nigeria", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", "Poland", "Portugal",
  "Qatar", "Romania", "Rwanda", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "Somalia", "Spain", "Sudan",
  "Sweden", "Switzerland", "Tanzania", "Thailand", "Togo", "Tunisia", "Turkey", "Uganda", "Ukraine", "Uruguay",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];
const LONG_FORMS = ["Republic of", "Kingdom of", "State of", "Commonwealth of", "Federal Republic of"];

const TABLE = new Map<string, string[]>();
function link(names: string[]) {
  for (const n of names) {
    const key = normalize(n);
    const others = names.filter((m) => normalize(m) !== key);
    TABLE.set(key, [...(TABLE.get(key) ?? []), ...others]);
  }
}
GROUPS.forEach(link);
for (const c of COUNTRIES) link([c, ...LONG_FORMS.map((f) => `${f} ${c}`)]);
for (const [name, aliases] of Object.entries(ONE_WAY)) {
  const key = normalize(name);
  TABLE.set(key, [...(TABLE.get(key) ?? []), ...aliases]);
}

/** Well-known other names for an answer, from the shared table. */
export function commonAliases(answerName: string): string[] {
  return TABLE.get(normalize(answerName)) ?? [];
}

/**
 * Prompts with a spelling or naming rule ("starts with B", "8 or more letters", "has an X in its name",
 * "must say full name").
 * Other names would dodge the rule ("DPRK" is not 8 letters), so they get no aliases.
 */
const SPELLING_RULE =
  /\b(starts?|begins?|ends?) (with|in)\b|\bletters?\b(?!.*\balphabet)|\bsyllables?\b|\bpalindrome|\bvowel|\bcontain(s|ing)\b.*["“]|\bcontains [a-z],|\bfull name\b|\bformal name\b|\bin (its|their) (english )?name\b/i;
export const hasSpellingRule = (promptText: string) => SPELLING_RULE.test(promptText);

