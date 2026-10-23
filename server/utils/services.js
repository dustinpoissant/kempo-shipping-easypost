/*
  The services EasyPost can return, and what a customer is shown for them. Pure.

  EasyPost names a rate by its carrier ("USPS", "UPS", "FedEx") and its service ("GroundAdvantage", "Priority",
  "FEDEX_GROUND"). A service is written `Carrier:Service` in the settings. USPS's three below are the ones in EasyPost's
  own documentation examples; the UPS and FedEx names are EasyPost's carrier names as I know them and are
  ASSUMPTIONS to check against what **Test EasyPost** returns for your account (a service not in this list is still
  priced when "other services" is turned on, with its name made readable).
*/
export const KNOWN = [
  { carrier: 'USPS', service: 'GroundAdvantage', label: 'Ground Advantage' },
  { carrier: 'USPS', service: 'Priority', label: 'Priority Mail' },
  { carrier: 'USPS', service: 'Express', label: 'Priority Mail Express' },
  { carrier: 'USPS', service: 'MediaMail', label: 'Media Mail' },
  { carrier: 'USPS', service: 'ParcelSelect', label: 'Parcel Select' },
  { carrier: 'UPS', service: 'Ground', label: 'Ground' },
  { carrier: 'UPS', service: '3DaySelect', label: '3 Day Select' },
  { carrier: 'UPS', service: '2ndDayAir', label: '2nd Day Air' },
  { carrier: 'UPS', service: '2ndDayAirAM', label: '2nd Day Air A.M.' },
  { carrier: 'UPS', service: 'NextDayAirSaver', label: 'Next Day Air Saver' },
  { carrier: 'UPS', service: 'NextDayAir', label: 'Next Day Air' },
  { carrier: 'UPS', service: 'NextDayAirEarlyAM', label: 'Next Day Air Early' },
  { carrier: 'FedEx', service: 'FEDEX_GROUND', label: 'Ground' },
  { carrier: 'FedEx', service: 'GROUND_HOME_DELIVERY', label: 'Home Delivery' },
  { carrier: 'FedEx', service: 'FEDEX_EXPRESS_SAVER', label: 'Express Saver' },
  { carrier: 'FedEx', service: 'FEDEX_2_DAY', label: '2Day' },
  { carrier: 'FedEx', service: 'FEDEX_2_DAY_AM', label: '2Day A.M.' },
  { carrier: 'FedEx', service: 'STANDARD_OVERNIGHT', label: 'Standard Overnight' },
  { carrier: 'FedEx', service: 'PRIORITY_OVERNIGHT', label: 'Priority Overnight' },
  { carrier: 'FedEx', service: 'FIRST_OVERNIGHT', label: 'First Overnight' },
];

export const tokenOf = (carrier, service) => `${carrier}:${service}`;

const LABELS = new Map(KNOWN.map(entry => [tokenOf(entry.carrier, entry.service), entry.label]));

/* Words out of a service name: "GroundAdvantage" and "FEDEX_2_DAY" become "Ground Advantage" and "Fedex 2 Day". */
export const readable = service => String(service)
  .replace(/_/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/([A-Za-z])(\d)/g, '$1 $2')
  .trim()
  .split(/\s+/)
  .map(word => (word === word.toUpperCase() && word.length > 1 && !/\d/.test(word) ? word[0] + word.slice(1).toLowerCase() : word))
  .join(' ');

/* What the customer is shown for a service ("Ground Advantage"), from the list above or made readable. */
export const labelFor = (carrier, service) => LABELS.get(tokenOf(carrier, service)) ?? readable(service);

/* A stored comma list of `Carrier:Service` pairs, once each, in order. Anything that is not a pair is dropped. */
export const parseServices = value => [...new Set(String(value ?? '').split(',').map(part => part.trim()).filter(part => /^[^:\s,]+:[^:\s,]+$/.test(part)))];
