/**
 * HubSpot Workflow — Custom Code Action
 * Object: Service Addresses (p6253239_service_addresses)
 *
 * Cleans the five raw address properties, then builds a formatted Location Name.
 *
 * Input fields to map in the action UI (name them exactly as the left-hand key):
 *   address  -> service_address_7_24
 *   address2 -> service_address_2
 *   city     -> service_city_7_24
 *   state    -> service_state_7_24
 *   zip      -> service_zip_code_7_24
 *   country  -> country                (optional)
 *
 * Output fields to declare (all String, except changed = Boolean):
 *   locationName, cleanAddress, cleanAddress2, cleanCity, cleanState, cleanZip, changed
 */

// ---------------------------------------------------------------------------
// State/province names -> the codes used by service_state_7_24
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

const ZIP_RE = /\b(\d{5})(?:-(\d{4}))?\b/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Collapse newlines/tabs/non-breaking spaces into single spaces and trim. */
function squash(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[​-‍﻿]/g, '')   // zero-width junk from pasted text
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Trim surrounding separator punctuation, but keep a legitimate trailing "." */
function trimSeparators(value) {
  return squash(value).replace(/^[\s,;:|\-]+/, '').replace(/[\s,;:|]+$/, '');
}

/** Lowercase, strip all punctuation — for "are these the same thing?" tests. */
function compareKey(value) {
  return squash(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply `re` to the end of `text`; report whether anything came off. */
function stripTail(text, re) {
  const match = text.match(re);
  if (!match) return { value: text, stripped: false };
  const remainder = trimSeparators(text.slice(0, match.index));
  // Never strip the street down to nothing.
  if (!remainder) return { value: text, stripped: false };
  return { value: remainder, stripped: true };
}

// ---------------------------------------------------------------------------
// Field-level cleaners
// ---------------------------------------------------------------------------

/** Zip: pull the 5-digit (or ZIP+4) code out of whatever was typed. */
function cleanZip(raw) {
  const match = squash(raw).match(ZIP_RE);
  if (!match) return '';
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

/** State: enum values are already codes, so just normalize casing/whitespace. */
function cleanState(raw) {
  const value = trimSeparators(raw);
  if (!value) return '';
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  const mapped = STATE_NAMES[value.toLowerCase()];
  return mapped || value.toUpperCase();
}

/**
 * City: drop trailing commas, a trailing state, and values that are really a
 * zip code sitting in the wrong field.
 */
function cleanCity(raw, state, zip) {
  let city = trimSeparators(raw);
  if (!city) return '';

  // "78041" pasted into the city field.
  if (/^\d{5}(-\d{4})?$/.test(city)) return '';
  if (zip && compareKey(city) === compareKey(zip)) return '';

  // "Laredo, TX" -> "Laredo"
  if (state) {
    city = stripTail(city, new RegExp(`[\\s,]+${escapeRe(state)}\\s*$`, 'i')).value;
  }
  return trimSeparators(city);
}

/**
 * Street: strip a city/state/zip tail that someone pasted in along with the
 * street. Runs in passes because each strip exposes the next one.
 *
 * The city is only removed when there is corroborating evidence — a state or
 * zip already came off, or the city sits behind a comma or a line break.
 * Without that guard "2231 Avenida De Mesilla" in Mesilla would be truncated
 * to "2231 Avenida De".
 */
function cleanStreet(raw, city, state, zip) {
  let street = trimSeparators(raw);
  if (!street) return '';

  // A line break before the city is the same kind of evidence a comma is:
  // it only shows up when a multi-line address block was pasted in.
  const lineBroken =
    !!city &&
    new RegExp(`[\\r\\n]\\s*${escapeRe(city)}\\s*$`, 'i').test(String(raw));

  for (let pass = 0; pass < 3; pass += 1) {
    const before = street;
    let sawCityStateZip = false;

    // 1. Trailing zip — only when it matches the record's own zip.
    if (zip) {
      const result = stripTail(street, new RegExp(`[\\s,]*${escapeRe(zip)}\\s*$`));
      street = result.value;
      sawCityStateZip = sawCityStateZip || result.stripped;
    }

    // 2. Trailing state, as a code or spelled out.
    if (state) {
      const spellings = [state];
      for (const name of Object.keys(STATE_NAMES)) {
        if (STATE_NAMES[name] === state) spellings.push(name);
      }
      for (const spelling of spellings) {
        const result = stripTail(
          street,
          new RegExp(`[\\s,]*\\b${escapeRe(spelling)}\\s*$`, 'i')
        );
        if (result.stripped) {
          street = result.value;
          sawCityStateZip = true;
          break;
        }
      }
    }

    // 3. Trailing city, guarded.
    if (city) {
      const commaGlued = new RegExp(`,\\s*${escapeRe(city)}\\s*$`, 'i').test(street);
      if (sawCityStateZip || commaGlued || lineBroken) {
        // No leading \b: catches the glued "CrockettSherman" paste.
        street = stripTail(street, new RegExp(`[\\s,]*${escapeRe(city)}\\s*$`, 'i')).value;
      }
    }

    if (street === before) break;
  }

  return trimSeparators(street);
}

/** Address 2: drop it when it just repeats another field. */
function cleanAddress2(raw, street, city, state, zip) {
  const line2 = trimSeparators(raw);
  if (!line2) return '';

  const key = compareKey(line2);
  if (!key) return '';

  const duplicates = [street, city, state, zip].map(compareKey).filter(Boolean);
  if (duplicates.indexOf(key) !== -1) return '';

  // Partial repeats: "1159 S Military Trl" vs "1159 S Military Trl Suite 2".
  const streetKey = compareKey(street);
  if (streetKey && (streetKey.indexOf(key) !== -1 || key.indexOf(streetKey) !== -1)) {
    return '';
  }

  return line2;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Clean all five fields and build the formatted one-line address.
 * Pure function — exported separately so it can be unit tested.
 */
function buildLocationName(input) {
  const zip = cleanZip(input.zip);
  const state = cleanState(input.state);
  const city = cleanCity(input.city, state, zip);
  const street = cleanStreet(input.address, city, state, zip);
  const line2 = cleanAddress2(input.address2, street, city, state, zip);

  const streetPart = [street, line2].filter(Boolean).join(', ');
  const stateZip = [state, zip].filter(Boolean).join(' ');
  const cityPart = [city, stateZip].filter(Boolean).join(', ');
  const locationName = [streetPart, cityPart].filter(Boolean).join(', ');

  return {
    locationName,
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

  const result = buildLocationName({
    address: fields.address,
    address2: fields.address2,
    city: fields.city,
    state: fields.state,
    zip: fields.zip
  });

  const changed =
    squash(fields.address) !== result.cleanAddress ||
    squash(fields.address2) !== result.cleanAddress2 ||
    squash(fields.city) !== result.cleanCity ||
    squash(fields.state) !== result.cleanState ||
    squash(fields.zip) !== result.cleanZip;

  callback({
    outputFields: {
      locationName: result.locationName,
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
exports.buildLocationName = buildLocationName;
