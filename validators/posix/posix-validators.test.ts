import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMPARISON_KEYS } from "../../core/acceptance/plan.ts";
import type { DbObservationData } from "../../core/environment/db-observation.ts";
import {
  POSIX_OBSERVATION_KIND,
  POSIX_SIMULATED_SURFACES,
} from "../../core/environment/posix-observation.ts";
import type {
  PosixExecRecord,
  PosixFileReading,
  PosixObservationData,
  PosixPackageReading,
  PosixPortReading,
  PosixServiceReading,
  PosixUserReading,
} from "../../core/environment/posix-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { ValidatorRegistry, evaluateCriterion } from "../../core/validation/registry.ts";
import type { AssertionResult, CriterionSpec } from "../../core/validation/types.ts";
import { POSIX_VALIDATORS, POSIX_VALIDATOR_NAMES, posixValidators } from "./posix-validators.ts";

/**
 * The `posix.*` family, proven offline against literal documents.
 *
 * The case for this file is the same as the one for `k8s-validators.test.ts`, one world further out. A
 * validator here reads a `PosixObservationData` and never opens a file, never spawns a process and
 * never connects to a socket, so a document written by hand is the *only* way to reach the branches
 * that matter - and most of those branches are the difference between "the system holds the wrong
 * thing" and "nobody looked", which needs a document that says one and not the other. The `sim-posix`
 * demo will prove the adapter produces such a document; nothing else proves the family judges one
 * correctly.
 *
 * The properties under test are the ones the product is measured by:
 *
 *  - **M3, zero false PASS.** Everything that could be mistaken for a pass - an unreadable document, a
 *    path the reading does not hold, a program the world never ran, a file whose contents were
 *    withheld, a port whose state was not confirmed, an expectation with no comparison, a package the
 *    world removed - is asserted to be `INCONCLUSIVE` or `ERROR` or `FAIL`, never `PASS`.
 *  - **A defect is a `FAIL`.** The shapes a broken provisioner actually takes: a mode that is too
 *    open, an owner that is the wrong account, a unit that is stopped, a command that exited
 *    non-zero, a command the world refused, a port that answers nobody.
 *  - **The distinctions a repair depends on.** "The file is absent" and "the mode is wrong" and "the
 *    contents are wrong" are three facts with three repairs, and the family keeps them apart by
 *    handing presence to the validator that owns it rather than reporting it here.
 *  - **A simulated world declares itself.** Every fixture is built from the vocabulary the adapter
 *    writes, so a test cannot pass against a document no world would ever emit.
 */

const registry = new ValidatorRegistry(posixValidators());

const HARDENING = "/etc/veridian/hardening.conf";
const SECRETS = "/etc/veridian/secrets.env";
const SERVER = "/opt/app/server.js";

const fileReading = (overrides: Partial<PosixFileReading> = {}): PosixFileReading => ({
  path: HARDENING,
  kind: "file",
  bytes: 42,
  mode: "0600",
  owner: "app",
  group: "app",
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  text: "# Veridian hardening\nsshd: off\n",
  textWithheld: null,
  ...overrides,
});

const userReading = (overrides: Partial<PosixUserReading> = {}): PosixUserReading => ({
  name: "app",
  uid: 1000,
  gid: 1000,
  shell: "/bin/sh",
  home: "/home/app",
  groups: ["app"],
  ...overrides,
});

const packageReading = (overrides: Partial<PosixPackageReading> = {}): PosixPackageReading => ({
  name: "ufw",
  version: "0.36.2-1",
  status: "installed",
  installedBy: "application",
  ...overrides,
});

const serviceReading = (overrides: Partial<PosixServiceReading> = {}): PosixServiceReading => ({
  name: "nginx",
  status: "running",
  enabled: true,
  command: "/usr/sbin/nginx",
  pid: 4321,
  ...overrides,
});

const portReading = (overrides: Partial<PosixPortReading> = {}): PosixPortReading => ({
  port: 8080,
  protocol: "tcp",
  address: "127.0.0.1",
  state: "listening",
  service: "nginx",
  verified: true,
  ...overrides,
});

const execReading = (overrides: Partial<PosixExecRecord> = {}): PosixExecRecord => ({
  source: "application",
  argv: ["apt-get", "install", "-y", "ufw"],
  program: "apt-get",
  result: "completed",
  exitCode: 0,
  stdout: "",
  stderr: "",
  reason: null,
  durationMs: 12,
  ...overrides,
});

