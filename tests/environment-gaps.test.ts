import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adapterDescriptors, registeredAdapters } from "../cli/worlds.ts";
import { detectEnvironmentAmbiguities } from "../core/clarification/detect.ts";
import type { AdapterDescriptor, DetectorContext } from "../core/clarification/detect.ts";
import { getPointer, hasPointer, joinPointer, parentOf, setPointer } from "../core/clarification/pointer.ts";

/**
 * What the ladder asks of an environment document, and what it must not ask.
 *
 * Two defects lived here and neither could fail a test, because nothing tested this function on a
 * world other than the two the demos happen to run:
 *
 * 1. A requirement's `field` was read as a **literal key**. `cli/worlds.ts` declares `cluster.name`,
 *    and the detector looked for a property whose name is the eight characters `cluster.name` - which
 *    a correct document does not have - so it reported three blocking gaps for values that were
 *    present, and an operator answering them would have written a root-level `"cluster.name"` key the
 *    schema refuses as an unknown property. The demo's own first run failed on this: seven gaps, four
 *    questions, "this definition cannot be run".
 *
 * 2. The predicate that skipped the HTTP questions knew only about `databasePath`, so a cluster world
 *    - a world with no socket at all - was still asked for a URL, was handed `health.path: "/"` and
 *    `health.expectStatus: 200`, and had `browser.enabled` derived `true`. `core/environment/load.ts`
 *    refuses `browser.enabled: true` outright when there is no url, so the two halves of one rule
 *    disagreed exactly as `readBrowser` says they would the first time a world arrived that only one
 *    of them was written for.
 *
 * Both tests are driven by the **real** descriptor table rather than a fixture, because the table, the
 * detector and the loader are three places that have to agree about one vocabulary, and a fixture would
 * be a fourth opinion.
 */

const context = (overrides: Partial<DetectorContext> = {}): DetectorContext => ({
  registeredValidators: [],
  validatorDescriptors: [],
  registeredAdapters: [...registeredAdapters()],
  adapterDescriptors: [...adapterDescriptors()],
  sourceLabel: "environment.yaml",
  ...overrides,
});

const paths = (environment: Record<string, unknown>, ctx = context()): readonly string[] =>
  detectEnvironmentAmbiguities(environment, ctx).map((entry) => entry.path);

const descriptorFor = (kind: string): AdapterDescriptor => {
  const found = adapterDescriptors().find((entry) => entry.kind === kind);
  assert.ok(found !== undefined, `cli/worlds.ts no longer declares a world of kind "${kind}"`);
  return found;
};

/** The pointer a requirement names, built the way the detector builds it. */
const pointerOf = (field: string): string => joinPointer(...field.split("."));

/** A document that names `kind` and states nothing else. The starting point for every case below. */
const skeleton = (kind: string): Record<string, unknown> => ({ adapter: kind, app: "app" });

/** A document that states exactly what `kind` declares, and nothing more. */
function satisfier(kind: string): Record<string, unknown> {
  let document: Record<string, unknown> = skeleton(kind);
  for (const requirement of descriptorFor(kind).requires) {
    document = setPointer(document, pointerOf(requirement.field), `stated:${requirement.field}`);
  }
  return document;
}

