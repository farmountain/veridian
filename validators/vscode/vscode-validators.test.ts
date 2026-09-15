import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { COMPARISON_KEYS } from "../../core/acceptance/plan.ts";
import {
  VSCODE_ENGINE_RESULTS,
  VSCODE_OBSERVATION_KIND,
  VSCODE_RESULTS,
  VSCODE_SIMULATED_SURFACES,
  isVSCodeObservationData,
  resolveVSCodeChannelName,
  resolveVSCodeCommandId,
  resolveVSCodeFilePath,
  resolveVSCodeSettingKey,
  resolveVSCodeStateRef,
  resolveVSCodeStatusId,
} from "../../core/environment/vscode-observation.ts";
import type {
  VSCodeActivationReading,
  VSCodeCallRecord,
  VSCodeCommandReading,
  VSCodeContributionReading,
  VSCodeEngineReading,
  VSCodeFileReading,
  VSCodeIdentityReading,
  VSCodeInvocationReading,
  VSCodeMessageReading,
  VSCodeObservationData,
  VSCodeOutputReading,
  VSCodeRefusalReading,
  VSCodeSettingReading,
  VSCodeStateReading,
  VSCodeStatusReading,
  VSCodeSubscriptionReading,
  VSCodeTargetResult,
} from "../../core/environment/vscode-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";
import type { AssertionResult } from "../../core/validation/types.ts";

import { VSCODE_VALIDATORS, VSCODE_VALIDATOR_NAMES, vscodeValidators } from "./vscode-validators.ts";

// ---- fixtures --------------------------------------------------------------------------------------

/**
 * The records this family reads, built the way the world builds them.
 *
 * The fixture is the **agreeing** case on purpose, including `runs: 1` with `activated: true`: a reading
 * where the host's own count and the extension's answer agree is what a test has to start from before it
 * can show what happens when they do not. `subscription()` defaults to `disposed: false` for the same
 * reason - the family exists partly to catch a handle nothing released, so the fixture that reveals a
 * leak has to be the *ordinary* reading rather than a contrived one.
 */
const identityReading = (overrides: Partial<VSCodeIdentityReading> = {}): VSCodeIdentityReading => ({
  name: "cart-web",
  publisher: "veridian",
  version: "1.0.0",
  displayName: "Cart Web",
  main: "extension.js",
  ...overrides,
});

const engineReading = (overrides: Partial<VSCodeEngineReading> = {}): VSCodeEngineReading => ({
  declared: "^1.100.0",
  apiVersion: "1.100.0",
  result: "admitted",
  reason: null,
  ...overrides,
});

const activationReading = (overrides: Partial<VSCodeActivationReading> = {}): VSCodeActivationReading => ({
  event: "onCommand:cart.add",
  activated: true,
  error: null,
  runs: 1,
  ...overrides,
});

const contributionReading = (
  overrides: Partial<VSCodeContributionReading> = {},
): VSCodeContributionReading => ({
  point: "commands",
  id: "cart.add",
  title: "Add an item",
  ...overrides,
});

const commandReading = (overrides: Partial<VSCodeCommandReading> = {}): VSCodeCommandReading => ({
  id: "cart.add",
  registered: true,
  title: "Add an item",
  declared: true,
  disposed: false,
  ...overrides,
});

const invocationReading = (overrides: Partial<VSCodeInvocationReading> = {}): VSCodeInvocationReading => ({
  command: "cart.add",
  client: "extension",
  args: ["shirt"],
  result: "answered",
  reason: null,
  ...overrides,
});

const settingReading = (overrides: Partial<VSCodeSettingReading> = {}): VSCodeSettingReading => ({
  key: "cart-web.limit",
  value: "10",
  source: "override",
  ...overrides,
});

const statusReading = (overrides: Partial<VSCodeStatusReading> = {}): VSCodeStatusReading => ({
  id: "cart.status",
  text: "$(cart) 3 items",
  tooltip: "3 items in the cart",
  command: "cart.add",
  visible: true,
  alignment: "left",
  ...overrides,
});

const outputReading = (overrides: Partial<VSCodeOutputReading> = {}): VSCodeOutputReading => ({
  channel: "Cart",
  lines: ["cart activated", "limit 10"],
  shown: true,
  ...overrides,
});

const messageReading = (overrides: Partial<VSCodeMessageReading> = {}): VSCodeMessageReading => ({
  level: "warning",
  message: "added 1 item",
  ...overrides,
});

const stateReading = (overrides: Partial<VSCodeStateReading> = {}): VSCodeStateReading => ({
  scope: "global",
  key: "cart.items",
  value: "3",
  ...overrides,
});

const subscriptionReading = (
  overrides: Partial<VSCodeSubscriptionReading> = {},
): VSCodeSubscriptionReading => ({
  kind: "command",
  id: "cart.add",
  disposed: false,
  ...overrides,
});

const fileReading = (overrides: Partial<VSCodeFileReading> = {}): VSCodeFileReading => ({
  path: "report.json",
  bytes: 128,
  readable: true,
  ...overrides,
});

const refusalReading = (overrides: Partial<VSCodeRefusalReading> = {}): VSCodeRefusalReading => ({
  api: "vscode.env",
  client: "extension",
  reason: "this world does not implement vscode.env",
  ...overrides,
});

const callRecord = (overrides: Partial<VSCodeCallRecord> = {}): VSCodeCallRecord => ({
  action: "activate",
  client: "provisioner",
  command: "veridian-vscode activate cart-web",
  resource: "cart-web",
  result: "answered",
  status: 0,
  reason: null,
  ...overrides,
});