/**
 * The world after a provisioning program did its job: the shape a passing criterion is judged against.
 *
 * Written as one document rather than assembled per test, because the interesting properties are
 * agreements between its records - the mode and the owner of the same file, the unit that is running
 * and the port that answers, the package that is installed and the command that installed it - and a
 * fixture built from one patched field at a time would not hold any of them.
 */
const hardened = (): PosixObservationData => ({
  host: "sim-posix-01",
  distribution: "veridian-simulated-linux",
  root: "D:/all_projects/Veridian/.veridian/environments/hardening/app/.sandbox",
  user: "app",
  simulated: POSIX_SIMULATED_SURFACES,
  execs: [
    execReading(),
    execReading({
      argv: ["/usr/lib/veridian/bin/systemctl", "restart", "nginx"],
      program: "systemctl",
      stdout: "nginx.service: started\n",
    }),
    execReading({
      source: "world",
      argv: ["/usr/lib/veridian/bin/dpkg", "--configure", "openssl"],
      program: "dpkg",
    }),
  ],
  files: [
    fileReading(),
    fileReading({
      path: SECRETS,
      bytes: 8,
      text: null,
      textWithheld: "the contents are not valid UTF-8",
    }),
    fileReading({
      path: "/etc/veridian",
      kind: "directory",
      bytes: 0,
      mode: "0755",
      sha256: null,
      text: null,
    }),
    fileReading({ path: SERVER, mode: "0644", owner: "app", text: "require('./cart');\n" }),
    // The file that makes the permission question worth asking: the same mode, a different account.
    fileReading({ path: "/etc/shadow", mode: "0600", owner: "root", group: "root", text: null, textWithheld: "not permitted for the account the criteria act as" }),
  ],
  users: [
    userReading({ name: "root", uid: 0, gid: 0, shell: "/bin/sh", home: "/root", groups: ["root"] }),
    userReading(),
    userReading({ name: "daemon", uid: 1, gid: 1, shell: "/usr/sbin/nologin", home: "/", groups: ["daemon"] }),
  ],
  packages: [
    packageReading(),
    packageReading({ name: "openssl", version: "3.0.13-1", installedBy: "world" }),
    packageReading({ name: "fail2ban", version: "1.0.2-3", installedBy: "criterion" }),
    // Held by the world's database and *not* installed. The false pass this family must not report.
    packageReading({ name: "telnetd", version: "0.17-42", status: "removed", installedBy: "application" }),
  ],
  services: [
    serviceReading(),
    serviceReading({ name: "ufw", status: "stopped", enabled: false, command: "/usr/sbin/ufw", pid: null }),
  ],
  ports: [
    portReading(),
    portReading({ port: 8081, state: "closed", service: null, verified: false }),
  ],
});

/**
 * The same world with four deliberate defects - the shape a provisioning program is wrong in.
 *
 * D1 an over-open mode, D2 a unit that is not running, D3 an install the world refused because the
 * package is not in its index, D4 a command that climbs out of the sandbox. Four failures with four
 * repairs, so a criterion that reports "it failed" without naming which one is not enough.
 */
const drifted = (): PosixObservationData => ({
  ...hardened(),
  execs: [
    execReading({ result: "refused", exitCode: null, stdout: "", reason: "the package \"ufw-fw\" is not in this world's index" }),
    execReading({
      source: "application",
      argv: ["cat", "../../etc/shadow"],
      program: "cat",
      result: "refused",
      exitCode: null,
      reason: "this command climbs out of the sandbox",
    }),
  ],
  files: [
    fileReading({ mode: "0644" }),
    fileReading({ path: SECRETS, bytes: 8, text: null, textWithheld: "the contents are not valid UTF-8" }),
    fileReading({ path: "/etc/veridian", kind: "directory", bytes: 0, mode: "0755", sha256: null, text: null }),
    fileReading({ path: SERVER, mode: "0644", owner: "root", text: "require('./cart');\n" }),
  ],
  // Held by the database and no longer installed: the state a `purge` leaves behind. The integrity
  // clause still holds - the package was installed by this application - which is why it stays.
  packages: [packageReading({ status: "removed" })],
  services: [serviceReading({ status: "stopped", pid: null, enabled: false })],
  ports: [portReading({ state: "closed", verified: false, service: null })],
});

