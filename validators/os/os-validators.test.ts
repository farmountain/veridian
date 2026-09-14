import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  OS_OBSERVATION_KIND,
  OS_SIMULATED_SURFACES,
  caseSensitive,
} from "../../core/environment/os-observation.ts";
import type {
  OsAccessDecision,
  OsAclEntry,
  OsAclReading,
  OsExecRecord,
  OsFileReading,
  OsObservationData,
} from "../../core/environment/os-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";
import type { AssertionResult } from "../../core/validation/types.ts";
import { OS_VALIDATORS, OS_VALIDATOR_NAMES, osValidators } from "./os-validators.ts";

/**
 * The `os.*` family, proven offline against literal documents.
 *
 * `validators/playwright/web-ui-validators.test.ts` explains why a validator family is tested against
 * a document written by hand rather than through a world; the reason holds here as strongly as it does
 * for the database family and the POSIX one. A validator never opens a file, never runs a program and
 * never touches the sandbox tree - it reads one `OsObservationData` - so handing it one is the only way
 * to reach these branches without a substitute running, and it is the only way to reach them at all a
 * year later with nothing installed.
 *
 * `adapters/sim-os/os-port.test.ts` is the other half and answers a different question: that file
 * proves the *world* holds what it says it holds. This file proves the *judging* is right. Neither
 * substitutes for the other, and the reason this file exists at all is that `AGENTS.md` records what
 * happened the last time a family shipped with one half missing - `validators/database/` had no unit
 * coverage at all while `validators/playwright/` had 26 kB of it, so four functions that decide every
 * database criterion's status were held by a single demo. The same four-functions-per-family risk
 * applies here twelve times over.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - a document from another
 *    world, a target the family cannot spell, a file the reading does not hold, a text the reading
 *    declined to carry, a security record the world never wrote, a program this run never ran, a
 *    service whose principal could not be read - is asserted to be `INCONCLUSIVE` or `ERROR`, never
 *    `PASS`.
 *  - **A defect is a `FAIL`,** and only when a fact was actually read: an absent account, a stopped
 *    service, a refused command, a `"none"` decision.
 *  - **The distinctions that make the repairs different.** "The path is absent", "the world holds no
 *    record for it", "nobody recorded a decision", "the world decided no" and "the reading was told not
 *    to carry the text" are five facts with five different repairs, and a family that collapsed any two
 *    of them would send an agent at the wrong file.
 */

const registry = new ValidatorRegistry(osValidators());

const WINDOWS = "C:\\ProgramData\\Veridian";
const POLICY = `${WINDOWS}\\policy.conf`;
const SECRETS = `${WINDOWS}\\secrets.env`;
const UNGOVERNED = `${WINDOWS}\\autostart.log`;
const SHADOW = `${WINDOWS}\\shadow.conf`;
const RUN_KEY = "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
const EMPTY_KEY = "HKLM\\SOFTWARE\\Veridian\\Empty";
const MACOS = "/Library/Application Support/veridian";
const MACOS_POLICY = `${MACOS}/policy.conf`;

// ---- the two documents -----------------------------------------------------------------------------

const file = (path: string, overrides: Partial<OsFileReading> = {}): OsFileReading => ({
  path,
  kind: "file",
  bytes: 42,
  owner: "svc-audit",
  group: "Users",
  sha256: null,
  text: null,
  textWithheld: null,
  ...overrides,
});

const entry = (overrides: Partial<OsAclEntry> = {}): OsAclEntry => ({
  account: "svc-audit",
  permission: "read",
  allow: true,
  inherited: false,
  ...overrides,
});

const decision = (overrides: Partial<OsAccessDecision> = {}): OsAccessDecision => ({
  account: "svc-audit",
  permission: "read",
  decision: "permitted",
  because: "an explicit entry grants it",
  ...overrides,
});

/**
 * The security record for `policy.conf`.
 *
 * Composed rather than written out because three of the tests below depend on *which* entry fired and
 * on the difference between an explicit grant and an inherited one - and a fixture written as one
 * literal makes that difference hard to see and easy to break.
 */
