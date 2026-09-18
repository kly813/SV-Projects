const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseServiceAddress } = require('../cleanServiceAddress.js');

const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8')
);

let failed = 0;
for (const testCase of cases) {
  const result = parseServiceAddress(testCase.in);
  const problems = [];

  if (result.locationName !== testCase.expect) {
    problems.push(
      `locationName expected ${JSON.stringify(testCase.expect)} ` +
      `got ${JSON.stringify(result.locationName)}`
    );
  }

  // Some cases also pin where each component had to land.
  for (const field of Object.keys(testCase.fields || {})) {
    if (result[field] !== testCase.fields[field]) {
      problems.push(
        `${field} expected ${JSON.stringify(testCase.fields[field])} ` +
        `got ${JSON.stringify(result[field])}`
      );
    }
  }

  if (!problems.length) {
    console.log(`  ok   ${testCase.note}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${testCase.note}`);
    for (const problem of problems) console.log(`         ${problem}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
assert.strictEqual(failed, 0, `${failed} case(s) failed`);