const observed = (data: unknown, kind: string = POSIX_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-posix:root",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/**
 * A document from another world, typed as that world's so a change to it breaks this file rather than
 * quietly turning the fixture into something no adapter would emit.
 */
const dbDocument: DbObservationData = {
  engine: "sqlite",
  database: ".veridian/environments/hardening.db",
  tables: [],
  query: null,
};

const run = (
  name: string,
  fields: Readonly<Record<string, unknown>>,
  observation: Observation,
): AssertionResult => registry.require(name).validate({ validator: name, ...fields }, observation);

const expectation = (
  validator: string,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({ validator, ...fields });

const expect_ = (
  name: string,
  fields: Readonly<Record<string, unknown>>,
  observation: Observation,
  status: AssertionResult["status"],
  message?: RegExp,
): AssertionResult => {
  const result = run(name, fields, observation);
  assert.equal(
    result.status,
    status,
    `expected ${status} from ${name}, got ${result.status}: ${String(result.message)}`,
  );
  if (message !== undefined) assert.match(String(result.message), message);
  return result;
};

const spec = (
  expectations: readonly Readonly<Record<string, unknown>>[],
): CriterionSpec => ({
  id: "AC-001",
  description: "the world was hardened and the application is serving behind it",
  mandatory: true,
  evidence: [],
  steps: [{ run: ["bash", "/opt/app/provision.sh"] }],
  expect: expectations,
});

const evaluate = (
  expectations: readonly Readonly<Record<string, unknown>>[],
  observation: Observation,
) =>
  evaluateCriterion(spec(expectations), observation, {
    registry,
    runId: observation.runId,
    environmentId: observation.environmentId,
    timestamp: observation.capturedAt,
  });

// ---- the family describes itself ------------------------------------------------------------------

describe("the posix validator family describes itself honestly", () => {
  it("registers every validator it exports, and exactly the twelve it has", () => {
    assert.deepEqual(
      registry.names(),
      POSIX_VALIDATORS.map((validator) => validator.name).sort(),
    );
    // Written out independently of the code, because a list derived from the thing it checks agrees
    // with it by construction. This is the roster a reader of the README is promised.
    assert.deepEqual(registry.names(), [
      "posix.contents",
      "posix.file",
      "posix.installed",
      "posix.owner",
      "posix.package",
      "posix.permission",
      "posix.port",
      "posix.probe",
      "posix.ran",
      "posix.running",
      "posix.service",
      "posix.user",
    ]);
  });

  it("keeps its names in one place, and every name is writable under the acceptance schema", () => {
    const declared = Object.values(POSIX_VALIDATOR_NAMES).sort();
    assert.deepEqual(declared, registry.names());
    for (const name of declared) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, `${name} is not writable in an acceptance contract`);
    }
  });

  it("hands out a fresh array each call, so a registry cannot be mutated through the family", () => {
    const first = posixValidators();
    const second = posixValidators();
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
    // The list a caller is handed is theirs to reorder and shorten; the family's own roster is not.
    first.length = 0;
    assert.equal(posixValidators().length, 12);
    assert.equal(second.length, 12);
  });

  it("declares what its target names, because every one of them reads a named thing", () => {
    for (const validator of POSIX_VALIDATORS) {
      assert.equal(validator.needsTarget, true, `${validator.name} must need a target`);
      assert.equal(
        typeof validator.targetNoun === "string" && validator.targetNoun.length > 0,
        true,
        `${validator.name} must say what its target holds, or the ladder asks the wrong question`,
      );
    }
  });

  it("only claims comparisons the acceptance engine knows how to plan", () => {
    for (const validator of POSIX_VALIDATORS) {
      assert.ok(validator.comparisons.length > 0, `${validator.name} claims no comparisons`);
      for (const key of validator.comparisons) {
        assert.ok(
          (COMPARISON_KEYS as readonly string[]).includes(key),
          `${validator.name} claims "${key}", which the engine cannot plan`,
        );
      }
    }
  });

  it("reads one observation kind and no other", () => {
    for (const validator of POSIX_VALIDATORS) {
      assert.equal(validator.observationKind, POSIX_OBSERVATION_KIND);
    }
  });
});

// ---- the branches every validator shares ----------------------------------------------------------

describe("a document from another world is an environment defect rather than a failure", () => {
  for (const validator of POSIX_VALIDATORS) {
    it(`${validator.name} refuses a database document and blames the world`, () => {
      const result = run(validator.name, { target: "/etc/veridian/hardening.conf" }, observed(dbDocument));
      assert.equal(result.status, "ERROR");
      assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
      assert.match(String(result.message), /does not carry a system document/);
    });
  }

  it("never passes on a document it cannot read, whatever the expectation says", () => {
    const junk: readonly unknown[] = [null, undefined, 0, "", [], {}, { files: [] }, { execs: [] }];
    for (const document of junk) {
      for (const validator of POSIX_VALIDATORS) {
        const result = run(validator.name, { target: "1" }, observed(document));
        assert.notEqual(result.status, "PASS", `${validator.name} passed on ${JSON.stringify(document)}`);
      }
    }
  });
});