describe("environment gaps: requirements name a pointer, not a key", () => {
  it("states every requirement of every registered world without raising one gap", () => {
    // The general property, over the real table: a document that says what a world declares is not
    // missing anything that world declared. This is the assertion that would have failed three times
    // over on the cluster world, and it is derived from `cli/worlds.ts` rather than repeated here.
    //
    // It is written against the *reason* a requirement gap quotes rather than against the path it
    // reports, and that distinction was paid for: the first version asked whether the reported paths
    // contained `pointerOf(field)`, so it passed under the literal-key defect - the gap was still
    // raised, at `/cluster.name` instead of `/cluster/name`, and the assertion could not see it.
    // *A test that asks whether a value is in a list cannot see a list that is wrong in a different
    // way.* The reason is what identifies a requirement gap, and it is not templated.
    for (const descriptor of adapterDescriptors()) {
      const reasons = new Set(descriptor.requires.map((requirement) => requirement.why));
      const raised = detectEnvironmentAmbiguities(satisfier(descriptor.kind), context());
      const requirementGaps = raised.filter((entry) => reasons.has(String(entry.context?.["reason"])));
      assert.deepEqual(
        requirementGaps.map((entry) => entry.path),
        [],
        `${descriptor.kind}: every requirement is stated, and these were reported missing`,
      );
    }
  });

  it("reports a missing nested requirement at its pointer, whose container exists", () => {
    const descriptor = descriptorFor("sim-k8s");
    assert.ok(descriptor.requires.length > 0, "sim-k8s declares no requirements, so this case is vacuous");

    const nested = descriptor.requires.find((entry) => entry.field.includes("."));
    assert.ok(nested !== undefined, "sim-k8s declares no nested requirement, so this case proves nothing");

    // Every requirement but the nested one is stated, so the nested one is the only requirement gap.
    let document: Record<string, unknown> = skeleton("sim-k8s");
    for (const requirement of descriptor.requires) {
      if (requirement.field === nested.field) continue;
      document = setPointer(document, pointerOf(requirement.field), "stated");
    }

    const gaps = detectEnvironmentAmbiguities(document, context()).filter(
      (entry) =>
        entry.path !== "/url" &&
        entry.path !== "/health/path" &&
        entry.path !== "/health/expectStatus" &&
        entry.path !== "/browser/enabled" &&
        entry.path !== "/reset/strategy" &&
        entry.path !== "/health/timeoutMs" &&
        entry.path !== "/health/intervalMs",
    );

    const pathsFound = gaps.map((entry) => entry.path);
    assert.ok(pathsFound.includes(pointerOf(nested.field)), `expected ${pointerOf(nested.field)} in ${String(pathsFound)}`);

    // A path is a place, not decoration: the engine writes the operator's answer to it and the failure
    // report quotes it. A token containing a dot is a literal key with a dot in it, which is what the
    // defect produced - and it names nothing the adapter reads.
    for (const path of pathsFound) {
      for (const token of path.split("/").slice(1)) {
        assert.ok(!token.includes("."), `gap path ${path} names a key with a dot in it`);
      }
    }

    // The container of a gap must exist even though the leaf does not - the invariant
    // `tests/definition-resolution.test.ts` holds for the definition path, applied to this one.
    const parent = parentOf(pointerOf(nested.field));
    assert.ok(parent !== "", "a nested requirement should have a container");
    assert.ok(hasPointer(document, parent), `the container ${parent} does not exist, so the answer has nowhere to land`);
  });

  it("writes an answer where the adapter will read it, not to a root key", () => {
    const descriptor = descriptorFor("sim-k8s");
    const nested = descriptor.requires.find((entry) => entry.field.includes("."));
    assert.ok(nested !== undefined, "sim-k8s declares no nested requirement, so this case proves nothing");

    const gap = detectEnvironmentAmbiguities(skeleton("sim-k8s"), context()).find(
      (entry) => entry.path === pointerOf(nested.field),
    );
    assert.ok(gap !== undefined, `no gap was raised at ${pointerOf(nested.field)}`);

    const answered = setPointer(skeleton("sim-k8s"), gap.path, "answered");
    assert.equal(getPointer(answered, pointerOf(nested.field)), "answered");

    // The defect's signature: a literal key at the root, spelled with a dot.
    assert.ok(!Object.hasOwn(answered, nested.field), "the answer was written to a root key named after the field");

    // And a document with the answer in it raises no gap for that requirement.
    assert.ok(
      !detectEnvironmentAmbiguities(answered, context()).some((entry) => entry.path === gap.path),
      "the requirement is still reported missing after being answered",
    );
  });
});