const vscodeDocument = (overrides: Partial<VSCodeObservationData> = {}): VSCodeObservationData => ({
  host: "veridian-vscode-sim",
  apiVersion: "1.100.0",
  sandbox: "/host/.veridian/sandbox-vscode",
  extension: identityReading(),
  engine: engineReading(),
  activation: activationReading(),
  simulated: ["extension-host", "module-resolution", "command-registry", "configuration"],
  contributions: [
    contributionReading(),
    contributionReading({ point: "activationEvents", id: "onCommand:cart.add", title: null }),
  ],
  commands: [commandReading()],
  invocations: [invocationReading()],
  settings: [settingReading()],
  status: [statusReading()],
  output: [outputReading()],
  messages: [messageReading()],
  state: [stateReading()],
  subscriptions: [subscriptionReading()],
  files: [fileReading()],
  refusals: [refusalReading()],
  calls: [callRecord()],
  ...overrides,
});

const observed = (data: unknown, kind: string = VSCODE_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-vscode:veridian-vscode-sim",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/** A document from the *other* world, typed as that world's to keep the fixture honest. */
const webDocument: WebObservationData = {
  url: "http://127.0.0.1:4173/",
  title: "Cart",
  targets: {},
  console: [],
  network: [],
  viewport: { width: 1280, height: 720 },
};

const world = observed(vscodeDocument());

const registry = new ValidatorRegistry(vscodeValidators());

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point and not the criterion's, for the reason the seven families
 * before this one give: it bypasses the observation-kind check deliberately, so the family's own status
 * discipline is what is under test rather than `evaluateCriterion`'s evidence rules, which have a suite
 * of their own.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const field = (
  validator: string,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...values });

/**
 * A name the reading quotes, in the spelling the reading uses.
 *
 * The family spells a name it names in **backticks** - `cart.add`, `Cart`, `vscode.env` - because every
 * one of those goes through `quote()` in `core/validation/assertions.ts`. Eight assertions in this suite
 * were written from recall with double quotes and failed against a product that was right, which is the
 * reason this helper exists rather than eight literal spellings: the next one is written in one place.
 */
const quoted = (text: string): string => `\`${text}\``;

const expect = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = judge(raw, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${String(raw["validator"])}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

// ---- the roster -------------------------------------------------------------------------------------

describe("the roster is the code, and every name in it is writable", () => {
  it("names exactly the seventeen validators the family exports, in both directions", () => {
    assert.equal(Object.values(VSCODE_VALIDATOR_NAMES).length, 17);
    assert.equal(VSCODE_VALIDATORS.length, 17);
    assert.deepEqual(
      VSCODE_VALIDATORS.map((validator) => validator.name).sort(),
      [...Object.values(VSCODE_VALIDATOR_NAMES)].sort(),
      "the roster of validators and the record of names are the same vocabulary written twice, and a " +
        "name in one and not the other is either unreachable or unfindable",
    );
    assert.ok(
      Object.isFrozen(VSCODE_VALIDATORS),
      "the roster is a global a caller could edit in place, which would make one criterion's verdict " +
        "depend on whether another criterion ran first",
    );
  });

  it("spells every name so that an acceptance contract can be written at all", () => {
    // The schema's own pattern, asserted rather than trusted: a name with a capital in it is a validator
    // no `acceptance.yaml` can express, so it would be implemented, exported, tested and unreachable.
    // It matters in this family for the reason `container.exitCode` recorded one world earlier - every
    // *field* this world records is camel case (`apiVersion`, `displayName`) and every *name* here has to
    // be lower case, so the two spellings live in the same file and the natural mistake is to carry one
    // across into the other.
    for (const name of Object.values(VSCODE_VALIDATOR_NAMES)) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, `${name} is not writable in a contract`);
      assert.match(name, /^vscode\./, `${name} is outside the prefix this family owns`);
    }
    assert.equal(VSCODE_VALIDATOR_NAMES.probe, "vscode.probe");
    assert.equal(VSCODE_VALIDATOR_NAMES.call, "vscode.call");
  });

  it("declares the world it reads on every member, and a target noun on every member that needs one", () => {
    for (const validator of VSCODE_VALIDATORS) {
      assert.equal(
        validator.observationKind,
        VSCODE_OBSERVATION_KIND,
        `${validator.name} reads a different world than this family does`,
      );
      if (validator.needsTarget) {
        assert.ok(
          (validator.targetNoun ?? "").length > 0,
          `${validator.name} declares no target noun, so the clarification ladder cannot ask for one`,
        );
      }
    }

    // The exception, named rather than counted, because "one of them does not" is the shape of a claim
    // that stays true while the exception moves to a validator that should have needed a target. Five is
    // the honest number for this world and each is a question about *the* extension or *the* host rather
    // than about one object: there is one host, one installed manifest, one floor decision, one
    // activation, and one list of what the extension said.
    const targetless = VSCODE_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(targetless, [
      "vscode.host",
      "vscode.identity",
      "vscode.engine",
      "vscode.activation",
      "vscode.message",
    ]);
  });

  it("declares only comparisons the acceptance layer can decode", () => {
    // `validator.comparisons` is read twice: by the clarification report, and by `decodeExpectation`'s
    // "cannot evaluate" branch. A comparison named here that `COMPARISON_KEYS` does not hold would be a
    // validator advertising an operation no criterion can state.
    for (const validator of VSCODE_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, `${validator.name} declares no comparison`);
      for (const key of validator.comparisons) {
        assert.ok(
          (COMPARISON_KEYS as readonly string[]).includes(key),
          `${validator.name} declares \`${key}\`, which is not one of ${COMPARISON_KEYS.join(", ")}`,
        );
      }
    }
  });

  it("returns a fresh roster each time, so a registry cannot be reached through the family", () => {
    const first = vscodeValidators();
    const second = vscodeValidators();
    assert.notEqual(first, second);
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
  });

  it("keeps the substitute, and every other family, out of the vocabulary that judges it", () => {
    // Two rules from `AGENTS.md`, held as executable rules over this file's own text because the import
    // list is the only place either can be broken. A family that imported an adapter could report on the
    // substitute rather than on the extension; a family that imported another family could answer a
    // question that belongs to a different world.
    const source = readFileSync(new URL("./vscode-validators.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.ok(specifiers.length >= 3, "the import scan found almost nothing, so it is not reading the file");
    assert.deepEqual(
      specifiers.filter((specifier) => specifier.includes("adapters/")),
      [],
      "a validator family that imports an adapter can judge the substitute instead of the world",
    );
    assert.deepEqual(
      specifiers.filter((specifier) => specifier.includes("validators/")),
      [],
      "a validator family that imports another family can answer a question about another world",
    );
  });

  it("refuses an empty expectation on every member rather than passing it", () => {
    // Two rules, and each member is refused by exactly one of them, which is why both are asserted here:
    // no target at all is refused *before* the judgement, and the judgement itself refuses to compare
    // against nothing. A member that reached `judge` with no comparison and passed would be the single
    // validator in the family that can never fail.
    for (const validator of VSCODE_VALIDATORS) {
      const result = judge({ validator: validator.name }, world);
      assert.equal(result.status, "ERROR", `${validator.name} judged an empty expectation`);
      const refusal = validator.needsTarget ? /named no target/ : /nothing to judge/;
      assert.match(String(result.message), refusal, `${validator.name} was refused for a different reason`);
    }

    // And the `judge` rule itself, reached by a member whose target does resolve. Stated as its own
    // assertion because the loop above never reaches it for the twelve members that need a target.
    const empty = judge(field("vscode.command", { target: "cart.add" }), world);
    assert.equal(empty.status, "ERROR");
    assert.match(String(empty.message), /nothing to judge/);
    assert.equal(empty.failureKind, "VALIDATOR_ERROR", "a defect in the contract is not the extension's");
  });
});

