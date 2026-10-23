import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, buildShipment, createClient, ratesFrom } from '../server/utils/easypost.js';
import { toInches, toOunces } from '../server/utils/units.js';
import { KNOWN, labelFor, parseServices, readable, tokenOf } from '../server/utils/services.js';

/* A fake fetch that answers from a list, in order, and remembers what it was asked. */
const fakeFetch = answers => {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if(answer instanceof Error) throw answer;
    const [status, body] = answer;
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
};

const rate = (carrier, service, value, extra = {}) => ({ id: `rate_${carrier}${service}`, carrier, service, rate: value, currency: 'USD', ...extra });
const SHIPMENT = [200, { id: 'shp_1', mode: 'test', rates: [rate('USPS', 'GroundAdvantage', '8.20', { delivery_days: 3 }), rate('USPS', 'Priority', '11.01', { delivery_days: 2 }), rate('USPS', 'Express', '51.20')], messages: [] }];
const origin = { name: 'Kempo Store', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78664', country: 'US' };
const shipment = buildShipment({ origin, destination: { postalCode: '10001', country: 'US' }, ounces: 20, inches: [9, 6, 3.5] });

test('weights and sizes are converted to the ounces and inches EasyPost prices in', () => {
  assert.equal(toOunces(1, 'lb'), 16);
  assert.ok(Math.abs(toOunces(1000, 'g') - 35.274) < 0.001);
  assert.equal(toInches(2.54, 'cm'), 1);
  assert.equal(toOunces(1, 'stone'), null);
});

test('a shipment request names both addresses and the parcel in ounces and inches, as strings', () => {
  assert.deepEqual(shipment, { shipment: {
    to_address: { zip: '10001', country: 'US', residential: true },
    from_address: { name: 'Kempo Store', street1: '1 Main St', city: 'Austin', state: 'TX', zip: '78664', country: 'US' },
    parcel: { length: '9', width: '6', height: '3.5', weight: '20' },
  } });
  const business = buildShipment({ origin, destination: { name: 'Buyer', line1: '5 Oak', line2: 'Apt 2', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' }, ounces: 5, inches: [1, 1, 1], residential: false });
  assert.deepEqual(business.shipment.to_address, { name: 'Buyer', street1: '5 Oak', street2: 'Apt 2', city: 'New York', state: 'NY', zip: '10001', country: 'US' });
});

test('every rate in the answer is read, dollars only, with days when the carrier says, and bad ones are dropped', () => {
  const body = { rates: [
    rate('USPS', 'GroundAdvantage', '8.20', { delivery_days: 3 }), rate('UPS', 'Ground', '12.5', { est_delivery_days: 4 }), rate('FedEx', 'FEDEX_GROUND', '9.99'),
    rate('USPS', 'Priority', '0'), rate('USPS', 'Express', 'free'), rate('DHL', 'Express', '20', { currency: 'EUR' }), { carrier: 'UPS', rate: '5.00', currency: 'USD' }, null,
  ] };
  assert.deepEqual(ratesFrom(body), [
    { id: 'rate_USPSGroundAdvantage', carrier: 'USPS', service: 'GroundAdvantage', dollars: 8.2, days: 3 },
    { id: 'rate_UPSGround', carrier: 'UPS', service: 'Ground', dollars: 12.5, days: 4 },
    { id: 'rate_FedExFEDEX_GROUND', carrier: 'FedEx', service: 'FEDEX_GROUND', dollars: 9.99, days: null },
  ]);
  assert.deepEqual(ratesFrom({}), []);
  assert.deepEqual(ratesFrom(null), []);
});

test('it asks with the key as the Basic username and an empty password, and reads the rates and the mode', async () => {
  const { impl, calls } = fakeFetch([SHIPMENT]);
  const [error, found] = await createClient({ apiKey: 'EZTK_test', fetchImpl: impl }).rates(shipment);
  assert.equal(error, null);
  assert.equal(found.mode, 'test');
  assert.deepEqual(found.rates.map(entry => entry.service), ['GroundAdvantage', 'Priority', 'Express']);
  assert.equal(calls[0].url, `${BASE}/shipments`);
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('EZTK_test:').toString('base64')}`);
  assert.deepEqual(calls[0].body, shipment);
});

test('a 429 stops every call for a minute, then calls resume', async () => {
  let clock = 0;
  const { impl, calls } = fakeFetch([[429, {}], SHIPMENT]);
  const client = createClient({ apiKey: 'k', fetchImpl: impl, now: () => clock });
  assert.equal((await client.rates(shipment))[0].code, 429);
  assert.equal((await client.rates(shipment))[0].code, 429);
  assert.equal(calls.length, 1, 'the second call was not made');
  clock = 61 * 1000;
  assert.equal((await client.rates(shipment))[0], null);
});

test('a bad key, an EasyPost error, no rates and a network failure are errors in plain words, never thrown', async () => {
  const [badKey] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[401, { error: { code: 'UNAUTHORIZED', message: 'x' } }]]).impl }).rates(shipment);
  assert.equal(badKey.code, 401);
  assert.match(badKey.msg, /did not accept the API key/);

  const [rejected] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[422, { error: { code: 'ADDRESS.VERIFY.FAILURE', message: 'Address not found' } }]]).impl }).rates(shipment);
  assert.equal(rejected.code, 422);
  assert.equal(rejected.msg, 'Address not found');

  const [payment] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[402, { error: { message: 'There is a lack of billing information' } }]]).impl }).rates(shipment);
  assert.equal(payment.code, 402);

  const [none] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[200, { mode: 'test', rates: [], messages: [{ carrier: 'UPS', type: 'rate_error', message: 'Missing account' }] }]]).impl }).rates(shipment);
  assert.equal(none.code, 422);
  assert.match(none.msg, /UPS: Missing account/);
  const [noMessage] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[200, { rates: [] }]]).impl }).rates(shipment);
  assert.match(noMessage.msg, /carrier is set up/);

  const [down] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([new Error('ECONNREFUSED')]).impl }).rates(shipment);
  assert.equal(down.code, 502);
  const [html] = await createClient({ apiKey: 'k', fetchImpl: fakeFetch([[503, '<html>down</html>']]).impl }).rates(shipment);
  assert.equal(html.code, 503);
});

test('a service is shown by its known name, or made readable', () => {
  assert.equal(labelFor('USPS', 'GroundAdvantage'), 'Ground Advantage');
  assert.equal(labelFor('FedEx', 'FEDEX_2_DAY'), '2Day');
  assert.equal(labelFor('DHLExpress', 'ExpressWorldwide'), 'Express Worldwide');
  assert.equal(readable('FEDEX_SMART_POST'), 'Fedex Smart Post');
  assert.equal(readable('UPSSaver'), 'UPSSaver');
  assert.equal(readable('2ndDayAir'), '2nd Day Air');
  assert.equal(tokenOf('USPS', 'Priority'), 'USPS:Priority');
  assert.ok(KNOWN.every(entry => labelFor(entry.carrier, entry.service) === entry.label));
});

test('service pairs are read from a comma list, once each, in order, and anything else is dropped', () => {
  assert.deepEqual(parseServices('USPS:Priority, UPS:Ground ,USPS:Priority,nope,A:B:C,:x'), ['USPS:Priority', 'UPS:Ground']);
  assert.deepEqual(parseServices(undefined), []);
});