describe("a criterion that names no target is refused rather than guessed at", () => {
  // The phrase each validator answers with when its target is missing. Written out here rather than
  // derived from `targetNoun`, because the two are different sentences on purpose: the ladder asks a
  // question naming the thing in the operator's terms, and the refusal says what *this* validator
  // reads. A test that read `targetNoun` back would compare the code with itself.
  const whatItReads: readonly (readonly [string, string])[] = [
    [POSIX_VALIDATOR_NAMES.file, "a file path, written as the sandbox spells it"],
    [POSIX_VALIDATOR_NAMES.permission, "a file path, written as the sandbox spells it"],
    [POSIX_VALIDATOR_NAMES.owner, "a file path, written as the sandbox spells it"],
    [POSIX_VALIDATOR_NAMES.contents, "a file path, written as the sandbox spells it"],
    [POSIX_VALIDATOR_NAMES.user, "an account name"],
    [POSIX_VALIDATOR_NAMES.package, "a package name"],
    [POSIX_VALIDATOR_NAMES.installed, "a package name"],
    [POSIX_VALIDATOR_NAMES.service, "a unit name"],
    [POSIX_VALIDATOR_NAMES.running, "a unit name"],
    [POSIX_VALIDATOR_NAMES.port, "a port number"],
    [POSIX_VALIDATOR_NAMES.ran, "a program name"],
    [POSIX_VALIDATOR_NAMES.probe, "a program name"],
  ];

  it("covers every validator in the family", () => {
    assert.deepEqual(
      whatItReads.map((entry) => entry[0]).sort(),
      registry.names(),
      "every validator must be exercised here, or the untested one is the one that guesses",
    );
  });

  for (const [name, phrase] of whatItReads) {
    it(`${name} reports the missing target and says what it read`, () => {
      const result = run(name, {}, observed(hardened()));
      assert.equal(result.status, "ERROR");
      assert.equal(result.failureKind, "VALIDATOR_ERROR");
      assert.ok(
        String(result.message).includes(`This validator reads ${phrase}, and the criterion named no target.`),
        `${name} said: ${String(result.message)}`,
      );
    });
  }
});

// ---- posix.file -----------------------------------------------------------------------------------

describe("posix.file", () => {
  it("passes when the world holds the file, with no message to skim", () => {
    const result = expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: HARDENING, equals: "present" },
      observed(hardened()),
      "PASS",
    );
    assert.equal(result.message, null);
    assert.equal(result.actual, true);
  });

  it("fails when the world does not, which is about the application and not about the reading", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: "/etc/veridian/never-written.conf", equals: "present" },
      observed(hardened()),
      "FAIL",
      /Expected the file .*never-written\.conf. in the sandbox to be present, but it is false/,
    );
  });

  it("answers absence as well as presence, so a hardening contract can assert a file is gone", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: "/etc/veridian/never-written.conf", equals: "absent" },
      observed(hardened()),
      "PASS",
    );
  });

  it("canonicalises the operator's spelling, because a path is a name and not a pattern", () => {
    // Two ways of writing one path, both of which a reader would expect to mean the file it names.
    // A `.` segment is *not* among them: collapsing it is resolving a path, which this family refuses
    // to do because the reading's own canonical form is what its `path` field holds.
    for (const spelling of [
      "/etc/veridian/hardening.conf/",
      "/etc//veridian/hardening.conf",
    ]) {
      expect_(
        POSIX_VALIDATOR_NAMES.file,
        { target: spelling, equals: "present" },
        observed(hardened()),
        "PASS",
      );
    }
  });

  it("refuses a path the sandbox cannot spell, rather than rewriting it into one", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: "C:\\veridian\\hardening.conf", equals: "present" },
      observed(hardened()),
      "ERROR",
      /written with forward slashes/,
    );
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: "etc/veridian/hardening.conf", equals: "present" },
      observed(hardened()),
      "ERROR",
      /is absolute/,
    );
  });

  it("refuses an expectation that states no comparison", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: HARDENING },
      observed(hardened()),
      "ERROR",
      /states no comparison/,
    );
  });

  it("refuses a comparison it does not declare", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.file,
      { target: HARDENING, contains: "hardening" },
      observed(hardened()),
      "ERROR",
      /"contains" is not declared by this validator/,
    );
  });
});

