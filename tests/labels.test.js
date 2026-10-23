import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, ratesFrom } from '../server/utils/easypost.js';
import { choiceKey, destinationFrom, keyMode, labelRow, measuresFrom, parcelsFromFee, ratesView, trackingUrl } from '../server/utils/labels.js';
import { buyLabel, refundLabel } from '../server/utils/purchase.js';

/* A fake fetch that answers from a list, in order, and remembers what it was asked (GET calls have no body). */
const fakeFetch = answers => {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  return { impl, calls };
};

/* What EasyPost answered to a real purchase on a test key, trimmed to the parts that are read. */
const BOUGHT = {
  id: 'shp_1',
  mode: 'test',
  reference: 'ord_1',
  tracking_code: '9400100208192110168773',
  parcel: { length: 9, width: 6, height: 2, weight: 10 },
  postage_label: { label_url: 'https://files.example/label.png', label_pdf_url: null, label_file_type: 'image/png' },
  selected_rate: { id: 'rate_1', carrier: 'USPS', service: 'GroundAdvantage', rate: '6.40', currency: 'USD' },
  tracker: { public_url: 'https://track.easypost.com/abc' },
};

test('the carrier tracking page is built for the carriers that have one, with the number escaped', () => {
  assert.equal(trackingUrl('USPS', '9400'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400');
  assert.equal(trackingUrl('UPS', '1Z999'), 'https://www.ups.com/track?tracknum=1Z999');
  assert.equal(trackingUrl('FedEx', '7777'), 'https://www.fedex.com/fedextrack/?trknbr=7777');
  assert.equal(trackingUrl('USPS', 'a&b=c'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=a%26b%3Dc');
  assert.equal(trackingUrl('Sendle', '1'), null);
  assert.equal(trackingUrl('constructor', '1'), null);
  assert.equal(trackingUrl('USPS', ''), null);
});

test('the boxes an order was packed into come from its shipping fee, in the units it kept', () => {
  const fee = { data: { units: { weight: 'oz', dimension: 'in' }, shipments: [{ name: 'Small', length: 9, width: 6, height: 3, weight: 12, items: 2 }, { length: '4', width: null }] } };
  const { units, parcels } = parcelsFromFee(fee);
  assert.deepEqual(units, { weight: 'oz', dimension: 'in' });
  assert.deepEqual(parcels[0], { name: 'Small', length: 9, width: 6, height: 3, weight: 12, items: 2 });
  assert.deepEqual(parcels[1], { name: '', length: 4, width: 0, height: 0, weight: 0, items: 0 });
  assert.deepEqual(parcelsFromFee(null), { units: null, parcels: [] });
  assert.deepEqual(parcelsFromFee({ data: { shipments: 'no' } }).parcels, []);
});

test('a typed parcel becomes ounces and inches, and a bad one is explained', () => {
  const [, ok] = measuresFrom({ length: '9', width: 6, height: 2.04, weight: '1' }, { weight: 'lb', dimension: 'in' });
  assert.deepEqual(ok, { ounces: 16, inches: [9, 6, 2] });
  const [, metric] = measuresFrom({ length: 25.4, width: 10, height: 5, weight: 500 }, { weight: 'g', dimension: 'cm' });
  assert.deepEqual(metric.inches, [10, 3.9, 2]);
  assert.equal(metric.ounces, 17.6);
  for(const bad of [{}, { length: 1, width: 1, height: 1 }, { length: 0, width: 1, height: 1, weight: 1 }, { length: 'x', width: 1, height: 1, weight: 1 }, { length: -1, width: 1, height: 1, weight: 1 }]){
    assert.ok(measuresFrom(bad, { weight: 'lb', dimension: 'in' })[0], JSON.stringify(bad));
  }
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 151 }, { weight: 'lb', dimension: 'in' })[0], /heavier/);
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 1 }, { weight: 'stone', dimension: 'in' })[0], /units/);
  assert.match(measuresFrom({ length: 1, width: 1, height: 1, weight: 1 }, undefined)[0], /units/);
  assert.equal(measuresFrom({ length: 0.01, width: 0.01, height: 0.01, weight: 0.001 }, { weight: 'oz', dimension: 'in' })[1].ounces, 0.1);
});

test('the destination is the order shipping address, with a phone from billing, and needs a street and a postal code', () => {
  const order = { data: { shipping: { name: 'Ann', line1: '1 Main', postalCode: '05478' } }, billing: { phone: '555' } };
  assert.deepEqual(destinationFrom(order), { name: 'Ann', line1: '1 Main', postalCode: '05478', country: 'US', phone: '555' });
  assert.equal(destinationFrom({ data: { shipping: { line1: '1 Main' } } }), null);
  assert.equal(destinationFrom({ data: {} }), null);
  assert.equal(destinationFrom(null), null);
});

