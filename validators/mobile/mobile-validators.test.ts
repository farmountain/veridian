/**
 * The twelfth validator family, judged against the vocabulary the code actually exports.
 *
 * Every name, every message fragment and every rendered string in this file is read out of
 * `mobile-validators.ts` and `core/environment/mobile-observation.ts` rather than recalled, because a
 * test that asserts a message's shape is asserting a property of the code that produces it - so the
 * assertion has to quote the producer.
 *
 * The judgements go through a `ValidatorRegistry`, so a test can never pass against a name the product
 * does not have. They bypass `evaluateCriterion`'s evidence rules deliberately: the family's own status
 * discipline is what is under test here, and the evidence rules have their own suite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { COMPARISON_KEYS } from "../../core/acceptance/plan.ts";
import {
  MOBILE_ACTIONS,
  MOBILE_ACTION_RESULTS,
  MOBILE_OBSERVATION_KIND,
  isMobileObservationData,
} from "../../core/environment/mobile-observation.ts";
import type {
  MobileBundleReading,
  MobileCallRecord,
  MobileDeepLinkReading,
  MobileDeviceReading,
  MobileLogReading,
  MobileNotificationReading,
  MobileObservationData,
  MobilePermissionReading,
} from "../../core/environment/mobile-observation.ts";
import { WEB_OBSERVATION_KIND } from "../../core/environment/web-observation.ts";
import type { WebObservationData } from "../../core/environment/web-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";
import type { AssertionResult } from "../../core/validation/types.ts";
import { ValidatorRegistry } from "../../core/validation/registry.ts";

import {
  MOBILE_VALIDATORS,
  MOBILE_VALIDATOR_NAMES,
  mobileValidators,
} from "./mobile-validators.ts";

const CART = "com.veridian.cart";

// ---- fixtures ------------------------------------------------------------------------------------

const permissionReading = (
  overrides: Partial<MobilePermissionReading> = {},
): MobilePermissionReading => ({
  name: "android.permission.CAMERA",
  key: "camera",
  declared: true,
  state: "granted",
  prompted: false,
  reason: null,
  ...overrides,
});

const deepLinkReading = (overrides: Partial<MobileDeepLinkReading> = {}): MobileDeepLinkReading => ({
  scheme: "veridian",
  host: "cart",
  path: "/item",
  bundle: CART,
  opened: 1,
  ...overrides,
});

const bundleReading = (overrides: Partial<MobileBundleReading> = {}): MobileBundleReading => ({
  id: CART,
  name: "Cart",
  version: "1.0.0",
  versionCode: 1,
  state: "running",
  running: true,
  exitCode: null,
  launches: 2,
  entryPoint: "index.js",
  command: ["node", "index.js"],
  dataDir: "data/com.veridian.cart",
  files: 12,
  sizeBytes: 4096,
  digest: "sha256:abc",
  permissions: [permissionReading()],
  deepLinks: [deepLinkReading()],
  ...overrides,
});

const logReading = (overrides: Partial<MobileLogReading> = {}): MobileLogReading => ({
  bundle: CART,
  runs: 2,
  stdout: "cart: ready\n",
  stderr: "",
  stdoutBytes: 12,
  stderrBytes: 0,
  truncated: false,
  ...overrides,
});

const notificationReading = (
  overrides: Partial<MobileNotificationReading> = {},
): MobileNotificationReading => ({
  id: "com.veridian.cart#1",
  bundle: CART,
  channel: "cart",
  title: "Cart ready",
  body: "3 items",
  priority: "normal",
  delivered: false,
  ...overrides,
});

const callRecord = (overrides: Partial<MobileCallRecord> = {}): MobileCallRecord => ({
  action: "bundle.install",
  client: "provisioner",
  command: "bundle.install com.veridian.cart",
  resource: CART,
  result: "answered",
  status: 0,
  reason: null,
  ...overrides,
});

const deviceReading = (overrides: Partial<MobileDeviceReading> = {}): MobileDeviceReading => ({
  id: "sim-cart-device",
  model: "Pixel 8",
  manufacturer: "Veridian",
  platform: "android",
  osName: "Android",
  osVersion: "14",
  locale: "en-US",
  state: "booted",
  orientation: { orientation: "landscape", rotationDegrees: 90, locked: false },
  screen: { width: 1080, height: 2400, densityDpi: 420, scale: 2.625, drawn: false },
  boots: 1,
  ...overrides,
});

const mobileDocument = (overrides: Partial<MobileObservationData> = {}): MobileObservationData => ({
  device: "sim-cart-device",
  world: {
    name: "veridian-device-sim",
    version: "1.0.0",
    apiLevel: 34,
    bundles: 1,
    launched: 2,
    notifications: 1,
  },
  state: deviceReading(),
  sandbox: "sandbox/device",
  simulated: ["device", "emulator"],
  calls: [callRecord()],
  bundles: [bundleReading()],
  logs: [logReading()],
  notifications: [notificationReading()],
  keychain: [
    {
      bundle: CART,
      key: "session",
      digest: "sha256:def",
      bytes: 32,
      accessible: "after-first-unlock",
    },
  ],
  ...overrides,
});

const observed = (data: unknown, kind: string = MOBILE_OBSERVATION_KIND): Observation => ({
  kind,
  capturedAt: "2026-01-01T00:00:00.000Z",
  environmentId: "env-1",
  runId: "run-1",
  data,
  artifacts: [{ path: "artifacts/AC-001.observation.json", kind: "json" }],
  error: null,
});

/** A reading from a world that is not this one, so the family's foreign-document branch is reachable. */
const webDocument = {
  page: { url: "http://127.0.0.1:3000/", title: "Cart" },
  elements: [],
  console: [],
  network: [],
} as unknown as WebObservationData;

