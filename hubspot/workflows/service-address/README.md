# Service Address — clean & format Location Name

Custom code action for the **Service Addresses** custom object
(`p6253239_service_addresses`, portal 6253239). It normalizes the five raw
address fields, removes duplicated data, then builds a formatted
`location_name`.

```
2720 N Malinche Ave LaredoTX 78043      ->  2720 N Malinche Ave, Laredo, TX 78043
```

## Why a custom code action

Plain property tokens in "Edit record property" concatenate with no separator
and no conditional logic, so you get `LaredoTX`, a stray `, ,` whenever
Service Address 2 is blank, and every trailing space in the source data rides
straight through into the output.

## Property reference (pulled from the portal)

| Field | Internal name | Type |
|---|---|---|
| Service Address 7.24 | `service_address_7_24` | string |
| Service Address 2 | `service_address_2` | string |
| Service City 7.24 | `service_city_7_24` | string |
| Service State 7.24 | `service_state_7_24` | enumeration |
| Service Zip Code 7.24 | `service_zip_code_7_24` | string |
| Location Name | `location_name` | string |
| Country | `country` | enumeration |

`service_state_7_24` internal values match their labels (`TX` = `TX`), so no
label lookup is needed for US/Canada. Mexico and non-North-American options
use ISO subdivision codes (`MX-NLE`, `GB-GRE`, `IN-TS`) which will render
literally — see *Known gaps*.

## What it cleans

Every pattern below was found in live records:

| Problem | Example | Result |
|---|---|---|
| Leading/trailing whitespace | `"78043 "`, `" 3350 Farm to Market 2920"` | trimmed |
| Newlines/tabs inside a value | `"1500 Wall Street\nBellevue"` | collapsed to one space |
| Full address pasted into the street | `"416 S. CrockettSherman, Texas 75090"` | `416 S. Crockett` |
| Spelled-out state in pasted text | `"…, Florida 32839"` | matched to `FL`, removed |
| Address 2 duplicating the street | both `"1159 S Military Trl"` | Address 2 dropped |
| Address 2 holding the city | `"Iron Mountain"` | dropped |
| Zip pasted into the city field | city `"78041 "` | dropped |
| Trailing comma on the city | `"San Antonio,"` | `San Antonio` |
| Blank Address 2 | — | no `, ,` in the output |

## Guard against over-trimming

The street's trailing city is only removed when there is corroborating
evidence of a paste: a state or zip already came off the same string, or the
city sits behind a comma or a line break.

Without that guard `2231 Avenida De Mesilla` in Mesilla, NM would be
truncated to `2231 Avenida De`. That case is in the test suite.

## Workflow setup

1. **Custom code** action (Operations Hub Professional required), Node.js.
   Paste `cleanServiceAddress.js`.
2. Map the input fields — the keys on the left must match exactly:

   | Input name | Property |
   |---|---|
   | `address` | Service Address 7.24 |
   | `address2` | Service Address 2 |
   | `city` | Service City 7.24 |
   | `state` | Service State 7.24 |
   | `zip` | Service Zip Code 7.24 |

3. Declare the outputs: `locationName`, `cleanAddress`, `cleanAddress2`,
   `cleanCity`, `cleanState`, `cleanZip` as **String**, and `changed` as
   **Boolean**.
4. Add **Edit record property** actions mapping each output back to its
   property. Set `location_name` from `locationName`; set the five source
   properties from their `clean*` outputs if you want the underlying data
   fixed too, not just the display string.

Use `changed` in an if/then branch to skip the writes on records that were
already clean.

## Before you enable it on all records

`location_name` is a derived field: it is always meant to hold the formatted
full address, and the workflow overwrites it on every enrolled record. Some
older records still hold a business name there instead (`Builders Academy,
Inc.`, `Millennium Engineers Group Inc`). That is legacy data, not something
to preserve — overwriting it is the point of this workflow. No backup needed.

Still worth a dry run first, to check the cleaner itself against a wide
sample rather than to protect the old values:

```
node test/dry-run.js [your-export.json]
```

It prints old vs. new for each record and flags any street that lost words,
so real truncation bugs stand out. On the bundled sample, the only four
flagged records are the genuine pasted-address duplicates.

## Tests

```
node test/run.js
```

27 cases, all drawn from live records plus edge cases (ZIP+4, missing city,
empty record, street numbers that look like zips, cities that are also street
suffixes).

## Known gaps

- Non-US/Canada states render as their raw code (`MX-NLE`, not `Nuevo León`).
  Add a lookup in `STATE_NAMES` if those matter.
- `country` is read but not appended. Add it to `buildLocationName` if you
  want international addresses to carry the country.
- A street that legitimately ends in its own city name **and** has a pasted
  state/zip tail loses the city twice (e.g. a real "… Mesilla" address in
  Mesilla that also had "NM 88046" pasted on). No live example found.
