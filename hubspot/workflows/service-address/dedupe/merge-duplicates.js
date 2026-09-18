#!/usr/bin/env node
/**
 * Executes the merge plan in duplicate-groups.csv.
 *
 *   HUBSPOT_TOKEN=pat-... node dedupe/merge-duplicates.js            # dry run
 *   HUBSPOT_TOKEN=pat-... node dedupe/merge-duplicates.js --execute   # for real
 *   ... --execute --limit 20                                         # first 20 only
 *
 * Dry run is the default and prints exactly what would happen. MERGES CANNOT
 * BE UNDONE, so start with --limit on a handful and check them in the UI.
 *
 * Only rows marked READY are merged. REVIEW rows are skipped — those are the
 * groups where the CW Address IDs conflict, or where no external ID exists to
 * anchor the choice. Change a row's status to READY by hand once you have
 * decided, and re-run.
 *
 * Every merge is appended to merge-log.csv as it happens, so an interrupted
 * run can be reconciled against what actually went through.
 */
const fs = require('fs');
const path = require('path');
const { mergeRecords, sleep } = require('./hubspot.js');

const execute = process.argv.includes('--execute');
const limitFlag = process.argv.indexOf('--limit');
const limit = limitFlag !== -1 ? Number(process.argv[limitFlag + 1]) : Infinity;

/** Minimal CSV reader - handles the quoted fields this file can contain. */
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const header = rows.shift();
  return rows.filter(r => r.length > 1).map(r => {
    const obj = {};
    header.forEach((name, i) => { obj[name] = r[i] === undefined ? '' : r[i]; });
    return obj;
  });
}

(async () => {
  const planFile = path.join(__dirname, 'duplicate-groups.csv');
  if (!fs.existsSync(planFile)) {
    throw new Error('duplicate-groups.csv not found. Run find-duplicates.js first.');
  }

  const plan = readCsv(planFile);
  const ready = plan.filter(row => row.status === 'READY' && row.merge_ids);
  const skipped = plan.length - ready.length;

  const jobs = [];
  for (const row of ready) {
    for (const mergeId of row.merge_ids.split(';').filter(Boolean)) {
      jobs.push({ primary: row.primary_id, merge: mergeId, name: row.location_name });
    }
  }
  const selected = jobs.slice(0, limit);

  console.log(`Plan: ${plan.length} groups, ${ready.length} READY, ${skipped} skipped (REVIEW).`);
  console.log(`${jobs.length} merges available; running ${selected.length}.`);
  console.log(execute ? '\n*** EXECUTING - THIS CANNOT BE UNDONE ***\n' : '\nDRY RUN - nothing will change. Add --execute to apply.\n');

  const logFile = path.join(__dirname, 'merge-log.csv');
  if (execute && !fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, 'timestamp,primary_id,merged_id,location_name,result\n');
  }

  let done = 0;
  let failed = 0;

  for (const job of selected) {
    const label = `${job.merge} -> ${job.primary}  ${job.name}`;
    if (!execute) { console.log('  would merge  ' + label); continue; }

    try {
      await mergeRecords(job.primary, job.merge);
      done += 1;
      console.log('  merged       ' + label);
      fs.appendFileSync(logFile,
        `${new Date().toISOString()},${job.primary},${job.merge},"${String(job.name).replace(/"/g, '""')}",ok\n`);
    } catch (error) {
      failed += 1;
      console.log('  FAILED       ' + label + '  -- ' + error.message.slice(0, 120));
      fs.appendFileSync(logFile,
        `${new Date().toISOString()},${job.primary},${job.merge},"${String(job.name).replace(/"/g, '""')}","${error.message.replace(/"/g, '""').slice(0, 200)}"\n`);
    }
    await sleep(150);
  }

  if (execute) {
    console.log(`\n${done} merged, ${failed} failed. Log: merge-log.csv`);
  } else {
    console.log('\nNothing changed. Re-run with --execute when the plan looks right.');
  }
})().catch(error => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
