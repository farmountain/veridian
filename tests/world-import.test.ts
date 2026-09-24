import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryIo, nodeIo } from "../core/io.ts";
import { loadSchemaSet, type SchemaSet } from "../core/schema/index.ts";
import {
  ESI_VERSION,
  canonicalJson,
  esiForSubject,
  exportDocument,
  importWorld,
  isImportRefusal,
  listEliRows,
  parseEsi,
  readImportDocument,
} from "../core/metrics/index.ts";
import type { EsiDocument } from "../core/metrics/index.ts";
import { finalizeEnvironment, type EnvironmentPlan, type ImportDeclaration } from "../core/environment/index.ts";
import { DefinitionError } from "../core/goal/index.ts";
import { environmentRecord, evidenceCompleteness, serializeEnvironment } from "../core/evidence/index.ts";
import { EnvironmentManager } from "../core/environment/manager.ts";
import type { EnvironmentAdapter } from "../core/environment/types.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

/**
 * The import half: a world is **adopted**, or it is not presented at all.
 *
 * Phase 08's acceptance criterion is one sentence - *an import is staged at `prepare()`* - and the
 * way it can be asserted is by making the pair of states it talks about reachable and then reading
 * what each one produces:
 *
 *  - A plan whose document **declares** an import and whose `adopted` is `null` is a world nobody
 *    verified. `EnvironmentManager.prepare` refuses it, so every criterion is `INCONCLUSIVE` and
 *    **never** `PASS`. That is the falsification, and it is the reason `imported` and `adopted` are
 *    two fields rather than one: with one field, "declared and unstaged" and "declared nothing" have
 *    the same value and the second is what a run reports.
 *  - A plan whose document declared an import and was **adopted** is judged normally. This is the
 *    negative control, and without it every assertion above would pass for a guard that refused
 *    everything.
 *
 * The fixtures are built in memory and against the real schema registry, so nothing here reads
 * `.veridian/`, which is gitignored and would make this suite pass on this machine and fail on a
 * fresh clone.
 */

const SOURCE = {
  path: "examples/shopping-cart/veridian-mvp.yaml",
  dir: "examples/shopping-cart",
  text: "",
} as const;

/**
 * What a relative `$.import.from` resolves to, so a fixture and the loader agree about the path.
 *
 * Written as a constant rather than recomputed per test because the *point* of the resolution is
 * asserted on its own, and a helper here would make that assertion compare a function with itself.
 */
const RESOLVED_FROM = "examples/shopping-cart/exported/cart.esi.json";

const LIMITS = {
  maxIterations: 10,
  maxRuntimeMs: 600_000,
  maxCriterionMs: 60_000,
  networkPolicy: "deny",
  networkAllowList: [],
  filesystemWrite: "sandbox",
} as const;

const schemas = async (): Promise<SchemaSet> => loadSchemaSet(nodeIo());

/** The operator's own document, as the loader would receive it once the protocol has settled it. */
const document = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  adapter: "local-process",
  app: "examples/shopping-cart",
  start: { command: "node", args: ["serve.mjs"] },
  process: { host: "loopback", root: "sandbox" },
  import: null,
  ...overrides,
});

const readPlan = async (
  raw: Record<string, unknown>,
  adopted: Parameters<typeof finalizeEnvironment>[4] = null,
): Promise<EnvironmentPlan> => finalizeEnvironment(raw, await schemas(), SOURCE, LIMITS, adopted);

/** The world's own identity, as it leaves: through the predicate, never read off the bundle. */
const identityOf = (plan: EnvironmentPlan): unknown =>
  exportDocument(serializeEnvironment(environmentRecord(plan, null, [], true, {
    network: "enforced",
    filesystemWrite: "enforced",
    substrate: null,
    crossings: [],
  }))).document["world"];

