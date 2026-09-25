/**
 * The environment mode, from the gap to the row that answers it.
 *
 * ## Why this is one file and not two
 *
 * `core/clarification/derive.ts` states the rule this file exists to hold: *a default row and the gap
 * that reaches it are one fact written in two files.* So the detector half lives in
 * `core/clarification/detect.ts` and the default half in `SCHEMA_DEFAULTS` in `derive.ts`, and neither
 * can be tested on its own:
 *
 *   - a gap with no row is `deferred`, and because `process.environment` changes the meaning of the
 *     environment it is **blocking**, so the run is refused outright;
 *   - a row with no gap is unreachable, and a derivation nothing can exercise is a claim nobody can
 *     check.
 *
 * A file that tested only one half would pass while the other was missing, which is precisely the
 * state this file was written to close.
 *
 * ## What was wrong
 *
 * `process.environment` is the fourth dimension of a boundary - what the application a world starts
 * may SEE. `schemas/environment.schema.json` declares `"default": "inherit"` for it and
 * `core/environment/load.ts` applies that default, so the *value* was never in question. But nothing in
 * the ladder cited it, so the schema default was **dead data**: declared in one file and consulted by
 * no row in the other.
 *
 * The asymmetry is what made it visible rather than the omission, and it is the reason the first
 * assertion below is written against the goal's own boundary field. The WRITE boundary's default
 * (`/limits/filesystemWrite` in the goal) is recorded as `derived` in every run. So are the read
 * surface, the reset strategy and the health fields. The environment was the **one boundary** whose
 * default was applied by a decoder and recorded by nothing - so a reader of such a bundle saw
 * `mode: inherit` in the crawl, which says what the mode *is*, and nowhere saw that the mode had been a
 * choice or what bound it.
 *
 * ## The measurement that proves the asymmetry, taken before the change
 *
 * A real run of `examples/env-reality` recorded 18 ambiguities in `clarifications.json`:
 *
 *   goal        /limits/filesystemWrite, /limits/maxIterations, ...   derived
 *   acceptance  /criteria/0..6/mandatory                              derived
 *   environment /health/intervalMs, /health/timeoutMs                 derived
 *   iteration   /decision                                             defaulted
 *
 * `/process/environment` is absent from that list while every sibling in the `environment` origin is
 * present. Two runs taken on 2026-09-25 measure both directions of the change:
 *
 *   `npm run demo:audit`   `workspace-audit` OMITS the mode, and its bundle now records
 *                          `derived /process/environment - schema default
 *                          schemas/environment.schema.json#/properties/process/properties/environment/default`
 *                          beside `health/intervalMs` and `health/timeoutMs`. Exit 0, so the blocking
 *                          gap resolves rather than refusing the run - which is the failure mode of a
 *                          gap whose row is missing.
 *   `npm run demo:env`     `env-reality` STATES the mode, and its bundle records no such gap at all.
 *                          The guard, measured rather than assumed.
 *
 * The bundle-level half is asserted by the subtest *"records the environment mode this document omits"*
 * in `tests/local-process-demo.test.ts`, which resolves the real `local-process` example - a process
 * world that omits the field - through the real ladder.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { adapterDescriptors, registeredAdapters } from "../cli/worlds.ts";
import { createDeriver, defaultDeriveRules } from "../core/clarification/derive.ts";
import { detectEnvironmentAmbiguities } from "../core/clarification/detect.ts";
import type { DetectorContext } from "../core/clarification/detect.ts";
import { ClarificationEngine, NullPromptPort } from "../core/clarification/engine.ts";
import { memoryIo } from "../core/io.ts";
import { fixedClock, silentLogger } from "./helpers/clock.ts";

const MODE_PATH = "/process/environment";

const context = (overrides: Partial<DetectorContext> = {}): DetectorContext => ({
  registeredValidators: [],
  validatorDescriptors: [],
  registeredAdapters: [...registeredAdapters()],
  adapterDescriptors: [...adapterDescriptors()],
  sourceLabel: "environment.yaml",
  ...overrides,
});

const paths = (environment: Record<string, unknown>): readonly string[] =>
  detectEnvironmentAmbiguities(environment, context()).map((entry) => entry.path);

/** A process world that states its host and root and says nothing about what it may see. */
const omitting: Record<string, unknown> = {
  adapter: "local-process",
  app: "app",
  process: { host: "env-reality-host", root: "sandbox" },
};

/** The same document with the field stated, which is the half that must raise nothing. */
const stated: Record<string, unknown> = {
  ...omitting,
  process: { host: "env-reality-host", root: "sandbox", environment: "declared" },
};

const engine = (): ClarificationEngine =>
  new ClarificationEngine({
    derive: createDeriver(defaultDeriveRules(memoryIo({}))),
    user: NullPromptPort,
    clock: fixedClock(),
    logger: silentLogger,
  });