describe("environment gaps: HTTP questions are not asked of a world with no HTTP", () => {
  const HTTP_PATHS = ["/url", "/health/path", "/health/expectStatus", "/browser/enabled"];

  /**
   * The document keys that stand for a shape with no HTTP surface of its own.
   *
   * This is the detector's own vocabulary - the eight clauses of `hasNoHttp` in
   * `core/clarification/detect.ts` - written once here so the *members* can be derived rather than
   * listed. A world named below is one whose own declaration says which of the eight it is; a world
   * that names none of them is asked every HTTP question, which is the other half.
   */
  const NO_HTTP_KEYS = [
    "databasePath",
    "cluster",
    "posix",
    "os",
    "cloud",
    "container",
    "vscode",
    "process",
  ];

  it("skips them for every world whose own declaration says it has no socket", () => {
    // **Derived from the register, not listed here, and that is the half that cost a defect.** The
    // predicate is an `||` chain, so the failure mode of a new world is that it *is* covered - by
    // somebody else's clause - while its own is missing, and the run then reports a world with no
    // address after being asked for one and handed `expectStatus: 200`. That is the `sim-k8s` abort one
    // family out. A hand-written list of kinds cannot see it: this test named `["sim-posix","sim-os"]`,
    // and adding the third shape (`cloud`) left those two subtests passing unchanged, which is exactly
    // the shape of the thing being guarded. *A test that iterates a list can only cover the list it was
    // written with; the coverage has to come from the register.*
    const covered: string[] = [];
    for (const descriptor of adapterDescriptors()) {
      const shapes = new Set(descriptor.requires.map((requirement) => requirement.field.split(".")[0] ?? ""));
      const named = NO_HTTP_KEYS.filter((key) => shapes.has(key));
      if (named.length === 0) continue;
      covered.push(descriptor.kind);

      const raised = paths(satisfier(descriptor.kind));
      for (const path of HTTP_PATHS) {
        assert.ok(
          !raised.includes(path),
          `${descriptor.kind} (${named.join(", ")}) was asked ${path}, and it has no address`,
        );
      }
      // Non-HTTP questions are still asked, so this is a boundary and not a blanket silence.
      assert.ok(raised.includes("/reset/strategy"), `${descriptor.kind} still has a reset to describe`);
    }

    // And the derivation itself is asserted, because a loop over an empty set passes for the wrong
    // reason. One world per clause of the predicate, so dropping a world's shape declaration - or
    // dropping a clause from the predicate - fails here rather than silently covering less.
    assert.deepEqual(
      [...covered].sort(),
      [
        "local-db",
        "local-process",
        "sim-cloud",
        "sim-container",
        "sim-k8s",
        "sim-os",
        "sim-posix",
        "sim-vscode",
      ],
      "one registered world per no-HTTP shape, and the register no longer names them all",
    );
  });

  it("still asks them for a world reached over a socket", () => {
    // The falsifier for the other direction: widening the predicate must not swallow the web case.
    // A definition that names an adapter and no address at all is an *incomplete* web definition, not
    // a cluster one, so `url` is exactly the question that has to be asked.
    const raised = paths(skeleton("local-web"));
    assert.ok(raised.includes("/url"), "a world with no stated address must still be asked for one");
    assert.ok(raised.includes("/health/path"), "a web world's health path is derivable and must be recorded");
    assert.ok(raised.includes("/browser/enabled"), "a web world's browser is derivable and must be recorded");

    // And the same question asked of the **register** rather than of `local-web`, because the two
    // directions of one predicate are one property: every world whose own declaration names none of
    // the eight no-HTTP shapes must be asked for an address, and a world that is silently skipped is
    // the `sim-k8s` abort one family out with its sign flipped. `local-api` is the world that made
    // this necessary - it is the first world that is *real* and reached over a socket, so the only
    // thing that distinguishes it from a `local-db` is the shape its requirement names, and a
    // hand-written list of HTTP worlds would be a second opinion about that.
    const socketWorlds: string[] = [];
    for (const descriptor of adapterDescriptors()) {
      const shapes = new Set(descriptor.requires.map((requirement) => requirement.field.split(".")[0] ?? ""));
      if (NO_HTTP_KEYS.some((key) => shapes.has(key))) continue;
      socketWorlds.push(descriptor.kind);
      assert.ok(
        paths(skeleton(descriptor.kind)).includes("/url"),
        `${descriptor.kind} names none of the no-HTTP shapes and was not asked for an address`,
      );
    }
    assert.deepEqual(
      [...socketWorlds].sort(),
      ["local-api", "local-web"],
      "every world reached over a socket, derived from the register rather than listed",
    );
  });

  it("does not treat a stated url as if it were absent", () => {
    // The predicate is about what the document says. A document that names a url is a web world
    // whatever else it carries, and the loader's own rule is that its health fields are read.
    const raised = paths({ ...skeleton("local-web"), url: "http://127.0.0.1:3000" });
    assert.ok(!raised.includes("/url"), "a stated url was reported missing");
  });
});

describe("environment gaps: the descriptor table is a vocabulary the ladder can resolve", () => {
  it("declares fields as dot-separated word segments, and says why each has no default", () => {
    for (const descriptor of adapterDescriptors()) {
      for (const requirement of descriptor.requires) {
        assert.ok(requirement.field.length > 0, `${descriptor.kind} declares an empty field`);
        assert.ok(requirement.question.length > 0, `${descriptor.kind}.${requirement.field} asks nothing`);
        assert.ok(
          requirement.why.length > 0,
          `${descriptor.kind}.${requirement.field} does not say why there is no default`,
        );
        // A dot is the separator, so a segment that is empty names no key; a slash would be escaped
        // before the lookup, and then the escape would have to be spelled into the field.
        for (const segment of requirement.field.split(".")) {
          assert.ok(segment.length > 0, `${descriptor.kind} declares "${requirement.field}" with an empty segment`);
          assert.ok(!segment.includes("/"), `${descriptor.kind} declares "${requirement.field}", which names two things`);
          assert.ok(!segment.includes("~"), `${descriptor.kind} declares "${requirement.field}", which needs escaping`);
        }
      }
    }
  });
});