// ---- documents from other worlds --------------------------------------------------------------------

describe("a document from another world is an environment defect, not a judgment", () => {
  it("reports ERROR naming the environment when the reading is another world's", () => {
    const result = expect(
      field("vscode.activation", { equals: true }),
      observed(webDocument, WEB_OBSERVATION_KIND),
      "ERROR",
      /does not carry an extension-host document/,
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    // `actual` carries the payload that arrived rather than `null`, which is deliberate: the message
    // says an extension-host document was not found, and a reader diagnosing the adapter needs to see
    // what arrived in its place.
    assert.equal(result.actual, webDocument);
  });

  it("reports ERROR and blames the environment when the reading is absent", () => {
    const result = expect(field("vscode.host", { contains: "veridian" }), observed(null), "ERROR");
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });

  it("does not read the substitute's own record as a comparison target", () => {
    // `simulated` is in the reading because the substitution has to be visible where the verdict is. It
    // is deliberately *not* a field a criterion can select: the validators here that need no target
    // ignore a target entirely, so a criterion naming `simulated` is answered about the host identity -
    // which is a fact about the world's interface rather than about the extension.
    const simulated = VSCODE_SIMULATED_SURFACES[0] ?? "";
    expect(field("vscode.host", { target: "simulated", equals: simulated }), world, "FAIL");
    expect(field("vscode.host", { target: "simulated", equals: "veridian-vscode-sim" }), world, "PASS");
  });
});

// ---- targets, and the resolver's own reason ---------------------------------------------------------

describe("a target is resolved by the family's own grammar, and its refusal is quoted", () => {
  it("refuses a command id the editor itself would refuse, in the resolver's words", () => {
    // The refusal is the resolver's own sentence rather than a replacement for it: the resolver knows
    // why it refused, and a validator that wrote one message covering every reason would be naming a
    // cause it never observed.
    expect(
      field("vscode.command", { target: "cart add", equals: "present" }),
      world,
      "ERROR",
      /as the editor itself requires/,
    );
  });

  it("accepts every spelling the editor accepts, including the ones the validator naming rule refuses", () => {
    // The family's command grammar is the *editor's*, and the editor's is not the validator naming rule
    // next door: `^[a-z0-9]+(\.[a-z0-9]+)+$` would refuse every camel-case id, and a criterion for a real
    // extension would be unwritable. Held against the resolver directly as well as through a verdict, so
    // the rule is asserted where it lives.
    for (const id of ["cart.add", "cart.preview-json", "cart-web.addItem", "cart3.add_item"]) {
      assert.equal(resolveVSCodeCommandId(id).kind, "target", `${id} should be a command id`);
    }
    assert.equal(
      resolveVSCodeCommandId("cart/add").kind,
      "refused",
      "a slash is not part of any command id the editor accepts",
    );
  });

  it("reads a settings key the editor declares, capitals and hyphens included", () => {
    // This pattern was lower case only when it was first written, copied from the validator naming rule,
    // and it refused this family's own target noun - `cart-web.limit` - as well as the real
    // `editor.codeActionsOnSave`. A grammar and the example printed beside it disagreed, and the grammar
    // was wrong. The dot requirement is the part that is a fact about *this* world: the substitute
    // composes the key as `section + "." + key`, so a full key always carries a section.
    for (const key of ["cart-web.limit", "editor.codeActionsOnSave", "rust-analyzer.check.command"]) {
      assert.equal(resolveVSCodeSettingKey(key).kind, "target", `${key} should be a settings key`);
    }
    const bare = resolveVSCodeSettingKey("limit");
    assert.equal(bare.kind, "refused");
    assert.match(
      bare.kind === "refused" ? bare.reason : "",
      /at least one dot/,
      "a bare word is refused by naming the missing section, not by naming a case rule it does not break",
    );
    expect(
      field("vscode.setting", { target: "limit", contains: "1" }),
      world,
      "ERROR",
      /at least one dot/,
    );
  });

  it("refuses a state reference that names no store, and one that names a third", () => {
    expect(
      field("vscode.state", { target: "cart.items", equals: "3" }),
      world,
      "ERROR",
      /so that a criterion says which store/,
    );
    expect(
      field("vscode.state", { target: "session/cart.items", equals: "3" }),
      world,
      "ERROR",
      /names "global" or "workspace"/,
    );
    assert.equal(resolveVSCodeStateRef("global/cart.items").kind, "target");
    assert.equal(resolveVSCodeStateRef("workspace/cart.items").kind, "target");
  });

  it("refuses a workspace path that reaches out of the workspace folder", () => {
    // Three spellings, three reasons, and the reason is the resolver's. A backslash is refused rather
    // than converted, because a path spelled in the host's convention came from somewhere that is not
    // this world's readings.
    expect(
      field("vscode.file", { target: "state\\report.json", atLeast: 1 }),
      world,
      "ERROR",
      /forward slashes/,
    );
    expect(field("vscode.file", { target: "/report.json", atLeast: 1 }), world, "ERROR", /may not name a root/);
    expect(
      field("vscode.file", { target: "../report.json", atLeast: 1 }),
      world,
      "ERROR",
      /reach out of the workspace folder/,
    );
  });

  it("accepts the examples its own target nouns print, which is a claim the two must agree on", () => {
    // A target noun is what an author reads before writing a contract, so an example in one that its own
    // grammar refuses is a contract the documentation tells an author not to write. Held as a list of
    // (resolver, example) pairs rather than by parsing the nouns, because the nouns are prose and this is
    // a claim about which grammar reads which target.
    const pairs: readonly (readonly [string, (target: string) => VSCodeTargetResult<unknown>])[] = [
      ["cart.add", resolveVSCodeCommandId],
      ["cart.preview-json", resolveVSCodeCommandId],
      ["cart-web.limit", resolveVSCodeSettingKey],
      ["cart.status", resolveVSCodeStatusId],
      ["Cart", resolveVSCodeChannelName],
      ["global/cart.items", resolveVSCodeStateRef],
      ["report.json", resolveVSCodeFilePath],
    ];
    for (const [example, resolve] of pairs) {
      assert.equal(resolve(example).kind, "target", `the family prints ${example} as an example and refuses it`);
    }
  });

  it("reports ERROR when no target was named at all", () => {
    expect(field("vscode.command", { contains: "present" }), world, "ERROR", /named no target/);
  });
});

// ---- the verdict test, and the field it collides with ------------------------------------------------

describe("the verdict test is the engine's vocabulary, not the presence of a status field", () => {
  it("judges a call record whose own `status` is a number as a record, not as a verdict", () => {
    // `VSCodeCallRecord.status` is the status the substitute answered with - 0 for a command line this
    // world performed and ran to completion - so every call record therefore *has* a `status` field. A
    // helper written as `"status" in value` would report a call record as an `AssertionResult`, and
    // `vscode.call` would return the record itself as if it were a verdict, with `status: 200` where a
    // criterion status belongs. The family tests membership in `CRITERION_STATUSES` instead, and this is
    // the pair of fixtures that tells the two apart.
    const nonzero = vscodeDocument({
      calls: [callRecord({ action: "install", command: "veridian-vscode install", result: "answered", status: 200 })],
    });
    const result = expect(
      field("vscode.call", { target: "install", equals: "answered" }),
      observed(nonzero),
      "PASS",
    );
    assert.ok(
      (CRITERION_STATUSES as readonly unknown[]).includes(result.status),
      "the verdict is not one of the engine's statuses",
    );

    const zero = vscodeDocument({
      calls: [callRecord({ action: "activate", result: "failed", status: 0, reason: "activate raised" })],
    });
    expect(field("vscode.call", { target: "activate", equals: "failed" }), observed(zero), "PASS");
  });
});

// ---- the world's own facts: host, manifest, floor, activation ---------------------------------------

describe("the facts about the world are judged without being mistaken for facts about the extension", () => {
  it("reads the host identity, and prints the API version and the sandbox a reader would need", () => {
    expect(field("vscode.host", { equals: "veridian-vscode-sim" }), world, "PASS");
    const failed = expect(
      field("vscode.host", { equals: "some-other-editor" }),
      world,
      "FAIL",
      /1\.100\.0/,
    );
    assert.match(
      String(failed.message),
      /sandbox-vscode/,
      "a failure report about the host has to say which copy of the world answered, and where it lives",
    );
  });

  it("reads the extension the way its own manifest declares it, including the entry point", () => {
    expect(field("vscode.identity", { contains: "cart-web 1.0.0" }), world, "PASS");
    expect(
      field("vscode.identity", { equals: 'veridian.cart-web 1.0.0 "Cart Web", entry "extension.js"' }),
      world,
      "PASS",
    );
    // A publisher the manifest does not declare is absent rather than invented, so the rendering drops
    // the dot and the criterion asks the question the manifest can answer.
    const unnamed = vscodeDocument({ extension: identityReading({ publisher: null, displayName: null }) });
    expect(field("vscode.identity", { contains: "cart-web 1.0.0, entry" }), observed(unnamed), "PASS");
  });

  it("judges the floor decision this world made, and reads a third word as a contract that cannot be read", () => {
    expect(field("vscode.engine", { equals: "admitted" }), world, "PASS");
    const refusedFloor = vscodeDocument({
      engine: engineReading({ declared: "^1.200.0", result: "refused", reason: "the floor is above this host" }),
    });
    expect(field("vscode.engine", { equals: "refused" }), observed(refusedFloor), "PASS");
    // A fifth word is a contract that cannot be read rather than a comparison that is always false. The
    // second shape is the dangerous one: it is indistinguishable from an extension defect and sends an
    // agent to repair working code.
    const unusable = expect(
      field("vscode.engine", { equals: "installed" }),
      world,
      "ERROR",
      /wants one of admitted, refused/,
    );
    assert.equal(unusable.failureKind, "VALIDATOR_ERROR");
    assert.deepEqual([...VSCODE_ENGINE_RESULTS], ["admitted", "refused"]);
  });

  it("reads an install with no manifest at all as `refused` with nothing declared", () => {
    // The honest answer rather than a gap: nothing declared a floor, so nothing was admitted, and the
    // sentence says so - which is the shape a criterion can assert while the world holds no extension.
    const empty = vscodeDocument({ engine: engineReading({ declared: null, result: "refused", reason: null }) });
    expect(field("vscode.engine", { equals: "refused" }), observed(empty), "PASS");
    const failed = expect(
      field("vscode.engine", { equals: "admitted" }),
      observed(empty),
      "FAIL",
      /\(none declared\)/,
    );
    assert.ok(failed.actual === "refused");
  });

  it("judges whether anything answered the activation event, and reports an `activate` that threw", () => {
    expect(field("vscode.activation", { equals: true }), world, "PASS");
    expect(field("vscode.activation", { equals: "present" }), world, "PASS");
    expect(field("vscode.activation", { equals: "absent" }), world, "FAIL");

    const threw = vscodeDocument({
      activation: activationReading({ activated: false, error: "TypeError: cannot read 'add'", runs: 2 }),
    });
    expect(field("vscode.activation", { equals: false }), observed(threw), "PASS");
    expect(
      field("vscode.activation", { equals: true }),
      observed(threw),
      "FAIL",
      /cannot read 'add'/,
    );
  });

  it("reports the host run count as a fact about this world rather than as a claim about the extension", () => {
    // One host process per acting observation is this world's design and has to be visible where the
    // verdict is, because otherwise a fourth activation reads as the first. `runs` is printed, never
    // judged - which is why a criterion asserting it would be a criterion asserting how many times the
    // run acted.
    const fourth = vscodeDocument({ activation: activationReading({ runs: 4 }) });
    const failed = expect(field("vscode.activation", { equals: "absent" }), observed(fourth), "FAIL");
    assert.match(String(failed.message), /host start 4/);
  });
});

// ---- the manifest's contributions, and the host's registrations -------------------------------------

describe("what the manifest declares and what the host registered are two different questions", () => {
  it("reads a contribution as the point and the title together, so one comparison answers both halves", () => {
    expect(field("vscode.contribution", { target: "cart.add", contains: "commands" }), world, "PASS");
    expect(field("vscode.contribution", { target: "cart.add", contains: "Add an item" }), world, "PASS");
    expect(
      field("vscode.contribution", { target: "cart.add", equals: 'commands "Add an item"' }),
      world,
      "PASS",
    );
    // An activation event carries no title, and the absence is spelled rather than left blank so that a
    // comparison against a title cannot pass on a point that has none.
    expect(
      field("vscode.contribution", { target: "onCommand:cart.add", contains: "activationEvents" }),
      world,
      "PASS",
    );
  });

  it("answers an id declared under two points as two declarations, because that is one fact with two answers", () => {
    const twoPoints = vscodeDocument({
      contributions: [contributionReading(), contributionReading({ point: "menus", title: null })],
    });
    expect(
      field("vscode.contribution", {
        target: "cart.add",
        equals: 'commands "Add an item"; menus (no title)',
      }),
      observed(twoPoints),
      "PASS",
    );
  });

  it("spells an id no contribution point declares, so a criterion can assert that it is not in the palette", () => {
    expect(field("vscode.contribution", { target: "cart.remove", equals: "(not declared)" }), world, "PASS");
    expect(field("vscode.contribution", { target: "cart.remove", contains: "commands" }), world, "FAIL");
  });

  it("judges a command's registration, and names in the failure whether the manifest declared it", () => {
    expect(field("vscode.command", { target: "cart.add", equals: "present" }), world, "PASS");
    const declaredNotRegistered = vscodeDocument({ commands: [commandReading({ registered: false })] });
    const failed = expect(
      field("vscode.command", { target: "cart.add", equals: "present" }),
      observed(declaredNotRegistered),
      "FAIL",
      /not registered/,
    );
    // Both halves travel in the sentence, because "declared and never registered" and "registered and
    // never declared" are different defects with different repairs.
    assert.match(String(failed.message), /declared in the manifest/);
  });

  it("reports INCONCLUSIVE naming vscode.contribution when the host holds no such command", () => {
    // "not registered" for a command nothing ever declared would send an agent to the registration code
    // for a defect in the manifest.
    expect(
      field("vscode.command", { target: "cart.preview", equals: "present" }),
      world,
      "INCONCLUSIVE",
      /vscode\.contribution/,
    );
  });
});

// ---- invocations ------------------------------------------------------------------------------------

describe("an invocation is judged at its newest, and by whom is printed rather than judged", () => {
  it("judges the newest invocation, because a repair that worked is not undone by an earlier attempt", () => {
    const both = vscodeDocument({
      invocations: [
        invocationReading({ result: "absent", reason: "no such command" }),
        invocationReading({ result: "answered" }),
      ],
    });
    expect(field("vscode.invocation", { target: "cart.add", equals: "answered" }), observed(both), "PASS");
    const backwards = vscodeDocument({
      invocations: [invocationReading({ result: "answered" }), invocationReading({ result: "absent" })],
    });
    expect(field("vscode.invocation", { target: "cart.add", equals: "answered" }), observed(backwards), "FAIL");
  });

  it("reads a fifth word as a contract that cannot be read, and the four words as the vocabulary", () => {
    expect(field("vscode.invocation", { target: "cart.add", equals: "answered" }), world, "PASS");
    expect(
      field("vscode.invocation", { target: "cart.add", equals: "succeeded" }),
      world,
      "ERROR",
      /wants one of answered, absent, refused, failed/,
    );
    assert.deepEqual([...VSCODE_RESULTS], ["answered", "absent", "refused", "failed"]);
  });

  it("reports INCONCLUSIVE and lists what was invoked, rather than judging a command nobody asked for", () => {
    const nothingAsked = expect(
      field("vscode.invocation", { target: "cart.remove", equals: "answered" }),
      world,
      "INCONCLUSIVE",
      /Nothing invoked/,
    );
    assert.ok(
      String(nothingAsked.message).includes(quoted("cart.add")),
      "the sentence must name what the reading does hold, so a reader is not sent looking",
    );
  });
});

// ---- settings, status bar ----------------------------------------------------------------------------

describe("what the extension read, and what it put on screen", () => {
  it("judges the value, and prints which of the three sources answered for it", () => {
    expect(field("vscode.setting", { target: "cart-web.limit", equals: "10" }), world, "PASS");
    const fromManifest = vscodeDocument({
      settings: [settingReading({ value: "5", source: "default" })],
    });
    expect(
      field("vscode.setting", { target: "cart-web.limit", equals: "5" }),
      observed(fromManifest),
      "PASS",
    );
  });

  it("spells a setting nothing answered for as `(nothing)`, which is a value a criterion can assert", () => {
    // The extension *did* read it - that is what puts the key in the reading at all - and the value it
    // got was `undefined`, which its own fallback may or may not have replaced. The two facts are kept
    // apart: `(nothing)` here, and `INCONCLUSIVE` for a key that was never read.
    const unset = vscodeDocument({ settings: [settingReading({ value: null, source: "unset" })] });
    expect(field("vscode.setting", { target: "cart-web.limit", equals: "(nothing)" }), observed(unset), "PASS");
    expect(field("vscode.setting", { target: "cart-web.limit", equals: "10" }), observed(unset), "FAIL");
  });

  it("reports INCONCLUSIVE for a setting the extension never read, which is not a wrong value", () => {
    expect(
      field("vscode.setting", { target: "cart-web.other", equals: "1" }),
      world,
      "INCONCLUSIVE",
      /never read the setting/,
    );
  });

  it("judges what a status bar item says, including one that was created and never shown", () => {
    expect(field("vscode.status", { target: "cart.status", contains: "3 items" }), world, "PASS");
    // A hidden item is read rather than treated as absent, so "the extension created it and never showed
    // it" is an observation a criterion can make instead of an absence it cannot tell from "never
    // created it".
    const hidden = vscodeDocument({ status: [statusReading({ visible: false })] });
    expect(field("vscode.status", { target: "cart.status", contains: "3 items" }), observed(hidden), "PASS");
    const failed = expect(
      field("vscode.status", { target: "cart.status", contains: "4 items" }),
      observed(hidden),
      "FAIL",
    );
    assert.match(String(failed.message), /hidden/);
  });

  it("reports INCONCLUSIVE when the extension created no status item at all", () => {
    // A document holding a *different* item is what makes "no such item" reachable; the default
    // document holds `cart.status`, and reading it here would have judged a correct item.
    const other = vscodeDocument({ status: [statusReading({ id: "cart.other" })] });
    const missing = expect(
      field("vscode.status", { target: "cart.status", contains: "items" }),
      observed(other),
      "INCONCLUSIVE",
      /created no status bar item/,
    );
    assert.ok(String(missing.message).includes(quoted("cart.other")));
    expect(
      field("vscode.status", { target: "cart.status", contains: "items" }),
      observed(vscodeDocument({ status: [] })),
      "INCONCLUSIVE",
      /no status items at all/,
    );
  });
});

// ---- output, messages, durable state ------------------------------------------------------------------

describe("what was written, what was said, and what was stored", () => {
  it("reads a channel's lines joined, so `contains` asks whether a line was written", () => {
    expect(field("vscode.output", { target: "Cart", contains: "cart activated" }), world, "PASS");
    expect(
      field("vscode.output", { target: "Cart", equals: "cart activated\nlimit 10" }),
      world,
      "PASS",
    );
    expect(field("vscode.output", { target: "Cart", contains: "checkout failed" }), world, "FAIL");
  });

  it("spells an empty channel and a channel that does not exist as two different observations", () => {
    const empty = vscodeDocument({ output: [outputReading({ lines: [] })] });
    expect(
      field("vscode.output", { target: "Cart", equals: "(nothing was written to it)" }),
      observed(empty),
      "PASS",
    );
    // A channel the extension created and never wrote to is an observation; a channel it never created
    // is an absence, and the second names the channels that do exist so a reader is not sent looking.
    const notThere = expect(
      field("vscode.output", { target: "Checkout", contains: "anything" }),
      observed(empty),
      "INCONCLUSIVE",
      /created no output channel/,
    );
    assert.ok(String(notThere.message).includes(quoted("Cart")));
    expect(
      field("vscode.output", { target: "Checkout", contains: "anything" }),
      observed(vscodeDocument({ output: [] })),
      "INCONCLUSIVE",
      /created no output channels at all/,
    );
  });

  it("reads what the extension told a user who does not exist, and spells the silence", () => {
    expect(field("vscode.message", { contains: "warning: added 1 item" }), world, "PASS");
    const silent = vscodeDocument({ messages: [] });
    expect(field("vscode.message", { equals: "(no messages were shown)" }), observed(silent), "PASS");
    expect(field("vscode.message", { contains: "added 1 item" }), observed(silent), "FAIL");
  });

  it("reads a stored value out of the store the criterion named, because there are two stores", () => {
    const bothStores = vscodeDocument({
      state: [stateReading(), stateReading({ scope: "workspace", value: "9" })],
    });
    expect(
      field("vscode.state", { target: "global/cart.items", equals: "3" }),
      observed(bothStores),
      "PASS",
    );
    expect(
      field("vscode.state", { target: "workspace/cart.items", equals: "9" }),
      observed(bothStores),
      "PASS",
    );
    expect(
      field("vscode.state", { target: "workspace/cart.items", equals: "3" }),
      observed(bothStores),
      "FAIL",
    );
  });

  it("reports INCONCLUSIVE for a key nothing was written under, naming what the store does hold", () => {
    const wrongKey = expect(
      field("vscode.state", { target: "global/cart.totals", equals: "3" }),
      world,
      "INCONCLUSIVE",
      /globalState holds/,
    );
    assert.ok(String(wrongKey.message).includes(quoted("cart.items")));
    expect(
      field("vscode.state", { target: "workspace/cart.items", equals: "3" }),
      observed(vscodeDocument({ state: [] })),
      "INCONCLUSIVE",
      /workspaceState holds nothing at all/,
    );
  });
});

// ---- handles, files ----------------------------------------------------------------------------------

describe("a handle that was not released, and a file the extension touched", () => {
  it("judges a handle's disposal, which is the leak check an extension's deactivate owes", () => {
    // `equals: false` on a handle the host was handed is the shape of the check: a registration still
    // held after a reload is one that outlived the code that made it.
    expect(field("vscode.subscription", { target: "cart.add", equals: false }), world, "PASS");
    expect(field("vscode.subscription", { target: "cart.add", equals: true }), world, "FAIL");

    const released = vscodeDocument({ subscriptions: [subscriptionReading({ disposed: true })] });
    expect(field("vscode.subscription", { target: "cart.add", equals: true }), observed(released), "PASS");
    // A handle with a *different* id is what makes "no such handle" reachable: a document holding
    // `cart.add` would be judged, and the assertion would be about the wrong question entirely.
    const absent = expect(
      field("vscode.subscription", { target: "cart.add", equals: false }),
      observed(vscodeDocument({
        subscriptions: [subscriptionReading({ kind: "output", id: "Cart", disposed: true })],
      })),
      "INCONCLUSIVE",
      /never handed a handle with the id/,
    );
    assert.match(String(absent.message), /handed 1 handle, 0 of which are still held/);
  });

  it("says in the failure which kind of handle leaked, because two leaks have two repairs", () => {
    const leak = vscodeDocument({
      subscriptions: [subscriptionReading({ kind: "output", id: "Cart", disposed: false })],
    });
    expect(field("vscode.subscription", { target: "Cart", equals: false }), observed(leak), "PASS");
    const other = expect(
      field("vscode.subscription", { target: "Cart", equals: true }),
      observed(leak),
      "FAIL",
      /still held/,
    );
    assert.match(String(other.message), /output Cart/);
  });

  it("measures a file in the workspace, and reports INCONCLUSIVE rather than zero for one that is absent", () => {
    expect(field("vscode.file", { target: "report.json", atLeast: 1 }), world, "PASS");
    expect(field("vscode.file", { target: "report.json", equals: 128 }), world, "PASS");
    const tooBig = expect(
      field("vscode.file", { target: "report.json", atMost: 100 }),
      world,
      "FAIL",
    );
    assert.match(String(tooBig.message), /to be at most 100/);
    const absent = expect(
      field("vscode.file", { target: "missing.json", atLeast: 1 }),
      world,
      "INCONCLUSIVE",
      /The reading holds/,
    );
    assert.ok(String(absent.message).includes(quoted("report.json")));
    expect(
      field("vscode.file", { target: "missing.json", atLeast: 1 }),
      observed(vscodeDocument({ files: [] })),
      "INCONCLUSIVE",
      /no files at all/,
    );
  });

  it("says in the failure that the extension touched a file this world could not read", () => {
    const unreadable = vscodeDocument({ files: [fileReading({ bytes: 0, readable: false })] });
    const failed = expect(
      field("vscode.file", { target: "report.json", atLeast: 1 }),
      observed(unreadable),
      "FAIL",
      /not readable/,
    );
    assert.match(String(failed.message), /0 bytes/);
  });
});

// ---- refusals ----------------------------------------------------------------------------------------

describe("an API this world does not implement is an observation, not a crash", () => {
  it("judges the reason rather than the bare fact of the refusal", () => {
    expect(field("vscode.refusal", { target: "vscode.env", contains: "does not implement" }), world, "PASS");
    expect(
      field("vscode.refusal", { target: "vscode.env", equals: "this world does not implement vscode.env" }),
      world,
      "PASS",
    );
    expect(field("vscode.refusal", { target: "vscode.env", contains: "not installed" }), world, "FAIL");
  });

  it("reports INCONCLUSIVE when nothing was refused, and says what the reading is evidence of", () => {
    // This reading records refusals and not successful uses, so the absence of a record is not evidence
    // that the extension avoided the API. A `PASS` here would be a verdict the reading cannot justify.
    const clean = expect(
      field("vscode.refusal", { target: "vscode.env", contains: "not implemented" }),
      observed(vscodeDocument({ refusals: [] })),
      "INCONCLUSIVE",
      /absence of an observation/,
    );
    assert.match(String(clean.message), /refused nothing at all/);

    const another = expect(
      field("vscode.refusal", { target: "window.showQuickPick", contains: "not implemented" }),
      world,
      "INCONCLUSIVE",
      /This world refused/,
    );
    assert.ok(String(another.message).includes(quoted("vscode.env")));
  });
});

// ---- the action record, split by who issued it -------------------------------------------------------

describe("an action record is read by who issued it", () => {
  it("reads the application's newest action through vscode.call", () => {
    const two = vscodeDocument({
      calls: [
        callRecord({ action: "install", command: "veridian-vscode install cart-web" }),
        callRecord({ action: "activate", command: "veridian-vscode activate cart-web" }),
      ],
    });
    expect(field("vscode.call", { target: "install", equals: "answered" }), observed(two), "PASS");
    expect(field("vscode.call", { target: "activate", equals: "answered" }), observed(two), "PASS");
  });

  it("prefers the newest record for one action, because the world may have been asked twice", () => {
    const twice = vscodeDocument({
      calls: [
        callRecord({ action: "activate", result: "failed", reason: "activate raised" }),
        callRecord({ action: "activate", result: "answered", reason: null }),
      ],
    });
    expect(field("vscode.call", { target: "activate", equals: "answered" }), observed(twice), "PASS");
    const backwards = vscodeDocument({
      calls: [
        callRecord({ action: "activate", result: "answered", reason: null }),
        callRecord({ action: "activate", result: "failed", reason: "activate raised" }),
      ],
    });
    expect(field("vscode.call", { target: "activate", equals: "answered" }), observed(backwards), "FAIL");
  });

  it("reads a command line as a target, which is how a criterion observes a command the world refuses", () => {
    // The record for a command this world does not implement carries `action: null` and the command line
    // it was asked for, so keying the target on an action name alone would make the refusal unobservable
    // - which is the one thing a contract about a substitute most needs to see.
    const unimplemented = vscodeDocument({
      calls: [
        callRecord({
          action: null,
          command: "veridian-vscode publish cart-web",
          resource: null,
          result: "refused",
          status: 0,
          reason: "the world does not implement `publish`",
        }),
      ],
    });
    expect(
      field("vscode.call", { target: "veridian-vscode publish cart-web", equals: "refused" }),
      observed(unimplemented),
      "PASS",
    );
    expect(
      field("vscode.call", { target: "veridian-vscode publish cart-web", equals: "answered" }),
      observed(unimplemented),
      "FAIL",
      /does not implement it/,
    );
  });

  it("does not judge the criterion's own command as though the application had issued it", () => {
    // A criterion that issued a command is asking what the *world* did, not what the application did.
    // Judging either through the other would let a run pass on the strength of the run's own questions,
    // which is the false pass this product exists to refuse.
    const criterionOnly = vscodeDocument({
      calls: [callRecord({ action: "activate", client: "criterion", command: "veridian-vscode activate" })],
    });
    expect(
      field("vscode.call", { target: "activate", equals: "answered" }),
      observed(criterionOnly),
      "INCONCLUSIVE",
      /vscode\.probe/,
    );
    expect(
      field("vscode.probe", { target: "activate", equals: "answered" }),
      observed(criterionOnly),
      "PASS",
    );
  });

  it("points at vscode.call when only the application issued the action the criterion asked about", () => {
    expect(
      field("vscode.probe", { target: "activate", equals: "answered" }),
      world,
      "INCONCLUSIVE",
      /vscode\.call/,
    );
  });

  it("reports INCONCLUSIVE, listing what the record holds, when nothing matches the target", () => {
    const nothing = expect(
      field("vscode.call", { target: "publish", equals: "answered" }),
      world,
      "INCONCLUSIVE",
      /no command naming/,
    );
    assert.ok(String(nothing.message).includes(quoted("publish")));
    expect(
      field("vscode.call", { target: "publish", equals: "answered" }),
      observed(vscodeDocument({ calls: [] })),
      "INCONCLUSIVE",
      /holds no commands at all/,
    );
  });
});

// ---- the reading's own guard -------------------------------------------------------------------------

describe("the world's own guard accepts what the family judges", () => {
  it("holds a reading the guard accepts, and the guard still refuses a malformed one", () => {
    // Asserted because a fixture that the guard rejects would make every test above a test of
    // `readDocument`'s ERROR branch while reading as a test of the validator - the whole family would be
    // judged by a document nothing can read, and every expectation in this file would be meaningless.
    assert.ok(isVSCodeObservationData(vscodeDocument()), "the fixture is not a reading this world accepts");
    assert.equal(isVSCodeObservationData({ ...vscodeDocument(), calls: "no" }), false);
    assert.equal(isVSCodeObservationData({ ...vscodeDocument(), host: 7 }), false);
    assert.equal(isVSCodeObservationData(null), false);
  });
});
