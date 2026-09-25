/**
 * Geography has to be somewhere real — AND somewhere the actual search
 * actor's location field recognizes, which is a narrower thing.
 *
 * This used to also accept "regions" — Worldwide, continents, and political/
 * economic groupings like DACH, GCC, Benelux, the EU. Removed entirely after
 * a real run confirmed "European Union" isn't a place LinkedIn's own
 * location search recognizes at all: the actor returned a hard 404 and every
 * candidate for the run was lost. Tracing the actor's error handling showed
 * the failure mode is worse than a thrown error — it CATCHES the bad
 * location internally and still returns 200 with an empty dataset, so it's
 * indistinguishable from a genuine "searched and found nothing" result.
 * "European Union" was the one confirmed broken, but every other REGIONS
 * entry was the same *kind* of value (a constructed grouping, not a real
 * administrative place) with the same unverified risk, and there is no
 * public taxonomy of valid LinkedIn locations to check them against the way
 * industries.ts could (LinkedIn's location list is enormous and resolved
 * live via autocomplete, not published as a static file). Countries are the
 * one category that's actually certain: every real country has a genuine
 * LinkedIn location entity. Restricting to that is what "only what the
 * scraper can actually search" means in practice.
 *
 * This is a free, instant, certain check — no AI call needed to know that
 * "nowhere" is not a place. It also does a second job: the geography goes to
 * the company search as a filter, so a canonical spelling ("United States",
 * not "usa" or "U.S.") makes the search itself more reliable.
 *
 * Scope is deliberately country-only, not "country or region" — anything
 * finer (a state, a city) OR broader (a continent, a bloc) belongs in Must
 * have ("Headquartered in Texas", "Operates across Europe"), where it is
 * checked against evidence rather than guessed at by an unverified search
 * filter value.
 */

const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina",
  "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
  "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina",
  "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia", "Cameroon",
  "Canada", "Cape Verde", "Central African Republic", "Chad", "Chile", "China", "Colombia",
  "Comoros", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Democratic Republic of the Congo",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France",
  "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India",
  "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan",
  "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania",
  "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua",
  "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
  "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland",
  "Portugal", "Qatar", "Republic of the Congo", "Romania", "Russia", "Rwanda",
  "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa",
  "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles",
  "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
  "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
  "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste",
  "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

/** The spellings people actually type, mapped to the canonical name. */
const ALIASES: Record<string, string> = {
  "us": "United States",
  "usa": "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "america": "United States",
  "united states of america": "United States",
  "the united states": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  "britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "uae": "United Arab Emirates",
  "emirates": "United Arab Emirates",
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
  "czech republic": "Czechia",
  "south korea": "South Korea",
  "korea": "South Korea",
  "republic of korea": "South Korea",
  "russia federation": "Russia",
  "russian federation": "Russia",
  "ireland": "Ireland",
  "republic of ireland": "Ireland",
  "swaziland": "Eswatini",
  "macedonia": "North Macedonia",
  "burma": "Myanmar",
  "cote d'ivoire": "Ivory Coast",
  "côte d'ivoire": "Ivory Coast",
  "drc": "Democratic Republic of the Congo",
  "dr congo": "Democratic Republic of the Congo",
  "cabo verde": "Cape Verde",
  "east timor": "Timor-Leste",
  "vatican": "Vatican City",
  // No substitute offered for apac/emea/eu/european union/latam/anz/
  // scandinavia/nordic/gulf/global/worldwide etc. — those used to alias to
  // REGIONS entries that are gone now (see the file header). There is no
  // single real country that means the same thing as "Europe" or
  // "Worldwide" once regions are off the table, so these now correctly fall
  // through to "not a known place" rather than silently resolving to one
  // arbitrary country that only partly matches what was actually meant.
};

export const KNOWN_PLACES: string[] = [...COUNTRIES].sort((a, b) => a.localeCompare(b));

const LOOKUP = new Map<string, string>();
for (const place of KNOWN_PLACES) LOOKUP.set(place.toLowerCase(), place);
for (const [alias, canonical] of Object.entries(ALIASES)) LOOKUP.set(alias, canonical);

/**
 * Returns the canonical name for a place, or null if it isn't one.
 * Case, spacing and punctuation are forgiven; "nowhere" is not.
 */
export function canonicalPlace(input: string): string | null {
  const base = input.trim().toLowerCase().replace(/\s+/g, " ");

  // Try progressively more forgiving forms. "U.S.A." only matches once the
  // dots are gone entirely — stripping just the trailing one leaves "u.s.a",
  // which is nothing.
  const candidates = [
    base,
    base.replace(/[.]$/, ""),
    base.replace(/[.]/g, ""),
    base.replace(/[.]/g, "").replace(/\s+/g, ""),
  ];

  for (const key of candidates) {
    const hit = LOOKUP.get(key);
    if (hit) return hit;
  }
  return null;
}

export function isKnownPlace(input: string): boolean {
  return canonicalPlace(input) !== null;
}