// ---- posix.permission -----------------------------------------------------------------------------

describe("posix.permission", () => {
  it("passes when the mode is the one the hardening claims", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: HARDENING, equals: "0600" },
      observed(hardened()),
      "PASS",
    );
  });

  it("fails on an over-open mode and reports what the world actually recorded", () => {
    const result = expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: HARDENING, equals: "0600" },
      observed(drifted()),
      "FAIL",
      /Expected the mode of .*hardening\.conf. to equal "0600", but it is "0644"/,
    );
    assert.equal(result.actual, "0644");
  });

  it("supports a pattern, so a contract can accept any mode with no group or other bits", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: HARDENING, matches: "^0[46]00$" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: HARDENING, matches: "^0[46]00$" },
      observed(drifted()),
      "FAIL",
    );
  });

  it("hands presence to posix.file rather than reporting a missing file as a wrong mode", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: "/etc/veridian/never-written.conf", equals: "0600" },
      observed(hardened()),
      "INCONCLUSIVE",
      /no file at .*never-written\.conf/,
    );
  });

  it("reports the mode alone, so the file that proves anything is the one owned by somebody else", () => {
    // `0600` on a file this account does not own reads exactly the same as `0600` on one it does. The
    // permission asymmetry is a fact about the owner, which is why `posix.owner` exists beside this.
    expect_(
      POSIX_VALIDATOR_NAMES.permission,
      { target: "/etc/shadow", equals: "0600" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.owner,
      { target: "/etc/shadow", equals: "root" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: "/etc/shadow", contains: "root:" },
      observed(hardened()),
      "INCONCLUSIVE",
      /did not carry its contents/,
    );
  });
});

// ---- posix.owner ----------------------------------------------------------------------------------

describe("posix.owner", () => {
  it("passes when the account owns the file", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.owner,
      { target: HARDENING, equals: "app" },
      observed(hardened()),
      "PASS",
    );
  });

  it("fails on the wrong account, which is a different repair from the wrong mode", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.owner,
      { target: SERVER, equals: "app" },
      observed(drifted()),
      "FAIL",
      /Expected the owner of .*server\.js. to equal "app", but it is "root"/,
    );
  });

  it("hands presence to posix.file, because 'not there' and 'owned by nobody' differ", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.owner,
      { target: "/etc/veridian/never-written.conf", equals: "app" },
      observed(hardened()),
      "INCONCLUSIVE",
      /answers/,
    );
  });
});

// ---- posix.contents -------------------------------------------------------------------------------

describe("posix.contents", () => {
  it("compares the whole text the reading recorded", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: HARDENING, equals: "# Veridian hardening\nsshd: off\n" },
      observed(hardened()),
      "PASS",
    );
  });

  it("finds a line rather than requiring the whole file", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: HARDENING, contains: "sshd: off" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: HARDENING, contains: "sshd: on" },
      observed(hardened()),
      "FAIL",
    );
  });

  it("supports a pattern over the text", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: HARDENING, matches: "^# Veridian hardening\\nsshd: off\\n$" },
      observed(hardened()),
      "PASS",
    );
  });

  it("refuses to judge contents the reading withheld, and says why the reading withheld them", () => {
    const result = expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: SECRETS, contains: "TOKEN" },
      observed(hardened()),
      "INCONCLUSIVE",
      /the contents are not valid UTF-8/,
    );
    assert.equal(result.actual, null);
  });

  it("hands presence to posix.file before it looks for contents", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: "/etc/veridian/never-written.conf", contains: "x" },
      observed(hardened()),
      "INCONCLUSIVE",
      /no file at/,
    );
  });

  it("never passes on an empty document by treating an absent text as an empty one", () => {
    // A reading could hold a file with `text: null` and no reason. That is a gap in the reading, and
    // judging `contains: ""` against it must not be a pass.
    const without = hardened();
    const files = without.files.map((entry) =>
      entry.path === HARDENING ? { ...entry, text: null, textWithheld: null } : entry,
    );
    const document: PosixObservationData = { ...without, files };
    expect_(
      POSIX_VALIDATOR_NAMES.contents,
      { target: HARDENING, contains: "# Veridian" },
      observed(document),
      "INCONCLUSIVE",
      /recorded no reason/,
    );
  });
});

// ---- posix.user -----------------------------------------------------------------------------------

