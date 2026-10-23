/*
  Talking to the EasyPost API (docs.easypost.com). Nothing here reads settings or the database: it is given the key and a
  `fetch`, so it can be tested with a fake one and EasyPost is never needed.

  What is known (from EasyPost's docs) and what is assumed, so the first live call knows what to check:

  - Base URL https://api.easypost.com/v2, and every request is HTTP Basic with the API key as the username and no
    password. A test key and a production key use the same URL; the shipment that comes back says which `mode` it was.
  - Rates come from creating a Shipment: POST /v2/shipments with `{ shipment: { to_address, from_address, parcel } }`.
    A shipment with valid addresses and a parcel "will automatically populate its rates attribute". Weight is in OUNCES and
    sizes in INCHES (to one decimal). Creating a shipment buys nothing: the label is bought by `buy`, for one of its rates.
  - Each rate has `carrier`, `service`, `rate` (a string of dollars), `currency`, and `delivery_days` (a whole number, when
    the carrier says). A carrier that failed to rate is in the shipment's `messages`, not in `rates`.
  - Errors are `{ error: { code, message } }` with an HTTP status; 429 means too many requests.
  - ASSUMED, to verify with a real key: that `residential` is accepted on the to address, that an address with only a postal
    code and country is enough for a rate, and (see services.js) the UPS and FedEx service names.
*/
export const BASE = 'https://api.easypost.com/v2';

const BACKOFF_MS = 60 * 1000;

const addressOf = ({ name, line1, line2, city, state, postalCode, country, phone }) => ({
  ...(name ? { name: String(name).slice(0, 60) } : {}),
  ...(line1 ? { street1: String(line1).slice(0, 100) } : {}),
  ...(line2 ? { street2: String(line2).slice(0, 100) } : {}),
  ...(city ? { city: String(city).slice(0, 60) } : {}),
  ...(state ? { state: String(state).slice(0, 30) } : {}),
  zip: String(postalCode),
  country: String(country || 'US'),
  ...(phone ? { phone: String(phone).slice(0, 30) } : {}),
});

/* The shipment to create to get a parcel's rates. `ounces` and `inches` are numbers; EasyPost takes them as strings. */
export const buildShipment = ({ origin, destination, ounces, inches, residential = true }) => ({
  shipment: {
    to_address: { ...addressOf(destination), ...(residential ? { residential: true } : {}) },
    from_address: addressOf(origin),
    parcel: { length: String(inches[0]), width: String(inches[1]), height: String(inches[2]), weight: String(ounces) },
  },
});

const asNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/* The rates in a shipment answer: [{ id, carrier, service, dollars, days }], dollars only, dropping anything unreadable. `id` is what buying the label takes. */
export const ratesFrom = body => (Array.isArray(body?.rates) ? body.rates : []).flatMap(rate => {
  const dollars = asNumber(rate?.rate);
  if(typeof rate?.carrier !== 'string' || typeof rate?.service !== 'string' || dollars === null || String(rate.currency ?? 'USD').toUpperCase() !== 'USD') return [];
  const days = Number(rate.delivery_days ?? rate.est_delivery_days);
  return [{ ...(typeof rate.id === 'string' ? { id: rate.id } : {}), carrier: rate.carrier, service: rate.service, dollars, days: Number.isFinite(days) && days > 0 ? days : null }];
});

/*
  A client for one API key. After a 429 it makes no more calls for a minute. It never throws: every method resolves to
  [error, result] like the rest of kempo.

  Verified against a test key (October 2026): POST /shipments/:id/buy with `{ rate: { id } }` answers 200 with the shipment
  carrying `tracking_code`, `postage_label.label_url` (a 4x6 PNG; `label_pdf_url` is null until GET /shipments/:id/label?file_format=PDF
  converts it), `selected_rate` (its `rate` is what was charged) and `tracker.public_url`. POST /shipments/:id/refund answers 200
  with `refund_status`.
*/
export const createClient = ({ apiKey, fetchImpl = globalThis.fetch, now = Date.now }) => {
  let blockedUntil = 0;
  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

  const send = async (method, path, body) => {
    if(blockedUntil > now()) return [{ code: 429, msg: 'EasyPost is limiting requests right now' }, null];
    let answer;
    try {
      const response = await fetchImpl(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: authorization }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* a non-JSON answer is reported by its status */ }
      answer = { status: response.status, ok: response.ok, json };
    } catch(error) {
      return [{ code: 502, msg: error?.message || 'EasyPost could not be reached' }, null];
    }
    if(answer.status === 429){
      blockedUntil = now() + BACKOFF_MS;
      return [{ code: 429, msg: 'EasyPost is limiting requests right now' }, null];
    }
    if(answer.status === 401) return [{ code: 401, msg: 'EasyPost did not accept the API key' }, null];
    if(!answer.ok) return [{ code: answer.status || 502, msg: answer.json?.error?.message || `EasyPost answered ${answer.status}` }, null];
    return [null, answer.json];
  };

  /* Creates a shipment and reads its rates. Nothing is bought. */
  const create = async shipment => {
    const [error, json] = await send('POST', '/shipments', shipment);
    if(error) return [error, null];
    const rates = ratesFrom(json);
    const messages = (Array.isArray(json?.messages) ? json.messages : []).map(message => ({ carrier: message?.carrier ?? '', message: String(message?.message ?? '') })).filter(message => message.message);
    if(!rates.length) return [{ code: 422, msg: messages[0] ? `EasyPost gave no prices. ${messages[0].carrier ? `${messages[0].carrier}: ` : ''}${messages[0].message}` : 'EasyPost gave no prices for this parcel. Check that a carrier is set up on your EasyPost account' }, null];
    return [null, { id: json?.id ?? null, rates, mode: json?.mode ?? null, messages }];
  };

  return {
    create,

    rates: async shipment => {
      const [error, found] = await create(shipment);
      if(error) return [error, null];
      const { rates, mode, messages } = found;
      return [null, { rates, mode, messages }];
    },

    /* One shipment as EasyPost holds it, to check it before buying. */
    shipment: id => send('GET', `/shipments/${encodeURIComponent(id)}`),

    /* Buys the label for one of a shipment's rates. This is the call that spends money on a production key. */
    buy: (id, rateId) => send('POST', `/shipments/${encodeURIComponent(id)}/buy`, { rate: { id: rateId } }),

    /* The same label as a PDF: resolves to the shipment, whose `postage_label.label_pdf_url` is then set. */
    pdf: id => send('GET', `/shipments/${encodeURIComponent(id)}/label?file_format=PDF`),

    refund: id => send('POST', `/shipments/${encodeURIComponent(id)}/refund`),
  };
};
