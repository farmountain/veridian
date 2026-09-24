import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryIo, nodeIo } from "../core/io.ts";
import { ESI_VERSION, canonicalJson, listEsi, parseEsi } from "../core/metrics/index.ts";
import type { EsiExport } from "../core/metrics/index.ts";

/**
 * The ESI, and the two properties that are the whole of it: it is **byte-stable**, and **nothing the
 * predicate refused reaches it**.
 *
 * Both properties share a failure mode that a single assertion can hide, so each is asserted beside
 * the control that gives it meaning:
 *
 *  - **Byte-stability is not proven by two equal strings.** A writer that built its object in one
 *    order produces equal strings from one code path and different strings the moment a second path
 *    builds the same value in another order. So the export is run twice *and* against an input whose
 *    keys were inserted in the reverse order, and the second comparison is the one that holds.
 *  - **"The document lacks the key" is not proven by the document lacking the key.** It is equally
 *    true of a predicate that refuses everything, of a writer that wrote nothing, and of a fixture
 *    that never carried one. So every refusal is asserted beside a positive control on the input and
 *    beside a sibling that says the export was not empty.
 *
 * The fixtures are built in memory rather than read from `.veridian/`: that directory is gitignored,
 * so a test reading it would pass on this machine and fail on a fresh clone.
 */

const RESULT_PATH = (runId: string): string => `.veridian/runs/${runId}/result.json`;
const ENVIRONMENT_PATH = (runId: string): string => `.veridian/runs/${runId}/environment.json`;

/** The operator's checkout, as an absolute path with a drive letter. */
const CHECKOUT = "D:\\all_projects\\Veridian\\examples\\shopping-cart";

/** Values that exist only to be looked for in the artifact. */
const ARG_SECRET = "--token=shh-the-command-line";
const ENV_SECRET = "Bearer shh-the-inherited-environment";

interface RunScript {
  readonly runId: string;
  readonly goalId: string;
  readonly adapter: string;
  /** The `environment.json` body. Written verbatim so its **key order** is the caller's to choose. */
  readonly environment: Record<string, unknown>;
}

const resultJson = (run: RunScript): string =>
  JSON.stringify({
    run_id: run.runId,
    goal_id: run.goalId,
    state: "COMPLETED",
    verdict: "PASS",
    environmentValid: true,
    criteria: [{ criterion_id: "AC-001", status: "PASS", mandatory: true, missing_evidence: [] }],
    iterations: [{ iteration: 1, verdict: "PASS", criteria: [{ criterion_id: "AC-001", status: "PASS" }] }],
    environment: { adapter: run.adapter, transitions: [] },
  });

const seeded = (runs: readonly RunScript[]): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const run of runs) {
    files[RESULT_PATH(run.runId)] = resultJson(run);
    files[ENVIRONMENT_PATH(run.runId)] = JSON.stringify(run.environment);
  }
  return files;
};

/**
 * A `web` world's document, complete enough that the predicate has something to rule on.
 *
 * It carries a refused key and a rendered one on purpose: `command`/`args`/`env` are the refusals,
 * and `app_path` is the rendering. A fixture with neither would let every assertion below pass while
 * testing nothing.
 */
const environmentDocument = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  adapter: "local-web",
  app: "shopping-cart",
  app_path: `${CHECKOUT}\\app`,
  url: "http://127.0.0.1:4173",
  database_path: null,
  world: { kind: "web", name: "http://127.0.0.1:4173", detail: { address: "http://127.0.0.1:4173" } },
  command: "node",
  args: ["serve.mjs", ARG_SECRET],
  env: { PATH: "/usr/bin", API_TOKEN: ENV_SECRET },
  health: { path: "/health", expectStatus: 200, timeoutMs: 20_000, intervalMs: 100, readyPattern: null },
  reset: { strategy: "restart", command: null },
  browser: { enabled: true, viewport: null, locale: null, timezoneId: null },
  valid: true,
  health_report: { ok: true, message: "ready", attempts: 1, elapsedMs: 12, url: null, statusCode: null, readyPatternSatisfied: null },
  boundary: {
    network: { policy: "deny", allow: [], enforcement: "enforced" },
    filesystem_write: { policy: "sandbox", enforcement: "enforced" },
    crossings: [],
  },
  transitions: [],
  ...overrides,
});