const runtime = observed(mobileDocument());

// ---- the harness ---------------------------------------------------------------------------------

const registry = new ValidatorRegistry(mobileValidators());

const judge = (
  raw: Readonly<Record<string, unknown>>,
  observation: Observation,
): AssertionResult => registry.require(String(raw["validator"])).validate(raw, observation);

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

const said = (result: AssertionResult, fragment: string): void => {
  assert.ok(
    String(result.message).includes(fragment),
    `the reading does not say ${JSON.stringify(fragment)}: ${String(result.message)}`,
  );
};

// ---- the roster ----------------------------------------------------------------------------------

describe("the roster is the code, and every name in it is writable", () => {
  it("names exactly the twelve validators the family exports, in both directions", () => {
    assert.equal(
      Object.values(MOBILE_VALIDATOR_NAMES).length,
      12,
      "the name record and the exported roster are not the same size",
    );
    assert.deepEqual(
      MOBILE_VALIDATORS.map((validator) => validator.name).sort(),
      [...Object.values(MOBILE_VALIDATOR_NAMES)].sort(),
      "the roster of validators and the record of names are the same vocabulary written twice, and a name in one and not the other is either unreachable or unfindable",
    );
    assert.ok(
      Object.isFrozen(MOBILE_VALIDATORS),
      "the roster is a global a caller could edit in place, which would make one criterion's verdict depend on whether another criterion ran first",
    );
  });

  it("spells every name so that an acceptance contract can be written at all", () => {
    // `acceptance.schema.json` matches a validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so a
    // hyphen produces a contract no document can express - and the failure is at load time, not here.
    const writable = /^[a-z0-9]+(\.[a-z0-9]+)+$/;
    for (const name of Object.values(MOBILE_VALIDATOR_NAMES)) {
      assert.match(name, writable, `${name} is not a name acceptance.schema.json can match`);
      assert.ok(name.startsWith("mobile."), `${name} does not name this family`);
    }
    assert.equal(
      MOBILE_VALIDATOR_NAMES.deepLink,
      "mobile.deeplink",
      "the validator that judges a deep link carries no hyphen, because the schema's character class has none - `mobile.deep-link` is a criterion that cannot be written",
    );
  });

  it("declares the world it reads on every member, and a target noun exactly where it needs one", () => {
    for (const validator of MOBILE_VALIDATORS) {
      assert.equal(
        validator.observationKind,
        MOBILE_OBSERVATION_KIND,
        `${validator.name} reads a different world`,
      );
      if (validator.needsTarget) {
        assert.equal(
          typeof validator.targetNoun,
          "string",
          `${validator.name} needs a target and does not say which, so the clarification ladder has nothing to ask for`,
        );
      } else {
        assert.equal(
          validator.targetNoun,
          undefined,
          `${validator.name} names a target noun and needs no target, so a ladder reading it would ask a question the validator ignores`,
        );
      }
    }
    const targetless = MOBILE_VALIDATORS.filter((validator) => !validator.needsTarget)
      .map((validator) => validator.name)
      .sort();
    assert.deepEqual(
      targetless,
      ["mobile.device", "mobile.installed", "mobile.orientation", "mobile.os", "mobile.screen"],
      "there is exactly one device in a reading, so exactly these five ask about the world itself rather than about a named thing",
    );
  });

  it("declares only comparisons the acceptance layer can decode", () => {
    const decodable = new Set<string>(COMPARISON_KEYS);
    for (const validator of MOBILE_VALIDATORS) {
      assert.ok(
        validator.comparisons.length > 0,
        `${validator.name} declares no comparison, so no criterion could state one`,
      );
      for (const key of validator.comparisons) {
        assert.ok(
          decodable.has(key),
          `${validator.name} declares \`${key}\`, which is not an acceptance comparison`,
        );
      }
    }
    const wordOnly = MOBILE_VALIDATORS.filter((validator) => validator.comparisons.length === 1)
      .map((validator) => validator.name)
      .sort();
    assert.deepEqual(
      wordOnly,
      ["mobile.call", "mobile.probe"],
      "the two record validators compare against the world's closed vocabulary of results, so `equals` is the only comparison a criterion can state",
    );
  });

  it("returns a fresh roster each time, so a registry cannot be reached through the family", () => {
    const first = mobileValidators();
    const second = mobileValidators();
    assert.notEqual(first, second, "the family hands out its own array, which a caller could edit");
    assert.deepEqual(
      first.map((validator) => validator.name),
      second.map((validator) => validator.name),
    );
    assert.ok(!Object.isFrozen(first), "a fresh array that is frozen cannot be given to a registry");
  });

  it("keeps the substitute, and every other family, out of the vocabulary that judges it", () => {
    const source = readFileSync(new URL("./mobile-validators.ts", import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    assert.ok(
      specifiers.length >= 3,
      "the import scan found almost nothing, so it is not reading the file",
    );
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
    for (const validator of MOBILE_VALIDATORS) {
      const result = judge(field(validator.name), runtime);
      assert.equal(
        result.status,
        "ERROR",
        `${validator.name} judged an empty expectation as ${result.status}`,
      );
      const pattern = validator.needsTarget ? /named no target/ : /nothing to judge/;
      assert.match(
        String(result.message),
        pattern,
        `${validator.name} was refused for a different reason: ${String(result.message)}`,
      );
      assert.equal(result.failureKind, "VALIDATOR_ERROR", `${validator.name} blamed the application`);
    }
    const resolved = expect(field("mobile.bundle", { target: CART }), runtime, "ERROR");
    assert.match(String(resolved.message), /nothing to judge/);
    assert.equal(
      resolved.failureKind,
      "VALIDATOR_ERROR",
      "a defect in the contract is not the application's",
    );
    said(resolved, "An expectation that cannot fail is a false PASS waiting to happen.");
  });
});

// ---- a reading from another world -----------------------------------------------------------------

describe("a document from another world is an environment defect, not a judgment", () => {
  it("reports the payload that arrived, and says the adapter produced it", () => {
    const result = expect(
      field("mobile.bundle", { target: CART, equals: "anything" }),
      observed(webDocument, WEB_OBSERVATION_KIND),
      "ERROR",
      /does not carry a mobile device document/,
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
    assert.equal(result.actual, webDocument, "the reading should carry the document it could not read");
    said(result, "this is a defect in the environment rather than a handset the criterion failed against");
  });

  it("refuses a null payload rather than treating it as an empty device", () => {
    const result = expect(field("mobile.device", { equals: "anything" }), observed(null), "ERROR");
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });

  it("refuses a document that is the right shape only at its first field", () => {
    const result = expect(
      field("mobile.installed", { equals: "anything" }),
      observed({ device: "sim-cart-device" }),
      "ERROR",
    );
    assert.equal(result.failureKind, "ENVIRONMENT_FAILURE");
  });
});

// ---- target resolution ----------------------------------------------------------------------------

describe("a target is resolved by the family's own grammar, and its refusal is quoted", () => {
  it("quotes the resolver's reason for each way a bundle id cannot be read", () => {
    const empty = expect(field("mobile.bundle", { target: "", equals: "x" }), runtime, "ERROR");
    said(empty, "a bundle id is required, and the target names an empty one");

    const slashed = expect(
      field("mobile.bundle", { target: `${CART}/camera`, equals: "x" }),
      runtime,
      "ERROR",
    );
    said(slashed, 'a target scopes a permission or a keychain entry inside a bundle with "/"');

    const hashed = expect(
      field("mobile.bundle", { target: `${CART}#1`, equals: "x" }),
      runtime,
      "ERROR",
    );
    said(hashed, 'a target names a notification inside a bundle as "<bundle>#<position>"');

    const notReversed = expect(field("mobile.bundle", { target: "cart", equals: "x" }), runtime, "ERROR");
    said(notReversed, "a bundle id is a reversed domain in lower case, with at least two segments");
    assert.equal(notReversed.target, "cart", "the refusal carries the target it refused");
  });

  it("states which separator a scoped target is missing", () => {
    const result = expect(
      field("mobile.permission", { target: CART, equals: "x" }),
      runtime,
      "ERROR",
      /The target `com\.veridian\.cart` does not name anything this world holds/,
    );
    said(result, 'a permission target is written "<bundle>/<permission>"');
  });

  it("refuses a deep link that is not a whole URI, and quotes the whole URI it wanted", () => {
    const noScheme = expect(
      field("mobile.deeplink", { target: "cart/item", equals: "x" }),
      runtime,
      "ERROR",
    );
    said(noScheme, 'a deep link is a whole URI - "veridian://cart/item" - and this one names no "<scheme>://"');

    const noHost = expect(
      field("mobile.deeplink", { target: "veridian://", equals: "x" }),
      runtime,
      "ERROR",
    );
    said(noHost, 'a deep link names a host between "://" and the path');
  });

  it("refuses a notification position that is not a 1-based whole number", () => {
    const noHash = expect(
      field("mobile.notification", { target: CART, equals: "x" }),
      runtime,
      "ERROR",
    );
    said(noHash, 'a notification target is written "<bundle>#<position>"');

    const zero = expect(
      field("mobile.notification", { target: `${CART}#0`, equals: "x" }),
      runtime,
      "ERROR",
    );
    said(zero, "a notification position is a 1-based whole number");
  });

  it("refuses surrounding whitespace on every grammar rather than trimming it", () => {
    for (const validator of ["mobile.bundle", "mobile.logs", "mobile.deeplink"]) {
      const result = expect(
        field(validator, { target: " veridian://cart/item ", equals: "x" }),
        runtime,
        "ERROR",
      );
      said(result, "a target is written without surrounding whitespace");
    }
  });
});

// ---- the verdict is the engine's ------------------------------------------------------------------

describe("the verdict test is the engine's vocabulary, not the presence of a status field", () => {
  it("does not mistake a recorded HTTP-style status for an assertion result", () => {
    const document = mobileDocument({
      calls: [callRecord({ status: 200, result: "answered" })],
    });
    const result = expect(
      field("mobile.call", { target: "bundle.install", equals: "answered" }),
      observed(document),
      "PASS",
    );
    assert.ok(
      (CRITERION_STATUSES as readonly unknown[]).includes(result.status),
      "the verdict is not one of the engine's statuses",
    );
    assert.equal(result.expected, "answered", "a pass carries the value it compared against");
  });

  it("does not mistake a zero status with a failure result for an assertion result", () => {
    const document = mobileDocument({
      calls: [callRecord({ status: 0, result: "failed", reason: "exit 1" })],
    });
    expect(
      field("mobile.call", { target: "bundle.install", equals: "failed" }),
      observed(document),
      "PASS",
    );
    expect(
      field("mobile.call", { target: "bundle.install", equals: "answered" }),
      observed(document),
      "FAIL",
    );
  });
});

// ---- the handset ---------------------------------------------------------------------------------

describe("the handset is judged as a fact about the world, substitution included", () => {
  it("reads the device as one line, and says when it has never booted", () => {
    expect(
      field("mobile.device", {
        equals: "sim-cart-device Veridian Pixel 8 android Android 14, booted, locale en-US",
      }),
      runtime,
      "PASS",
    );
    expect(field("mobile.device", { contains: "Veridian Pixel 8" }), runtime, "PASS");
    expect(field("mobile.device", { matches: "^sim-cart-device " }), runtime, "PASS");
    expect(field("mobile.device", { equals: "booted" }), runtime, "FAIL");

    const never = mobileDocument({ state: deviceReading({ state: "off", boots: 0 }) });
    expect(field("mobile.device", { contains: "(never booted)" }), observed(never), "PASS");
    expect(
      field("mobile.device", { contains: "(never booted)" }),
      runtime,
      "FAIL",
      /but it is "sim-cart-device Veridian Pixel 8 android Android 14, booted, locale en-US"/,
    );
  });

  it("reads the API level from the world's answer rather than the device's report", () => {
    expect(field("mobile.os", { equals: "Android 14 (apiLevel 34)" }), runtime, "PASS");
    expect(field("mobile.os", { equals: "Android 15 (apiLevel 35)" }), runtime, "FAIL");

    // The two facts live in different places in the reading, so moving one must move exactly one answer.
    const document = mobileDocument({
      world: { ...mobileDocument().world, apiLevel: 35 },
    });
    expect(field("mobile.os", { equals: "Android 14 (apiLevel 35)" }), observed(document), "PASS");
    expect(
      field("mobile.device", {
        equals: "sim-cart-device Veridian Pixel 8 android Android 14, booted, locale en-US",
      }),
      observed(document),
      "PASS",
    );
  });

  it("says a screen was rendered and never drawn, and treats that as a different answer from drawn", () => {
    expect(
      field("mobile.screen", {
        equals: "1080x2400 at 420dpi, scale 2.625 (rendered and never drawn)",
      }),
      runtime,
      "PASS",
    );
    const drawn = mobileDocument({
      state: deviceReading({
        screen: { width: 1080, height: 2400, densityDpi: 420, scale: 2.625, drawn: true },
      }),
    });
    // A `PASS` carries no message on purpose - `judge` says so - so the property worth holding here is
    // that the two states render differently: a criterion pinning the not-drawn form cannot be
    // satisfied by a handset whose screen really is drawn.
    expect(
      field("mobile.screen", {
        equals: "1080x2400 at 420dpi, scale 2.625 (rendered and never drawn)",
      }),
      observed(drawn),
      "FAIL",
      /but it is "1080x2400 at 420dpi, scale 2.625 \(drawn\)"/,
    );
  });

  it("reads the axis, the rotation and the lock, and says which axis is locked", () => {
    expect(
      field("mobile.orientation", { equals: "landscape (rotation 90, unlocked)" }),
      runtime,
      "PASS",
    );
    expect(
      field("mobile.orientation", { equals: "landscape (rotation 90, locked)" }),
      runtime,
      "FAIL",
    );
    const locked = mobileDocument({
      state: deviceReading({
        orientation: { orientation: "portrait", rotationDegrees: 0, locked: true },
      }),
    });
    expect(
      field("mobile.orientation", { equals: "portrait (rotation 0, locked)" }),
      observed(locked),
      "PASS",
    );
  });
});

// ---- the store ------------------------------------------------------------------------------------

describe("the store is judged by what the device holds", () => {
  it("reads one bundle's whole record, including the exit code only when there is one", () => {
    const whole =
      'com.veridian.cart Cart 1.0.0 (versionCode 1) [running], entry "index.js", ' +
      "12 file(s), 4096 byte(s), digest sha256:abc, launched 2 time(s)";
    expect(field("mobile.bundle", { target: CART, equals: whole }), runtime, "PASS");
    expect(field("mobile.bundle", { target: CART, contains: "[running]" }), runtime, "PASS");
    expect(field("mobile.bundle", { target: CART, contains: "last exit" }), runtime, "FAIL");

    const exited = mobileDocument({
      bundles: [bundleReading({ state: "stopped", running: false, exitCode: 1 })],
    });
    expect(
      field("mobile.bundle", { target: CART, contains: "[stopped]" }),
      observed(exited),
      "PASS",
    );
    expect(field("mobile.bundle", { target: CART, contains: "last exit 1" }), observed(exited), "PASS");
  });

  it("reports an absent bundle as a reading it could not make, and says what is there", () => {
    const result = expect(
      field("mobile.bundle", { target: "com.veridian.other", equals: "x" }),
      runtime,
      "INCONCLUSIVE",
      /The device holds no bundle `com\.veridian\.other`, so there is nothing to read/,
    );
    said(result, `The device holds \`${CART}\`.`);
    said(result, "Whether it should is the question `mobile.installed` answers");
    assert.equal(result.target, "com.veridian.other");

    const empty = mobileDocument({ bundles: [] });
    const nothing = expect(
      field("mobile.bundle", { target: "com.veridian.other", equals: "x" }),
      observed(empty),
      "INCONCLUSIVE",
    );
    said(nothing, "The device holds no bundles at all");
  });

  it("lists what is installed, leaving out what has been removed", () => {
    expect(field("mobile.installed", { equals: `1 bundle(s): ${CART}` }), runtime, "PASS");

    const removed = bundleReading({ id: "com.veridian.old", name: "Old", state: "removed" });
    const withRemoved = mobileDocument({ bundles: [bundleReading(), removed] });
    expect(field("mobile.installed", { equals: `1 bundle(s): ${CART}` }), observed(withRemoved), "PASS");
    expect(
      field("mobile.installed", { contains: "com.veridian.old" }),
      observed(withRemoved),
      "FAIL",
      /but it is "1 bundle\(s\): com\.veridian\.cart"/,
    );
  });

  it("still lets a removed bundle be read by its own record", () => {
    // The two validators answer different questions on purpose: `installed` is a roster and `bundle` is
    // one record, so a criterion about what was uninstalled has a reading to name.
    const removed = bundleReading({ id: "com.veridian.old", name: "Old", state: "removed" });
    const withRemoved = mobileDocument({ bundles: [bundleReading(), removed] });
    expect(
      field("mobile.bundle", { target: "com.veridian.old", contains: "[removed]" }),
      observed(withRemoved),
      "PASS",
    );
  });

  it("renders an empty device as a count rather than as nothing", () => {
    expect(
      field("mobile.installed", { equals: "0 bundle(s)" }),
      observed(mobileDocument({ bundles: [] })),
      "PASS",
    );
  });
});

// ---- what the application did while it ran ---------------------------------------------------------

describe("a permission is read as a declared grant, and its absence names what was declared instead", () => {
  it("reads the name, the state and both provenance clauses", () => {
    expect(
      field("mobile.permission", {
        target: `${CART}/camera`,
        equals: "camera (android.permission.CAMERA): granted (declared by the bundle, never prompted for)",
      }),
      runtime,
      "PASS",
    );
    const prompted = mobileDocument({
      bundles: [bundleReading({ permissions: [permissionReading({ prompted: true })] })],
    });
    expect(
      field("mobile.permission", { target: `${CART}/camera`, contains: "(declared by the bundle, prompted for)" }),
      observed(prompted),
      "PASS",
    );
  });

  it("reports a permission the manifest never declared as undeclared rather than as refused", () => {
    const undeclared = mobileDocument({
      bundles: [
        bundleReading({
          permissions: [
            permissionReading({ declared: false, state: "not-determined", prompted: true }),
          ],
        }),
      ],
    });
    expect(
      field("mobile.permission", {
        target: `${CART}/camera`,
        equals:
          "camera (android.permission.CAMERA): not-determined " +
          "(not declared by the bundle, prompted for)",
      }),
      observed(undeclared),
      "PASS",
    );
  });

  it("quotes the reason a permission carries, because a refusal and a stated cause are different findings", () => {
    const denied = mobileDocument({
      bundles: [
        bundleReading({
          permissions: [permissionReading({ state: "denied", reason: "user refused at prompt" })],
        }),
      ],
    });
    expect(
      field("mobile.permission", { target: `${CART}/camera`, contains: " - user refused at prompt" }),
      observed(denied),
      "PASS",
    );
  });

  it("reports a permission the bundle never declared without calling it denied", () => {
    const result = expect(
      field("mobile.permission", { target: `${CART}/microphone`, equals: "x" }),
      runtime,
      "INCONCLUSIVE",
      /declares no permission this world addresses by `microphone`: it declares `camera`/,
    );
    said(
      result,
      "A permission that was never declared and one that was declared and refused are different findings, so this reading reports only the first.",
    );
  });

  it("reports a permission asked of a bundle the device does not hold as no manifest at all", () => {
    const result = expect(
      field("mobile.permission", { target: "com.veridian.other/camera", equals: "x" }),
      runtime,
      "INCONCLUSIVE",
      /there is no manifest to have declared `camera`/,
    );
    said(result, `The device holds \`${CART}\`.`);
    assert.equal(result.target, "com.veridian.other/camera");
  });

  it("says a bundle declares nothing rather than listing nothing", () => {
    const bare = mobileDocument({ bundles: [bundleReading({ permissions: [] })] });
    const result = expect(
      field("mobile.permission", { target: `${CART}/camera`, equals: "x" }),
      observed(bare),
      "INCONCLUSIVE",
    );
    said(result, "it declares no permissions at all");
  });
});

describe("a deep link is read as a route and as what resolving it did", () => {
  it("says a link resolved and that no bundle was launched for it", () => {
    expect(
      field("mobile.deeplink", {
        target: "veridian://cart/item",
        equals:
          "veridian://cart/item -> com.veridian.cart " +
          "(opened 1 time(s), resolved, no bundle launched)",
      }),
      runtime,
      "PASS",
    );
    expect(
      field("mobile.deeplink", { target: "veridian://cart/item", contains: "opened 1 time(s)" }),
      runtime,
      "PASS",
    );
    // The parenthetical is the reading's own honesty: resolving a route starts no process here, and a
    // value that omitted it would say a bundle ran.
    expect(
      field("mobile.deeplink", {
        target: "veridian://cart/item",
        equals: "veridian://cart/item -> com.veridian.cart (opened 1 time(s))",
      }),
      runtime,
      "FAIL",
    );
  });

  it("matches the host exactly and the path by prefix", () => {
    expect(
      field("mobile.deeplink", { target: "veridian://cart/item/42", contains: `-> ${CART}` }),
      runtime,
      "PASS",
    );
    expect(
      field("mobile.deeplink", { target: "veridian://checkout/item", contains: `-> ${CART}` }),
      runtime,
      "INCONCLUSIVE",
    );
  });

  it("reports an unanswered route as the finding, and says how it matched", () => {
    const bare = mobileDocument({ bundles: [bundleReading({ deepLinks: [] })] });
    const result = expect(
      field("mobile.deeplink", { target: "veridian://cart/item", equals: "x" }),
      observed(bare),
      "INCONCLUSIVE",
      /No bundle in this reading registered a link answering `veridian:\/\/cart\/item`/,
    );
    said(result, "A link is matched with its scheme and its host exactly and its path by prefix");
    assert.equal(result.target, "veridian://cart/item");
  });
});

describe("a notification is read at its position inside its own bundle's list", () => {
  it("says a notification was queued and never delivered", () => {
    expect(
      field("mobile.notification", {
        target: `${CART}#1`,
        equals: 'com.veridian.cart#1 cart/normal: "Cart ready" - 3 items (queued, never delivered)',
      }),
      runtime,
      "PASS",
    );
    const delivered = mobileDocument({
      notifications: [notificationReading({ delivered: true })],
    });
    expect(
      field("mobile.notification", { target: `${CART}#1`, contains: "(delivered)" }),
      observed(delivered),
      "PASS",
    );
  });

  it("reports a position past the end of the list, counted within the bundle", () => {
    const result = expect(
      field("mobile.notification", { target: `${CART}#2`, equals: "x" }),
      runtime,
      "INCONCLUSIVE",
      /posted 1 notification\(s\), so position 2 is past the end of its list/,
    );
    said(result, "The position is 1-based and counted within this bundle's own notifications, not the device's.");
  });

  it("does not count another bundle's notifications towards this bundle's positions", () => {
    const other = notificationReading({ id: "com.veridian.other#1", bundle: "com.veridian.other" });
    const document = mobileDocument({ notifications: [other] });
    const result = expect(
      field("mobile.notification", { target: `${CART}#1`, equals: "x" }),
      observed(document),
      "INCONCLUSIVE",
      /The bundle `com\.veridian\.cart` posted no notification, so there is no position 1 to read/,
    );
    said(result, "Whether it should have is a question about the application");
  });
});

describe("a log record is read as two streams, or as the absence of a stream at all", () => {
  it("reads both streams and the launch count, and marks a truncated record", () => {
    expect(
      field("mobile.logs", {
        target: CART,
        equals: `${CART}: stdout 12 byte(s), stderr 0 byte(s) over 2 launch(es)`,
      }),
      runtime,
      "PASS",
    );
    const truncated = mobileDocument({ logs: [logReading({ truncated: true })] });
    expect(field("mobile.logs", { target: CART, contains: ", truncated" }), observed(truncated), "PASS");
    expect(field("mobile.logs", { target: CART, contains: "over 2 launch(es)" }), runtime, "PASS");
  });

  it("distinguishes a bundle that never launched from one that launched and wrote nothing", () => {
    const quiet = mobileDocument({ logs: [logReading({ stdoutBytes: 0, runs: 1 })] });
    expect(
      field("mobile.logs", { target: CART, equals: `${CART}: stdout 0 byte(s), stderr 0 byte(s) over 1 launch(es)` }),
      observed(quiet),
      "PASS",
    );

    const never = mobileDocument({ logs: [] });
    const result = expect(
      field("mobile.logs", { target: CART, equals: "x" }),
      observed(never),
      "INCONCLUSIVE",
      /The world recorded no stream for `com\.veridian\.cart` at all/,
    );
    said(result, "a bundle that never launched has none, and this is that second case");
    said(result, "what `mobile.call` reads, with the target `bundle.launch`");
  });
});

// ---- the action record ----------------------------------------------------------------------------

describe("an action record is read by who issued it", () => {
  it("reads the application's newest request, and refuses to swap in the criterion's", () => {
    expect(
      field("mobile.call", { target: "bundle.install", equals: "answered" }),
      runtime,
      "PASS",
    );
    expect(field("mobile.call", { target: "bundle.install", equals: "refused" }), runtime, "FAIL");

    const onlyCriterion = mobileDocument({
      calls: [callRecord({ client: "criterion" })],
    });
    const result = expect(
      field("mobile.call", { target: "bundle.install", equals: "answered" }),
      observed(onlyCriterion),
      "INCONCLUSIVE",
      /A request the criterion made cannot stand in for one the application did, or the reverse\./,
    );
    said(result, "that the application made");
    said(result, "the record names it only from `mobile.probe`'s side, asking for the criterion");
    expect(
      field("mobile.probe", { target: "bundle.install", equals: "answered" }),
      observed(onlyCriterion),
      "PASS",
    );
  });

  it("reports a target nobody issued as a reading it could not make", () => {
    const result = expect(
      field("mobile.call", { target: "bundle.launch", equals: "answered" }),
      runtime,
      "INCONCLUSIVE",
      /The world recorded no request naming `bundle\.launch` from anybody/,
    );
    said(result, "reads the application's own requests");
    said(result, "whether the command was ever issued at all is what this record would have said");

    const forProbe = expect(
      field("mobile.probe", { target: "device.info", equals: "answered" }),
      runtime,
      "INCONCLUSIVE",
    );
    said(forProbe, "reads the criterion's own requests");
  });

  it("reaches a command this world does not implement by its command line", () => {
    const unimplemented = callRecord({
      action: null,
      command: "device.rotate left",
      resource: null,
      result: "refused",
      status: 200,
      reason: "unknown action",
    });
    const document = mobileDocument({ calls: [callRecord(), unimplemented] });
    expect(
      field("mobile.call", { target: "device.rotate left", equals: "refused" }),
      observed(document),
      "PASS",
    );
    const failed = expect(
      field("mobile.call", { target: "device.rotate left", equals: "answered" }),
      observed(document),
      "FAIL",
    );
    said(failed, 'the newest one this world recorded, and the reason it gave was `unknown action`');
  });

  it("reads the newest record for a target rather than the first", () => {
    const document = mobileDocument({
      calls: [
        callRecord({ result: "failed", status: 0, reason: "exit 1" }),
        callRecord({ result: "answered" }),
      ],
    });
    expect(
      field("mobile.call", { target: "bundle.install", equals: "answered" }),
      observed(document),
      "PASS",
    );
    expect(
      field("mobile.call", { target: "bundle.install", contains: "failed" }),
      observed(document),
      "ERROR",
      /"contains" is not declared by this validator; it compares with equals/,
    );
  });

  it("refuses a result outside the world's own vocabulary rather than reporting a failed comparison", () => {
    const result = expect(
      field("mobile.call", { target: "bundle.install", equals: "ok" }),
      runtime,
      "ERROR",
    );
    said(
      result,
      `"equals" on a command's result wants one of ${MOBILE_ACTION_RESULTS.join(", ")}`,
    );
    assert.equal(result.failureKind, "VALIDATOR_ERROR", "the application has not been accused of anything");
  });

  it("says the application's request and the criterion's are two different readings", () => {
    // One document, two questions: the application installed the bundle and the criterion asked what the
    // device holds. Judging either through the other is the false pass this family's pair exists to refuse.
    const document = mobileDocument({
      calls: [
        callRecord({ action: "bundle.install", client: "provisioner", result: "answered" }),
        callRecord({
          action: "device.info",
          client: "criterion",
          command: "device.info",
          resource: null,
          result: "answered",
        }),
      ],
    });
    const reading = observed(document);
    expect(field("mobile.call", { target: "bundle.install", equals: "answered" }), reading, "PASS");
    expect(field("mobile.call", { target: "device.info", equals: "answered" }), reading, "INCONCLUSIVE");
    expect(field("mobile.probe", { target: "device.info", equals: "answered" }), reading, "PASS");
    expect(field("mobile.probe", { target: "bundle.install", equals: "answered" }), reading, "INCONCLUSIVE");
    expect(field("mobile.probe", { target: "device.info", equals: "refused" }), reading, "FAIL");
  });
});

// ---- the reading's own guard ---------------------------------------------------------------------

describe("the fixtures are documents the world's own guard accepts", () => {
  it("holds a reading the family's guard would not refuse", () => {
    // The fixtures drive every test in this file, so a fixture the guard refuses would mean the suite is
    // judging documents no world can produce. Asserted against the guard rather than a hand-written list.
    assert.equal(isMobileObservationData(runtime.data), true);
    const document = runtime.data as MobileObservationData;
    const actions = new Set<string>(MOBILE_ACTIONS);
    for (const call of document.calls) {
      if (call.action !== null) {
        assert.ok(actions.has(call.action), `${call.action} is not an action this world records`);
      }
    }
    for (const bundle of document.bundles) {
      for (const permission of bundle.permissions) {
        assert.ok(permission.key.length > 0, "a permission with no short key cannot be addressed");
      }
    }
  });

  it("holds no keychain reading that carries a plaintext value", () => {
    // There is no `mobile.keychain` validator among the twelve, and the reading it would judge is the
    // reason a keychain can be observed at all: it records a digest and a length, never the secret.
    assert.ok(
      !Object.values(MOBILE_VALIDATOR_NAMES).some((name) => name.includes("keychain")),
      "a keychain validator would need a reading this world refuses to write",
    );
    const document = mobileDocument();
    const [entry] = document.keychain;
    assert.ok(entry !== undefined, "the fixture holds a keychain entry, so this test is not vacuous");
    assert.ok(
      !Object.keys(entry).includes("value"),
      "a reading that carried the plaintext would be a keychain that leaks by being observed",
    );
  });
});