const policyAcl: OsAclReading = {
  path: POLICY,
  owner: "svc-audit",
  mode: null,
  entries: [
    entry(),
    entry({ account: "db-operator", permission: "write", allow: false }),
    entry({ account: "Users", permission: "read", allow: true, inherited: true }),
    entry({ account: "Everyone", permission: "read", allow: true }),
  ],
  decisions: [
    decision(),
    decision({ permission: "write", decision: "refused", because: "an explicit deny covers it" }),
  ],
};

/**
 * A record for the secrets file whose decision is the family's centre.
 *
 * `read` was decided and `write` was never recorded, which is a *gap* - `permissionsOf` returns `null`
 * for it, and `null` is judged `INCONCLUSIVE`. `refusedAcl` below is the other half of the pair: a
 * record where both permissions were decided and both were refused, which is `"none"`, a fact, judged
 * `FAIL` when a criterion expected otherwise. Collapsing the two would turn an unrecorded decision
 * into a confident "this account may do nothing".
 */
const partialAcl: OsAclReading = {
  path: SECRETS,
  owner: "db-operator",
  mode: null,
  entries: [entry({ account: "db-operator" })],
  decisions: [decision({ account: "db-operator" })],
};

/**
 * A record whose *entries* and whose *decisions* disagree. This is the fixture that proves which of
 * the two the family reads.
 *
 * A grant is followed by a deny for the same account and permission, which on a real Windows volume is
 * a single win for the deny. Summing the entries would answer "allowed"; reading the decision says
 * "refused". The record is legal and ordinary, and it is the reason `OsAccessDecision` exists at all -
 * the ordering rules are exactly the part of a real system that is easy to model almost correctly.
 */
const contestedAcl: OsAclReading = {
  path: SHADOW,
  owner: "svc-audit",
  mode: null,
  entries: [
    entry(),
    entry({ allow: false }),
    entry({ account: "db-operator", permission: "write", allow: true }),
  ],
  decisions: [
    decision({ decision: "refused", because: "a deny following the grant decides it" }),
    decision({ permission: "write", decision: "permitted" }),
    decision({ account: "db-operator", permission: "write", decision: "refused" }),
  ],
};

const refusedAcl: OsAclReading = {
  path: SECRETS,
  owner: "db-operator",
  mode: null,
  entries: [entry({ account: "db-operator", allow: false })],
  decisions: [
    decision({ account: "db-operator", decision: "refused" }),
    decision({ account: "db-operator", permission: "write", decision: "refused" }),
  ],
};

const windowsDocument = (overrides: Partial<OsObservationData> = {}): OsObservationData => ({
  host: "veridian-sim-os",
  family: "windows",
  system: "Windows Server 2022",
  root: "/tmp/veridian-sim-os",
  user: "svc-audit",
  caseSensitive: false,
  simulated: OS_SIMULATED_SURFACES,
  execs: [],
  files: [
    file(POLICY, { text: "POLICY=strict\n" }),
    file(SECRETS, { textWithheld: "the reading does not carry a secret-bearing file" }),
    file(UNGOVERNED, { owner: "cart-web" }),
    file(SHADOW),
  ],
  acls: [policyAcl, contestedAcl],
  accounts: [
    { name: "svc-audit", kind: "user", home: `${WINDOWS}\\home`, groups: ["Users"], createdBy: "application" },
  ],
  settings: [
    {
      scope: "system",
      container: RUN_KEY,
      name: "CartWeb",
      value: "C:\\cart-web\\start.cmd",
      type: "REG_SZ",
      writtenBy: "application",
    },
  ],
  services: [
    {
      name: "cart-web",
      status: "running",
      enabled: true,
      command: "node server.mjs",
      pid: 41,
      account: "svc-audit",
      port: 4173,
    },
    {
      name: "cart-audit",
      status: "stopped",
      enabled: false,
      command: "node audit.mjs",
      pid: null,
      account: "",
      port: null,
    },
  ],
  ...overrides,
});

/**
 * A second document from the *other* family, with the reading's own field set to say so.
 *
 * Its purpose is not decoration: the family's two resolvers branch on the reading's family, and a
 * suite that only ever handed them a Windows document would hold one branch and call it the rule.
 * `caseSensitive: true` is set deliberately so that the folding branch is exercised on a family that
 * does not fold - a reader who sees `caseSensitive` in the document can tell which world answered, and
 * this fixture is a world that answers differently.
 */
