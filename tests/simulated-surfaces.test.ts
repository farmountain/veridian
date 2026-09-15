import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nodeIo } from "../core/io.ts";
import { CLOUD_SIMULATED_SURFACES } from "../core/environment/cloud-observation.ts";
import { CONTAINER_SIMULATED_SURFACES } from "../core/environment/container-observation.ts";
import { K8S_SIMULATED_SURFACES } from "../core/environment/k8s-observation.ts";
import { OS_SIMULATED_SURFACES } from "../core/environment/os-observation.ts";
import { POSIX_SIMULATED_SURFACES } from "../core/environment/posix-observation.ts";

/**
 * What the distribution document says each world substitutes must be what each world declares.
 *
 * This is the guard for "a document that names a world's surfaces is a claim about a constant", which
 * is the third form of a defect this repository has now paid for three times: `db.query` was named as
 * a database validator in three documents while `DB_VALIDATORS` held four entries; `web.visible` was
 * implemented, registered and named by no document at all because the README printed a shorthand;
 * and `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` said `sim-posix` substitutes *"Kali's attack network"*
 * while `POSIX_SIMULATED_SURFACES` says the opposite in as many words - its `egress` member reads
 * *"the sandbox has no network beyond its own loopback listeners; egress is refused, not routed"*,
 * and `posix-port.ts` refuses the one command that would need one. **A Kali world with no egress has
 * no attack network**: the cell named a surface the world deliberately refuses as though it were a
 * feature, and omitted four the world does declare. It was found by comparing two lists, not by
 * reading the sentence - which read as complete, because three of its four tokens were right.
 *
 * So the document's Simulated column now prints each world's declared names verbatim, and this file
 * reads both sides. It is deliberately two questions rather than one:
 *
 *   - the five worlds that declare surfaces must print **exactly** those surfaces, so a renamed
 *     member fails here rather than in a reader's head;
 *   - a world the document calls **built** must not print a surface name no constant declares, so a
 *     surface cannot be conferred on a world by editing prose.
 *
 * The second question is scoped to rows the document calls `**built**` on purpose. A *planned* world
 * may legitimately describe what it intends to substitute in its own words; what it may not do is
 * present that description as a roster, and a roster is a constant. Order is not asserted, for the
 * reason `tests/readme-rosters.test.ts` gives: a roster is a set, and pinning the document's order
 * against the code's fails on an edit that changed nothing an operator can observe.
 */

const DOC = "docs/DISTRIBUTION-AND-ENVIRONMENTS.md";
const TABLE_HEAD = "| World | Application executes | Simulated | Status |";

const repo = nodeIo();

/** One row of the document's world table, as the table spells it. */
interface WorldRow {
  readonly simulated: string;
  readonly status: string;
}

/** The world table's rows, keyed by the world id each row's first cell names. */
function worldTable(body: string): ReadonlyMap<string, WorldRow> {
  const lines = body.split(/\r?\n/);
  const head = lines.findIndex((line) => line.trim() === TABLE_HEAD);
  assert.notEqual(head, -1, `${DOC} no longer has the world table header row: ${TABLE_HEAD}`);

  // `head` is the column titles and `head + 1` is the separator, so the rows start at `head + 2`,
  // and the table ends at the first line that is not a row. Parsing to the end of the table rather
  // than a fixed number of lines is what lets a world be added without editing this file.
  const rows = new Map<string, WorldRow>();
  for (let index = head + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const world = /`([^`]+)`/.exec(cells[0] ?? "")?.[1] ?? "";
    assert.ok(world.length > 0, `${DOC}'s world table has a row naming no world: ${line}`);
    rows.set(world, { simulated: cells[2] ?? "", status: cells[3] ?? "" });
  }

  // The header was found and the rows were not, which is the one way this parse could pass
  // vacuously. Eleven rows stand in the table; ten is the floor that leaves room for an edit to the
  // table's prose without leaving room for the parse to have silently collected nothing.
  assert.ok(rows.size >= 10, `${DOC}'s world table parsed to ${rows.size} rows`);
  return rows;
}