describe("posix.user", () => {
  it("passes for an account the world holds, including one the base image provided", () => {
    for (const name of ["root", "app", "daemon"]) {
      expect_(
        POSIX_VALIDATOR_NAMES.user,
        { target: name, equals: "present" },
        observed(hardened()),
        "PASS",
      );
    }
  });

  it("fails for an account nobody created", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.user,
      { target: "deploy", equals: "present" },
      observed(hardened()),
      "FAIL",
    );
  });
});

// ---- posix.package and posix.installed ------------------------------------------------------------

describe("posix.package", () => {
  it("passes for an installed package", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.package,
      { target: "ufw", equals: "present" },
      observed(hardened()),
      "PASS",
    );
  });

  it("reports a package the world removed as absent, not as present", () => {
    // The reading *does* hold `telnetd` - the world keeps removed packages in its database, exactly as
    // a package manager does. A presence test over the list would find it and pass. This is the false
    // pass the status field exists to prevent, and the assertion below is what makes the test about
    // the validator rather than about a missing entry.
    const document = hardened();
    assert.ok(
      document.packages.some((entry) => entry.name === "telnetd"),
      "the fixture must hold the removed package, or this test proves nothing",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.package,
      { target: "telnetd", equals: "present" },
      observed(document),
      "FAIL",
      /Expected the package .telnetd. in the world's package database to be present, but it is false/,
    );
    expect_(
      POSIX_VALIDATOR_NAMES.package,
      { target: "telnetd", equals: "absent" },
      observed(document),
      "PASS",
    );
  });

  it("fails for a package the world has never heard of", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.package,
      { target: "openssh-server", equals: "present" },
      observed(hardened()),
      "FAIL",
    );
  });
});

describe("posix.installed", () => {
  it("passes for a package this run installed, and fails for one the base image provided", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "ufw", equals: "application" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "openssl", equals: "application" },
      observed(hardened()),
      "FAIL",
      /to be application, but it is "world"/,
    );
  });

  it("distinguishes a package a criterion installed while probing", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "fail2ban", equals: "criterion" },
      observed(hardened()),
      "PASS",
    );
  });

  it("reports an unknown package as inconclusive, naming the validator that owns presence", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "openssh-server", equals: "application" },
      observed(hardened()),
      "INCONCLUSIVE",
      /posix\.package/,
    );
  });

  it("refuses a word that is not in the source vocabulary, rather than always failing", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "ufw", equals: "the-run" },
      observed(hardened()),
      "ERROR",
      /wants one of application, criterion, world/,
    );
  });

  it("still reports provenance for a package the world removed, which is a true fact", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.installed,
      { target: "telnetd", equals: "application" },
      observed(hardened()),
      "PASS",
    );
    // ...and that is why a criterion meaning "installed, and still there" states both clauses.
    expect_(
      POSIX_VALIDATOR_NAMES.package,
      { target: "telnetd", equals: "present" },
      observed(hardened()),
      "FAIL",
    );
  });
});

// ---- posix.service and posix.running --------------------------------------------------------------

describe("posix.service", () => {
  it("passes for a unit the world holds, whether or not it is running", () => {
    for (const name of ["nginx", "ufw"]) {
      expect_(
        POSIX_VALIDATOR_NAMES.service,
        { target: name, equals: "present" },
        observed(hardened()),
        "PASS",
      );
    }
  });

  it("fails for a unit nobody wrote", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.service,
      { target: "cart-web", equals: "present" },
      observed(hardened()),
      "FAIL",
    );
  });
});

describe("posix.running", () => {
  it("passes for a unit the world is running", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.running,
      { target: "nginx", equals: "running" },
      observed(hardened()),
      "PASS",
    );
  });

  it("fails for a unit that exists and is stopped, which is the repair a hardening script makes", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.running,
      { target: "nginx", equals: "running" },
      observed(drifted()),
      "FAIL",
      /to be running, but it is "stopped"/,
    );
  });

  it("accepts all three statuses the reading declares", () => {
    for (const word of ["running", "stopped", "failed"] as const) {
      const document: PosixObservationData = {
        ...hardened(),
        services: [serviceReading({ status: word })],
      };
      expect_(
        POSIX_VALIDATOR_NAMES.running,
        { target: "nginx", equals: word },
        observed(document),
        "PASS",
      );
    }
  });

  it("hands presence to posix.service rather than calling a missing unit stopped", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.running,
      { target: "cart-web", equals: "running" },
      observed(hardened()),
      "INCONCLUSIVE",
      /holds no unit .cart-web., so there is no status to read/,
    );
  });

  it("refuses a status word that is not in the vocabulary, rather than reporting a defect", () => {
    // "started" is what an operator actually types. Judged against the reading it would be a FAIL, and
    // the reader would go and look at a service that is running perfectly well.
    expect_(
      POSIX_VALIDATOR_NAMES.running,
      { target: "nginx", equals: "started" },
      observed(hardened()),
      "ERROR",
      /wants one of running, stopped, failed/,
    );
  });
});