test('rates are shown cheapest first, with the one the customer chose marked', () => {
  const rates = ratesFrom({ rates: [
    { id: 'r1', carrier: 'USPS', service: 'Priority', rate: '11.01', currency: 'USD', delivery_days: 2 },
    { id: 'r2', carrier: 'USPS', service: 'GroundAdvantage', rate: '6.40', currency: 'USD', delivery_days: 3 },
  ] });
  assert.equal(choiceKey(rates[1]), 'USPS|Ground Advantage');
  const view = ratesView(rates, 'USPS|Ground Advantage');
  assert.deepEqual(view.map(rate => [rate.id, rate.label, rate.cents, rate.chosen]), [['r2', 'Ground Advantage', 640, true], ['r1', 'Priority Mail', 1101, false]]);
  assert.ok(ratesView(rates, '').every(rate => rate.chosen === false));
});

test('a test key is told from a production one by its prefix alone', () => {
  assert.equal(keyMode('EZTK123'), 'test');
  assert.equal(keyMode('EZAK123'), 'production');
  assert.equal(keyMode(''), 'production');
});

test('the row kept for a label has the cost in cents, the tracking and the carrier page, and null when the answer is unusable', () => {
  const when = new Date('2026-10-22T12:00:00Z');
  const row = labelRow(BOUGHT, { id: 'lbl1', orderId: 'ord_1', userId: 'u1', now: when });
  assert.equal(row.cost, 640);
  assert.equal(row.currency, 'USD');
  assert.equal(row.serviceLabel, 'Ground Advantage');
  assert.equal(row.trackingCode, '9400100208192110168773');
  assert.equal(row.trackingUrl, 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100208192110168773');
  assert.equal(row.publicTrackingUrl, 'https://track.easypost.com/abc');
  assert.equal(row.mode, 'test');
  assert.equal(row.purchasedAt, when);
  assert.deepEqual(row.parcel, { length: 9, width: 6, height: 2, ounces: 10 });
  assert.equal(labelRow({ ...BOUGHT, mode: 'production' }, { id: 'x', orderId: 'o' }).mode, 'production');
  assert.equal(labelRow({ ...BOUGHT, tracking_code: null }, { id: 'x', orderId: 'o' }), null);
  assert.equal(labelRow({ ...BOUGHT, postage_label: null }, { id: 'x', orderId: 'o' }), null);
  assert.equal(labelRow({ ...BOUGHT, selected_rate: { rate: 'abc' } }, { id: 'x', orderId: 'o' }), null);
  assert.equal(labelRow(null, { id: 'x', orderId: 'o' }), null);
});

test('the client buys, asks for a PDF, reads a shipment and refunds with the right calls', async () => {
  const { impl, calls } = fakeFetch([[200, BOUGHT], [200, { postage_label: { label_pdf_url: 'https://files.example/label.pdf' } }], [200, BOUGHT], [200, { refund_status: 'submitted' }]]);
  const client = createClient({ apiKey: 'EZTK_test', fetchImpl: impl });
  assert.equal((await client.buy('shp_1', 'rate_1'))[1].tracking_code, BOUGHT.tracking_code);
  assert.equal((await client.pdf('shp_1'))[1].postage_label.label_pdf_url, 'https://files.example/label.pdf');
  assert.equal((await client.shipment('shp_1'))[1].id, 'shp_1');
  assert.equal((await client.refund('shp_1'))[1].refund_status, 'submitted');
  assert.deepEqual(calls.map(call => [call.method, call.url.replace('https://api.easypost.com/v2', '')]), [
    ['POST', '/shipments/shp_1/buy'], ['GET', '/shipments/shp_1/label?file_format=PDF'], ['GET', '/shipments/shp_1'], ['POST', '/shipments/shp_1/refund'],
  ]);
  assert.deepEqual(calls[0].body, { rate: { id: 'rate_1' } });
});

test('the client reports a refused purchase with the message EasyPost gave, and never throws', async () => {
  const refused = createClient({ apiKey: 'k', fetchImpl: fakeFetch([[422, { error: { message: 'Insufficient funds' } }]]).impl });
  assert.deepEqual(await refused.buy('shp_1', 'r'), [{ code: 422, msg: 'Insufficient funds' }, null]);
  const down = createClient({ apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await down.refund('shp_1'), [{ code: 502, msg: 'offline' }, null]);
});

/* A fake client for the purchase: the shipment as EasyPost holds it before buying, and what buying answers. */
const fakeClient = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    shipment: async id => { calls.push(['shipment', id]); return [null, { id, reference: 'ord_1', rates: [{ id: 'rate_1' }, { id: 'rate_2' }] }]; },
    buy: async (id, rateId) => { calls.push(['buy', id, rateId]); return [null, BOUGHT]; },
    pdf: async id => { calls.push(['pdf', id]); return [null, { postage_label: { label_pdf_url: 'https://files.example/label.pdf' } }]; },
    refund: async id => { calls.push(['refund', id]); return [null, { refund_status: 'submitted' }]; },
    ...overrides,
  };
};

const purchase = async (client, extra = {}) => {
  const saved = [];
  const notes = [];
  const result = await buyLabel({ client, orderId: 'ord_1', shipmentId: 'shp_1', rateId: 'rate_1', userId: 'u1', save: async row => { saved.push(row); return [null, row]; }, note: async (row, text) => { notes.push(text); }, newId: () => 'lbl1', ...extra });
  return { result, saved, notes };
};

