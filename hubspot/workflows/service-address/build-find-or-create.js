// Generates findOrCreateServiceAddress.js from cleanServiceAddress.js so the
// two actions can never drift apart on how an address is normalized.
const fs = require('fs');
const src = fs.readFileSync('cleanServiceAddress.js', 'utf8');

// Keep everything up to the workflow entry point; drop that action's main().
const cut = src.indexOf('// ---------------------------------------------------------------------------\n// Workflow entry point');
if (cut === -1) throw new Error('entry point marker not found');
const shared = src.slice(src.indexOf('const STATE_NAMES'), cut).trimEnd();

const header = `/**
 * HubSpot Workflow — Custom Code Action
 * Object: COMPANY (this runs on the company workflow, not the address one)
 *
 * Replaces "create a Service Address" with "find the existing one, or create
 * it" — then associates the company either way.
 *
 * The current company workflow creates a new Service Address every time a
 * company is built out, so ten companies in one building produce ten records
 * for the same location. Service Addresses are meant to be one per physical
 * location, shared by every company there, so this looks first.
 *
 * SETUP
 *   1. In the action, add a secret named HUBSPOT_TOKEN holding a private app
 *      token with: crm.objects.custom.read, crm.objects.custom.write,
 *      crm.objects.companies.write.
 *   2. Data inputs (name on the left, company property on the right):
 *        address  -> the company's street address
 *        address2 -> address line 2, if you have one
 *        city     -> city
 *        state    -> state/region
 *        zip      -> postal code
 *   3. Data outputs: serviceAddressId (String), locationName (String),
 *      outcome (String), matched (Boolean).
 *
 * Matching uses exactly the same normalization as the address-cleanup action,
 * so "2231 Avenida De Mesilla\\nMesillaNM 88046" and
 * "2231 Avenida De Mesilla Mesilla, NM 88046" resolve to the same record.
 * Run the cleanup workflow across existing records first, or matches will be
 * missed against records still holding messy values.
 */

`;

const tail = `
// ---------------------------------------------------------------------------
// HubSpot API
// ---------------------------------------------------------------------------
const OBJECT_TYPE = 'p6253239_service_addresses';
const API = 'https://api.hubapi.com';

/** Node 18+ has global fetch; older runtimes fall back to axios. */
async function api(path, method, body) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error('Add a secret named HUBSPOT_TOKEN to this action.');

  const url = API + path;
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };

  if (typeof fetch === 'function') {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      throw new Error(response.status + ' on ' + path + ': ' + (await response.text()).slice(0, 300));
    }
    return response.status === 204 ? null : response.json();
  }

  const axios = require('axios');
  const response = await axios({ url, method, headers, data: body });
  return response.data;
}

/** Lowercase, punctuation-free — the key two records must share to be a match. */
function matchKey(locationName) {
  return String(locationName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Narrow the search before comparing. Filtering on zip (or city + state when
 * there is no zip) keeps this to one small page instead of scanning ~191,000
 * records, and the exact decision is still made on the normalized key.
 */
async function findCandidates(parsed) {
  const filters = [];
  if (parsed.cleanZip) {
    filters.push({ propertyName: 'service_zip_code_7_24', operator: 'EQ', value: parsed.cleanZip });
  } else if (parsed.cleanCity) {
    filters.push({ propertyName: 'service_city_7_24', operator: 'EQ', value: parsed.cleanCity });
    if (parsed.cleanState) {
      filters.push({ propertyName: 'service_state_7_24', operator: 'EQ', value: parsed.cleanState });
    }
  } else {
    return [];                       // too little to search on safely
  }

  const result = await api('/crm/v3/objects/' + OBJECT_TYPE + '/search', 'POST', {
    filterGroups: [{ filters }],
    properties: [
      'service_address_7_24', 'service_address_2', 'service_city_7_24',
      'service_state_7_24', 'service_zip_code_7_24', 'location_name'
    ],
    limit: 100
  });
  return result.results || [];
}

async function createServiceAddress(parsed) {
  const created = await api('/crm/v3/objects/' + OBJECT_TYPE, 'POST', {
    properties: {
      service_address_7_24: parsed.cleanAddress,
      service_address_2: parsed.cleanAddress2,
      service_city_7_24: parsed.cleanCity,
      service_state_7_24: parsed.cleanState,
      service_zip_code_7_24: parsed.cleanZip,
      location_name: parsed.locationName
    }
  });
  return created.id;
}

/**
 * Default association, so no association type ID has to be hard-coded here.
 * Re-associating an already-linked pair is a no-op, which makes the whole
 * action safe to re-run.
 */
async function associate(companyId, serviceAddressId) {
  await api(
    '/crm/v4/objects/companies/' + companyId +
    '/associations/default/' + OBJECT_TYPE + '/' + serviceAddressId,
    'PUT'
  );
}

// ---------------------------------------------------------------------------
// Workflow entry point
// ---------------------------------------------------------------------------
exports.main = async (event, callback) => {
  const fields = event.inputFields || {};
  const companyId = event.object && event.object.objectId;
  if (!companyId) throw new Error('No enrolled company id on the event.');

  const parsed = parseServiceAddress({
    address: fields.address,
    address2: fields.address2,
    city: fields.city,
    state: fields.state,
    zip: fields.zip
  });

  // Nothing worth creating a location record for. Do not invent one.
  if (!parsed.locationName || !parsed.cleanAddress) {
    callback({
      outputFields: {
        serviceAddressId: '', locationName: '', matched: false,
        outcome: 'skipped: no usable street address on the company'
      }
    });
    return;
  }

  const key = matchKey(parsed.locationName);
  let serviceAddressId = '';

  for (const candidate of await findCandidates(parsed)) {
    const p = candidate.properties || {};
    const candidateKey = matchKey(parseServiceAddress({
      address: p.service_address_7_24,
      address2: p.service_address_2,
      city: p.service_city_7_24,
      state: p.service_state_7_24,
      zip: p.service_zip_code_7_24
    }).locationName);
    if (candidateKey === key) { serviceAddressId = candidate.id; break; }
  }

  const matched = !!serviceAddressId;
  if (!matched) serviceAddressId = await createServiceAddress(parsed);

  await associate(companyId, serviceAddressId);

  callback({
    outputFields: {
      serviceAddressId,
      locationName: parsed.locationName,
      matched,
      outcome: matched ? 'associated the existing address' : 'created a new address'
    }
  });
};

// Exported for the test harness; HubSpot only ever calls exports.main.
exports.parseServiceAddress = parseServiceAddress;
exports.matchKey = matchKey;
`;

fs.writeFileSync('findOrCreateServiceAddress.js', header + shared + '\n' + tail);
console.log('generated findOrCreateServiceAddress.js');