const ONE_RUN: readonly RunScript[] = [
  { runId: "run-01", goalId: "shopping-cart", adapter: "local-web", environment: environmentDocument() },
];

const only = async (files: Record<string, string>): Promise<EsiExport> => {
  const exports = await listEsi(memoryIo(files), ".veridian");
  const first = exports[0];
  assert.ok(first !== undefined, "the history declares one subject, so there is one document");
  return first;
};

describe("the ESI is byte-stable", () => {
  it("produces the same bytes from the same input twice", async () => {
    const first = await only(seeded(ONE_RUN));
    const second = await only(seeded(ONE_RUN));
    assert.equal(first.json, second.json);
  });

  it("produces the same bytes when the input's keys were inserted in a different order", async () => {
    // This is the assertion that gives the one above its meaning. `JSON.stringify` preserves
    // insertion order, so a writer whose stability came from one code path always building its object
    // the same way would pass the first test and fail this one - and the failure would arrive the
    // first time a second reader parsed a bundle whose keys sat in another order.
    const forwards = environmentDocument();
    const backwards = Object.fromEntries(Object.entries(forwards).reverse());

    assert.deepEqual(
      Object.keys(forwards),
      Object.keys(backwards).reverse(),
      "the control: the two fixtures really are in different orders",
    );
    assert.notEqual(JSON.stringify(forwards), JSON.stringify(backwards), "and their raw bytes differ");

    const a = await only(seeded([{ ...(ONE_RUN[0] as RunScript), environment: forwards }]));
    const b = await only(seeded([{ ...(ONE_RUN[0] as RunScript), environment: backwards }]));
    assert.equal(a.json, b.json);
  });

  it("writes the version and the subject into the document rather than leaving them to be inferred", async () => {
    const exported = await only(seeded(ONE_RUN));
    assert.equal(exported.document.esi_version, ESI_VERSION);
    assert.equal(exported.document.subject, "shopping-cart@local-web");
  });
});

describe("the ESI can be read back, and what it says survives the round trip", () => {
  it("parses its own bytes and yields an identity block byte-identical to the one it wrote", async () => {
    // AC-7's first half, read the way it can be read: the *round trip* is lossless. A document the
    // exporter rendered (a `database` world's name, a process world's command line) is not byte-equal
    // to the raw bundle - that is what dENV is for - so the claim that can be true is that reading the
    // bytes back gives exactly what was written.
    const exported = await only(seeded(ONE_RUN));

    const read = parseEsi(exported.json);
    assert.ok(read !== null, "the exporter's own bytes must parse");
    assert.equal(
      canonicalJson(read.world),
      canonicalJson(exported.document.world),
      "the identity block survived the round trip",
    );
  });

  it("carries a world whose shape the reader can check field by field against the bundle", async () => {
    const exported = await only(seeded(ONE_RUN));
    const read = parseEsi(exported.json);
    assert.deepEqual(read?.world, { kind: "web", name: "http://127.0.0.1:4173", detail: { address: "http://127.0.0.1:4173" } });
    // And the source bundle says the same thing here, because a `web` world carries no location -
    // the one kind where dENV's rendering is a no-op, which is why this is the kind to assert it on.
    assert.deepEqual(read?.world, (environmentDocument()["world"] as unknown));
  });

  it("refuses bytes that are not one of its documents, rather than throwing", async () => {
    assert.equal(parseEsi("{ not json"), null);
    assert.equal(parseEsi("[]"), null);
    assert.equal(parseEsi(JSON.stringify({ esi_version: 99, subject: "x", runs: [] })), null);
    assert.equal(parseEsi(JSON.stringify({ esi_version: ESI_VERSION, runs: [] })), null, "no subject");
    assert.notEqual(parseEsi(JSON.stringify({ esi_version: ESI_VERSION, subject: "x", runs: [] })), null);
  });

  it("exports exactly its four functions, so an import path is an edit somebody has to make", async () => {
    // The refusal, held as a roster rather than as a promise. "There is no import here" cannot be
    // asserted by calling something and finding nothing - that assertion passes whatever the module
    // contains. It can be asserted by reading the module's own exports and comparing them with the
    // set they are meant to be, which is the shape `tests/mcp-demo.test.ts` uses to hold that nothing
    // under `core/**` names the MCP surface: a claim about what a file does not contain is held by
    // enumerating what it does.
    //
    // Adding an `importEsi` fails here on purpose. Importing a document built on another machine is
    // phase 08 and it is gated on the isolation substrate, because a reader that could adopt a world
    // would be resolving one on *this* machine and calling it the document's.
    const source = (await nodeIo().readTextFile("core/metrics/esi.ts")) ?? "";
    assert.ok(source.length > 0, "control: the file was read, or the roster below compares nothing");

    const names = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
      (match) => match[1] ?? "",
    );
    assert.deepEqual(names.sort(), ["ESI_VERSION", "esiForSubject", "listEsi", "parseEsi"]);
  });
});

