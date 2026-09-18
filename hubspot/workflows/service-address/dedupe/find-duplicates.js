#!/usr/bin/env node
/**
 * READ-ONLY. Finds duplicate Service Address records and writes a plan.
 *
 *   HUBSPOT_TOKEN=pat-... node dedupe/find-duplicates.js
 *
 * Records are grouped by their CLEANED Location Name, not the stored one.
 * That is the whole point: "2231 Avenida De Mesilla\nMesillaNM 88046" and
 * "2231 Avenida De Mesilla Mesilla, NM 88046" are the same address but do not
 * match as raw strings. Cleaned, both become one key.
 *
 * Writes two files:
 *   duplicate-groups.csv   one row per group - the merge plan
 *   duplicate-records.csv  one row per record - for eyeballing before merging
 *
 * Primary selection, per the rule agreed with the team:
 *   1. exactly one record in the group has a CW Address ID  -> that one
 *   2. several share the SAME CW Address ID                 -> oldest of those
 *   3. several have DIFFERENT CW Address IDs                -> REVIEW, no merge
 *   4. none has a CW Address ID                             -> a record with
 *      another external ID, else the oldest; still marked REVIEW when nothing
 *      external exists to anchor on
 */
const fs = require('fs');
const path = require('path');
const { listAllRecords } = require('./hubspot.js');
const { parseServiceAddress } = require('../cleanServiceAddress.js');

const EXTERNAL_IDS = ['cw_address_id', 'sv_salesforce_address_id', 'spotio_address_record_id'];

function has(record, field) {
  return !!(record[field] && String(record[field]).trim());
}

function oldest(records) {
  return records.slice().sort((a, b) =>
    String(a.hs_createdate || '').localeCompare(String(b.hs_createdate || '')))[0];
}

/** Returns { primary, status, reason }. */
function choosePrimary(group) {
  const withCw = group.filter(r => has(r, 'cw_address_id'));

  if (withCw.length === 1) {
    return { primary: withCw[0], status: 'READY', reason: 'only record with a CW Address ID' };
  }

  if (withCw.length > 1) {
    const distinct = new Set(withCw.map(r => String(r.cw_address_id).trim()));
    if (distinct.size === 1) {
      return {
        primary: oldest(withCw),
        status: 'READY',
        reason: `${withCw.length} records share CW Address ID ${[...distinct][0]}; kept the oldest`
      };
    }
    return {
      primary: oldest(withCw),
      status: 'REVIEW',
      reason: `conflicting CW Address IDs (${[...distinct].join(' / ')}) - merging would orphan one`
    };
  }

  for (const field of EXTERNAL_IDS.slice(1)) {
    const withId = group.filter(r => has(r, field));
    if (withId.length === 1) {
      return { primary: withId[0], status: 'READY', reason: `no CW ID; only record with ${field}` };
    }
  }

  return {
    primary: oldest(group),
    status: 'REVIEW',
    reason: 'no external ID on any record - nothing to anchor the choice on'
  };
}

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, header, rows) {
  const body = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  fs.writeFileSync(file, body + '\n');
}

async function main() {
  process.stdout.write('Fetching records... ');
  const records = await listAllRecords(count => {
    if (count % 2000 === 0) process.stdout.write(count + ' ');
  });
  console.log(`\nFetched ${records.length} records.`);

  const groups = new Map();
  for (const record of records) {
    const parsed = parseServiceAddress({
      address: record.service_address_7_24,
      address2: record.service_address_2,
      city: record.service_city_7_24,
      state: record.service_state_7_24,
      zip: record.service_zip_code_7_24
    });
    const key = parsed.locationName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;                       // nothing to match on
    record._clean = parsed.locationName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const duplicates = [...groups.entries()].filter(([, group]) => group.length > 1);
  duplicates.sort((a, b) => b[1].length - a[1].length);

  const groupRows = [];
  const recordRows = [];
  let ready = 0;
  let review = 0;
  let mergeCount = 0;

  for (const [key, group] of duplicates) {
    const { primary, status, reason } = choosePrimary(group);
    const secondaries = group.filter(r => r.id !== primary.id);
    if (status === 'READY') { ready += 1; mergeCount += secondaries.length; } else { review += 1; }

    groupRows.push([
      key, status, group.length, primary._clean, primary.id,
      primary.cw_address_id || '', secondaries.map(r => r.id).join(';'), reason
    ]);

    for (const record of group) {
      recordRows.push([
        key, record.id === primary.id ? 'PRIMARY' : 'merge-into-primary', record.id,
        record._clean, record.location_name || '', record.cw_address_id || '',
        record.sv_salesforce_address_id || '', record.spotio_address_record_id || '',
        record.hs_createdate || ''
      ]);
    }
  }

  const dir = __dirname;
  writeCsv(path.join(dir, 'duplicate-groups.csv'),
    ['key', 'status', 'record_count', 'location_name', 'primary_id', 'primary_cw_address_id', 'merge_ids', 'reason'],
    groupRows);
  writeCsv(path.join(dir, 'duplicate-records.csv'),
    ['key', 'role', 'record_id', 'cleaned_location_name', 'stored_location_name', 'cw_address_id', 'sv_salesforce_address_id', 'spotio_address_record_id', 'created'],
    recordRows);

  console.log(`\nDuplicate groups: ${duplicates.length}`);
  console.log(`  READY  ${ready} groups -> ${mergeCount} merges`);
  console.log(`  REVIEW ${review} groups -> need a human before merging`);
  console.log('\nWrote duplicate-groups.csv and duplicate-records.csv');
  console.log('Read them before running merge-duplicates.js. Merges cannot be undone.');
}

// Exported so the primary-selection rule can be tested without hitting the API.
module.exports = { choosePrimary };

if (require.main === module) {
  main().catch(error => {
    console.error('\nFailed:', error.message);
    process.exit(1);
  });
}
