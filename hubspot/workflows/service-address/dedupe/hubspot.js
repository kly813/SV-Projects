/**
 * Shared HubSpot API helpers for the dedupe scripts.
 *
 * Auth comes from HUBSPOT_TOKEN, a private app access token with
 * crm.objects.custom.read (and .write for the merge script).
 */
const OBJECT_TYPE = 'p6253239_service_addresses';
const BASE = 'https://api.hubapi.com';

const PROPERTIES = [
  'service_address_7_24',
  'service_address_2',
  'service_city_7_24',
  'service_state_7_24',
  'service_zip_code_7_24',
  'location_name',
  'cw_address_id',
  'sv_salesforce_address_id',
  'spotio_address_record_id',
  'hs_createdate'
];

function token() {
  const value = process.env.HUBSPOT_TOKEN;
  if (!value) {
    throw new Error('Set HUBSPOT_TOKEN to a private app access token first.');
  }
  return value;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch with retry. 429 and 5xx back off and retry; everything else throws
 * with the response body, because a silent failure here means a wrong merge.
 */
async function request(path, options = {}, attempt = 1) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (response.status === 429 || response.status >= 500) {
    if (attempt > 5) {
      throw new Error(`${response.status} after 5 attempts on ${path}`);
    }
    const wait = Number(response.headers.get('Retry-After') || 0) * 1000 ||
      Math.min(2 ** attempt * 250, 8000);
    await sleep(wait);
    return request(path, options, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`${response.status} on ${path}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Page through every record.
 *
 * Uses the list endpoint, not search: search caps out at 10,000 results and
 * this object has ~191,000 records.
 */
async function listAllRecords(onProgress) {
  const records = [];
  let after = null;

  do {
    const params = new URLSearchParams({
      limit: '100',
      properties: PROPERTIES.join(',')
    });
    if (after) params.set('after', after);

    const page = await request(`/crm/v3/objects/${OBJECT_TYPE}?${params}`);
    for (const result of page.results) {
      records.push({ id: result.id, ...result.properties });
    }
    after = page.paging && page.paging.next ? page.paging.next.after : null;

    if (onProgress) onProgress(records.length);
    await sleep(120);          // ~8 req/s, well under the 100-per-10s ceiling
  } while (after);

  return records;
}

async function mergeRecords(primaryObjectId, objectIdToMerge) {
  return request(`/crm/v3/objects/${OBJECT_TYPE}/merge`, {
    method: 'POST',
    body: JSON.stringify({ primaryObjectId, objectIdToMerge })
  });
}

module.exports = { OBJECT_TYPE, PROPERTIES, listAllRecords, mergeRecords, sleep };
