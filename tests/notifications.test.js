import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAccountProblem, pricesFailed, pricesWorked } from '../server/utils/notifications/failures.js';
import { quoteParcels, createCache } from '../server/utils/quotes.js';

/* A stand-in for kempo's notification functions that records what it was asked to do. */
const fakeCore = () => {
  const calls = { created: [], acknowledged: [] };
  return {
    calls,
    createNotification: async notification => { calls.created.push(notification); return [null, { notification }]; },
    markAcknowledged: async args => { calls.acknowledged.push(args); return [null, {}]; },
  };
};

const settings = { apiKey: 'k', services: ['USPS:GroundAdvantage'], otherServices: true, residential: true, cacheMinutes: 0 };
const units = { weight: 'lb', dimension: 'in' };
const origin = { name: 'Store', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78664', country: 'US' };
const address = { name: 'Buyer', line1: '5 Oak', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' };
const parcel = () => ({ id: 'p', box: { name: 'Small', length: 7, width: 6, height: 5 }, items: 1, weight: 1.22, quotes: [] });
const price = client => quoteParcels({ parcels: [parcel()], address, origin, units, currency: 'usd', settings, client, cache: createCache() });

test('a refused key, no credit and an outage are the account\'s problem; a parcel it cannot price or a slow-down are not', () => {
  for(const code of [401, 402, 403, 500, 502, 503]) assert.equal(isAccountProblem({ code }), true, String(code));
  for(const code of [400, 404, 422, 429]) assert.equal(isAccountProblem({ code }), false, String(code));
  assert.equal(isAccountProblem(null), false);
});

test('the quote run reports the first account problem and that a request was answered', async () => {
  const refused = await price({ rates: async () => [{ code: 401, msg: 'did not accept the API key' }, null] });
  assert.equal(refused.broken.code, 401);
  assert.equal(refused.answered, false);

  const noPrice = await price({ rates: async () => [{ code: 422, msg: 'no prices for this parcel' }, null] });
  assert.equal(noPrice.broken, null, 'a parcel with no price is not a broken account');
  assert.equal(noPrice.answered, true, 'but the service did answer');

  const worked = await price({ rates: async () => [null, { rates: [{ carrier: 'USPS', service: 'GroundAdvantage', dollars: 8, days: 3 }], mode: 'test', messages: [] }] });
  assert.equal(worked.broken, null);
  assert.equal(worked.answered, true);
});

test('prices failing raises a banner for the people who manage shipping, once an hour however many fail', async () => {
  const core = fakeCore();
  let clock = 10 * 60 * 60 * 1000;
  const now = () => clock;
  await pricesFailed({ error: { code: 401, msg: 'EasyPost did not accept the API key' }, core, now });
  await pricesFailed({ error: { code: 502, msg: 'other' }, core, now });
  clock += 30 * 60 * 1000;
  await pricesFailed({ error: { code: 502, msg: 'other' }, core, now });
  assert.equal(core.calls.created.length, 1, 'once');

  const [banner] = core.calls.created;
  assert.equal(banner.type, 'banner');
  assert.equal(banner.subtype, 'error');
  assert.equal(banner.mustAcknowledge, true);
  assert.equal(banner.permission, 'shipping:manage');
  assert.equal(banner.dedupeKey, 'prices-failing');
  assert.ok(banner.message.includes('did not accept the API key'), banner.message);
  assert.ok(banner.actions[0].href.startsWith('/admin/extension/kempo-shipping/'), JSON.stringify(banner.actions));

  clock += 31 * 60 * 1000;
  await pricesFailed({ error: { code: 502, msg: 'still down' }, core, now });
  assert.equal(core.calls.created.length, 2, 'and again after the hour, naming the latest');
});

test('a request that is answered acknowledges it, and never throws when kempo does', async () => {
  await pricesWorked({ core: fakeCore() });
  const core = fakeCore();
  await pricesWorked({ core });
  assert.equal(core.calls.acknowledged.length, 0, 'nothing was raised, so nothing to close');

  await pricesFailed({ error: { code: 401, msg: 'x' }, core, now: () => 100 * 60 * 60 * 1000 });
  await pricesWorked({ core });
  assert.equal(core.calls.acknowledged.length, 1);
  assert.deepEqual(core.calls.acknowledged[0], { owner: core.calls.created[0].owner, dedupeKey: 'prices-failing' });

  const broken = { createNotification: async () => { throw new Error('boom'); }, markAcknowledged: async () => { throw new Error('boom'); } };
  await pricesFailed({ error: { code: 401, msg: 'x' }, core: broken, now: () => 200 * 60 * 60 * 1000 });
  await pricesWorked({ core: broken });
});
