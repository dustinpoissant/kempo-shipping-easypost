import { labelRow } from './labels.js';

/*
  Buying a label, and asking for the money back. Everything outside EasyPost's answer is handed in (`client`, `save`, `note`,
  `newId`), so this is tested with fakes and never needs EasyPost or a database.

  The browser sends only the shipment and the rate it chose. What is checked here, because the browser can send anything:
  the shipment belongs to this order (it was created with the order's id as its `reference`), has no label yet, and the
  rate is one of its own. The cost kept is the one EasyPost answers with, never one the browser sent.
*/
const buyOnce = async ({ client, orderId, shipmentId, rateId, userId, save, note, newId, now = () => new Date() }) => {
  if(typeof shipmentId !== 'string' || typeof rateId !== 'string' || !shipmentId || !rateId) return [{ code: 400, msg: 'Choose a service to buy' }, null];

  const [lookupError, shipment] = await client.shipment(shipmentId);
  if(lookupError) return [lookupError, null];
  if(shipment?.reference !== orderId) return [{ code: 409, msg: 'These prices were not for this order. Get the prices again' }, null];
  if(shipment.tracking_code || shipment.postage_label) return [{ code: 409, msg: 'A label was already bought for this shipment' }, null];
  if(!(shipment.rates ?? []).some(rate => rate?.id === rateId)) return [{ code: 409, msg: 'That price is no longer available. Get the prices again' }, null];

  const [buyError, bought] = await client.buy(shipmentId, rateId);
  if(buyError) return [buyError, null];

  let row = labelRow(bought, { id: newId(), orderId, userId, now: now() });
  if(!row) return [{ code: 502, msg: `EasyPost answered without a label. Check shipment ${shipmentId} in your EasyPost dashboard` }, null];

  /* The PDF is a nicety: the label is bought either way. */
  const [, converted] = await client.pdf(shipmentId);
  if(converted?.postage_label?.label_pdf_url) row = { ...row, labelPdfUrl: converted.postage_label.label_pdf_url };

  const [saveError] = await save(row);
  if(saveError) return [{ code: 500, msg: `${saveError.msg} Tracking number ${row.trackingCode}; find it in your EasyPost dashboard (${shipmentId}).` }, null];

  await note(row, `Label bought: ${row.carrier} ${row.serviceLabel}, ${new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(row.cost / 100)}${row.mode === 'test' ? ' (test, not charged)' : ''}. Tracking ${row.trackingCode}`);
  return [null, row];
};

/*
  A shipment being bought is locked in this process until the purchase is finished, so two requests for the same shipment that arrive
  together (a double click, a second tab) cannot both reach the carrier: the second is refused while the first is running, and after
  it the usual check (a label already exists) refuses it. Several processes sharing one site would need the database to do this.
*/
const inFlight = new Set();

export const buyLabel = async args => {
  const { shipmentId } = args;
  if(typeof shipmentId === 'string' && shipmentId){
    if(inFlight.has(shipmentId)) return [{ code: 409, msg: 'This label is already being bought' }, null];
    inFlight.add(shipmentId);
  }
  try {
    return await buyOnce(args);
  } finally {
    inFlight.delete(args.shipmentId);
  }
};

/* Asks EasyPost to refund an unused label. The answer is kept as the label's `refundStatus`; EasyPost and the carrier decide the rest. */
export const refundLabel = async ({ client, label, update, note }) => {
  if(label.refundStatus) return [{ code: 409, msg: 'A refund was already asked for' }, null];
  const [error, answer] = await client.refund(label.shipmentRef);
  if(error) return [error, null];
  const refundStatus = String(answer?.refund_status ?? 'submitted');
  const [updateError, row] = await update(label.id, { refundStatus, status: refundStatus === 'rejected' ? label.status : 'refund_requested' });
  if(updateError) return [updateError, null];
  await note(label, `Label refund asked for: ${label.carrier} ${label.serviceLabel}, tracking ${label.trackingCode} (${refundStatus})`);
  return [null, row];
};