/** An interchange document whose identity block is exactly this plan's, as the export would write it. */
const esiOf = async (plan: EnvironmentPlan, subject = "shopping-cart@local-process"): Promise<EsiDocument> => {
  const rows = await listEliRows(memoryIo({}), ".veridian");
  assert.equal(rows.rows.length, 0, "control: an empty history produces no rows, so the fixture is ours");
  const json = JSON.stringify({
    esi_version: ESI_VERSION,
    subject,
    world: identityOf(plan),
    world_variants: [],
    runs: [{ run_id: "run-01", verdict: "PASS", state: "COMPLETED", iteration_count: 1, environment: {} }],
  });
  const parsed = parseEsi(json);
  assert.ok(parsed !== null, "control: the fixture is a document this build can read");
  return parsed;
};

describe("an import is a verification, not a materialisation", () => {
  it("adopts a world whose own document produces the identity the interchange document named", async () => {
    const plan = await readPlan(document());
    const adopted = importWorld(await esiOf(plan), { from: "exported/cart.esi.json" }, plan);

    assert.ok(!isImportRefusal(adopted), `expected an adoption, got: ${JSON.stringify(adopted)}`);
    assert.equal(adopted.world, "process:loopback");
    assert.equal(adopted.subject, "shopping-cart@local-process");
    assert.equal(adopted.runs, 1);
    // The identity is stored as **canonical JSON of what the predicate rendered**, which is what
    // makes AC-7's byte-identity check a string comparison rather than a second rendering rule.
    assert.equal(adopted.identity, canonicalJson(identityOf(plan)));
  });

  it("refuses a document that names a different world, and names the fact that differs", async () => {
    const plan = await readPlan(document());
    const other: EsiDocument = {
      ...(await esiOf(plan)),
      world: { kind: "cloud", name: "acct-cart", detail: { provider: "aws", account: "acct-cart" } },
    };

    const refused = importWorld(other, { from: "exported/other.esi.json" }, plan);
    assert.ok(isImportRefusal(refused), "a document naming a different world must not be adopted");
    assert.equal(refused.path, "$.import.from");
    // Names the fact rather than reporting "they differ": the operator has to go and look at one of
    // the two documents, and a message that leaves them diffing two JSON blobs by eye is not a
    // refusal anybody can act on.
    assert.match(refused.message, /the world's kind differs/);
    assert.match(refused.message, /`cloud`/);
    assert.match(refused.message, /`process`/);
  });

  it("refuses a document with no identity block, because there is nothing to adopt into", async () => {
    const plan = await readPlan(document());
    const nameless: EsiDocument = { ...(await esiOf(plan)), world: null };

    const refused = importWorld(nameless, { from: "exported/nameless.esi.json" }, plan);
    assert.ok(isImportRefusal(refused));
    assert.match(refused.message, /names no world/);
  });

  it("refuses when this document declares no world of its own, rather than adopting into nothing", async () => {
    // A world with no `process` block, no `url` and no `databasePath` has no identity, so there is
    // nothing for a document to be *the same as*. The refusal has to say that instead of reporting a
    // mismatch against an empty identity, which would read as a document problem rather than a
    // document problem **and** a missing declaration. The document is built from a world *with* an
    // identity, because a nameless document would be refused one branch earlier and this assertion
    // would pass without ever reaching the branch it is about.
    const worldless = await readPlan(document({ process: null }));
    assert.equal(identityOf(worldless), null, "control: this plan declares no world");
    const refused = importWorld(await esiOf(await readPlan(document())), { from: RESOLVED_FROM }, worldless);
    assert.ok(isImportRefusal(refused));
    assert.match(refused.message, /declares no world/);
    assert.match(refused.message, /`process` world called `loopback`/, "and names what it was offered");
  });

  it("reads nothing rather than throwing when the declared document does not exist", async () => {
    const refused = await readImportDocument(memoryIo({}), { from: "exported/missing.esi.json" });
    assert.ok(isImportRefusal(refused));
    assert.match(refused.message, /no interchange document exists at exported\/missing\.esi\.json/);
  });

  it("refuses bytes that are not an interchange document, naming the path", async () => {
    const io = memoryIo({ "exported/broken.esi.json": "{ not json" });
    const refused = await readImportDocument(io, { from: "exported/broken.esi.json" });
    assert.ok(isImportRefusal(refused));
    assert.match(refused.message, /is not an interchange document this build can read/);
  });
});

describe("the loader refuses an adoption that does not belong to the declaration", () => {
  it("refuses an adoption record for a document this plan did not declare", async () => {
    const plan = await readPlan(document());
    const adopted = importWorld(await esiOf(plan), { from: "exported/cart.esi.json" }, plan);
    assert.ok(!isImportRefusal(adopted), "control: the adoption below is a real one");

    // The document declares no import at all, so an adoption reaching the loader has nothing to be
    // an adoption *of* - and a plan carrying one would report an adoption for a document its own
    // text never named.
    await assert.rejects(
      () => readPlan(document({ import: null }), adopted),
      (error: unknown) => error instanceof DefinitionError && /declares no import at all/.test(error.message),
    );
  });

  it("refuses an import declaration with no source, rather than defaulting to no import", async () => {
    // The default that would otherwise be taken is `no import`, which is the answer that makes the
    // run look ordinary - so a declaration nobody can read is refused rather than swallowed.
    await assert.rejects(
      () => readPlan(document({ import: { from: "   " } })),
      (error: unknown) =>
        error instanceof DefinitionError &&
        /names no document/.test(error.message) &&
        /\$\.import\.from/.test(error.message),
    );
  });

  it("resolves the declared path against the environment file, not the process's directory", async () => {
    const plan = await readPlan(document({ import: { from: "../exported/cart.esi.json" } }));
    assert.ok(plan.imported !== null);
    assert.equal(plan.imported.from, "examples/exported/cart.esi.json");
    // And the pair is exactly the state `prepare()` refuses: declared, and not staged.
    assert.equal(plan.adopted, null);
  });
});

/**
 * A declaration and the adoption of it, produced together so the two paths cannot drift.
 *
 * The loader resolves `$.import.from` against the environment file, so a fixture that wrote the
 * *unresolved* string into the record would be refused for a reason that has nothing to do with what
 * it is testing. Measured here: three subtests, before this helper existed, all failing on
 * `exported/cart.esi.json` against `examples/shopping-cart/exported/cart.esi.json`.
 */
const declaredAndAdopted = async (): Promise<{
  readonly declared: EnvironmentPlan;
  readonly adopted: NonNullable<EnvironmentPlan["adopted"]>;
}> => {
  const declared = await readPlan(document({ import: { from: "exported/cart.esi.json" } }));
  assert.ok(declared.imported !== null, "control: the fixture declares an import");
  const adopted = importWorld(await esiOf(await readPlan(document())), declared.imported, declared);
  assert.ok(!isImportRefusal(adopted), `control: the fixture is adoptable (${JSON.stringify(adopted)})`);
  return { declared, adopted };
};

describe("an import is staged at prepare(), and the bundle says so or the run is INCONCLUSIVE", () => {
  it("records the adoption only once a world was adopted, and writes it into environment.json", async () => {
    const { declared, adopted } = await declaredAndAdopted();
    assert.equal(declared.adopted, null, "the declaration alone stages nothing");

    const staged = await readPlan(document({ import: { from: "exported/cart.esi.json" } }), adopted);
    assert.ok(staged.adopted !== null, "the verified record travels onto the plan");

    const written = serializeEnvironment(
      environmentRecord(staged, null, [], true, {
        network: "enforced",
        filesystemWrite: "enforced",
        substrate: null,
        crossings: [],
      }),
    );
    assert.deepEqual(written["imported"], {
      from: RESOLVED_FROM,
      subject: "shopping-cart@local-process",
      world: "process:loopback",
      identity: adopted.identity,
      runs: 1,
    });
  });

  it("writes an explicit null for a run that built its own world, so absence is not the reading", async () => {
    const plan = await readPlan(document());
    const written = serializeEnvironment(
      environmentRecord(plan, null, [], true, {
        network: "enforced",
        filesystemWrite: "enforced",
        substrate: null,
        crossings: [],
      }),
    );
    // `in` rather than a value test: an omitted key invites a reader to infer "built here" from its
    // absence, and a key set to `null` is the bundle saying so.
    assert.ok("imported" in written, "the key is written, not omitted");
    assert.equal(written["imported"], null);
  });

  it("makes an adopted run incomplete under M5 when the bundle loses the record", async () => {
    const { adopted } = await declaredAndAdopted();
    const staged = await readPlan(document({ import: { from: "exported/cart.esi.json" } }), adopted);

    const record = environmentRecord(staged, null, [], true, {
      network: "enforced",
      filesystemWrite: "enforced",
      substrate: null,
      crossings: [],
    });
    const carried = serializeEnvironment(record);
    assert.deepEqual(evidenceCompleteness([], record, carried), { missing: [], complete: true });

    // Negative control, so the assertion above is not passing for a completeness check that never
    // fires: drop the key from the written document and the incompleteness appears, naming the world.
    const lost: Record<string, unknown> = { ...carried, imported: null };
    const reported = evidenceCompleteness([], record, lost);
    assert.deepEqual(reported.missing, ["imported:process:loopback"]);
    assert.equal(reported.complete, false);
  });
});

describe("the export, read back and exported again, is byte-identical", () => {
  it("carries an adopted identity through a second export unchanged", async () => {
    // AC-7's second direction. The claim that can be true is not "the two documents are equal" - the
    // export renders keys the original bundle never had - it is that *reading the document and
    // adopting the world it names produces the same identity block*, byte for byte. Two exports and
    // one adoption in between, compared as strings.
    const plan = await readPlan(document());
    const first = identityOf(plan);
    const { adopted } = await declaredAndAdopted();

    const staged = await readPlan(document({ import: { from: "exported/cart.esi.json" } }), adopted);
    assert.equal(canonicalJson(identityOf(staged)), adopted.identity);

    // And the rendering is idempotent, which is what makes the comparison above a statement about
    // the round trip rather than about one function happening to agree with itself: put the exported
    // identity back through the predicate and nothing moves.
    assert.equal(canonicalJson(exportDocument({ world: first }).document["world"]), canonicalJson(first));
  });

  it("refuses nothing on the second pass, so the dENV refused-key reading is zero in both directions", async () => {
    // A `process` world is the one whose identity carries refused keys - `detail.command` and
    // `detail.args` are refused for the same reason a top-level `command` is - so a refusal appearing
    // on the first pass and not the second (or the reverse) would be the round trip losing something
    // the predicate had already ruled on.
    const plan = await readPlan(document());
    const first = exportDocument(serializeEnvironment(
      environmentRecord(plan, null, [], true, {
        network: "enforced",
        filesystemWrite: "enforced",
        substrate: null,
        crossings: [],
      }),
    ));
    assert.deepEqual(
      first.refused.map((entry) => entry.key).sort(),
      ["args", "command", "env"],
      "control: this world's document is one the predicate has something to refuse",
    );
    // And the identity block's own two commands are refused *inside* the rendering rather than at the
    // top level, which is the pair that would be lost if `world` were `kept` rather than rendered.
    assert.deepEqual(
      first.rendered.map((entry) => entry.path).sort(),
      ["app_path", "world.detail.root"],
      "control: and something to render, so the export is not a refusal of everything",
    );

    const adopted = importWorld(await esiOf(plan), { from: "exported/cart.esi.json" }, plan);
    assert.ok(!isImportRefusal(adopted));
    const second = exportDocument({ world: JSON.parse(adopted.identity) as unknown });
    assert.deepEqual(second.refused, [], "the exported identity refuses nothing, because it carries none");
    assert.deepEqual(second.rendered, [], "and it renders nothing, because it arrived already rendered");
  });
});

describe("the import path is enumerable", () => {
  it("keeps core/metrics/esi.ts free of a reader that resolves a world", async () => {
    // The claim "the ESI module has no import path" cannot be asserted by calling something and
    // finding nothing. It can be asserted by reading the module's exports and comparing them with the
    // set they are meant to be - and phase 08 is where that roster had to be *updated*, because the
    // import became real. What it did not become is a member of `esi.ts`: the exporter still cannot
    // resolve a world, and the import lives one file over, as its own module with its own roster.
    const esi = (await nodeIo().readTextFile("core/metrics/esi.ts")) ?? "";
    assert.ok(esi.length > 0, "control: the file was read, or the roster below compares nothing");
    const exported = [...esi.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
      (match) => match[1] ?? "",
    );
    assert.deepEqual(exported.sort(), ["ESI_VERSION", "esiForSubject", "listEsi", "parseEsi"]);

    const importer = (await nodeIo().readTextFile("core/metrics/import.ts")) ?? "";
    assert.ok(importer.length > 0, "control: the import module exists and was read");
    const importExports = [...importer.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
      (match) => match[1] ?? "",
    );
    assert.deepEqual(
      importExports.sort(),
      ["importWorld", "isImportRefusal", "readImportDocument"],
      "three exports: read the document, verify it against a plan, and split the result",
    );
    // And the thing that would make it a materialisation rather than a verification: it reaches no
    // adapter, so nothing here can construct a world. Asserted over the module's **imports** rather
    // than its prose, because the prose is allowed to say the word "adapter" - it is explaining why
    // it does not reach for one.
    const reached = [...importer.matchAll(/^import[^;]*?from "([^"]+)"/gms)].map(
      (match) => match[1] ?? "",
    );
    assert.ok(reached.length >= 4, `control: the imports were read (${reached.join(", ")})`);
    assert.deepEqual(
      reached.filter((path) => path.includes("adapter")),
      [],
      "the import module must reach no adapter: a reader that could build a world would be " +
        "resolving one on this machine and calling it the document's",
    );
  });

  it("lets only the manager decide the declared/unstaged pair", async () => {
    // The phase's refusal, held as a roster over the production tree rather than as a promise. The
    // pair is what makes an unstaged import visible at all; a second file deciding it would be a
    // second place a caller could decide what to do about it, and the second place is where the rule
    // erodes. Three files read the pair - the loader writes it, the manager decides it, the writer
    // reports it - and nothing else names `adopted` at all.
    const production = [
      "core/environment/load.ts",
      "core/environment/manager.ts",
      "core/environment/types.ts",
      "core/evidence/writer.ts",
      "core/evidence/types.ts",
      "core/definition.ts",
    ];
    for (const path of production) {
      const text = (await nodeIo().readTextFile(path)) ?? "";
      assert.ok(text.length > 0, `control: ${path} was read, or the roster below compares nothing`);
    }
    const manager = (await nodeIo().readTextFile("core/environment/manager.ts")) ?? "";
    assert.match(
      manager,
      /plan\.imported !== null && plan\.adopted === null/,
      "the manager is where the pair is decided",
    );
    // And the decision is inside `prepare` rather than in a helper a second caller could reach: the
    // refusal sits above the `creating` step, so there is no window in which a world that was never
    // adopted could be created and observed. Scoped to `prepare`'s own body, because the vocabulary
    // at the top of the file contains the word `creating` long before the step does.
    const body = manager.slice(manager.indexOf("async prepare("));
    assert.ok(body.length > 0, "control: `prepare` was found, or the comparison below is on a slice of nothing");
    assert.ok(
      body.indexOf("plan.adopted === null") < body.indexOf('"creating"'),
      "the refusal is above the step that creates the world, which is what 'staged at prepare()' means",
    );
  });
});