describe("nothing the predicate refused reaches the ESI", () => {
  it("leaves the command line, its arguments and the inherited environment out of the document", async () => {
    const exported = await only(seeded(ONE_RUN));

    // The positive control: the values really are in the bundle this document came from.
    const bundle = JSON.stringify(environmentDocument());
    assert.ok(bundle.includes(ARG_SECRET), "control: the argument is in the input");
    assert.ok(bundle.includes(ENV_SECRET), "control: the environment value is in the input");

    // The values, not the keys. A key check passes for a writer that moved the secret under another
    // name; a value search does not.
    assert.equal(exported.json.includes(ARG_SECRET), false, "the argument reached the artifact");
    assert.equal(exported.json.includes(ENV_SECRET), false, "the environment value reached the artifact");

    // And the sibling, without which "refused everything" passes.
    assert.ok(exported.json.includes("shopping-cart"), "the app name is in the artifact");
    assert.ok(exported.json.includes("http://127.0.0.1:4173"), "the world's address is in the artifact");

    // The refusal is reported rather than rendered, and it names the run it came from - a refusal
    // without a run id is a refusal a reader cannot act on.
    assert.deepEqual(
      exported.refused.map((entry) => entry.key).sort(),
      ["args", "command", "env"],
    );
    assert.ok(exported.refused.every((entry) => entry.run_id === "run-01" && entry.reason.length > 0));
  });

  it("renders the operator's checkout out of the document and records that it did", async () => {
    const exported = await only(seeded(ONE_RUN));
    assert.equal(exported.json.includes("all_projects"), false, "the checkout reached the artifact");

    // Present but not verbatim: a rendered value is still there, which is what tells a reader this is
    // a rewriting rather than a loss.
    const environment = exported.document.runs[0]?.environment;
    assert.equal(environment?.["app_path"], "app");
    assert.deepEqual(
      exported.rendered.map((entry) => entry.path),
      ["app_path"],
    );
  });

  it("reaches the predicate for the subject's own grouping, so the two cannot disagree about it", async () => {
    // `listEsi` reads through `listEliRows`, so the subject string is M1's. Asserted by calling the
    // join directly rather than by restating the format: a second implementation of the key would
    // have to agree here, and the grouping is what makes two goals against one adapter two documents.
    const twoGoals: readonly RunScript[] = [
      { runId: "run-01", goalId: "goal-alpha", adapter: "local-web", environment: environmentDocument() },
      { runId: "run-02", goalId: "goal-beta", adapter: "local-web", environment: environmentDocument() },
    ];
    const exports = await listEsi(memoryIo(seeded(twoGoals)), ".veridian");
    assert.deepEqual(
      exports.map((entry) => entry.document.subject).sort(),
      ["goal-alpha@local-web", "goal-beta@local-web"],
    );
  });

  it("reports a subject whose runs disagree about their world, rather than picking silently", async () => {
    // `world` is a key dENV's own reading found moving on a real subject, so a document that carried a
    // single label and no note would be reporting agreement it did not measure.
    const moved: readonly RunScript[] = [
      { runId: "run-01", goalId: "shopping-cart", adapter: "local-web", environment: environmentDocument() },
      {
        runId: "run-02",
        goalId: "shopping-cart",
        adapter: "local-web",
        environment: environmentDocument({ world: { kind: "web", name: "http://127.0.0.1:5173", detail: { address: "http://127.0.0.1:5173" } } }),
      },
    ];
    const exported = await only(seeded(moved));
    assert.deepEqual(exported.document.world_variants, [
      "web:http://127.0.0.1:4173",
      "web:http://127.0.0.1:5173",
    ]);
    assert.equal(exported.document.world?.name, "http://127.0.0.1:4173", "the first readable run's world");
  });
});
