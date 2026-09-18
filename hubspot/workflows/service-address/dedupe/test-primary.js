const assert = require('assert');
const { choosePrimary } = require('./find-duplicates.js');

const rec = (id, cw, created, extra = {}) =>
  ({ id: String(id), cw_address_id: cw || '', hs_createdate: created, ...extra });

const cases = [
  { note: 'one record has a CW ID -> that one wins, regardless of age',
    group: [rec(1, '', '2024-01-01'), rec(2, 'CW-500', '2026-09-01')],
    primary: '2', status: 'READY' },

  { note: 'same CW ID on both -> oldest wins',
    group: [rec(1, 'CW-500', '2026-09-01'), rec(2, 'CW-500', '2024-01-01')],
    primary: '2', status: 'READY' },

  { note: 'DIFFERENT CW IDs -> never auto-merge',
    group: [rec(1, 'CW-500', '2024-01-01'), rec(2, 'CW-999', '2026-09-01')],
    primary: '1', status: 'REVIEW' },

  { note: 'no CW ID but one Salesforce ID -> that one wins',
    group: [rec(1, '', '2024-01-01'), rec(2, '', '2026-09-01', { sv_salesforce_address_id: 'SF-7' })],
    primary: '2', status: 'READY' },

  { note: 'no external ID anywhere -> oldest, flagged for review',
    group: [rec(1, '', '2026-09-01'), rec(2, '', '2024-01-01')],
    primary: '2', status: 'REVIEW' },

  { note: 'whitespace-only CW ID does not count as present',
    group: [rec(1, '   ', '2026-09-01'), rec(2, '', '2024-01-01')],
    primary: '2', status: 'REVIEW' },

  { note: 'three records, one with CW ID',
    group: [rec(1, '', '2024-01-01'), rec(2, 'CW-500', '2025-01-01'), rec(3, '', '2023-01-01')],
    primary: '2', status: 'READY' }
];

let failed = 0;
for (const c of cases) {
  const out = choosePrimary(c.group);
  const ok = out.primary.id === c.primary && out.status === c.status;
  if (!ok) { failed++; console.log(`  FAIL ${c.note}\n       got primary=${out.primary.id} status=${out.status}`); }
  else console.log(`  ok   ${c.note}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
assert.strictEqual(failed, 0);