/**
 * AC-8 itself, run rather than read.
 *
 * The roster above holds that the *decision* is in `prepare()` and above `creating`. That is a claim
 * about the source text, and a claim about source text is not the criterion: AC-8 is about what a run
 * produces. The two subtests below take the two states the pair makes distinguishable and put each
 * through `EnvironmentManager.prepare()` against a real adapter double, so the difference is read off
 * an outcome rather than off a regex.
 *
 * This is also the phase's own falsification probe, run as a test: delete the refusal in
 * `prepare()` and the first subtest fails, because the adapter's `create` is then reached and the
 * world is presented as live. The second is the negative control, so the pair cannot pass for a
 * manager that refuses everything.
 */
function silentAdapter(): { readonly adapter: EnvironmentAdapter; readonly calls: string[] } {
  const calls: string[] = [];
  const adapter: EnvironmentAdapter = {
    kind: "fake",
    async create() {
      calls.push("create");
      return { id: "env-1" };
    },
    async start() {
      calls.push("start");
    },
    async deploy() {
      calls.push("deploy");
    },
    async execute() {
      return {
        kind: "process.text" as const,
        capturedAt: "2026-01-01T00:00:00.000Z",
        environmentId: "env-1",
        runId: "run-1",
        data: {},
        artifacts: [],
        error: null,
      };
    },
    async observe() {
      return {
        kind: "process.text" as const,
        capturedAt: "2026-01-01T00:00:00.000Z",
        environmentId: "env-1",
        runId: "run-1",
        data: {},
        artifacts: [],
        error: null,
      };
    },
    async probe() {
      return { ok: true, statusCode: null, message: null, patternSeen: null };
    },
    async snapshot() {
      return "snap-1";
    },
    async restore() {},
    async reset() {},
    async stop() {},
    async destroy() {},
    boundaries() {
      return { network: "enforced" as const, filesystemWrite: "enforced" as const, crossings: [] };
    },
  };
  return { adapter, calls };
}