// ---- posix.port -----------------------------------------------------------------------------------

describe("posix.port", () => {
  it("passes for a port that answers", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "8080", equals: "listening" },
      observed(hardened()),
      "PASS",
    );
  });

  it("judges a closed port, because closed is what knocking and getting no answer means", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "8081", equals: "closed" },
      observed(hardened()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "8080", equals: "closed" },
      observed(drifted()),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "8081", equals: "listening" },
      observed(hardened()),
      "FAIL",
    );
  });

  it("refuses to judge a listening claim the reading itself did not confirm", () => {
    // No adapter in this repository can produce this document - the substitution is a property of the
    // reading vocabulary, and a validator is a function over a document. That is what makes the branch
    // a guard rather than a sentence, and this test is what makes it reachable.
    const document: PosixObservationData = {
      ...hardened(),
      ports: [portReading({ port: 9090, state: "listening", verified: false, service: null })],
    };
    for (const expected of ["listening", "closed"]) {
      expect_(
        POSIX_VALIDATOR_NAMES.port,
        { target: "9090", equals: expected },
        observed(document),
        "INCONCLUSIVE",
        /did not reach a socket/,
      );
    }
  });

  it("reports a port the reading holds nothing about as inconclusive", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "443", equals: "listening" },
      observed(hardened()),
      "INCONCLUSIVE",
      /holds no entry for port 443/,
    );
  });

  it("refuses a target that is not a number, rather than reporting a port nobody listens on", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "http", equals: "listening" },
      observed(hardened()),
      "ERROR",
      /A port is written as a number/,
    );
  });

  it("refuses a state word that is not in the vocabulary", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.port,
      { target: "8080", equals: "open" },
      observed(hardened()),
      "ERROR",
      /wants one of listening, closed/,
    );
  });
});

// ---- posix.ran and posix.probe --------------------------------------------------------------------

describe("posix.ran", () => {
  it("passes for a command the application ran to completion", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "apt-get", equals: "completed" },
      observed(hardened()),
      "PASS",
    );
  });

  it("fails for each way a command can go wrong, because each has a different repair", () => {
    const ways: readonly PosixExecRecord["result"][] = ["nonzero", "refused", "timed-out"];
    for (const way of ways) {
      const document: PosixObservationData = {
        ...hardened(),
        execs: [execReading({ result: way })],
      };
      expect_(
        POSIX_VALIDATOR_NAMES.ran,
        { target: "apt-get", equals: "completed" },
        observed(document),
        "FAIL",
        new RegExp(`but it is "${way}"`),
      );
    }
  });

  it("judges the newest execution, so a repaired command is judged as repaired", () => {
    const document: PosixObservationData = {
      ...hardened(),
      execs: [
        execReading({ result: "nonzero", exitCode: 100, stderr: "E: Unable to locate package ufw\n" }),
        execReading(),
      ],
    };
    expect_(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "apt-get", equals: "completed" },
      observed(document),
      "PASS",
    );
  });

  it("finds a command the world substituted by the name the caller used, not the resolved path", () => {
    // `argv[0]` holds the path the world resolved to. Keying on it would make this validator
    // unfindable for exactly the programs the world substituted.
    const result = run(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "systemctl", equals: "completed" },
      observed(hardened()),
    );
    assert.equal(result.status, "PASS");
    const document = hardened();
    const record = document.execs.find((entry) => entry.program === "systemctl");
    assert.equal(record?.argv[0], "/usr/lib/veridian/bin/systemctl");
  });

  it("reports a program the world never ran as inconclusive, not as a failure", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "npm", equals: "completed" },
      observed(hardened()),
      "INCONCLUSIVE",
      /recorded no execution of .npm. at all/,
    );
  });

  it("refuses to judge the criterion's own commands, and names the validator that reads them", () => {
    const document: PosixObservationData = {
      ...hardened(),
      execs: [execReading({ source: "criterion", program: "cat", argv: ["cat", "/etc/os-release"] })],
    };
    expect_(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "cat", equals: "completed" },
      observed(document),
      "INCONCLUSIVE",
      /was issued by criterion.*posix\.probe/s,
    );
  });

  it("refuses a result word that is not in the vocabulary", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.ran,
      { target: "apt-get", equals: "outlived" },
      observed(hardened()),
      "ERROR",
      /wants one of completed, nonzero, refused, timed-out/,
    );
  });
});

