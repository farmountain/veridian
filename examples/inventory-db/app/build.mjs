#!/usr/bin/env node
/**
 * The application under test: a build step that creates an inventory database.
 *
 * A database world has no server and no page. What it has is a *file whose contents are the
 * application's state*, and a command that produces that file from source. That command is the
 * world's `start`: running it is what brings the world into existence, and running it again is what
 * a reset means.
 *
 * It deletes first. A build that only added would accumulate: the second iteration of a run would
 * see the first iteration's rows, and every count in the contract would drift upward until a
 * criterion happened to be satisfied by accident. Deleting is therefore not tidiness - it is the
 * difference between a reproducible world and a world whose contents depend on how many times it has
 * been visited.
 *
 * The store is `node:sqlite`, which ships with Node 22 and needs no dependency. That matters here
 * for the same reason the shopping cart demo has no backend: the demo must be runnable from a clean
 * checkout, so the only thing that can be wrong is the code and the data.
 */

import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * The catalog, in the units a human would write it in: dollars, not cents.
 *
 * `reorderLevel` for Doodad is deliberately equal to its `quantityOnHand`. A product exactly *at*
 * its reorder level is not below it, so it must not appear in the reorder report - which makes
 * the boundary between "<" and "<=" observable rather than a matter of opinion. That single row is
 * what makes AC-003 a real criterion instead of a row count that any population satisfies.
 */
const CATALOG = [
  { sku: "WIDGET", name: "Widget", price: 10, quantityOnHand: 30, reorderLevel: 10 },
  { sku: "GADGET", name: "Gadget", price: 25, quantityOnHand: 4, reorderLevel: 10 },
  { sku: "DOODAD", name: "Doodad", price: 5, quantityOnHand: 8, reorderLevel: 8 },
];

/** Placed orders. Prices are joined from the catalog rather than restated, so a price has one home. */
const ORDER_LINES = [
  { sku: "WIDGET", quantity: 2 },
  { sku: "GADGET", quantity: 3 },
  { sku: "DOODAD", quantity: 6 },
];

/**
 * Money is stored in whole cents and never as a float.
 *
 * A price held as `12.34` is a price that will disagree with itself after the first multiplication,
 * and a contract that says "the total is 12500" would then be describing something the database
 * cannot represent exactly.
 */
function cents(dollars) {
  return Math.round(dollars * 100);
}

const SCHEMA = `
  CREATE TABLE products (
    sku TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    quantity_on_hand INTEGER NOT NULL,
    reorder_level INTEGER NOT NULL
  );
  CREATE TABLE order_lines (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL REFERENCES products (sku),
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL
  );
`;

/**
 * The reorder report, as a table the build maintains.
 *
 * Deriving it into a table rather than leaving it as a view is deliberate: the report is an artifact
 * of the application, so a criterion judges *the application's* answer rather than re-running the
 * query itself and comparing the query with itself. `shortfall` is how many units are missing.
 */
const REORDER_REPORT = `
  CREATE TABLE reorder_items AS
    SELECT sku, reorder_level - quantity_on_hand AS shortfall
      FROM products
    WHERE quantity_on_hand < reorder_level
    ORDER BY sku;
`;

function build(target) {
  rmSync(target, { force: true });

  const db = new DatabaseSync(target);
  try {
    db.exec(SCHEMA);

    const insertProduct = db.prepare(
      "INSERT INTO products (sku, name, unit_price_cents, quantity_on_hand, reorder_level) VALUES (?, ?, ?, ?, ?)",
    );
    for (const item of CATALOG) {
      insertProduct.run(item.sku, item.name, cents(item.price), item.quantityOnHand, item.reorderLevel);
    }

    // The price is read back from the catalog instead of being carried in `ORDER_LINES`, so the
    // order line and the product can never disagree about what something costs.
    const insertLine = db.prepare(
      `INSERT INTO order_lines (sku, quantity, unit_price_cents)
         SELECT ?, ?, unit_price_cents FROM products WHERE sku = ?`,
    );
    for (const line of ORDER_LINES) {
      insertLine.run(line.sku, line.quantity, line.sku);
    }

    db.exec(REORDER_REPORT);

    const products = db.prepare("SELECT COUNT(*) AS n FROM products").get();
    const reorder = db.prepare("SELECT COUNT(*) AS n FROM reorder_items").get();
    return { products: products.n, reorder: reorder.n };
  } finally {
    db.close();
  }
}

const target = process.argv[2] ?? "data.db";
const counts = build(target);

// Read by the environment's `start.readyPattern`, so the run waits for a fact rather than a sleep.
process.stdout.write(`inventory-db ready: ${String(counts.products)} products, ${String(counts.reorder)} to reorder\n`);
