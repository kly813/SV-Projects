/**
 * HubSpot Workflow — Custom Code Action
 * Object: Service Addresses (p6253239_service_addresses)
 *
 * Reads all five address fields as one pool of text, works out which component
 * each piece of it actually is, puts every piece in its proper field, then
 * builds the formatted Location Name from the result.
 *
 * Input fields to map in the action UI (name them exactly as the left-hand key):
 *   address  -> service_address_7_24
 *   address2 -> service_address_2
 *   city     -> service_city_7_24
 *   state    -> service_state_7_24
 *   zip      -> service_zip_code_7_24
 *
 * Output fields to declare (all String, except changed = Boolean):
 *   locationName, cleanAddress, cleanAddress2, cleanCity, cleanZip, changed
 *
 * cleanState and businessName are also returned but are left undeclared by
 * default, which discards them. cleanState would have to be declared as an
 * Enumeration and its 113 options entered by hand, to change the 0.1% of
 * records whose state is empty; the state still appears in locationName
 * either way. Declare businessName to keep a business name typed ahead of
 * the street.
 */

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'american samoa': 'AS',
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  newfoundland: 'NL', 'newfoundland and labrador': 'NL',
  'northwest territories': 'NT', 'nova scotia': 'NS', nunavut: 'NU',
  ontario: 'ON', 'prince edward island': 'PE', quebec: 'QC', 'québec': 'QC',
  saskatchewan: 'SK', yukon: 'YT'
};

const STATE_CODES = {};
for (const name of Object.keys(STATE_NAMES)) STATE_CODES[STATE_NAMES[name]] = true;

const ZIP_ONLY_RE = /^(\d{5})(?:-(\d{4}))?$/;
const ZIP_TAIL_RE = /(?:^|[^\d-])(\d{5})(?:-(\d{4}))?$/;