describe("posix.probe", () => {
  it("passes for a probe the world refused, which is how a containment contract is written", () => {
    const document: PosixObservationData = {
      ...hardened(),
      execs: [
        execReading({
          source: "criterion",
          program: "cat",
          argv: ["cat", "../../etc/shadow"],
          result: "refused",
          exitCode: null,
          reason: "this command climbs out of the sandbox",
        }),
      ],
    };
    expect_(
      POSIX_VALIDATOR_NAMES.probe,
      { target: "cat", equals: "refused" },
      observed(document),
      "PASS",
    );
    expect_(
      POSIX_VALIDATOR_NAMES.probe,
      { target: "cat", equals: "completed" },
      observed(document),
      "FAIL",
    );
  });

  it("refuses to judge the application's commands, and names the validator that reads them", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.probe,
      { target: "apt-get", equals: "completed" },
      observed(hardened()),
      "INCONCLUSIVE",
      /was issued by application.*posix\.ran/s,
    );
  });

  it("reports a probe that was never run as inconclusive", () => {
    expect_(
      POSIX_VALIDATOR_NAMES.probe,
      { target: "sudo", equals: "refused" },
      observed(hardened()),
      "INCONCLUSIVE",
      /recorded no execution of .sudo. at all/,
    );
  });
});

// ---- the family through the registry ---------------------------------------------------------------

describe("a whole criterion is judged, not just an assertion at a time", () => {
  const hardening: readonly Readonly<Record<string, unknown>>[] = [
    expectation(POSIX_VALIDATOR_NAMES.file, { target: HARDENING, equals: "present" }),
    expectation(POSIX_VALIDATOR_NAMES.permission, { target: HARDENING, equals: "0600" }),
    expectation(POSIX_VALIDATOR_NAMES.owner, { target: HARDENING, equals: "app" }),
    expectation(POSIX_VALIDATOR_NAMES.contents, { target: HARDENING, contains: "sshd: off" }),
    expectation(POSIX_VALIDATOR_NAMES.package, { target: "ufw", equals: "present" }),
    expectation(POSIX_VALIDATOR_NAMES.installed, { target: "ufw", equals: "application" }),
    expectation(POSIX_VALIDATOR_NAMES.running, { target: "nginx", equals: "running" }),
    expectation(POSIX_VALIDATOR_NAMES.port, { target: "8080", equals: "listening" }),
    expectation(POSIX_VALIDATOR_NAMES.ran, { target: "apt-get", equals: "completed" }),
  ];

  it("passes every clause against the world the provisioner built", () => {
    const result = evaluate(hardening, observed(hardened()));
    assert.equal(result.status, "PASS");
    assert.equal(result.assertions.length, hardening.length);
    assert.deepEqual(
      result.assertions.map((assertion) => assertion.status),
      hardening.map(() => "PASS"),
    );
  });

  it("fails exactly the clauses the drift broke, and names them in the criterion's message", () => {
    const result = evaluate(hardening, observed(drifted()));
    assert.equal(result.status, "FAIL");
    const failed = result.assertions.filter((assertion) => assertion.status === "FAIL");
    assert.deepEqual(
      failed.map((assertion) => assertion.validator).sort(),
      [
        POSIX_VALIDATOR_NAMES.package,
        POSIX_VALIDATOR_NAMES.permission,
        POSIX_VALIDATOR_NAMES.port,
        POSIX_VALIDATOR_NAMES.ran,
        POSIX_VALIDATOR_NAMES.running,
      ].sort(),
    );
    // The clause that still holds must still say PASS: a run that reports every clause as failed is as
    // useless as one that reports them all as passed.
    const passed = result.assertions.filter((assertion) => assertion.status === "PASS");
    assert.deepEqual(
      passed.map((assertion) => assertion.validator).sort(),
      [
        POSIX_VALIDATOR_NAMES.contents,
        POSIX_VALIDATOR_NAMES.file,
        POSIX_VALIDATOR_NAMES.installed,
        POSIX_VALIDATOR_NAMES.owner,
      ].sort(),
    );
    assert.match(String(result.message), /0600/);
  });

  it("ends inconclusive rather than failed when the world could not be read", () => {
    const result = evaluate(hardening, observed(dbDocument));
    assert.equal(result.status, "ERROR");
    assert.ok(result.assertions.every((assertion) => assertion.status === "ERROR"));
  });
});
