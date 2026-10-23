# kempo-shipping-easypost

Carrier rates for [kempo-shipping](https://github.com/dustinpoissant/kempo-shipping) through [EasyPost](https://www.easypost.com). One API key gives USPS, UPS, FedEx and more, with no carrier sign-ups of your own: EasyPost holds the carrier accounts. Each parcel your order is packed into is priced, and the customer chooses between the services you turn on at checkout, cheapest first.

It adds an **EasyPost** tab to the Shipping page. Nothing is priced by EasyPost until an API key is saved. **Only rates are asked for: nothing is ever bought.**

## Setup

1. Install it from the Extensions screen (it needs kempo-shipping).
2. On **Shipping → General**, fill in **Ship from**, including the postal code. Carriers price from there.
3. Set the weight and size of your products and add your boxes on the **Boxes** tab. A box does not need a price of its own: the carrier prices it.
4. In the EasyPost dashboard, copy an API key. A **test key** is fine to try this (the prices are samples).
5. On **Shipping → EasyPost**, paste the key, choose the services, **Save**, then **Test EasyPost**.

`SETTINGS_ENCRYPTION_KEY` must be set on the server, because the key is stored encrypted. It is never sent back to a browser: the field is always empty, and a blank field on save leaves the stored one alone.

## How it prices

For each parcel kempo-shipping packed (its box, and the weight with the empty box) it creates **one** EasyPost shipment, which returns a price for every service of every carrier on your EasyPost account, and adds a quote `{ carrier: 'USPS', service: 'Ground Advantage', price, days }` for each service you turned on. kempo-shipping then offers the customer every carrier and service that has a quote for **every** parcel of the order, and the **Shipping method** choice at checkout lists them next to your own box prices, cheapest first.

- **Services:** the settings list the common domestic ones by carrier (USPS Ground Advantage, Priority Mail, Priority Mail Express; UPS Ground, 3 Day Select, 2nd Day Air, Next Day Air Saver, Next Day Air; FedEx Ground, Home Delivery, Express Saver, 2Day, Standard and Priority Overnight). **Also offer any other service** adds whatever else EasyPost returns, with its name made readable. Only carriers set up on your EasyPost account return prices (EasyPost gives every account a USPS account).
- **Weight and size** are converted to ounces and inches, with the weight rounded up to the next ounce and sizes to the next tenth of an inch.
- **Residential** is on by default, so the price includes the carriers' home delivery surcharge. Turn it off if you mostly ship to businesses.
- **A parcel EasyPost cannot price** gets no quote from it: no weight, over 150 lb, no ZIP code, a country this does not serve (US, PR, GU, VI, AS and MP are), or a currency other than USD. Your own box prices or the flat rate cover it.
- **Prices are kept for 60 minutes** (a setting) per route, weight and size. EasyPost's free allowance is a number of rate requests per label bought, with a small fee per extra request, so this keeps repeat prices from counting. A 429 stops all requests for a minute.
- **It never stops an order.** Any EasyPost problem means no quote from it, never an error at checkout.

## The EasyPost tab on the order

The admin order page gets an **EasyPost** tab (after Customer, before History). It lists the labels bought for the order and lets staff buy more:

- **Labels:** the service, the tracking number, what EasyPost charged, when it was bought, **Print label** (the PDF, or the PNG if no PDF was made), **Track** (the carrier's own tracking page: USPS, UPS, FedEx and DHL Express; EasyPost's page for any other) and **Ask for refund** for a label that was not used.
- **Buy a label:** each box the order was packed into is a row (the size and weight can be changed, or a parcel added). **Get prices** asks EasyPost for every carrier's price for that parcel, to the order's shipping address, from the Ship From address; the one the customer chose is marked. **Buy label** asks to confirm, then buys it.
- One order can have several labels: each box is its own shipment, so a second box is bought separately. When the order already has a label that was not refunded, **Buy label** first asks "This order already has a label. Are you sure you want a second one?".
- A test key (`EZTK...`) shows a notice: nothing is charged and the labels cannot be used to post a parcel. A production key spends money when **Buy label** is confirmed.
- Every purchase and refund request is a private line in the order's history. Labels are kept in the `kempoEasypostLabel` table, so reprinting and tracking never ask EasyPost again.

Getting prices creates a shipment on EasyPost (nothing is bought); the shipment is created with the order's id as its `reference`, and buying refuses a shipment that is for another order, already has a label, or does not have the chosen rate. The cost kept is the one EasyPost answers with. Viewing needs `shipping:view`, buying and refunding `shipping:manage`.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `easypost_api_key` | — | Secret. The API key (test or production) |
| `easypost_services` | the list above | `Carrier:Service` pairs offered, using EasyPost's names |
| `easypost_other_services` | `false` | Also offer services not in the list |
| `easypost_residential` | `true` | Price as delivered to a home |
| `easypost_cache_minutes` | `60` | How long a price is reused |

Permissions are kempo-shipping's: `shipping:view` sees the tab, `shipping:manage` changes it and runs the test.

## Verify against the real API first

This was written from EasyPost's docs before a key was used here, so a few details are **assumptions to check with the first real call** (**Test EasyPost** does one and shows every service EasyPost returned, with the exact `Carrier:Service` name, so a name that differs from the list is easy to fix):

- the UPS and FedEx service names (USPS's `GroundAdvantage`, `Priority` and `Express` are in EasyPost's own examples);
- that `residential` is accepted on the destination address, and that an address with only a postal code and country is enough to rate;
- which carriers a **test** key returns prices for (the docs say each account has a USPS account; UPS and FedEx may need to be added on your EasyPost account);
- whether rate requests are billed (EasyPost's billing docs say charges are at label purchase; their pricing pages mention a small fee for rating beyond a free allowance).

## Not built yet

Tracking updates (the tab links to the carrier, it does not show scan events), buying a label from the customer's account, address verification, insurance, international rates, restricting rating to certain carrier accounts, and picking a specific carrier account.

## Tests

`npm test` covers the request, the response, the client (Basic auth, the mode, a 429 backoff, errors never thrown) with a fake `fetch`, the quotes (conversion and rounding, caching, skipped parcels, the services offered) and the settings. No EasyPost account is needed.
