import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { COMPARISON_KEYS } from "../../core/acceptance/plan.ts";
import {
  CONTAINER_ACTIONS,
  CONTAINER_HEALTH_STATES,
  CONTAINER_OBSERVATION_KIND,
  CONTAINER_STATES,
  isContainerObservationData,
  resolveContainerRef,
} from "../../core/environment/container-observation.ts";
import type {
  ContainerCallRecord,
  ContainerImageReading,
  ContainerInstanceReading,
  ContainerLogReading,
  ContainerObservationData,
} from "../../core/environment/container-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";
import type { AssertionResult } from "../../core/validation/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";

import { CONTAINER_VALIDATORS, CONTAINER_VALIDATOR_NAMES, containerValidators } from "./container-validators.ts";

// ---- fixtures --------------------------------------------------------------------------------------

/**
 * The three records this family reads, built the way the world builds them.
 *
 * `alive: true` beside `state: "running"` is the *agreeing* case on purpose: the pair is the family's
 * central distinction, so the fixture has to hold a reading where the two agree before a test can show
 * what happens when they do not.
 */
const imageReading = (overrides: Partial<ContainerImageReading> = {}): ContainerImageReading => ({
  id: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  tags: ["cart-web:1.0.0"],
  digest: "ctx-aaaaaaaa",
  sizeBytes: 4096,
  layers: 1,
  os: "linux",
  architecture: "amd64",
  entrypoint: ["node"],
  cmd: ["server.mjs"],
  workingDir: "/app",
  user: "app",
  env: { NODE_ENV: "production" },
  exposedPorts: [8080],
  labels: { "org.veridian.title": "cart-web" },
  ...overrides,
});

const containerReading = (overrides: Partial<ContainerInstanceReading> = {}): ContainerInstanceReading => ({
  id: "cart-web-1a2b3c4d",
  name: "cart-web",
  image: "cart-web:1.0.0",
  state: "running",
  alive: true,
  exitCode: null,
  command: ["node", "server.mjs"],
  workingDir: "/app",
  user: "app",
  env: { NODE_ENV: "production" },
  mounts: [
    {
      kind: "bind",
      source: "/host/app/data",
      destination: "/data",
      readOnly: true,
      sourceExists: true,
    },
  ],
  ports: [
    { containerPort: 8080, protocol: "tcp", hostPort: 8080, hostIp: "127.0.0.1", exposed: true, published: true },
  ],
  resources: { memoryBytes: 268435456, memoryReservationBytes: null, cpus: 1.5, pidsLimit: 128, enforced: false },
  health: {
    command: ["curl", "-f", "http://127.0.0.1:8080/health"],
    state: "healthy",
    exitCode: 0,
    attempts: 3,
    intervalSeconds: 5,
  },
  restartPolicy: "no",
  labels: { "org.veridian.title": "cart-web" },
  ...overrides,
});

const logReading = (overrides: Partial<ContainerLogReading> = {}): ContainerLogReading => ({
  container: "cart-web",
  runs: 1,
  stdout: "cart listening on 8080\n",
  stderr: "warn: cache cold\n",
  stdoutBytes: 23,
  stderrBytes: 16,
  truncated: false,
  ...overrides,
});

const callRecord = (overrides: Partial<ContainerCallRecord> = {}): ContainerCallRecord => ({
  action: "container.start",
  client: "provisioner",
  command: "docker start cart-web",
  resource: "container/cart-web",
  result: "answered",
  status: 0,
  reason: null,
  ...overrides,
});

const containerDocument = (overrides: Partial<ContainerObservationData> = {}): ContainerObservationData => ({
  runtime: "docker",
  version: "24.0.0-sim",
  sandbox: "/host/.veridian/sandbox-container",
  os: "linux",
  architecture: "amd64",
  simulated: ["namespaces", "cgroups", "registry"],
  calls: [callRecord()],
  images: [imageReading()],
  containers: [containerReading()],
  logs: [logReading()],
  ...overrides,
});