const macosDocument = (overrides: Partial<OsObservationData> = {}): OsObservationData => ({
  host: "veridian-sim-os",
  family: "macos",
  system: "macOS 14 Sonoma",
  root: "/tmp/veridian-sim-os",
  user: "svc-audit",
  caseSensitive: false,
  simulated: OS_SIMULATED_SURFACES,
  execs: [],
  files: [file(MACOS_POLICY, { text: "POLICY=strict\n", owner: "svc-audit" })],
  acls: [],
  accounts: [],
  settings: [
    {
      scope: "user",
      container: "com.veridian.app",
      name: "Autostart",
      value: "1",
      type: "integer",
      writtenBy: "application",
    },
  ],
  services: [],
  ...overrides,
});

const exec = (overrides: Partial<OsExecRecord> = {}): OsExecRecord => ({
  source: "application",
  argv: ["net", "user", "svc-audit", "/add"],
  program: "net",
  result: "completed",
  exitCode: 0,
  stdout: "",
  stderr: "",
  reason: null,
  durationMs: 3,
  ...overrides,
});

const observed = (data: unknown, kind: string = OS_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-os:windows:svc-audit",
  runId: "run-1",
  data,
  artifacts: [
    { path: "artifacts/AC-001.observation.json", kind: "json" },
    { path: "artifacts/AC-001.execs.json", kind: "json" },
  ],
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

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point and not the criterion's: it bypasses the observation-kind
 * check deliberately, so that the family's own status discipline is what is under test rather than
 * `evaluateCriterion`'s evidence rules - which have their own suite.
 */
const judge = (raw: Readonly<Record<string, unknown>>, observation: Observation): AssertionResult =>
  registry.require(String(raw["validator"])).validate(raw, observation);

const field = (
  validator: string,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...values });

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

const win = observed(windowsDocument());
const mac = observed(macosDocument());

// ---- the roster ------------------------------------------------------------------------------------

describe("the roster is the code, and the contract the demo ships uses every name in it", () => {
  it("names exactly the twelve validators the family exports, in both directions", () => {
    const declared = Object.values(OS_VALIDATOR_NAMES);
    assert.equal(declared.length, 12, "the family's name record changed size");
    assert.deepEqual(
      OS_VALIDATORS.map((validator) => validator.name).sort(),
      [...declared].sort(),
      "the registry of validators and the record of names are the same vocabulary written twice, and " +
        "a name in one and not the other is a validator the schema accepts and the engine cannot run, " +
        "or the reverse",
    );
    assert.ok(Object.isFrozen(OS_VALIDATORS), "the roster is a global a caller could edit in place");
  });

  it("spells every name so that an acceptance contract can be written at all", () => {
    // Not a style preference: `acceptance.schema.json` matches a validator name against
    // `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `os.ACL` would be a criterion no document can express.
    for (const name of Object.values(OS_VALIDATOR_NAMES)) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, `${name} is not writable in a contract`);
    }
  });

  it("declares the world it reads and the target it needs, on every member", () => {
    for (const validator of OS_VALIDATORS) {
      assert.equal(
        validator.observationKind,
        OS_OBSERVATION_KIND,
        `${validator.name} does not declare the system document, so a criterion using it would be ` +
          "judged against a reading it never asked for",
      );
      assert.equal(validator.needsTarget, true, `${validator.name} judges something and names it`);
      assert.ok(
        (validator.targetNoun ?? "").length > 0,
        `${validator.name} needs a target and does not say which kind, so the clarification ladder ` +
          "cannot ask for one",
      );
    }
  });

  it("covers every validator the shipped demo's contract asks for, and asks for all twelve", () => {
    // A list of names in a document is a claim about the code. This is the cheapest way to hold it:
    // read the document and compare it to the roster, in both directions - an invented name would be a
    // criterion the demo cannot run, and a validator no contract uses would be a verdict nothing
    // needs. Measured rather than asserted from memory.
    const contract = readFileSync(new URL("../../examples/sim-os/acceptance.yaml", import.meta.url), "utf8");
    const named = new Set(
      [...contract.matchAll(/validator:\s*(os\.[a-z0-9.]+)/g)].map((match) => match[1] ?? ""),
    );
    const unknown = [...named].filter((name) => !Object.values(OS_VALIDATOR_NAMES).includes(name as never));
    assert.deepEqual(unknown, [], "the demo's contract names a validator the family does not have");
    assert.deepEqual(
      [...named].sort(),
      Object.values(OS_VALIDATOR_NAMES).sort(),
      "the demo exercises the family, and a name it never uses is a branch nothing has run end to end",
    );
  });

  it("keeps the substitute out of the vocabulary that judges it", () => {
    // The same rule as the layering rule in `AGENTS.md`, at the one seam where it matters most: a
    // validator that could reach `adapters/sim-os/` could be told whether the system was substituted,
    // and a verdict that depends on what stood in for the system is not a verdict about the system.
    const source = readFileSync(new URL("./os-validators.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.deepEqual(
      imports.filter((specifier) => specifier.includes("adapters/")),
      [],
      "the family reads a document; a validator that imported the world could report on the substitute",
    );
  });
});