/** The backticked tokens a cell prints, in the order it prints them. */
function tokensIn(cell: string): readonly string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

/** Each simulated world beside the surfaces its own reading vocabulary declares. */
const DECLARED: readonly (readonly [string, readonly string[]])[] = [
  ["sim-k8s", K8S_SIMULATED_SURFACES],
  ["sim-posix", POSIX_SIMULATED_SURFACES],
  ["sim-os", OS_SIMULATED_SURFACES],
  ["sim-cloud", CLOUD_SIMULATED_SURFACES],
  ["sim-container", CONTAINER_SIMULATED_SURFACES],
];

/** A surface is a lower-case slug: the naming rule every vocabulary in this tree already follows. */
const SURFACE_SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

describe("the document's simulated surfaces are the ones each world declares", () => {
  it("prints exactly the surfaces the constant declares, and no others", async () => {
    const body = await repo.readTextFile(DOC);
    assert.ok(body !== null, `${DOC} could not be read`);
    const rows = worldTable(body);

    for (const [world, declared] of DECLARED) {
      const row = rows.get(world);
      assert.ok(row !== undefined, `${DOC}'s world table has no row for ${world}`);

      const printed = tokensIn(row.simulated);

      // Asked first, and separately, so the failure names the invented surface rather than
      // reporting a set difference: a name the document prints and the constant does not declare is
      // a surface the document has conferred on a world by editing prose.
      for (const token of printed) {
        assert.ok(
          declared.includes(token),
          `${DOC} says ${world} substitutes \`${token}\`. ${world} declares ` +
            `${declared.join(", ")}. A surface is called off by its constant, not by this table.`,
        );
      }

      assert.deepEqual(
        [...printed].sort(),
        [...declared].sort(),
        `${DOC}'s ${world} row disagrees with the constant. Printed: ${printed.join(", ")}. ` +
          `Declared: ${declared.join(", ")}.\n` +
          "A surface in the document and not in the constant is a substitution a reader will " +
          "believe and no reading will record; a surface in the constant and not in the document " +
          "is one nobody will find, which is how egress came to be described as an attack network.",
      );
    }
  });

  it("does not confer a surface on a built world by editing prose", async () => {
    const body = await repo.readTextFile(DOC);
    assert.ok(body !== null, `${DOC} could not be read`);
    const rows = worldTable(body);
    const declared = new Set(DECLARED.map(([world]) => world));

    for (const [world, row] of rows) {
      if (declared.has(world) || !row.status.includes("**built**")) continue;
      assert.deepEqual(
        tokensIn(row.simulated),
        [],
        `${DOC} calls ${world} built and its Simulated cell prints ${tokensIn(row.simulated).join(", ")} ` +
          `as backticked surface names, and no \`*_SIMULATED_SURFACES\` constant declares them. ` +
          "Either the world declares its surfaces, or the cell describes them in prose.",
      );
    }
  });

  it("gives every declared surface a lower-case slug, and no surface twice", async () => {
    // The naming rule the rest of this tree is held to - `container.exitcode` rather than
    // `container.exitCode`, `os-identity` rather than `osIdentity` - applied to the one vocabulary
    // no validator or schema reads. Nothing else would notice a camel-case member: the surfaces are
    // carried into a bundle and quoted by a reader, and a reader does not run a linter.
    for (const [world, surfaces] of DECLARED) {
      assert.ok(surfaces.length > 0, `${world} declares no simulated surfaces`);
      for (const surface of surfaces) {
        assert.match(
          surface,
          SURFACE_SLUG,
          `${world} declares \`${surface}\`, which is not a lower-case slug`,
        );
      }
      assert.equal(
        new Set(surfaces).size,
        surfaces.length,
        `${world} declares a surface twice: ${surfaces.join(", ")}`,
      );
    }
  });
});