// Segments that look like a city but are really a secondary address line.
const UNIT_WORD_RE = /^(?:#|ste\.?|suite|unit|apt\.?|apartment|bldg\.?|building|fl\.?|floor|rm\.?|room|dept\.?|lot|trlr|space|spc|po\s*box|p\.?o\.?\s*box)\b/i;

/**
 * Common English street-type suffixes. When a pasted address has lost its comma
 * ("2720 N Malinche Ave Laredo"), whatever follows the last of these is the
 * city. Deliberately English-only: adding "Avenida" would split
 * "2231 Avenida De Mesilla" into "2231 Avenida" + "De Mesilla".
 */
const STREET_SUFFIXES = [
  'street', 'st', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd', 'drive',
  'dr', 'lane', 'ln', 'way', 'court', 'ct', 'circle', 'cir', 'parkway', 'pkwy',
  'place', 'pl', 'terrace', 'ter', 'trail', 'trl', 'highway', 'hwy', 'pike',
  'row', 'run', 'loop', 'path', 'plaza', 'square', 'sq', 'expressway', 'expy',
  'freeway', 'fwy', 'turnpike', 'tpke'
];
const STREET_SUFFIX_SET = {};
for (const suffix of STREET_SUFFIXES) STREET_SUFFIX_SET[suffix] = true;

/** Tokens that open a street: "123", "123A", "N3676", "10600". */
const HOUSE_NUMBER_RE = /^[A-Za-z]?\d+[A-Za-z]?(?:-\d+)?$/;

/** Words that mark text as an organization rather than a street. */
const BUSINESS_WORD_RE = /\b(?:inc|llc|llp|lp|ltd|corp|corporation|co|company|pc|pa|pllc|group|associates|assoc|partners|enterprises|industries|holdings|services|solutions|systems|technologies|foundation|trust|institute|academy|school|church|clinic|hospital|center|centre|salon|restaurant|bank|store|market|shop|studio|agency|department|dept|university|college)\b\.?/i;

/**
 * Pull a leading business name off a street line, e.g.
 * "Chiropractic First Family Wellness 1480 Williston Rd".
 *
 * Deliberately strict, because a false positive damages a good address. The
 * leading text must contain no digits, must not be a unit word ("PO Box"),
 * must be either multi-word or carry a business word, and must be followed by
 * something that actually opens a street. That is what keeps "S 162nd St" and
 * "One Microsoft Way" intact.
 */
function extractBusinessName(text) {
  const value = trimSeparators(text);
  if (!value) return { businessName: '', street: value };

  const accept = (name, street) => {
    const trimmedName = trimSeparators(name);
    const trimmedStreet = trimSeparators(street);
    if (!trimmedStreet || trimmedName.length < 3) return null;
    if (/\d/.test(trimmedName)) return null;
    if (UNIT_WORD_RE.test(trimmedName)) return null;
    const multiWord = trimmedName.split(' ').filter(Boolean).length > 1;
    if (!multiWord && !BUSINESS_WORD_RE.test(trimmedName)) return null;
    return { businessName: trimmedName, street: trimmedStreet };
  };

  // "Acme Corp, 123 Main St" — the comma already marks the boundary.
  const parts = segments(value);
  if (parts.length >= 2) {
    const rest = parts.slice(1).join(', ');
    const firstRestWord = rest.split(' ')[0] || '';
    if (HOUSE_NUMBER_RE.test(firstRestWord)) {
      const split = accept(parts[0], rest);
      if (split) return split;
    }
  }

  // "Acme Corp 123 Main St" — find where the street starts.
  const words = value.split(' ').filter(Boolean);
  for (let i = 1; i < words.length - 1; i += 1) {
    if (!HOUSE_NUMBER_RE.test(words[i])) continue;
    const split = accept(words.slice(0, i).join(' '), words.slice(i).join(' '));
    if (split) return split;
    break;
  }

  return { businessName: '', street: value };
}

/**
 * Whole-field values that mean "nothing here". Compared against compareKey, so
 * punctuation and case do not matter: "N/A", "n.a.", "dont have it" and
 * "Don't Have It" all collapse to the same key.
 *
 * Matching is whole-value only, so a street called "None Such Rd" or a city
 * called "Nada" is unaffected.
 */
const PLACEHOLDER_KEYS = {};
for (const phrase of [
  'na', 'nan', 'none', 'null', 'nil', 'unknown', 'unk', 'tbd', 'tba',
  'test', 'testing', 'xxx', 'xxxx', 'zzz', 'pending', 'blank', 'empty',
  'noaddress', 'nostreet', 'nocity', 'nozip', 'noneprovided', 'nonegiven',
  'donthaveit', 'donothaveit', 'dontknow', 'donotknow', 'dontkno',
  'notavailable', 'notprovided', 'notapplicable', 'notlisted', 'notknown',
  'same', 'sameasabove', 'seeabove', 'unavailable', 'missing'
]) PLACEHOLDER_KEYS[phrase] = true;

function isPlaceholder(value) {
  const key = compareKey(value);
  return !!key && PLACEHOLDER_KEYS[key] === true;
}

/**
 * Words that show up in a sentence but essentially never in a US street name.
 *
 * "the", "and", "at", "of", "to", "in" and "on" are deliberately absent: they
 * appear in real streets such as "Farm to Market 1626", "Old Spanish Trail"
 * and "Avenue of the Americas".
 */
const PROSE_WORDS = {};
for (const word of [
  'says', 'said', 'say', 'would', 'could', 'should', 'will', 'wont',
  'who', 'whom', 'whose', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'does', 'did', 'doesnt', 'didnt', 'maybe', 'about', 'please', 'call',
  'called', 'ask', 'asked', 'tell', 'told', 'need', 'needs', 'want', 'wants',
  'know', 'knows', 'think', 'thinks', 'they', 'she', 'he', 'her', 'his',
  'their', 'our', 'your', 'we', 'you', 'not', 'but', 'because', 'however',
  'also', 'very', 'really', 'just', 'only', 'still', 'already', 'again',
  'when', 'where', 'why', 'how', 'what', 'which', 'this', 'that', 'these',
  'those', 'there', 'with', 'without', 'from', 'after', 'before', 'while',
  'until', 'since', 'unless', 'though', 'although', 'manager', 'owner',
  'decisions', 'decesions', 'account', 'candidate', 'customer', 'contact'
]) PROSE_WORDS[word] = true;

/**
 * Strip a free-text note that was typed into the street field after the actual
 * address, e.g. "14934 Webb Chapel Road Lady at the first desk says ...".
 *
 * Cuts at the first street-type suffix, but only when what follows really is
 * prose: at least five words AND at least two words that do not belong in a
 * street name. Both tests are needed to protect ordinary continuations -
 * "599 W Sam Ridley Pkwy Suite 103", "1026 Florin Road #323",
 * "4201 Highway 11 N" and "3648 FM 1960 Rd. W" all survive untouched.
 *
 * Returns the note as well, so it can be kept rather than silently destroyed.
 */
function stripTrailingNote(text) {
  const value = trimSeparators(text);
  const words = value.split(' ').filter(Boolean);
  if (words.length < 7 || !HOUSE_NUMBER_RE.test(words[0])) {
    return { street: value, note: '' };
  }

  for (let i = 1; i < words.length - 1; i += 1) {
    const word = words[i].toLowerCase().replace(/[.,]+$/, '');
    if (!STREET_SUFFIX_SET[word]) continue;

    const tail = words.slice(i + 1);
    if (tail.length < 5) return { street: value, note: '' };

    let proseHits = 0;
    for (const candidate of tail) {
      if (PROSE_WORDS[candidate.toLowerCase().replace(/[^a-z]/gi, '')]) proseHits += 1;
    }
    if (proseHits < 2) return { street: value, note: '' };

    return {
      street: trimSeparators(words.slice(0, i + 1).join(' ')),
      note: trimSeparators(tail.join(' '))
    };
  }
  return { street: value, note: '' };
}

/**
 * Does this value open like a street? A house number followed by at least one
 * more word. Used to spot a record whose street and city fields are swapped.
 */
function looksLikeStreet(value) {
  const words = trimSeparators(value).split(' ').filter(Boolean);
  if (words.length < 2) return false;
  return HOUSE_NUMBER_RE.test(words[0]);
}

/**
 * Split "2720 N Malinche Ave Laredo" into street and city at the last street
 * suffix. Returns null when there is no confident split.
 */
function splitAtStreetSuffix(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  for (let i = words.length - 2; i >= 1; i -= 1) {
    const word = words[i].toLowerCase().replace(/[.,]+$/, '');
    if (!STREET_SUFFIX_SET[word]) continue;
    const tail = words.slice(i + 1).join(' ');
    if (!looksLikeCity(tail)) return null;
    return { street: words.slice(0, i + 1).join(' '), city: tail };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Collapse whitespace. A line break in pasted text marks a component boundary,
 * so it becomes a comma rather than a space — that is what lets
 * "1500 Wall Street\nBellevue" be split back into street and city.
 */
function normalize(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/[\t\u00A0 ]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+,/g, ',')
    .trim();
}

/**
 * Strip separator punctuation and wrapping quote marks from both ends.
 * Real records carry values like '"1848 Pacific Coast Hwy "', where someone
 * pasted a quoted cell out of a spreadsheet. Straight and curly double quotes
 * and backticks are removed; apostrophes inside a name are untouched because
 * only the ends are trimmed.
 */
function trimSeparators(value) {
  return normalize(value)
    .replace(/^[\s,;:|"\u201C\u201D`]+/, '')
    .replace(/[\s,;:|"\u201C\u201D`]+$/, '')
    .trim();
}

/** Lowercase, punctuation-free — for "are these the same thing?" tests. */
function compareKey(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split on commas, dropping empties. */
function segments(text) {
  return normalize(text).split(',').map(s => s.trim()).filter(Boolean);
}

function isZip(value) {
  return ZIP_ONLY_RE.test(trimSeparators(value));
}

function isStateToken(value) {
  const token = trimSeparators(value);
  if (/^[A-Za-z]{2}$/.test(token) && STATE_CODES[token.toUpperCase()]) return true;
  return Object.prototype.hasOwnProperty.call(STATE_NAMES, token.toLowerCase());
}

function toStateCode(value) {
  const token = trimSeparators(value);
  if (/^[A-Za-z]{2}$/.test(token)) return token.toUpperCase();
  return STATE_NAMES[token.toLowerCase()] || '';
}

/**
 * Normalize whatever is in the state field without ever discarding it.
 *
 * The dropdown carries ISO subdivision codes for anywhere outside the US and
 * Canada — MX-NLE, GB-GRE, IN-TS, DO-13. Those are valid options this code has
 * no name mapping for, so anything it cannot map is passed through as-is
 * rather than blanked.
 */
function cleanStateValue(raw) {
  const token = trimSeparators(raw);
  if (!token) return '';
  return toStateCode(token) || token.toUpperCase();
}

/**
 * Pull a zip out of a field. A digit run that is not 5 or 9 long is a typo
 * (real example: "415813") and is left alone rather than silently truncated
 * into a valid-looking but wrong zip.
 */
function formatZip(value) {
  const text = normalize(value);
  const match = text.match(ZIP_TAIL_RE);
  if (!match) return '';
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

/**
 * Does this segment read like a city name? Used only when recovering a city
 * that no field supplied, so it errs toward saying no.
 */
function looksLikeCity(value) {
  const token = trimSeparators(value);
  if (token.length < 2) return false;
  if (/\d/.test(token)) return false;            // "Suite 605", "2920"
  if (UNIT_WORD_RE.test(token)) return false;    // "Unit D", "PO Box"
  if (isStateToken(token)) return false;         // a bare state code
  return /^[A-Za-z][A-Za-z .'\-]*$/.test(token);
}

// ---------------------------------------------------------------------------
// Harvesting components off the end of a street string
// ---------------------------------------------------------------------------

/**
 * Pull a trailing zip off `text`.
 * `known` (the record's own zip) is removed wherever it matches; an unknown zip
 * is only taken when it is the final token, so "78341 Hwy 25" keeps its number.
 */
function harvestZip(text, known) {
  if (known) {
    const match = text.match(new RegExp(`[\\s,]*${escapeRe(known)}\\s*$`));
    if (match) {
      const rest = trimSeparators(text.slice(0, match.index));
      if (rest) return { text: rest, zip: known };
    }
    return { text, zip: '' };
  }

  const match = text.match(/[\s,]*\b(\d{5})(-\d{4})?\s*$/);
  if (!match) return { text, zip: '' };
  const rest = trimSeparators(text.slice(0, match.index));
  if (!rest) return { text, zip: '' };
  return { text: rest, zip: match[2] ? `${match[1]}${match[2]}` : match[1] };
}

/**
 * Pull a trailing state off `text`, as a code or spelled out.
 * An unknown state is only taken with corroboration: a zip came off the same
 * string, or the state sits behind a comma.
 */
function harvestState(text, known, sawZip) {
  const candidates = [];
  if (known) {
    candidates.push(known);
    for (const name of Object.keys(STATE_NAMES)) {
      if (STATE_NAMES[name] === known) candidates.push(name);
    }
  } else {
    const tail = text.match(/(?:^|[\s,])([A-Za-z]{2})\s*$/);
    if (tail && STATE_CODES[tail[1].toUpperCase()]) candidates.push(tail[1]);
    for (const name of Object.keys(STATE_NAMES)) {
      if (new RegExp(`(?:^|[\\s,])${escapeRe(name)}\\s*$`, 'i').test(text)) {
        candidates.push(name);
      }
    }
  }

  for (const candidate of candidates) {
    const match = text.match(new RegExp(`[\\s,]*\\b${escapeRe(candidate)}\\s*$`, 'i'));
    if (!match) continue;
    const rest = trimSeparators(text.slice(0, match.index));
    if (!rest) continue;
    const commaBound = /,\s*$/.test(text.slice(0, match.index + match[0].length).replace(new RegExp(`${escapeRe(candidate)}\\s*$`, 'i'), ''));
    if (!known && !sawZip && !commaBound) continue;
    return { text: rest, state: toStateCode(candidate) };
  }
  return { text, state: '' };
}

/**
 * Pull a trailing city off `text`.
 * When the city is known it is matched directly, without a leading word break,
 * so the glued "CrockettSherman" paste splits. When it is not known, only a
 * clearly delimited final segment is taken.
 *
 * Either way this needs corroboration — a state or zip already came off, or the
 * city sits behind a comma. Without it, "2231 Avenida De Mesilla" in Mesilla
 * would be truncated to "2231 Avenida De".
 */
function harvestCity(text, known, corroborated) {
  if (known) {
    const commaBound = new RegExp(`,\\s*${escapeRe(known)}\\s*$`, 'i').test(text);
    if (!corroborated && !commaBound) return { text, city: '' };
    const match = text.match(new RegExp(`[\\s,]*${escapeRe(known)}\\s*$`, 'i'));
    if (!match) return { text, city: '' };
    const rest = trimSeparators(text.slice(0, match.index));
    if (!rest) return { text, city: '' };
    return { text: rest, city: known };
  }

  if (!corroborated) return { text, city: '' };

  // Preferred: a comma already marks the boundary.
  const parts = segments(text);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (looksLikeCity(last)) {
      return { text: parts.slice(0, -1).join(', '), city: last };
    }
    return { text, city: '' };
  }

  // Fallback: no comma left, so split at the last street-type suffix.
  const split = splitAtStreetSuffix(text);
  if (split) return { text: split.street, city: split.city };
  return { text, city: '' };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Take whatever is in the five fields, decide what each piece really is, and
 * hand back a tidy set plus the formatted Location Name.
 */
function parseServiceAddress(input) {
  let street = trimSeparators(input.address);
  let line2 = trimSeparators(input.address2);
  let city = trimSeparators(input.city);
  let state = trimSeparators(input.state);
  let zip = trimSeparators(input.zip);

  // "dont have it", "N/A", "unknown" — typed in to get past a required field.
  if (isPlaceholder(street)) street = '';
  if (isPlaceholder(line2)) line2 = '';
  if (isPlaceholder(city)) city = '';
  if (isPlaceholder(zip)) zip = '';

  // The same value in both the street and city boxes is one value entered
  // twice, not two components. Keep it wherever it fits better.
  if (street && city && compareKey(street) === compareKey(city)) {
    if (looksLikeStreet(street)) city = ''; else street = '';
  }

  // --- Pass 1: relocate whole fields that plainly hold the wrong component ---

  // A zip typed into the city or second-line field.
  for (const holder of ['city', 'line2']) {
    const value = holder === 'city' ? city : line2;
    if (value && isZip(value)) {
      if (!zip) zip = value;
      if (holder === 'city') city = ''; else line2 = '';
    }
  }
  // A state typed into the city or second-line field.
  for (const holder of ['city', 'line2']) {
    const value = holder === 'city' ? city : line2;
    if (value && isStateToken(value) && /^[A-Za-z]{2}$/.test(value)) {
      if (!state) state = toStateCode(value);
      if (holder === 'city') city = ''; else line2 = '';
    }
  }

  zip = formatZip(zip);
  state = cleanStateValue(state);

  // Fields swapped: the street sits in the city box while the address box
  // holds something that does not open a street at all — typically a business
  // name. Move the street where it belongs. Whatever was in the address box is
  // set aside as a business name rather than concatenated into the result.
  //
  // The city is deliberately NOT recovered from that leftover. In
  // "Speedy Inspections AND Tire, Inc dba Speedy Tire and Muffler Garland" the
  // city is the last word, but a business ending in "... and Muffler" in a city
  // called "Garland Heights" would split the same way and produce a wrong city.
  // Leaving it blank asks for a human instead of guessing.
  let swappedLeftover = '';
  if (looksLikeStreet(city) && !looksLikeStreet(street)) {
    swappedLeftover = street;
    street = city;
    city = '';
  }

  // The second line sometimes holds the city, or repeats the street.
  if (line2) {
    const key = compareKey(line2);
    if (key && city && key === compareKey(city)) line2 = '';
    else if (key && zip && key === compareKey(zip)) line2 = '';
    else if (key && state && key === compareKey(state)) line2 = '';
    else if (key && compareKey(street) && key === compareKey(street)) line2 = '';
  }

  // Line 2 may itself be a pasted full address while line 1 is short.
  const line2HasMore = line2 && compareKey(line2).length > compareKey(street).length &&
    compareKey(line2).indexOf(compareKey(street)) === 0;
  if (line2HasMore) {
    street = line2;
    line2 = '';
  }

  // --- Pass 2: peel city/state/zip off the end of the street ---
  for (let pass = 0; pass < 3; pass += 1) {
    const before = street;

    const zipResult = harvestZip(street, zip);
    street = zipResult.text;
    if (zipResult.zip && !zip) zip = formatZip(zipResult.zip);
    const sawZip = !!zipResult.zip;

    const stateResult = harvestState(street, state, sawZip);
    street = stateResult.text;
    if (stateResult.state && !state) state = stateResult.state;
    const sawState = !!stateResult.state;

    const cityResult = harvestCity(street, city, sawZip || sawState);
    street = cityResult.text;
    if (cityResult.city && !city) city = cityResult.city;

    if (street === before) break;
  }

  // --- Pass 3: the second line, once the street is settled ---
  if (line2) {
    const key = compareKey(line2);
    const streetKey = compareKey(street);
    const duplicate =
      (city && key === compareKey(city)) ||
      (state && key === compareKey(state)) ||
      (zip && key === compareKey(zip)) ||
      (streetKey && (streetKey.indexOf(key) !== -1 || key.indexOf(streetKey) !== -1));
    if (duplicate) line2 = '';
  }

  // A street that lost everything but still has a second line: promote it.
  if (!street && line2) {
    street = line2;
    line2 = '';
  }

  city = trimSeparators(city);
  if (isZip(city)) city = '';

  // A placeholder like "-" is not an address.
  if (street && !/[A-Za-z0-9]/.test(street)) street = '';

  const noted = stripTrailingNote(street);
  street = noted.street;

  const named = extractBusinessName(street);
  const businessName = named.businessName || swappedLeftover;
  street = named.street;

  const streetPart = [street, line2].filter(Boolean).join(', ');
  const stateZip = [state, zip].filter(Boolean).join(' ');
  const cityPart = [city, stateZip].filter(Boolean).join(', ');

  return {
    locationName: [streetPart, cityPart].filter(Boolean).join(', '),
    businessName,
    removedNote: noted.note,
    cleanAddress: street,
    cleanAddress2: line2,
    cleanCity: city,
    cleanState: state,
    cleanZip: zip
  };
}

// ---------------------------------------------------------------------------
// Workflow entry point
// ---------------------------------------------------------------------------
exports.main = async (event, callback) => {
  const fields = event.inputFields || {};

  const result = parseServiceAddress({
    address: fields.address,
    address2: fields.address2,
    city: fields.city,
    state: fields.state,
    zip: fields.zip
  });

  const changed =
    trimSeparators(fields.address) !== result.cleanAddress ||
    trimSeparators(fields.address2) !== result.cleanAddress2 ||
    trimSeparators(fields.city) !== result.cleanCity ||
    trimSeparators(fields.state) !== result.cleanState ||
    trimSeparators(fields.zip) !== result.cleanZip;

  callback({
    outputFields: {
      locationName: result.locationName,
      businessName: result.businessName,
      removedNote: result.removedNote,
      cleanAddress: result.cleanAddress,
      cleanAddress2: result.cleanAddress2,
      cleanCity: result.cleanCity,
      cleanState: result.cleanState,
      cleanZip: result.cleanZip,
      changed
    }
  });
};

// Exported for the test harness; HubSpot only ever calls exports.main.
exports.parseServiceAddress = parseServiceAddress;
exports.buildLocationName = parseServiceAddress;
