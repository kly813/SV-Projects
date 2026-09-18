/**
 * Exercises findOrCreateServiceAddress against a stubbed HubSpot API, so the
 * create-vs-associate decision is tested without touching the portal.
 */
const assert = require('assert');
process.env.HUBSPOT_TOKEN = 'test-token';

function stubApi(existingRecords) {
  const calls = { searched: 0, created: [], associated: [] };
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    const ok = data => ({ ok: true, status: 200, json: async () => data, text: async () => '' });

    if (url.includes('/search')) {
      calls.searched += 1;
      const filters = body.filterGroups[0].filters;
      const results = existingRecords.filter(r =>
        filters.every(f => (r.properties[f.propertyName] || '') === f.value));
      return ok({ results });
    }
    if (options.method === 'POST') {
      calls.created.push(body.properties);
      return ok({ id: '999000' });
    }
    if (options.method === 'PUT') {
      calls.associated.push(url.split('/').slice(-3).join('/'));
      return { ok: true, status: 204, json: async () => null, text: async () => '' };
    }
    throw new Error('unexpected call: ' + url);
  };
  return calls;
}

const existing = [{
  id: '62142100653',
  properties: {
    // Deliberately messy, as it sits in the portal today.
    service_address_7_24: '2231 Avenida De Mesilla',
    service_address_2: '',
    service_city_7_24: 'Mesilla ',
    service_state_7_24: 'NM',
    service_zip_code_7_24: '88046',
    location_name: '2231 Avenida De Mesilla\nMesillaNM 88046'
  }
}];

async function run(label, inputFields, records, expect) {
  delete require.cache[require.resolve('../findOrCreateServiceAddress.js')];
  const calls = stubApi(records);
  const mod = require('../findOrCreateServiceAddress.js');
  let out;
  await mod.main({ inputFields, object: { objectId: '5001' } }, r => { out = r.outputFields; });

  const problems = [];
  if (out.matched !== expect.matched) problems.push(`matched ${out.matched} want ${expect.matched}`);
  if (calls.created.length !== expect.created) problems.push(`created ${calls.created.length} want ${expect.created}`);
  if (calls.associated.length !== expect.associated) problems.push(`associated ${calls.associated.length} want ${expect.associated}`);
  if (expect.id && out.serviceAddressId !== expect.id) problems.push(`id ${out.serviceAddressId} want ${expect.id}`);

  if (problems.length) { console.log('  FAIL ' + label + '\n        ' + problems.join('; ')); return 1; }
  console.log('  ok   ' + label + '  -> ' + out.outcome);
  return 0;
}

(async () => {
  let failed = 0;

  failed += await run('messy existing record is matched, not duplicated',
    { address: '2231 Avenida De Mesilla', city: 'Mesilla', state: 'NM', zip: '88046' },
    existing, { matched: true, created: 0, associated: 1, id: '62142100653' });

  failed += await run('second company at the same address reuses it',
    { address: '2231 Avenida De Mesilla ', city: ' Mesilla', state: 'nm', zip: '88046 ' },
    existing, { matched: true, created: 0, associated: 1, id: '62142100653' });

  failed += await run('company address pasted as one blob still matches',
    { address: '2231 Avenida De Mesilla, Mesilla, NM 88046', city: '', state: '', zip: '' },
    existing, { matched: true, created: 0, associated: 1, id: '62142100653' });

  failed += await run('different street in the same zip creates a new record',
    { address: '900 Pine Rd', city: 'Mesilla', state: 'NM', zip: '88046' },
    existing, { matched: false, created: 1, associated: 1 });

  failed += await run('nothing existing at all creates and associates',
    { address: '100 Main St', city: 'Austin', state: 'TX', zip: '78701' },
    [], { matched: false, created: 1, associated: 1 });

  failed += await run('company with no address creates nothing',
    { address: '', city: '', state: '', zip: '' },
    existing, { matched: false, created: 0, associated: 0 });

  failed += await run('placeholder address creates nothing',
    { address: 'N/A', city: 'unknown', state: '', zip: '' },
    existing, { matched: false, created: 0, associated: 0 });

  console.log(`\n${7 - failed}/7 passed`);
  assert.strictEqual(failed, 0);
})();
