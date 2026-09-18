# Service Address dedupe

Finds and merges duplicate Service Address records using HubSpot's own API.
Nothing here needs a paid app — HubSpot's built-in duplicate *detection* only
covers contacts and companies, but the merge endpoint works for custom objects.

## Why this works

Duplicates do not match as raw strings. These two are the same address:

```
2231 Avenida De Mesilla\nMesillaNM 88046     (record 62142100653)
2231 Avenida De Mesilla Mesilla, NM 88046    (record 62055738546)
```

Run both through `cleanServiceAddress.js` and they become the same string, so
fuzzy matching turns into exact matching. That is why these scripts group on the
*cleaned* Location Name rather than the stored one, and why it is worth running
the cleanup workflow first.

## Setup

Create a private app in HubSpot with `crm.objects.custom.read` (plus
`crm.objects.custom.write` for merging) and export its token:

```
export HUBSPOT_TOKEN=pat-na1-...
```

## 1. Find duplicates (read-only)

```
node dedupe/find-duplicates.js
```

Pages through every record (the list endpoint, not search — search caps at
10,000 results and this object has ~191,000). Writes:

- **duplicate-groups.csv** — one row per group: the merge plan
- **duplicate-records.csv** — one row per record, for eyeballing

## 2. Review

Open `duplicate-groups.csv`. Each row is `READY` or `REVIEW`.

Primary selection:

| Situation | Primary | Status |
|---|---|---|
| Exactly one record has a CW Address ID | that record | READY |
| Several share the **same** CW Address ID | oldest of them | READY |
| Several have **different** CW Address IDs | oldest | **REVIEW** |
| No CW ID, one record has another external ID | that record | READY |
| No external ID anywhere | oldest | **REVIEW** |

Conflicting CW Address IDs are never merged automatically — merging them
orphans one ConnectWise link, and that is not recoverable. Decide by hand, then
change the row's status to `READY` and re-run.

## 3. Merge

```
node dedupe/merge-duplicates.js              # dry run, prints the plan
node dedupe/merge-duplicates.js --execute --limit 5
node dedupe/merge-duplicates.js --execute
```

Dry run is the default. **Merges cannot be undone**, so do `--limit 5` first and
check those records in the UI before running the rest. Every merge is appended
to `merge-log.csv` as it happens, so an interrupted run can be reconciled.

## Tests

```
node dedupe/test-primary.js
```

Seven cases covering the primary-selection rule, including the conflicting-CW-ID
case that must never auto-merge.

## Worth knowing

The duplicate pair above was created 36 seconds apart, which means something
automated made both — an integration or an import, not a person. Deduping
treats the symptom. If that source still runs, the duplicates come back.
