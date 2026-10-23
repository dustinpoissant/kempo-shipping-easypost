import { labelFor } from './services.js';
import { toInches, toOunces } from './units.js';

/*
  What the EasyPost tab of the admin order page works out, with no database and no network so it can be tested alone:
  the parcels an order was packed into, the address to send to, the rates to show and which one the customer chose, the
  tracking page on the carrier's own site, and the row kept for a label that was bought.
*/
const MAX_OUNCES = 150 * 16;

export const CARRIER_TRACKING = {
  USPS: code => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${code}`,
  UPS: code => `https://www.ups.com/track?tracknum=${code}`,
  UPSDAP: code => `https://www.ups.com/track?tracknum=${code}`,
  FedEx: code => `https://www.fedex.com/fedextrack/?trknbr=${code}`,
  DHLExpress: code => `https://www.dhl.com/en/express/tracking.html?AWB=${code}`,
};

/* The carrier's own tracking page, or null for a carrier this does not know (the EasyPost tracking page covers it). */
export const trackingUrl = (carrier, code) => {
  const build = Object.hasOwn(CARRIER_TRACKING, carrier) ? CARRIER_TRACKING[carrier] : null;
  return build && code ? build(encodeURIComponent(code)) : null;
};

/*
  The boxes kempo-shipping packed the order into, as it kept them with the shipping fee: [{ name, length, width, height, weight,
  items }] in the units the store had then (`units`). An order with none (placed before they were kept, or not packed) gives [].
*/
export const parcelsFromFee = fee => ({
  units: fee?.data?.units ?? null,
  parcels: (Array.isArray(fee?.data?.shipments) ? fee.data.shipments : []).map(box => ({
    name: String(box?.name ?? ''),
    length: Number(box?.length) || 0,
    width: Number(box?.width) || 0,
    height: Number(box?.height) || 0,
    weight: Number(box?.weight) || 0,
    items: Number(box?.items) || 0,
  })),
});

/* A parcel typed into the form, in the units sent with it, as the ounces and inches EasyPost takes. Resolves to [message, null] or [null, { ounces, inches }]. */
export const measuresFrom = (parcel, units) => {
  const sides = [parcel?.length, parcel?.width, parcel?.height].map(Number);
  const weight = Number(parcel?.weight);
  if(sides.some(side => !Number.isFinite(side) || side <= 0) || !Number.isFinite(weight) || weight <= 0) return ['Give the length, width, height and weight of the parcel', null];
  const ounces = toOunces(weight, units?.weight);
  const inches = sides.map(side => toInches(side, units?.dimension));
  if(ounces === null || inches.some(side => side === null)) return ['The units of the parcel are not ones a carrier takes', null];
  if(ounces > MAX_OUNCES) return ['That parcel is heavier than carriers take (150 lb)', null];
  return [null, { ounces: Math.max(0.1, Math.round(ounces * 10) / 10), inches: inches.map(side => Math.max(0.1, Math.round(side * 10) / 10)) }];
};

/* Where the order is going, as the shipment's to-address, or null when it has no street and postal code to send to. */
export const destinationFrom = order => {
  const address = order?.data?.shipping;
  if(!address?.line1 || !address?.postalCode) return null;
  return { ...address, country: address.country || 'US', phone: address.phone || order?.billing?.phone || '' };
};

/* The key kempo-shipping gave the customer's choice (`USPS|Ground Advantage`) for a rate EasyPost returned. */
export const choiceKey = rate => `${rate.carrier}|${labelFor(rate.carrier, rate.service)}`;

/* The rates for the page: cheapest first, each with the name the customer saw and whether it is the one they chose. */
export const ratesView = (rates, selected) => rates
  .map(rate => ({ id: rate.id, carrier: rate.carrier, service: rate.service, label: labelFor(rate.carrier, rate.service), cents: Math.round(rate.dollars * 100), days: rate.days, chosen: Boolean(selected) && choiceKey(rate) === selected }))
  .sort((a, b) => a.cents - b.cents);

/* Whether the key is a test key: EasyPost's test keys begin EZTK, production ones EZAK. Nothing else of the key is ever looked at. */
export const keyMode = apiKey => (String(apiKey).startsWith('EZTK') ? 'test' : 'production');

/* The row to keep for a label, from the shipment the purchase answered with. Null when the answer has no label or tracking number. */
export const labelRow = (shipment, { id, orderId, userId, now = new Date() }) => {
  const rate = shipment?.selected_rate;
  const cost = Number(rate?.rate);
  if(!shipment?.id || !shipment?.tracking_code || !shipment?.postage_label?.label_url || !Number.isFinite(cost)) return null;
  const carrier = String(rate.carrier ?? '');
  return {
    id,
    orderId,
    shipmentRef: shipment.id,
    rateRef: String(rate.id ?? ''),
    carrier,
    service: String(rate.service ?? ''),
    serviceLabel: labelFor(carrier, rate.service),
    trackingCode: String(shipment.tracking_code),
    trackingUrl: trackingUrl(carrier, shipment.tracking_code),
    publicTrackingUrl: shipment.tracker?.public_url ?? null,
    labelUrl: String(shipment.postage_label.label_url),
    labelPdfUrl: shipment.postage_label.label_pdf_url ?? null,
    cost: Math.round(cost * 100),
    currency: String(rate.currency ?? 'USD').toUpperCase(),
    mode: shipment.mode === 'production' ? 'production' : 'test',
    parcel: shipment.parcel ? { length: shipment.parcel.length, width: shipment.parcel.width, height: shipment.parcel.height, ounces: shipment.parcel.weight } : null,
    status: 'purchased',
    refundStatus: null,
    purchasedAt: now,
    purchasedBy: userId ?? null,
  };
};