test('buying checks the shipment, buys the chosen rate, keeps the label with its PDF and notes it in the order history', async () => {
  const client = fakeClient();
  const { result: [error, row], saved, notes } = await purchase(client);
  assert.equal(error, null);
  assert.equal(row.id, 'lbl1');
  assert.equal(row.cost, 640);
  assert.equal(row.labelPdfUrl, 'https://files.example/label.pdf');
  assert.equal(saved.length, 1);
  assert.deepEqual(client.calls.map(call => call[0]), ['shipment', 'buy', 'pdf']);
  assert.deepEqual(client.calls[1], ['buy', 'shp_1', 'rate_1']);
  assert.match(notes[0], /Label bought: USPS Ground Advantage, \$6\.40 \(test, not charged\)\. Tracking 9400100208192110168773/);
});

test('nothing is bought for another order, a shipment that already has a label, a rate it does not have, or no choice', async () => {
  const cases = [
    [fakeClient({ shipment: async id => [null, { id, reference: 'ord_2', rates: [{ id: 'rate_1' }] }] }), {}, 409],
    [fakeClient({ shipment: async id => [null, { id, reference: 'ord_1', tracking_code: 'x', rates: [{ id: 'rate_1' }] }] }), {}, 409],
    [fakeClient({ shipment: async id => [null, { id, reference: 'ord_1', rates: [{ id: 'other' }] }] }), {}, 409],
    [fakeClient(), { rateId: undefined }, 400],
    [fakeClient(), { shipmentId: '' }, 400],
    [fakeClient({ shipment: async () => [{ code: 404, msg: 'Not found' }, null] }), {}, 404],
  ];
  for(const [client, extra, code] of cases){
    const { result: [error], saved } = await purchase(client, extra);
    assert.equal(error?.code, code);
    assert.equal(saved.length, 0);
    assert.ok(!client.calls.some(call => call[0] === 'buy'), 'bought anyway');
  }
});

test('a purchase EasyPost refuses saves nothing, and an answer with no label is reported with the shipment to look for', async () => {
  const refused = await purchase(fakeClient({ buy: async () => [{ code: 422, msg: 'Insufficient funds' }, null] }));
  assert.deepEqual(refused.result, [{ code: 422, msg: 'Insufficient funds' }, null]);
  assert.equal(refused.saved.length, 0);
  const empty = await purchase(fakeClient({ buy: async () => [null, { id: 'shp_1' }] }));
  assert.equal(empty.result[0].code, 502);
  assert.match(empty.result[0].msg, /shp_1/);
});

test('a label that was bought but could not be saved gives the tracking number to find it by, and a missing PDF does not matter', async () => {
  const unsaved = await purchase(fakeClient(), { save: async () => [{ code: 500, msg: 'The label was bought but could not be saved.' }, null] });
  assert.equal(unsaved.result[0].code, 500);
  assert.match(unsaved.result[0].msg, /9400100208192110168773/);
  const noPdf = await purchase(fakeClient({ pdf: async () => [{ code: 502, msg: 'down' }, null] }));
  assert.equal(noPdf.result[1].labelPdfUrl, null);
  assert.equal(noPdf.saved.length, 1);
});

test('a refund is asked for once, kept on the label and noted', async () => {
  const label = { id: 'lbl1', shipmentRef: 'shp_1', carrier: 'USPS', serviceLabel: 'Ground Advantage', trackingCode: '94', status: 'purchased', refundStatus: null };
  const updates = [];
  const notes = [];
  const update = async (id, changes) => { updates.push([id, changes]); return [null, { ...label, ...changes }]; };
  const note = async (row, text) => { notes.push(text); };
  const [error, row] = await refundLabel({ client: fakeClient(), label, update, note });
  assert.equal(error, null);
  assert.deepEqual(updates, [['lbl1', { refundStatus: 'submitted', status: 'refund_requested' }]]);
  assert.equal(row.refundStatus, 'submitted');
  assert.match(notes[0], /refund asked for/i);
  assert.equal((await refundLabel({ client: fakeClient(), label: { ...label, refundStatus: 'submitted' }, update, note }))[0].code, 409);
  assert.equal((await refundLabel({ client: fakeClient({ refund: async () => [{ code: 422, msg: 'Too late' }, null] }), label, update, note }))[0].msg, 'Too late');
  assert.equal(updates.length, 1);
});

test('two purchases of one shipment at the same moment buy once: the second is refused while the first is running', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient({ buy: async (id, rateId) => { client.calls.push(['buy', id, rateId]); await gate; return [null, BOUGHT]; } });
  const first = purchase(client);
  const second = purchase(client);
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const [a, b] = await Promise.all([first, second]);
  const results = [a.result, b.result];
  assert.equal(client.calls.filter(call => call[0] === 'buy').length, 1, 'bought twice');
  assert.equal(results.filter(([error]) => error === null).length, 1);
  assert.equal(results.find(([error]) => error)[0].code, 409);
  assert.equal(a.saved.length + b.saved.length, 1);
  assert.equal((await purchase(fakeClient())).result[0], null, 'the lock was not released');
});
