const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildLocationName } = require('../cleanServiceAddress.js');

const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8')
);

let failed = 0;
for (const testCase of cases) {
  const actual = buildLocationName(testCase.in).locationName;
  if (actual === testCase.expect) {
    console.log(`  ok   ${testCase.note}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${testCase.note}`);
    console.log(`         expected: ${JSON.stringify(testCase.expect)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
assert.strictEqual(failed, 0, `${failed} case(s) failed`);
