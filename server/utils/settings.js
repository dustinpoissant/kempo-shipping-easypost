import { parseServices } from './services.js';

/*
  The extension's settings as pure rules (reading and writing them is config.js), so they can be tested alone.

  The API key is a `secret` setting, so kempo encrypts it. It is never sent to a browser: the settings screen is told only
  whether it is set, and a blank field on save means "unchanged", because the field is always empty (saving the form after
  changing the services must not wipe the key). Clearing it is an explicit `null`.
*/
export const OWNER = 'kempo-shipping-easypost';

export const DEFAULTS = {
  services: parseServices('USPS:GroundAdvantage,USPS:Priority,USPS:Express,UPS:Ground,UPS:3DaySelect,UPS:2ndDayAir,UPS:NextDayAirSaver,UPS:NextDayAir,FedEx:FEDEX_GROUND,FedEx:GROUND_HOME_DELIVERY,FedEx:FEDEX_EXPRESS_SAVER,FedEx:FEDEX_2_DAY,FedEx:STANDARD_OVERNIGHT,FedEx:PRIORITY_OVERNIGHT'),
  otherServices: false,
  residential: true,
  cacheMinutes: 60,
};

const MAX_CACHE_MINUTES = 24 * 60;
const MAX_SERVICES = 200;

const flag = (value, fallback) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback);

/* The settings as stored (every value a string or boolean) in the shape the rest of the extension uses. */
export const fromStored = stored => {
  const minutes = Number(stored.easypost_cache_minutes);
  return {
    apiKey: String(stored.easypost_api_key ?? ''),
    services: parseServices(stored.easypost_services ?? DEFAULTS.services.join(',')),
    otherServices: flag(stored.easypost_other_services, DEFAULTS.otherServices),
    residential: flag(stored.easypost_residential, DEFAULTS.residential),
    cacheMinutes: Number.isFinite(minutes) && minutes >= 0 ? Math.min(Math.floor(minutes), MAX_CACHE_MINUTES) : DEFAULTS.cacheMinutes,
  };
};

export const isConfigured = settings => Boolean(settings.apiKey);

/* Whether the key is a test key, from its prefix (EasyPost's test keys start EZTK). Only a hint for the screen. */
export const looksLikeTestKey = key => /^EZTK/.test(String(key));

/*
  What the settings screen may send, checked. Returns [error, writes] where writes is `{ setting name: value }` for the
  settings to save. `apiKey` is left out when blank (unchanged) and written as '' when null.
*/
export const cleanSettings = body => {
  const writes = {};
  const bad = msg => [{ code: 400, msg }, null];

  if(body.apiKey !== undefined){
    if(body.apiKey === null) writes.easypost_api_key = '';
    else if(typeof body.apiKey !== 'string') return bad('The API key must be text');
    else if(body.apiKey.trim()){
      if(body.apiKey.trim().length > 200 || /\s/.test(body.apiKey.trim())) return bad('That is not an EasyPost API key');
      writes.easypost_api_key = body.apiKey.trim();
    }
  }
  if(body.services !== undefined){
    if(!Array.isArray(body.services) || body.services.length > MAX_SERVICES || body.services.some(service => typeof service !== 'string' || parseServices(service).length !== 1)) return bad('Choose from the services listed');
    writes.easypost_services = [...new Set(body.services)].join(',');
  }
  for(const [field, name] of [['otherServices', 'easypost_other_services'], ['residential', 'easypost_residential']]){
    if(body[field] === undefined) continue;
    if(typeof body[field] !== 'boolean') return bad('That choice must be on or off');
    writes[name] = body[field];
  }
  if(body.cacheMinutes !== undefined){
    const minutes = Number(body.cacheMinutes);
    if(!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_CACHE_MINUTES) return bad(`Keep prices for a whole number of minutes, from 0 to ${MAX_CACHE_MINUTES}`);
    writes.easypost_cache_minutes = minutes;
  }
  return [null, writes];
};
