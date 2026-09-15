/**
 * The catalog and the cart, as data.
 *
 * Money is declared the way a catalog is: as a string of dollars with a decimal point. Turning it into
 * whole cents is the *service's* decision rather than this file's, because the API is what states
 * money and the representation it chooses is part of its contract - so the conversion lives in
 * `server.mjs`, beside the routes that publish it.
 *
 * The catalog and the cart are frozen because the service reads them and never writes them. The
 * service's own mutable state is the item map it builds from this catalog at start-up, and that map
 * is rebuilt every time the process is restarted - which is what makes `reset.strategy: restart` a
 * genuinely fresh world rather than a second draft of the previous one.
 */

export const CATALOG = Object.freeze([
  Object.freeze({ sku: "WIDGET", name: "Widget", price: "10.00", quantityOnHand: 30, reorderLevel: 5 }),
  Object.freeze({ sku: "GADGET", name: "Gadget", price: "25.00", quantityOnHand: 4, reorderLevel: 8 }),
  Object.freeze({ sku: "DOODAD", name: "Doodad", price: "5.00", quantityOnHand: 2, reorderLevel: 2 }),
]);

/**
 * What the cart holds. Quantities only - the price of a line is read from the catalog, so a line can
 * never disagree with the item it names.
 *
 * Two widgets at $10.00, three gadgets at $25.00 and six doodads at $5.00 is 12500 cents. That number
 * is derivable from this file and from the catalog, and the criterion that asserts it asserts the
 * arithmetic rather than a constant somebody typed twice.
 */
export const CART = Object.freeze([
  Object.freeze({ sku: "WIDGET", quantity: 2 }),
  Object.freeze({ sku: "GADGET", quantity: 3 }),
  Object.freeze({ sku: "DOODAD", quantity: 6 }),
]);