const observed = (data: unknown, kind: string = CONTAINER_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "sim-container:docker",
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

const runtime = observed(containerDocument());

const registry = new ValidatorRegistry(containerValidators());

/**
 * Judge through the registry, so a test can never pass against a name the product does not have.
 *
 * This is the *validator's* entry point and not the criterion's: it bypasses the observation-kind check
 * deliberately, so that the family's own status discipline is what is under test rather than
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

// ---- the roster ------------------------------------------------------------------------------------

describe("the roster is the code, and every name in it is writable", () => {
  it("names exactly the nineteen validators the family exports, in both directions", () => {
    assert.equal(Object.values(CONTAINER_VALIDATOR_NAMES).length, 19);
    assert.deepEqual(
      CONTAINER_VALIDATORS.map((validator) => validator.name).sort(),
      [...Object.values(CONTAINER_VALIDATOR_NAMES)].sort(),
      "the roster of validators and the record of names are the same vocabulary written twice, and " +
        "a name in one and not the other is either unreachable or unfindable",
    );
    assert.ok(
      Object.isFrozen(CONTAINER_VALIDATORS),
      "the roster is a global a caller could edit in place, which would make one criterion's verdict " +
        "depend on whether another criterion ran first",
    );
  });

  it("spells every name so that an acceptance contract can be written at all", () => {
    // The schema's own pattern, asserted rather than trusted: a name with a capital in it is a
    // validator no `acceptance.yaml` can express, so it would be implemented, exported, tested and
    // unreachable. It matters more in this family than in the ones before it, because the *fields*
    // this world reads are camel case (`exitCode`, `readOnly`) and the natural mistake is to carry the
    // spelling across into the name.
    for (const name of Object.values(CONTAINER_VALIDATOR_NAMES)) {
      assert.match(name, /^[a-z0-9]+(\.[a-z0-9]+)+$/, `${name} is not writable in a contract`);
      assert.match(name, /^container\./, `${name} is outside the prefix this family owns`);
    }
    assert.equal(CONTAINER_VALIDATOR_NAMES.exitCode, "container.exitcode");
    assert.equal(CONTAINER_VALIDATOR_NAMES.call, "container.call");
  });

  it("declares the world it reads on every member, and the target it needs on all but one", () => {
    for (const validator of CONTAINER_VALIDATORS) {
      assert.equal(
        validator.observationKind,
        CONTAINER_OBSERVATION_KIND,
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
    // that stays true while the exception moves to a validator that should have needed a target.
    const targetless = CONTAINER_VALIDATORS.filter((validator) => !validator.needsTarget).map(
      (validator) => validator.name,
    );
    assert.deepEqual(targetless, ["container.runtime"]);
    assert.equal(registry.require("container.runtime").targetNoun, undefined);
  });

  it("declares only comparisons the acceptance layer can decode", () => {
    // `validator.comparisons` is read twice: by the clarification report, and by `decodeExpectation`'s
    // "cannot evaluate" branch. A comparison named here that `COMPARISON_KEYS` does not hold would be a
    // validator advertising an operation no criterion can state.
    for (const validator of CONTAINER_VALIDATORS) {
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
    const first = containerValidators();
    const second = containerValidators();
    assert.notEqual(first, second);
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
  });

  it("keeps the substitute, and every other family, out of the vocabulary that judges it", () => {
    // Two rules from `AGENTS.md`, held as executable rules over this file's own text because the import
    // list is the only place either can be broken. A family that imported an adapter could report on
    // the substitute rather than on the application; a family that imported another family could
    // answer a question that belongs to a different world.
    const source = readFileSync(new URL("./container-validators.ts", import.meta.url), "utf8");
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
    // Two rules, and each member is refused by exactly one of them, which is why both are asserted
    // here: no target at all is refused *before* the judgement, and the judgement itself refuses to
    // compare against nothing. A member that reached `judge` with no comparison and passed would be
    // the single validator in the family that can never fail.
    for (const validator of CONTAINER_VALIDATORS) {
      const result = judge({ validator: validator.name }, runtime);
      assert.equal(result.status, "ERROR", `${validator.name} judged an empty expectation`);
      const refusal = validator.needsTarget ? /named no target/ : /nothing to judge/;
      assert.match(String(result.message), refusal, `${validator.name} was refused for a different reason`);
    }

    // And the `judge` rule itself, reached by a member whose target does resolve. Stated as its own
    // assertion because the loop above never reaches it for eighteen of the nineteen members.
    const empty = judge(field("container.tag", { target: "image/cart-web:1.0.0" }), runtime);
    assert.equal(empty.status, "ERROR");
    assert.match(String(empty.message), /nothing to judge/);
    assert.equal(empty.failureKind, "VALIDATOR_ERROR", "a defect in the contract is not the application's");
  });
});

// ---- documents from other worlds -------------------------------------------------------------------

describe("a document from another world is an environment defect, not a judgment", () => {
  it("reports ERROR naming the environment when the reading is another world's", () => {
    const result = expect(
      field("container.state", { target: "container/cart-web", equals: "running" }),
      observed(webDocument, WEB_OBSERVATION_KIND),
      "ERROR",
      /does not carry a container runtime document/,
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    // `actual` carries the payload that arrived rather than `null`, which is deliberate: the message
    // says a container document was not found, and a reader diagnosing the adapter needs to see what
    // arrived in its place.
    assert.equal(result.actual, webDocument);
  });

  it("reports ERROR and blames the environment when the reading is absent", () => {
    const result = expect(
      field("container.runtime", { contains: "docker" }),
      observed(null),
      "ERROR",
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });

  it("does not read the substitute's own record as a comparison target", () => {
    // `simulated` is in the reading because the substitution has to be visible where the verdict is.
    // It is deliberately *not* a field a criterion can select: the one validator here that needs no
    // target ignores a target entirely, so a criterion naming `simulated` is answered about the runtime
    // identity - which is a fact about the world's interface rather than about Veridian.
    expect(
      field("container.runtime", { target: "simulated", equals: "namespaces" }),
      runtime,
      "FAIL",
    );
    expect(field("container.runtime", { target: "simulated", equals: "docker" }), runtime, "PASS");
  });
});

// ---- targets, and the resolver's own reason --------------------------------------------------------

describe("a target is resolved by the family's own grammar, and its refusal is quoted", () => {
  it("refuses a target that names no kind, in the resolver's words", () => {
    // The refusal is the resolver's own sentence rather than a replacement for it: the resolver knows
    // why it refused, and a validator that wrote one message covering every reason would be naming a
    // cause it never observed.
    expect(
      field("container.state", { target: "/cart-web", equals: "running" }),
      runtime,
      "ERROR",
      /names a kind first/,
    );
  });

  it("refuses a target whose name cannot be spelled, rather than looking one up", () => {
    // A slash inside the name is the realistic mistake - a target that kept the separator from the
    // resource line it was copied off. The refusal names the mistake rather than reporting a missing
    // image, which would send the reader to rebuild something that is already built.
    expect(
      field("container.image", { target: "image/cart/web", equals: true }),
      runtime,
      "ERROR",
      /cannot be written in this family's spelling/,
    );
  });

  it("reads an image tag's colon as part of the name, because a tag has one", () => {
    // The separator one grammar reserves is a character another grammar's terms contain. This family
    // allows `:` in a name because `name:tag` is how an image is spelled; the provider family next door
    // reserves it. Asserted against the resolver directly as well as through a verdict, so the rule is
    // held where it lives rather than only where it is used.
    const resolved = resolveContainerRef("image/cart-web:1.0.0");
    assert.equal(resolved.kind, "target");
    expect(
      field("container.image", { target: "image/cart-web:1.0.0", equals: true }),
      runtime,
      "PASS",
    );
  });

  it("reports ERROR when no target was named at all", () => {
    expect(field("container.tag", { contains: "1.0.0" }), runtime, "ERROR", /named no target/);
  });

  it("refuses the wrong kind of object by naming the validators that do read it", () => {
    // The two kinds exist because an image and a container have different fields. A criterion that
    // named the wrong one is answered with a sentence naming what the target *is*, so a reader is sent
    // to the validator that can read it rather than to the store.
    expect(
      field("container.state", { target: "image/cart-web:1.0.0", equals: "running" }),
      runtime,
      "ERROR",
      /container\.image/,
    );
    expect(
      field("container.image", { target: "container/cart-web", equals: true }),
      runtime,
      "ERROR",
      /container\.image/,
    );
  });
});

// ---- the verdict test, and the field it collides with -----------------------------------------------

describe("the verdict test is the engine's vocabulary, not the presence of a status field", () => {
  it("judges a call record whose own `status` is a number as a record, not as a verdict", () => {
    // `ContainerCallRecord.status` is the HTTP-ish status the substitute answered with, and every call
    // record therefore *has* a `status` field. A helper written as `"status" in value` would report a
    // call record as an `AssertionResult`, and `container.call` would return the record itself as if it
    // were a verdict - with `status: 200` where a criterion status belongs. The family tests membership
    // in `CRITERION_STATUSES` instead, and this is the fixture that tells the two apart.
    const document = containerDocument({
      calls: [callRecord({ action: "image.build", command: "docker build", result: "answered", status: 200 })],
    });
    const result = expect(
      field("container.call", { target: "image.build", equals: "answered" }),
      observed(document),
      "PASS",
    );
    assert.ok(
      (CRITERION_STATUSES as readonly unknown[]).includes(result.status),
      "the verdict is not one of the engine's statuses",
    );
  });

  it("judges a call record whose status is 0 the same way, so the collision is not about truthiness", () => {
    const document = containerDocument({
      calls: [callRecord({ action: "container.start", result: "failed", status: 0, reason: "exit 1" })],
    });
    expect(
      field("container.call", { target: "container.start", equals: "failed" }),
      observed(document),
      "PASS",
    );
  });
});

// ---- the store: images, tags, digests ----------------------------------------------------------------

describe("the store is judged by what it holds, not by what the document promised", () => {
  it("reads an image by its tag and by its id, so a criterion may name either", () => {
    expect(field("container.image", { target: "image/cart-web:1.0.0", equals: true }), runtime, "PASS");
    expect(field("container.image", { target: "image/sha256:1111111111111111111111111111111111111111111111111111111111111111", equals: true }), runtime, "PASS");
  });

  it("passes the negative presence comparison, which is how a criterion says 'never built'", () => {
    expect(field("container.image", { target: "image/cart-web:9.9.9", equals: false }), runtime, "PASS");
  });

  it("fails an absent image, because presence is the question this validator owns", () => {
    // `FAIL` rather than `INCONCLUSIVE`: the store *was* read and it does not hold the image. It is the
    // sibling validators - `tag`, `digest`, `label`, `env` - that report `INCONCLUSIVE` and hand the
    // presence question to this one, because "it is not there" and "its digest is wrong" are different
    // repairs and only one of them is worth rebuilding for.
    const result = expect(
      field("container.image", { target: "image/cart-web:9.9.9", equals: true }),
      runtime,
      "FAIL",
    );
    assert.match(String(result.message), /cart-web:9\.9\.9/, "the failure has to name what it looked for");
  });

  it("reads the whole tag set for a tag criterion", () => {
    const document = containerDocument({
      images: [imageReading({ tags: ["cart-web:1.0.0", "cart-web:latest"] })],
    });
    expect(
      field("container.tag", { target: "image/cart-web:1.0.0", contains: "cart-web:latest" }),
      observed(document),
      "PASS",
    );
    expect(
      field("container.tag", { target: "image/cart-web:1.0.0", equals: "cart-web:latest" }),
      observed(document),
      "FAIL",
    );
  });

  it("reports INCONCLUSIVE naming container.image when a tag criterion names an image nobody built", () => {
    const result = expect(
      field("container.tag", { target: "image/cart-web:9.9.9", contains: "latest" }),
      runtime,
      "INCONCLUSIVE",
      /container\.image/,
    );
    // The message says what the store *does* hold, which is what makes it actionable: "it is not
    // there" plus "here is what is" is one repair away from an answer.
    assert.match(String(result.message), /cart-web:1\.0\.0/);
    assert.strictEqual(
      result.failureKind,
      null,
      "a question nobody answered is not a failure kind; reporting one would classify a missing image as a defect",
    );
  });

  it("reads a digest as a text spelling and fails a mismatch", () => {
    expect(
      field("container.digest", { target: "image/cart-web:1.0.0", equals: "ctx-aaaaaaaa" }),
      runtime,
      "PASS",
    );
    expect(
      field("container.digest", { target: "image/cart-web:1.0.0", equals: "ctx-bbbbbbbb" }),
      runtime,
      "FAIL",
    );
  });

  it("reports ERROR when the store arrived unreadable", () => {
    const document = containerDocument({ images: [{} as ContainerImageReading] });
    expect(field("container.image", { target: "image/cart-web:1.0.0", equals: true }), observed(document), "ERROR");
  });
});

// ---- labels and environment, on either kind ---------------------------------------------------------

describe("labels and environment are read from either kind of object", () => {
  it("reads a label from an image and says which object it read", () => {
    const result = expect(
      field("container.label", { target: "image/cart-web:1.0.0", equals: "cart-web" }),
      runtime,
      "FAIL",
    );
    assert.match(String(result.message), /image/);
  });

  it("reads a label from a container", () => {
    expect(
      field("container.label", { target: "container/cart-web", contains: "org.veridian.title" }),
      runtime,
      "PASS",
    );
  });

  it("spells an empty label map as `(none)` so a criterion can assert its absence", () => {
    const document = containerDocument({ containers: [containerReading({ labels: {} })] });
    expect(
      field("container.label", { target: "container/cart-web", equals: "(none)" }),
      observed(document),
      "PASS",
    );
  });

  it("reads the merged environment a container's record carries", () => {
    expect(
      field("container.env", { target: "container/cart-web", contains: "NODE_ENV=production" }),
      runtime,
      "PASS",
    );
  });

  it("reports INCONCLUSIVE naming container.image when an environment criterion names a missing image", () => {
    expect(
      field("container.env", { target: "image/cart-web:9.9.9", contains: "NODE_ENV" }),
      runtime,
      "INCONCLUSIVE",
      /container\.image/,
    );
  });
});

// ---- the two state questions ------------------------------------------------------------------------

describe("what the world recorded and what the operating system reported are two questions", () => {
  it("judges the recorded state against its own vocabulary", () => {
    // Driven from the vocabulary the reading owns rather than from a recalled list, so a word added to
    // the world is a word this test exercises without being edited.
    for (const word of CONTAINER_STATES) {
      const document = containerDocument({ containers: [containerReading({ state: word })] });
      expect(field("container.state", { target: "container/cart-web", equals: word }), observed(document), "PASS");
    }
    expect(field("container.state", { target: "container/cart-web", equals: "exited" }), runtime, "FAIL");
  });

  it("reads an unknown state word as an unusable expectation rather than as a failure", () => {
    // The vocabulary is the reading's, not the criterion's. A word the world cannot record is a typo
    // in the contract, which is an ERROR - never `TEST_FAILURE`, because the application is not on
    // trial for the operator's spelling.
    expect(field("container.state", { target: "container/cart-web", equals: "up" }), runtime, "ERROR", /one of/);
  });

  it("judges aliveness separately, so a container recorded running but dead is two facts", () => {
    expect(field("container.alive", { target: "container/cart-web", equals: true }), runtime, "PASS");
    const document = containerDocument({ containers: [containerReading({ alive: false })] });
    const result = expect(
      field("container.alive", { target: "container/cart-web", equals: true }),
      observed(document),
      "FAIL",
    );
    assert.match(String(result.message), /running/, "the message has to carry the record beside the report");
  });

  it("reads an exit code, and refuses to invent one while the process is alive", () => {
    const stopped = containerDocument({
      containers: [containerReading({ state: "exited", alive: false, exitCode: 0 })],
    });
    // The name is lower case even though the field is camel case: an acceptance contract may only
    // spell a validator with lower-case segments and dots, which the roster test holds.
    expect(field("container.exitcode", { target: "container/cart-web", equals: 0 }), observed(stopped), "PASS");
    expect(field("container.exitcode", { target: "container/cart-web", atMost: 0 }), observed(stopped), "PASS");

    // `exitCode: null` on an alive container. A fabricated `0` here would let a criterion bless a
    // program that is still running.
    const result = expect(
      field("container.exitcode", { target: "container/cart-web", equals: 0 }),
      runtime,
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /container\.state/);
  });

  it("reads the command the world recorded, joined and exact", () => {
    expect(
      field("container.command", { target: "container/cart-web", equals: "node server.mjs" }),
      runtime,
      "PASS",
    );
    expect(
      field("container.command", { target: "container/cart-web", contains: "server.mjs" }),
      runtime,
      "PASS",
    );
  });
});

// ---- user, mounts, ports, limits ---------------------------------------------------------------------

describe("the account, the mounts, the mappings and the caps each name their own limitation", () => {
  it("judges the recorded account and says in the failure that it was recorded, not applied", () => {
    expect(field("container.user", { target: "container/cart-web", equals: "app" }), runtime, "PASS");
    const result = expect(
      field("container.user", { target: "container/cart-web", equals: "root" }),
      runtime,
      "FAIL",
    );
    assert.match(
      String(result.message),
      /does not apply/,
      "a substitute that holds no uid map must say so where it is read, not in a document beside it",
    );
  });

  it("judges a bind mount with its source's existence and its read-only flag in the same reading", () => {
    expect(field("container.mount", { target: "container/cart-web", contains: "/data" }), runtime, "PASS");
    expect(field("container.mount", { target: "container/cart-web", contains: ":ro" }), runtime, "PASS");

    const missing = containerDocument({
      containers: [
        containerReading({
          mounts: [
            { kind: "bind", source: "/host/app/dtaa", destination: "/data", readOnly: true, sourceExists: false },
          ],
        }),
      ],
    });
    const result = expect(
      field("container.mount", { target: "container/cart-web", contains: "/host/app/data" }),
      observed(missing),
      "FAIL",
    );
    assert.match(
      String(result.message),
      /source absent/,
      "a mount whose source this machine cannot open is the defect a criterion has to be able to see",
    );
  });

  it("spells an empty mount list so a criterion can assert that nothing was mounted", () => {
    const document = containerDocument({ containers: [containerReading({ mounts: [] })] });
    expect(
      field("container.mount", { target: "container/cart-web", equals: "(none)" }),
      observed(document),
      "PASS",
    );
  });

  it("judges port mappings and never claims reachability", () => {
    expect(field("container.port", { target: "container/cart-web", contains: "8080:8080/tcp" }), runtime, "PASS");
    const result = expect(
      field("container.port", { target: "container/cart-web", contains: "9999" }),
      runtime,
      "FAIL",
    );
    assert.match(
      String(result.message),
      /opens no port/,
      "the reading has no `reachable` field on purpose, and the message says so rather than implying one",
    );
    assert.equal(
      (registry.require("container.port").comparisons as readonly string[]).includes("reachable"),
      false,
    );
  });

  it("distinguishes a published mapping from an exposed-only one", () => {
    const exposedOnly = containerDocument({
      containers: [
        containerReading({
          ports: [
            { containerPort: 8080, protocol: "tcp", hostPort: null, hostIp: "", exposed: true, published: false },
          ],
        }),
      ],
    });
    expect(
      field("container.port", { target: "container/cart-web", contains: "from the image" }),
      observed(exposedOnly),
      "PASS",
    );
  });

  it("judges declared limits and says they are declared rather than enforced", () => {
    expect(
      field("container.limit", { target: "container/cart-web", contains: "declared, not enforced" }),
      runtime,
      "PASS",
    );

    const none = containerDocument({
      containers: [
        containerReading({
          resources: {
            memoryBytes: null,
            memoryReservationBytes: null,
            cpus: null,
            pidsLimit: null,
            enforced: false,
          },
        }),
      ],
    });
    expect(
      field("container.limit", { target: "container/cart-web", equals: "no limits declared" }),
      observed(none),
      "PASS",
    );
  });
});

// ---- health -----------------------------------------------------------------------------------------

describe("a healthcheck nobody asked for has not failed", () => {
  it("judges the healthcheck's own answer", () => {
    expect(field("container.health", { target: "container/cart-web", equals: "healthy" }), runtime, "PASS");
    expect(field("container.health", { target: "container/cart-web", equals: "starting" }), runtime, "FAIL");
  });

  it("reads an unknown health word as an unusable expectation", () => {
    expect(field("container.health", { target: "container/cart-web", equals: "ok" }), runtime, "ERROR", /one of/);
    for (const word of CONTAINER_HEALTH_STATES) {
      const document = containerDocument({
        containers: [containerReading({ health: { ...containerReading().health!, state: word } })],
      });
      expect(field("container.health", { target: "container/cart-web", equals: word }), observed(document), "PASS");
    }
  });

  it("reports INCONCLUSIVE, naming the aliveness question, when there is no healthcheck", () => {
    const document = containerDocument({ containers: [containerReading({ health: null })] });
    const result = expect(
      field("container.health", { target: "container/cart-web", equals: "healthy" }),
      observed(document),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /container\.alive/);
  });
});

// ---- logs, and the reason they are two validators ----------------------------------------------------

describe("stdout and stderr are two streams, so they are two validators", () => {
  it("reads stdout through container.logs", () => {
    expect(field("container.logs", { target: "container/cart-web", contains: "listening on 8080" }), runtime, "PASS");
  });

  it("reads stderr through container.stderr", () => {
    expect(field("container.stderr", { target: "container/cart-web", contains: "cache cold" }), runtime, "PASS");
  });

  it("does not find stderr in stdout, which is the whole reason for the split", () => {
    // A single log validator that concatenated the two streams would answer this criterion PASS, and a
    // criterion about a clean stdout would then be satisfied by the very warning it exists to catch.
    const result = expect(
      field("container.logs", { target: "container/cart-web", contains: "cache cold" }),
      runtime,
      "FAIL",
    );
    assert.match(String(result.message), /stdout/);
  });

  it("says in the failure that the record stopped keeping bytes", () => {
    const document = containerDocument({ logs: [logReading({ truncated: true })] });
    const result = expect(
      field("container.logs", { target: "container/cart-web", contains: "shutting down" }),
      observed(document),
      "FAIL",
    );
    assert.match(String(result.message), /stopped keeping bytes/);
  });

  it("reports INCONCLUSIVE when no log was read for a container the world does hold", () => {
    const document = containerDocument({ logs: [] });
    expect(
      field("container.logs", { target: "container/cart-web", contains: "listening" }),
      observed(document),
      "INCONCLUSIVE",
      /container\.state/,
    );
  });
});

// ---- the action record, split by who asked -----------------------------------------------------------

describe("an action record is read by who issued it", () => {
  it("reads the application's newest action through container.call", () => {
    expect(
      field("container.call", { target: "container.start", equals: "answered" }),
      runtime,
      "PASS",
    );
  });

  it("prefers the newest record, because the world may have been asked twice", () => {
    const document = containerDocument({
      calls: [
        callRecord({ action: "image.build", result: "failed", status: 1 }),
        callRecord({ action: "image.build", result: "answered", status: 0 }),
      ],
    });
    expect(
      field("container.call", { target: "image.build", equals: "answered" }),
      observed(document),
      "PASS",
    );
  });

  it("reports INCONCLUSIVE and points at container.probe when only a criterion issued the action", () => {
    const document = containerDocument({
      calls: [callRecord({ action: "container.start", client: "criterion", command: "docker start cart-web" })],
    });
    const result = expect(
      field("container.call", { target: "container.start", equals: "answered" }),
      observed(document),
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /container\.probe/);
  });

  it("reads a criterion's own command through container.probe, and not through container.call", () => {
    const document = containerDocument({
      calls: [
        callRecord({
          action: null,
          client: "criterion",
          command: "docker compose up",
          resource: null,
          result: "refused",
          status: 501,
          reason: "this world does not implement compose",
        }),
      ],
    });
    const reading = observed(document);

    // The command-line branch is what makes an `action: null` record reachable at all: a command the
    // world does not implement has no action *name*, so a criterion can only name it by its spelling.
    expect(field("container.probe", { target: "docker compose up", equals: "refused" }), reading, "PASS");
    expect(field("container.probe", { target: "docker compose up", equals: "answered" }), reading, "FAIL");

    const result = expect(
      field("container.call", { target: "docker compose up", equals: "refused" }),
      reading,
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /container\.probe/);
  });

  it("reports INCONCLUSIVE, listing what the record does hold, when nothing matches the target", () => {
    const result = expect(
      field("container.call", { target: "image.pull", equals: "answered" }),
      runtime,
      "INCONCLUSIVE",
    );
    assert.match(String(result.message), /container\.start/);
  });

  it("reads a command line as a target, which is how a criterion observes a command the world does not serve", () => {
    // The `action: null` record is the case the design exists for: a command this world does not
    // implement has no action name to be keyed by, so a target that matches the command line is the
    // only way a contract can observe that the world refused it.
    const document = containerDocument({
      calls: [callRecord({ action: null, command: "docker compose up", result: "refused", status: 405 })],
    });
    const result = expect(
      field("container.call", { target: "docker compose up", equals: "answered" }),
      observed(document),
      "FAIL",
    );
    assert.match(String(result.message), /does not implement it/);
    assert.match(String(result.message), /docker compose up/, "the failure has to quote the command line");
    expect(
      field("container.call", { target: "docker compose up", equals: "refused" }),
      observed(document),
      "PASS",
    );
  });

  it("judges the result of an action against the world's own vocabulary", () => {
    expect(field("container.call", { target: "container.start", equals: "invented" }), runtime, "ERROR", /one of/);
  });
});

// ---- the runtime record itself -----------------------------------------------------------------------

describe("the runtime is judged as a fact about the world, substitution included", () => {
  it("reads the runtime name and version", () => {
    expect(field("container.runtime", { equals: "docker" }), runtime, "PASS");
    expect(field("container.runtime", { matches: "^dock" }), runtime, "PASS");
    expect(field("container.runtime", { equals: "podman" }), runtime, "FAIL");
  });

  it("does not report the substitution through the runtime's own name", () => {
    // The reading's `runtime` is the *interface* the application spoke, not the engine behind it. A
    // substitute that reported itself as `veridian-container-sim` here would be a world answering a
    // question about the application with a fact about Veridian, which is why the substitution travels
    // in `simulated` instead.
    const document = containerDocument({ runtime: "veridian-container-sim" });
    expect(field("container.runtime", { equals: "docker" }), observed(document), "FAIL");
  });

  it("holds a reading the world's own guard accepts", () => {
    // The fixtures drive every test in this file, so a fixture the guard would refuse would mean the
    // suite is judging documents no world can produce. Asserted on the document every fixture is built
    // from, and against the guard rather than against a hand-written list of required fields.
    assert.equal(isContainerObservationData(runtime.data), true);
    const document = runtime.data as ContainerObservationData;
    const actions = new Set<string>(CONTAINER_ACTIONS);
    for (const call of document.calls) {
      if (call.action !== null) {
        assert.ok(actions.has(call.action), `${call.action} is not an action this world records`);
      }
    }
  });
});