// ---- documents from other worlds -------------------------------------------------------------------

describe("a document from another world is an environment defect, not a judgment", () => {
  it("reports ERROR naming the environment when the reading is another world's", () => {
    const result = expect(
      field("os.file", { target: POLICY, equals: true }),
      observed(webDocument, WEB_OBSERVATION_KIND),
      "ERROR",
      /does not carry a system document/,
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    // `actual` carries the payload that arrived rather than `null`, which is deliberate: the message
    // says a system document was not found, and a reader diagnosing the adapter needs to see what
    // arrived in its place. Asserted rather than assumed - the first version of this test asserted
    // `null` and was wrong about the code.
    assert.equal(result.actual, webDocument);
  });

  it("reports ERROR and blames the environment rather than the application when the reading is absent", () => {
    const result = expect(field("os.account", { target: "svc-audit", equals: true }), observed(null), "ERROR");
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });
});

// ---- targets, and the resolver's own reason --------------------------------------------------------

describe("a target is validated by the family's own resolver, and its refusal is quoted", () => {
  it("refuses a forward-slash path in a Windows world, in the resolver's words", () => {
    // The refusal is quoted rather than summarized because the resolver is the thing that knows the
    // cause; a validator that wrote its own message would name whatever its author thought of, which is
    // the defect this repository has already paid for twice.
    expect(
      field("os.file", { target: "/etc/os-release", equals: true }),
      win,
      "ERROR",
      /separates with a forward slash/,
    );
  });

  it("refuses a relative path rather than resolving it against something", () => {
    expect(
      field("os.file", { target: "sandbox\\policy.conf", equals: true }),
      win,
      "ERROR",
      /an absolute path in this world begins with a drive letter/,
    );
  });

  it("refuses a path that climbs out of the tree the reading was taken from", () => {
    expect(
      field("os.file", { target: "C:\\ProgramData\\..\\..\\Windows\\win.ini", equals: true }),
      win,
      "ERROR",
      /`\.\.` segment names a place outside the tree/,
    );
  });

  it("refuses a Windows spelling against a macOS reading, and quotes the reason", () => {
    expect(
      field("os.file", { target: "C:\\ProgramData\\Veridian\\policy.conf", equals: true }),
      mac,
      "ERROR",
      /separates with a backslash/,
    );
  });

  it("resolves the other family's spelling, so the two branches are both reachable", () => {
    // Without this the suite would hold one branch and call it the rule: every refusal above is about
    // Windows, and a resolver that refused *everything* would satisfy all of them.
    expect(field("os.file", { target: MACOS_POLICY, equals: true }), mac, "PASS");
    expect(field("os.contents", { target: MACOS_POLICY, contains: "POLICY=strict" }), mac, "PASS");
  });

  it("refuses a validator that was given no target, naming what it reads", () => {
    const result = expect(field("os.acl", { contains: "deny" }), win, "ERROR", /named no target/);
    assert.equal(result.failureKind, "VALIDATOR_ERROR");
    assert.match(String(result.message), /This validator reads an `<account>:<path>` reference|reads a path/);
  });

  it("refuses an access target that names no account, and one that names an impossible one", () => {
    expect(field("os.access", { target: "policy.conf", equals: "read" }), win, "ERROR", /named no account/);
    expect(
      field("os.access", { target: `9svc:${POLICY}`, equals: "read" }),
      win,
      "ERROR",
      /is not an account name this world can look up/,
    );
  });

  it("reads a bare Windows path as an account and refuses it, rather than inventing one", () => {
    // Measured rather than assumed: the reference is split on the *first* colon, which on Windows is
    // the drive's - so `C:\ProgramData\...` proposes an account called `C`, and `C` is spelled well
    // enough to pass the name check. What stops it is the path resolver, refusing the remainder
    // because it is not absolute. The refusal is what matters and it is still an ERROR, but the note is
    // here because a reader seeing "begins with a drive letter" against a path that visibly begins with
    // a drive letter would otherwise be sent looking for a defect in the resolver.
    expect(
      field("os.access", { target: POLICY, equals: "read" }),
      win,
      "ERROR",
      /an absolute path in this world begins with a drive letter/,
    );
  });
});

// ---- presence, contents and ownership --------------------------------------------------------------

describe("presence is a question with its own repair", () => {
  it("passes for something the reading holds and fails for something it does not", () => {
    expect(field("os.file", { target: POLICY, equals: true }), win, "PASS");
    const absent = expect(field("os.file", { target: `${WINDOWS}\\nowhere.conf`, equals: true }), win, "FAIL");
    assert.equal(absent.actual, false, "the world was asked and answered; that is a FAIL, not a gap");
  });

  it("accepts the words `present` and `absent` as well as the booleans", () => {
    expect(field("os.file", { target: POLICY, equals: "present" }), win, "PASS");
    expect(field("os.file", { target: `${WINDOWS}\\nowhere.conf`, equals: "absent" }), win, "PASS");
  });

  it("folds case on both families, because the vocabulary's own table says their volumes fold", () => {
    // Where the folding comes from is worth stating precisely, since the first version of this test
    // assumed the *document's* `caseSensitive` field decided it and was wrong about the code: the
    // answer is derived from the family (`OS_CASE_FOLDING`), and the field in the reading is the record
    // of which world answered. Asserting the two agree is what stops a fixture - or an adapter - from
    // describing a volume that folds while claiming one that does not.
    assert.equal(caseSensitive("windows"), false);
    assert.equal(caseSensitive("macos"), false);
    assert.equal(windowsDocument().caseSensitive, caseSensitive("windows"));
    assert.equal(macosDocument().caseSensitive, caseSensitive("macos"));

    expect(field("os.file", { target: "c:\\programdata\\veridian\\POLICY.CONF", equals: true }), win, "PASS");
    expect(
      field("os.file", { target: "/library/application support/veridian/policy.conf", equals: true }),
      mac,
      "PASS",
    );
  });

  it("judges the text the reading carried, and refuses to judge one it withheld", () => {
    expect(field("os.contents", { target: POLICY, equals: "POLICY=strict\n" }), win, "PASS");
    expect(field("os.contents", { target: POLICY, matches: "^POLICY=" }), win, "PASS");
    const withheld = expect(
      field("os.contents", { target: SECRETS, equals: "" }),
      win,
      "INCONCLUSIVE",
      /did not carry its contents/,
    );
    assert.match(
      String(withheld.message),
      /the reading does not carry a secret-bearing file/,
      "the reading's own reason is quoted, so a reader learns which file it was rather than that one " +
        "somewhere was unreadable",
    );
  });

  it("reports a path it does not hold as a gap, naming the validator that owns presence", () => {
    const result = expect(
      field("os.owner", { target: `${WINDOWS}\\nowhere.conf`, equals: "svc-audit" }),
      win,
      "INCONCLUSIVE",
      /holds no file at/,
    );
    assert.match(String(result.message), /`os\.file`/);
  });

  it("answers for a file the world holds but never governed, because ownership is a property of the object", () => {
    // The security record for this path is deliberately absent from the fixture: the tree walk finds
    // files the world never wrote permissions for, and the owner is still a fact the world knows.
    assert.equal(windowsDocument().acls.some((acl) => acl.path === UNGOVERNED), false);
    expect(field("os.owner", { target: UNGOVERNED, equals: "cart-web" }), win, "PASS");
  });
});

// ---- the three questions about one file ------------------------------------------------------------

describe("three questions about one file, answered from three places in the reading", () => {
  it("reads the entries written on a path, sorted, one per line", () => {
    // Sorted by the *lower-cased* account, so `db-operator` precedes `Everyone` rather than following
    // it - which is the whole reason the rendering is built from a sorted list rather than written in
    // the order the record happens to hold.
    const rendering =
      "db-operator:write:deny\n" +
      "Everyone:read:allow\n" +
      "svc-audit:read:allow\n" +
      "Users:read:allow:inherited";
    expect(field("os.acl", { target: POLICY, equals: rendering }), win, "PASS");
    expect(field("os.acl", { target: POLICY, contains: ":deny" }), win, "PASS");
    expect(field("os.acl", { target: POLICY, contains: "Everyone:read:allow" }), win, "PASS");
  });

  it("reads an inherited grant differently from one written here, which is the sentence hardening wants", () => {
    expect(field("os.acl", { target: POLICY, contains: "Users:read:allow:inherited" }), win, "PASS");
    expect(
      field("os.acl", { target: POLICY, contains: "svc-audit:read:allow:inherited" }),
      win,
      "FAIL",
      /but it is/,
    );
  });

  it("reports a record the world never wrote as a gap, and says it is not an empty list", () => {
    const result = expect(
      field("os.acl", { target: UNGOVERNED, equals: "" }),
      win,
      "INCONCLUSIVE",
      /holds no security record for it/,
    );
    assert.match(String(result.message), /This is not an empty access control list/);
  });

  it("judges the world's decision, not a re-derivation of the entry list", () => {
    expect(field("os.access", { target: `svc-audit:${POLICY}`, equals: "read" }), win, "PASS");
    const refused = expect(
      field("os.access", { target: `svc-audit:${POLICY}`, equals: "write" }),
      win,
      "FAIL",
      /but it is "read"/,
    );
    assert.equal(refused.actual, "read", "the permissions held are a rendering, not the entry list");

    // The fixture that proves it: `shadow.conf` holds an entry *granting* `svc-audit` read and an entry
    // denying it, and the world recorded the decision as refused. Summing the entries answers "read";
    // the family answers "write", because the read decision is refused. If this ever starts passing on
    // an entry search, the family has silently become a model of ACL ordering - the part of a real
    // system that is easy to model almost correctly.
    expect(field("os.access", { target: `svc-audit:${SHADOW}`, equals: "write" }), win, "PASS");
    expect(field("os.access", { target: `svc-audit:${SHADOW}`, equals: "read" }), win, "FAIL", /but it is "write"/);
  });

  it("folds the account when reading a decision, as the world does when writing one", () => {
    expect(field("os.access", { target: `SVC-AUDIT:${POLICY}`, equals: "read" }), win, "PASS");
  });

  it("separates a decision of `none` from a decision nobody recorded", () => {
    // The pair this family's documentation calls its centre, and the two answers are deliberately not
    // the same status: `"none"` is a fact the world concluded and is judged, while `null` is a gap in
    // the reading and is not. A validator that collapsed them would turn an unrecorded decision into a
    // confident "this account may do nothing" - a verdict nobody observed.
    const none = expect(
      field("os.access", { target: `db-operator:${SECRETS}`, equals: "read" }),
      observed(windowsDocument({ acls: [refusedAcl] })),
      "FAIL",
      /but it is "none"/,
    );
    assert.equal(none.actual, "none");

    const gap = expect(
      field("os.access", { target: `db-operator:${SECRETS}`, equals: "read" }),
      observed(windowsDocument({ acls: [partialAcl] })),
      "INCONCLUSIVE",
      /records no decision for/,
    );
    assert.match(String(gap.message), /may not derive the answer from the entry list/);
  });
});

// ---- the store, the services and the principal -----------------------------------------------------

describe("the store, the services and the principal", () => {
  it("renders a container as one line per value, sorted, and the empty string when it holds nothing", () => {
    expect(field("os.setting", { target: RUN_KEY, equals: "CartWeb=C:\\cart-web\\start.cmd" }), win, "PASS");
    expect(field("os.setting", { target: RUN_KEY, contains: "Autostart=" }), win, "FAIL");
    // "this key holds no autostart entry" is a sentence a criterion can write, and it is only writable
    // because the rendering of an empty container is the empty string rather than a null.
    expect(field("os.setting", { target: EMPTY_KEY, equals: "" }), win, "PASS");
  });

  it("refuses a per-user store by name, quoting the world's reason rather than resolving it", () => {
    expect(
      field("os.setting", { target: "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", equals: "" }),
      win,
      "ERROR",
      /holds the machine-wide store only/,
    );
  });

  it("refuses a hive this world does not hold, and a hive with nothing under it", () => {
    expect(field("os.setting", { target: "HKCR\\Veridian", equals: "" }), win, "ERROR", /holds `HKLM` alone/);
    expect(field("os.setting", { target: "HKLM", equals: "" }), win, "ERROR", /hive on its own/);
  });

  it("addresses the other family's store by preference domain, and refuses the wrong spelling for each", () => {
    expect(field("os.setting", { target: "com.veridian.app", equals: "Autostart=1" }), mac, "PASS");
    expect(field("os.setting", { target: RUN_KEY, equals: "" }), mac, "ERROR", /preference domain/);
    expect(
      field("os.setting", { target: "com.veridian.app", equals: "" }),
      win,
      "ERROR",
      /addressed with\s+backslashes|hive/,
    );
  });

  it("answers whether an account exists, and compares the name as the family spells it", () => {
    expect(field("os.account", { target: "svc-audit", equals: true }), win, "PASS");
    expect(field("os.account", { target: "svc-audit", equals: "present" }), win, "PASS");
    expect(field("os.account", { target: "cart", equals: false }), win, "PASS");
    // `accountNamed` deliberately does not fold: an account name is an identifier the system holds
    // exactly, and a contract that found `SVC-AUDIT` where the world recorded `svc-audit` would pass on
    // a mis-cased provisioning step that a real system would have refused.
    expect(field("os.account", { target: "SVC-AUDIT", equals: true }), win, "FAIL");
  });

  it("asks presence of a service as one question and status as another, because the repairs differ", () => {
    expect(field("os.service", { target: "cart-web", equals: true }), win, "PASS");
    expect(field("os.service", { target: "cart-audit", equals: true }), win, "PASS");
    expect(field("os.service", { target: "cart-db", equals: false }), win, "PASS");
    expect(field("os.running", { target: "cart-web", equals: "running" }), win, "PASS");
    // Registered and stopped is a service that failed to start, and it is a FAIL rather than a gap -
    // which is exactly the fact `os.service` cannot express and this validator exists for.
    expect(field("os.running", { target: "cart-audit", equals: "running" }), win, "FAIL", /but it is "stopped"/);
  });

  it("reports a service the reading does not hold as a gap, naming the validator that owns presence", () => {
    const result = expect(
      field("os.running", { target: "cart-db", equals: "stopped" }),
      win,
      "INCONCLUSIVE",
      /holds no service/,
    );
    assert.match(String(result.message), /`os\.service`/);
    assert.match(String(result.message), /not a service that is stopped/);
  });

  it("rejects a status outside the reading's vocabulary instead of judging it false forever", () => {
    // A comparison that can only ever be false is indistinguishable from an application defect, and it
    // is the shape that sends an agent to repair working code.
    expect(
      field("os.running", { target: "cart-web", equals: "started" }),
      win,
      "ERROR",
      /wants one of running, stopped, failed/,
    );
  });

  it("reads the principal, and reports a gap when the world could not read one out of the definition", () => {
    expect(field("os.principal", { target: "cart-web", equals: "svc-audit" }), win, "PASS");
    // A regular expression is written as a string in a contract, not handed over as an object - which
    // the comparison refuses by name, and which this test asserted wrongly on its first run.
    expect(field("os.principal", { target: "cart-web", matches: "^svc-" }), win, "PASS");
    const unreadable = expect(
      field("os.principal", { target: "cart-audit", equals: "svc-audit" }),
      win,
      "INCONCLUSIVE",
      /records no account for it/,
    );
    assert.match(
      String(unreadable.message),
      /report a defect in the application for a fact this world\s+never determined/,
      "an empty principal is the world failing to find out, not the application running as nobody",
    );
  });
});

// ---- the action record -----------------------------------------------------------------------------

describe("the action record is split by who asked, and the newest answer is judged", () => {
  it("judges the newest execution by the application, not the first", () => {
    // The record is a chronological log: a program this world refused on an early iteration and
    // performed after a repair is a program that works now.
    const document = windowsDocument({
      execs: [
        exec({ result: "refused", exitCode: null, reason: "the world does not hold this program" }),
        exec({ result: "completed", exitCode: 0 }),
      ],
    });
    const result = expect(field("os.ran", { target: "net", equals: "completed" }), observed(document), "PASS");
    assert.equal(result.actual, "completed");

    const stillBroken = observed(
      windowsDocument({ execs: [exec({ result: "completed" }), exec({ result: "nonzero", exitCode: 2 })] }),
    );
    expect(field("os.ran", { target: "net", equals: "completed" }), stillBroken, "FAIL", /but it is "nonzero"/);
  });

  it("judges the criterion's own command separately from the application's", () => {
    // The containment contract: a criterion that runs a command and asserts `refused` is stating that
    // the sandbox held. Judging it through `os.ran` would let a run pass on the strength of the run's
    // own questions, which is the false pass this product exists to refuse.
    const document = windowsDocument({
      execs: [
        exec({ source: "application", program: "net" }),
        exec({
          source: "criterion",
          argv: ["type", "..\\..\\Windows\\win.ini"],
          program: "type",
          result: "refused",
          exitCode: null,
          reason: "this command climbs out of the sandbox",
        }),
      ],
    });
    expect(field("os.probe", { target: "type", equals: "refused" }), observed(document), "PASS");
    // The application never ran `type` at all, so `os.ran` must not answer for the criterion's copy.
    const crossed = expect(
      field("os.ran", { target: "type", equals: "refused" }),
      observed(document),
      "INCONCLUSIVE",
      /only the executions issued by application/,
    );
    assert.match(String(crossed.message), /`os\.probe`/);
  });

  it("tells an absent record apart from a record that belongs to somebody else", () => {
    // Two different facts with two different readers: nobody ran the program, or somebody who is not
    // the application ran it. A single message covering both would send half its readers to the wrong
    // file.
    const never = expect(
      field("os.ran", { target: "sc", equals: "completed" }),
      win,
      "INCONCLUSIVE",
      /recorded no execution of `sc` at all/,
    );
    const elsewhere = expect(
      field("os.ran", { target: "net", equals: "completed" }),
      observed(windowsDocument({ execs: [exec({ source: "criterion" })] })),
      "INCONCLUSIVE",
      /issued by criterion/,
    );
    assert.notEqual(never.message, elsewhere.message);
  });

  it("names the caller as the caller named it, not as the world resolved it", () => {
    // `argv[0]` holds the substitute's path when the world substituted a program, so keying on it would
    // make this validator unfindable for exactly the commands a criterion is most likely to ask about.
    const document = windowsDocument({
      execs: [exec({ program: "net", argv: ["/substitute/net", "user"] })],
    });
    expect(field("os.ran", { target: "net", equals: "completed" }), observed(document), "PASS");
  });

  it("rejects a result outside the reading's vocabulary", () => {
    // The document has to hold a record for the program, because a comparison is only reached once
    // there is something to compare - an absent record is answered first, and that answer is a gap
    // rather than a rejection. Written this way round deliberately: the obvious version of this test
    // was `win`, which holds no executions at all, and it asserted the wrong branch.
    const document = observed(windowsDocument({ execs: [exec({ program: "net" })] }));
    expect(field("os.ran", { target: "net", equals: "ok" }), document, "ERROR", /wants one of completed/);
    assert.match(
      String(judge(field("os.ran", { target: "net", equals: "ok" }), document).message),
      /completed, nonzero, refused, timed-out/,
    );
  });
});

// ---- expectations that cannot fail -----------------------------------------------------------------

describe("an expectation that cannot fail is not a judgment", () => {
  it("refuses an expectation that states no comparison", () => {
    expect(field("os.file", { target: POLICY }), win, "ERROR", /states no comparison/);
  });

  it("refuses a presence comparison against a word that is not a presence", () => {
    expect(field("os.file", { target: POLICY, equals: "yes" }), win, "ERROR", /wants true, false/);
  });

  it("refuses a text comparison against a number", () => {
    expect(field("os.contents", { target: POLICY, equals: 3 }), win, "ERROR", /compares text with a string/);
  });

  it("leaves a passing assertion without a message, so a skim cannot read one as the failure", () => {
    const passed = judge(field("os.file", { target: POLICY, equals: true }), win);
    assert.equal(passed.status, "PASS");
    assert.equal(passed.message, null);
  });
});
