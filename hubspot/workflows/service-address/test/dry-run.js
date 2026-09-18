/**
 * Dry run: prints what the cleaner would produce for a set of exported records,
 * so the output can be eyeballed before any workflow is switched on.
 *
 *   node test/dry-run.js [records.json]
 *
 * Each record: { id, address, address2, city, state, zip, current }
 */
const fs = require('fs');
const path = require('path');
const { buildLocationName } = require('../cleanServiceAddress.js');

const file = process.argv[2] || path.join(__dirname, 'sample-records.json');
const records = JSON.parse(fs.readFileSync(file, 'utf8'));

let fieldEdits = 0;
let shortened = 0;

for (const record of records) {
  const out = buildLocationName(record);
  const edits = [];

  if ((record.address || '') !== out.cleanAddress) {
    edits.push(`address  ${JSON.stringify(record.address || '')} -> ${JSON.stringify(out.cleanAddress)}`);
  }
  if ((record.address2 || '') !== out.cleanAddress2) {
    edits.push(`address2 ${JSON.stringify(record.address2 || '')} -> ${JSON.stringify(out.cleanAddress2)}`);
  }
  if ((record.city || '') !== out.cleanCity) {
    edits.push(`city     ${JSON.stringify(record.city || '')} -> ${JSON.stringify(out.cleanCity)}`);
  }
  if ((record.state || '') !== out.cleanState) {
    edits.push(`state    ${JSON.stringify(record.state || '')} -> ${JSON.stringify(out.cleanState)}`);
  }
  if ((record.zip || '') !== out.cleanZip) {
    edits.push(`zip      ${JSON.stringify(record.zip || '')} -> ${JSON.stringify(out.cleanZip)}`);
  }

  // Flag any street that lost words, so truncation bugs are easy to spot.
  const lostWords =
    String(record.address || '').trim().split(/\s+/).filter(Boolean).length -
    out.cleanAddress.split(/\s+/).filter(Boolean).length;
  const flag = lostWords > 0 ? `  [street lost ${lostWords} word(s) - CHECK]` : '';
  if (lostWords > 0) shortened += 1;

  if (edits.length) fieldEdits += 1;

  console.log(`\n#${record.id}${flag}`);
  console.log(`  was: ${JSON.stringify(record.current || '')}`);
  console.log(`  now: ${JSON.stringify(out.locationName)}`);
  for (const edit of edits) console.log(`       ${edit}`);
}

console.log(`\n${records.length} records | ${fieldEdits} with field edits | ${shortened} with a shortened street`);