describe("prepare() is where the pair is decided, read off an outcome rather than off the source", () => {
  it("refuses a declared-and-unstaged import before the world is created at all", async () => {
    // The state a plan is in when the declaration reached it and the verification did not - which is
    // reachable on purpose, so that `imported` and `adopted` cannot be one field.
    const declared = await readPlan(document({ import: { from: "exported/cart.esi.json" } }));
    assert.ok(declared.imported !== null, "control: the fixture really declares an import");
    assert.equal(declared.adopted, null, "control: and it really carries no adoption");

    const { adapter, calls } = silentAdapter();
    const prepared = await new EnvironmentManager({
      adapter,
      clock: fixedClock(),
      logger: silentLogger,
      sleep: async () => undefined,
    }).prepare(declared);

    assert.equal(prepared.ok, false, "an unstaged import is refused, so it is never a live world");
    // The classification is the one that sends a reader to the world rather than to the code: the
    // environment never became the twin of the document, and the application is not at fault.
    assert.equal(
      prepared.ok ? null : prepared.failure.kind,
      "ENVIRONMENT_FAILURE",
      "and it is classified as an environment failure rather than as a test failure",
    );
    assert.match(
      prepared.ok ? "" : prepared.failure.message,
      /declares an import from examples\/shopping-cart\/exported\/cart\.esi\.json/,
      "and the refusal names the document, so the reader knows which one it is about",
    );
    // The measurement that makes AC-8 *staging* rather than *reporting*: nothing was created, so
    // there is no window in which an unadopted world could be observed and judged.
    assert.deepEqual(calls, [], "the adapter was never asked to make anything");
  });

  it("judges an adopted world normally, so the refusal above is not a manager that refuses everything", async () => {
    const { declared, adopted } = await declaredAndAdopted();
    const staged = await readPlan(document({ import: { from: "exported/cart.esi.json" } }), adopted);
    assert.ok(staged.adopted !== null, "control: the fixture carries an adoption, not just a declaration");

    const { adapter, calls } = silentAdapter();
    const prepared = await new EnvironmentManager({
      adapter,
      clock: fixedClock(),
      logger: silentLogger,
      sleep: async () => undefined,
    }).prepare(staged);

    assert.equal(prepared.ok, true, `the adopted world prepares (${JSON.stringify(declared.imported)})`);
    assert.ok(calls.includes("create"), "and the world really was created, because it really was verified");
    // The ordering AC-8 is about, read off the result rather than off the file: the adoption is
    // recorded before anything was created in the world. Read by the state each transition *enters*
    // rather than by its reason, because a reason is prose and prose is not a position.
    const order = prepared.ok ? prepared.transitions : [];
    assert.equal(order[0]?.to, "defined", "the first transition is the adoption, into the same state");
    assert.match(order[0]?.reason ?? "", /^adopting process:loopback /, "and it says what was adopted");
    assert.ok(
      order.findIndex((entry) => entry.reason.startsWith("adopting ")) <
        order.findIndex((entry) => entry.to === "creating"),
      `the adoption precedes the creation (${order.map((entry) => entry.to).join(" > ")})`,
    );
  });
});