describe("the environment mode is raised as a gap, not applied silently", () => {
  it("raises exactly one gap, at the mode's own pointer, for a process world that omits it", () => {
    const raised = detectEnvironmentAmbiguities(omitting, context());
    const gaps = raised.filter((entry) => entry.path === MODE_PATH);

    assert.equal(gaps.length, 1, `expected one gap at ${MODE_PATH}`);
    const gap = gaps[0];
    assert.ok(gap);
    assert.equal(gap.kind, "missing_value");
    assert.equal(
      gap.blocking,
      true,
      "the mode decides what the application may read, so a gap in it changes the meaning of the " +
        "environment - which the ladder must resolve rather than pass over",
    );
    assert.ok(gap.question.length > 0, "the gap asks nothing, so a human could not answer it");
  });

  it("raises no gap once the document states the mode", () => {
    assert.ok(
      !paths(stated).includes(MODE_PATH),
      "a document that states its mode is still reported as having left it out",
    );
  });

  it("does not ask a world with no process block, because it has no such field to leave out", () => {
    // Derived from the register rather than listed, for the reason `tests/environment-gaps.test.ts`
    // states for the HTTP predicate: a hand-written list of kinds covers the kinds it was written
    // with. `local-process` is the one world whose declaration names `process`, and it is excluded by
    // deriving the exclusion rather than by remembering it.
    const asked: string[] = [];
    for (const descriptor of adapterDescriptors()) {
      const shapes = new Set(descriptor.requires.map((requirement) => requirement.field.split(".")[0] ?? ""));
      if (shapes.has("process")) continue;
      if (paths({ adapter: descriptor.kind, app: "app" }).includes(MODE_PATH)) asked.push(descriptor.kind);
    }
    assert.deepEqual(
      asked,
      [],
      "worlds with no process block were asked what their application may see, which invents a gap " +
        "in a document that has no such field to leave out",
    );
  });
});

describe("the gap and the default row are one fact, so the ladder closes it without asking anyone", () => {
  it("resolves at rung 1 from the schema, and never reaches a question or a self-prompt", async () => {
    const gaps = detectEnvironmentAmbiguities(omitting, context()).filter(
      (entry) => entry.path === MODE_PATH,
    );
    assert.equal(gaps.length, 1, "the fixture no longer raises the gap this test is about");

    const outcome = await engine().resolve(omitting, gaps);
    const records = outcome.report.records.filter((entry) => entry.ambiguity.path === MODE_PATH);
    assert.equal(records.length, 1);

    const record = records[0];
    assert.ok(record);
    assert.equal(
      record.resolution.via,
      "derived",
      "the mode was not derived from the schema. A row and its gap are one fact in two files, so " +
        "this failing means `SCHEMA_DEFAULTS` in core/clarification/derive.ts has lost the " +
        "`/process/environment` entry - and the gap, being blocking, would refuse the run.",
    );
    assert.equal(record.resolution.via === "derived" ? record.resolution.value : null, "inherit");
    assert.deepEqual(
      record.rungsAttempted,
      ["derived"],
      "the walk entered a rung it did not need, which for a derivable gap is work the run did and " +
        "should not have",
    );

    // The two costs the rung order exists to protect, both asserted rather than assumed.
    assert.equal(outcome.report.questionsAsked, 0, "a derivable gap cost a human a question");
    assert.equal(outcome.report.selfPromptRounds, 0, "a derivable gap spent a self-prompt round");
    assert.deepEqual(
      outcome.deferred,
      [],
      "the gap was left deferred, and because it is blocking the run would be refused",
    );
  });

  it("cites a pointer that resolves in the schema file it names", async () => {
    // The evidence is only evidence if it can be checked, which `derive.ts` states as the rule for
    // every row in the table: *the citation is a real JSON-Schema pointer, so every piece of evidence
    // here can be checked against the file it names.* A citation is the one part of a resolution that
    // nothing else in the suite reads - it is a string in a bundle - so this is where it is held to
    // the file. It is also the assertion that makes the row's `value` a reading rather than a copy.
    const outcome = await engine().resolve(omitting, [
      ...detectEnvironmentAmbiguities(omitting, context()).filter((entry) => entry.path === MODE_PATH),
    ]);
    const record = outcome.report.records.find((entry) => entry.ambiguity.path === MODE_PATH);
    assert.ok(record && record.resolution.via === "derived");

    const evidence = (record.resolution as { evidence: string }).evidence;
    const prefix = "schema default - ";
    assert.ok(evidence.startsWith(prefix), `evidence does not name a schema default: ${evidence}`);

    const [file = "", pointer = ""] = evidence.slice(prefix.length).split("#");
    assert.equal(file, "schemas/environment.schema.json", "the citation names a different schema file");

    const text = await readFile(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
    const document: unknown = JSON.parse(text);
    let at: unknown = document;
    for (const token of pointer.split("/").filter((part) => part !== "")) {
      assert.ok(
        at !== null && typeof at === "object",
        `the citation ${pointer} walks into ${typeof at}, so it does not resolve`,
      );
      at = (at as Record<string, unknown>)[token];
    }
    assert.equal(
      at,
      "inherit",
      `the citation ${pointer} resolves to ${JSON.stringify(at)} in ${file}, so the row's value and ` +
        "the schema's default disagree",
    );
  });
});
