# Changelog

All notable changes to `kempo-shipping-easypost` are documented in this file.

## [Unreleased]

### Changed

- **One click is one purchase.** The first click on a Buy label locks every Buy button before the confirmation opens and keeps them locked for a moment after, so a double click is treated as one. The server also locks a shipment while it is being bought, so two requests for it at once buy once (the second is refused with "This label is already being bought").
- **Buying a second label for an order asks first:** when the order already has a label that was not refunded, the confirmation says so and asks if you are sure you want a second one (an order with two boxes has two labels, each bought on its own).

### Added

- **An EasyPost tab on the admin order page** (added through kempo-commerce's `commerce-admin-order-tabs`): get every carrier's price for each box of the order, buy a label, print it again, see the tracking number, cost and purchase time, open the carrier's tracking page, and ask for a refund of an unused label. New `kempoEasypostLabel` table (created on install and update), routes under `/easypost/api/orders/:id/`, and an order-history line for each purchase and refund request. Needs kempo-commerce.

- **Nothing is asked of EasyPost while the customer is typing.** The hook is told `ready` by kempo-shipping; until the address is finished it uses only prices already in its cache and reports the rest as pending (`charge.pending`).
- **Carrier rates for kempo-shipping through EasyPost.** A `kempo-shipping:rates` handler that prices each packed parcel with one EasyPost shipment (rates only, nothing is bought), giving the customer a choice between the USPS, UPS, FedEx and other services you turn on at checkout.
- **An EasyPost tab on the Shipping page:** the API key (replace-only, stored encrypted, never sent back), the services by carrier, other services, residential pricing, how long prices are kept, and **Test EasyPost**, which lists every rate EasyPost returned with its exact service name.
- **A price cache and a 429 backoff** so checkout stays fast and rate requests stay few, and a handler that never throws, so an EasyPost problem leaves the order priced by the store's own rates.
