/**
 * Shopping cart - the *correct* implementation.
 *
 * This file is checked in correct on purpose. The three deliberate defects the canonical demo
 * detects are an overlay applied at run time by `../defects.ts`, not a second copy of this app
 * kept somewhere else. One app, one truth: a checked-in-defective `cart.js` and a `cart.fixed.js`
 * to repair towards would be two files that drift apart, and the drift would only ever show up as
 * a demo that passes for the wrong reason.
 *
 * `tests/shopping-cart-demo.test.ts` asserts that the three correct forms below are still present,
 * so a run that was interrupted between "inject" and "repair" fails a test instead of quietly
 * becoming the new source of truth.
 *
 * Prices are integers and all arithmetic is rounded to whole cents, so a comparison of the form
 * "$1.60" cannot flake on a floating-point representation. A flaky canonical demo would undermine
 * exactly the property (M1, result consistency) it exists to demonstrate.
 */

/** Unit prices are held in whole dollars; `money()` rounds every derived figure to cents. */
const CATALOGUE = Object.freeze({
  widget: Object.freeze({ name: "Widget", unitPrice: 10 }),
  gadget: Object.freeze({ name: "Gadget", unitPrice: 25 }),
  doodad: Object.freeze({ name: "Doodad", unitPrice: 5 }),
});

/** Sales tax. The jurisdiction this app is deployed into charges 8%. */
const TAX_RATE = 0.08;

const state = { lines: [] };

function priceOf(id) {
  const product = CATALOGUE[id];
  if (product === undefined) throw new Error(`unknown product: ${id}`);
  return product.unitPrice;
}

function lineTotal(line) {
  return priceOf(line.id) * line.qty;
}

function subtotal() {
  return state.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

function tax() {
  return subtotal() * TAX_RATE;
}

function total() {
  return subtotal() + tax();
}

/** Quantities are positive integers; anything a user types that is not one collapses to 1. */
function normaliseQuantity(raw) {
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function addToCart(id, rawQuantity) {
  const quantity = normaliseQuantity(rawQuantity);
  const existing = state.lines.find((line) => line.id === id);
  if (existing === undefined) {
    state.lines.push({ id, qty: quantity });
  } else {
    existing.qty += quantity;
  }
  render();
}

function removeLine(id) {
  state.lines = state.lines.filter((line) => line.id !== id);
  render();
}

function money(value) {
  return `$${(Math.round(value * 100) / 100).toFixed(2)}`;
}

function render() {
  const body = document.querySelector("#cart-body");
  body.replaceChildren();

  for (const line of state.lines) {
    const product = CATALOGUE[line.id];
    const row = document.createElement("tr");
    row.className = "cart-item";
    row.dataset.id = line.id;

    row.appendChild(cell(product.name, "name"));
    row.appendChild(cell(money(product.unitPrice), "amount unit-price"));
    row.appendChild(cell(String(line.qty), "amount qty"));
    row.appendChild(cell(money(lineTotal(line)), "amount line-total"));

    const actions = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.dataset.id = line.id;
    remove.textContent = "Remove";
    actions.appendChild(remove);
    row.appendChild(actions);

    body.appendChild(row);
  }

  setText("#item-count", String(state.lines.length));
  setText("#subtotal", money(subtotal()));
  setText("#tax", money(tax()));
  setText("#total", money(total()));
  document.querySelector("#cart-empty").hidden = state.lines.length > 0;
}

function cell(text, className) {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
}

function setText(selector, text) {
  document.querySelector(selector).textContent = text;
}

function quantityInputFor(id) {
  return document.querySelector(`#qty-${id}`);
}

document.querySelector("#catalogue").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-add]");
  if (button === null) return;
  const id = button.dataset.add;
  addToCart(id, quantityInputFor(id).value);
});

document.querySelector("#cart-body").addEventListener("click", (event) => {
  const button = event.target.closest("button.remove");
  if (button === null) return;
  removeLine(button.dataset.id);
});

render();
