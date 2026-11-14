import { OWNER } from '../settings.js';

/*
  Tells the people who manage shipping that EasyPost is not giving prices: an API key that was refused, an account
  that is out of credit, the service being down. Checkout does not stop (kempo-shipping falls back to the store's own
  table or the flat rate), so nothing else would say it: the store would simply charge the wrong shipping until
  somebody noticed.

  Prices are asked for every time a cart changes, so this raises at most once an hour however many requests fail, and it
  is acknowledged by the first request that is answered again. Both are kept in memory: a restart can raise it once
  more, and nothing worse. `core` is kempo's `createNotification` and `markAcknowledged` (the hook passes them, so this
  file needs no database and a test can stand in for them). Never throws: a notification problem must not turn into a
  pricing problem.

  Only a problem with the account counts (a refused key, no credit, the service down). A parcel EasyPost cannot price,
  an address it does not know and being asked to slow down are the shopper's or the moment's, and say nothing.
*/
const DEDUPE_KEY = 'prices-failing';
const ONCE_PER_MS = 60 * 60 * 1000;
const SETTINGS_URL = '/admin/extension/kempo-shipping/#easypost';

let raisedAt = 0;

/* Whether an error from the client is the account's fault and not the parcel's or the moment's */
export const isAccountProblem = error => [401, 402, 403].includes(error?.code) || error?.code >= 500;

export const pricesFailed = async ({ error, core, now = Date.now }) => {
  if(now() - raisedAt < ONCE_PER_MS) return;
  raisedAt = now();

  try {
    const [raiseError] = await core.createNotification({
      owner: OWNER,
      type: 'banner',
      subtype: 'error',
      mustAcknowledge: true,
      title: 'EasyPost is not giving shipping prices',
      message: `Orders are being charged the store's own shipping instead: ${String(error?.msg || 'EasyPost did not answer')}`.slice(0, 500),
      permission: 'shipping:manage',
      dedupeKey: DEDUPE_KEY,
      actions: [{ label: 'Open the EasyPost settings', href: SETTINGS_URL }],
    });
    if(raiseError) console.error(`[${OWNER}] Could not raise a notification: ${raiseError.msg}`);
  } catch(raiseError) {
    console.error(`[${OWNER}] Could not raise a notification: ${raiseError?.message ?? raiseError}`);
  }
};

export const pricesWorked = async ({ core }) => {
  if(!raisedAt) return;
  raisedAt = 0;

  try {
    await core.markAcknowledged({ owner: OWNER, dedupeKey: DEDUPE_KEY });
  } catch(error) {
    console.error(`[${OWNER}] Could not close a notification: ${error?.message ?? error}`);
  }
};
