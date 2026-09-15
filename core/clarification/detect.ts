import { getPointer, joinPointer } from "./pointer.ts";
import type { Ambiguity } from "./types.ts";
import { ambiguity, failSafeDefault, isBlocking } from "./types.ts";

/**
 * The detectors.
 *
 * Each detector is a pure function `(artifact, ctx) => Ambiguity[]`, and this is what makes the
 * protocol cohesive rather than bolted on: a stage has no way to proceed past a gap except by
 * resolving it. The artifact shapes below are declared structurally — deliberately not imported
 * from `core/goal` or `core/acceptance` — so that the clarification layer stays the lowest layer
 * in the Core and cannot acquire a cycle.
 */

export interface ValidatorDescriptor {
  /** Name as it appears in an acceptance contract, e.g. `web.ui.text`. */
  readonly name: string;
  /** True when the validator cannot do its job without a `target` selector. */
  readonly needsTarget: boolean;
  /** Comparison keys the validator understands, e.g. `["equals","contains","matches"]`. */
  readonly comparisons: readonly string[];
  /** What `target` names, e.g. `element`, `table`, `column`. Defaults to `element`. */
  readonly targetNoun?: string;
}

/**
 * One field a world cannot be built without.
 *
 * Declared by the adapter itself and read by the ladder, in the same shape as `ValidatorDescriptor`:
 * the artifact's author is asked a question about the artifact, and neither the question nor the
 * requirement is written down twice.
 */
export interface AdapterRequirement {
  /**
   * Where the value sits in the document, as a dot-separated path from the root: `databasePath`, or
   * `cluster.name` for one that is a level down. A dot inside a key is not expressible, which is why
   * the worlds that declare one spell their keys in word-like segments.
   */
  readonly field: string;
  readonly question: string;
  /** Why there is no default, quoted to the operator when the gap reaches DEFER. */
  readonly why: string;
}

/**
 * What a world requires of a document that names it.
 *
 * `local-web` requires a `url`; `local-db` requires a `databasePath`; a Kubernetes world would
 * require a manifest. Encoding that as a rule inside `core/clarification` would be the core learning
 * every adapter's private shape - which is the coupling §35 of `PLAN.md` claims cannot happen, and
 * the reason this is a field on the context rather than a `switch` on the adapter name.
 *
 * An adapter that declares nothing is not refused; it is a world whose document is complete when its
 * schema says so, and the schema remains the authority on everything a requirement does not cover.
 */
export interface AdapterDescriptor {
  readonly kind: string;
  readonly requires: readonly AdapterRequirement[];
}

export interface DetectorContext {
  readonly registeredValidators: readonly string[];
  readonly validatorDescriptors: readonly ValidatorDescriptor[];
  /** Registered environment adapter kinds. */
  readonly registeredAdapters: readonly string[];
  /** What each registered adapter requires of a document that names it. */
  readonly adapterDescriptors?: readonly AdapterDescriptor[];
  /** Label of the artifact being inspected, used as derivation context and in questions. */
  readonly sourceLabel: string;
  /** Directory of the application under test, when known. Enables the manifest derivation. */
  readonly appDir?: string;
  /** Only used to build reader-friendly questions. */
  readonly defaultUrl?: string;
}

// ---------------------------------------------------------------------------------------------
// Structural views of the artifacts (deliberately permissive: detectors read, they do not validate)
// ---------------------------------------------------------------------------------------------

export interface GoalLike {
  readonly version?: unknown;
  readonly id?: unknown;
  readonly statement?: unknown;
  readonly acceptance?: unknown;
  readonly environment?: unknown;
  readonly limits?: Record<string, unknown>;
}

export interface ExpectationLike {
  readonly validator?: unknown;
  readonly target?: unknown;
  readonly equals?: unknown;
  readonly contains?: unknown;
  readonly matches?: unknown;
  readonly atLeast?: unknown;
  readonly atMost?: unknown;
  readonly name?: unknown;
  readonly message?: unknown;
}

export interface CriterionLike {
  readonly id?: unknown;
  readonly description?: unknown;
  readonly mandatory?: unknown;
  readonly steps?: readonly Record<string, unknown>[];
  readonly expect?: readonly ExpectationLike[];
  readonly evidence?: readonly unknown[];
}

export interface AcceptanceLike {
  readonly version?: unknown;
  readonly goal_id?: unknown;
  readonly criteria?: readonly CriterionLike[];
}

export interface EnvironmentLike {
  readonly adapter?: unknown;
  readonly app?: unknown;
  readonly start?: { readonly command?: unknown; readonly args?: unknown };
  readonly url?: unknown;
  readonly databasePath?: unknown;
  readonly health?: {
    readonly path?: unknown;
    readonly expectStatus?: unknown;
    readonly timeoutMs?: unknown;
    readonly intervalMs?: unknown;
  };
  readonly reset?: { readonly strategy?: unknown };
  readonly browser?: { readonly enabled?: unknown };
  /** Present when the world stands in for a cluster. The address is the cluster's, not a URL's. */
  readonly cluster?: unknown;
  /** Present when the world stands in for a POSIX-like system. It has no address at all. */
  readonly posix?: unknown;
  /**
   * Present when the world stands in for an operating system.
   *
   * It has no address at all, and it is a *different* declaration from `posix` rather than a variant
   * of it: a POSIX world and a Windows world answer the same questions with different vocabularies,
   * and `family` is what decides which. Collapsing them into one field would make the detector ask a
   * Windows document for a `distribution`.
   */
  readonly os?: unknown;
  /**
   * Present when the world stands in for a cloud account.
   *
   * It has no address at all, and - unlike the four declarations before it - it carries no path
   * either. A provider holds objects rather than directories, so this is the one world shape whose
   * declaration cannot be mistaken for a filesystem, and the one where "the world has no url" and
   * "the world has no local directory" are both true at once.
   */
  readonly cloud?: unknown;
  /**
   * Present when the world stands in for a container runtime.
   *
   * It has no address at all - and, uniquely among the six, it has **two** filesystems. A container
   * world's declaration carries a host directory (where its images and containers live) *and* a
   * platform that decides how a path inside a container is spelled, so a detector that read this
   * block as a path would be reading the wrong one of the two.
   */
  readonly container?: unknown;
  /**
   * Present when the world stands in for a VS Code extension host.
   *
   * It has no address at all, and this is the one declaration whose subject is a *host* rather than a
   * place - the world is the thing that loads the application rather than the thing the application
   * runs inside. It carries a sandbox root like the four filesystem worlds before it, so a detector
   * that read "has a directory" as "has an application to reach over a socket" would be reading this
   * block backwards.
   */
  readonly vscode?: unknown;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const isMissing = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/**
 * Whether the document describes a world with no HTTP surface of its own.
 *
 * Decided from the *document*, not from the adapter name, because `core/clarification` is the lowest
 * layer and may not import an adapter to ask it. Seven shapes have no HTTP: a world reached by
 * opening a file (`databasePath`), one whose address is a substitute control plane (`cluster`), one
 * that is a system rather than a service (`posix`), one that is a machine (`os`), one whose subject
 * is an account rather than a host or a system (`cloud`), one whose subject is a runtime holding
 * images and containers (`container`), and one whose subject is the editor host that loads an
 * extension (`vscode`). Anything else is a socket world, and is still asked for its URL.
 *
 * Getting this wrong is not cosmetic, and each new shape is how the cost was measured. Every question
 * gated below is an HTTP question - the address, the health path, the health status, whether to drive
 * a browser - and `core/environment/load.ts` answers all four the same way for a document with no
 * url: `health.path` and `health.expectStatus` become `null`, `browser.enabled` becomes `false`, and
 * `browser.enabled: true` next to no url is refused outright. The loader had that rule and the
 * detector did not share it, so the ladder derived `browser.enabled = true` for a world with no page
 * and demanded a URL for a world whose adapter never reads one. *Two implementations of one rule
 * disagree the first time a world arrives that only one of them was written for* - and the answer is
 * not a third implementation. There is one predicate, and every new kind of world is added here.
 *
 * The `||` chain is the shape this predicate has to have, and it is also the shape that hides a
 * member: adding `cloud` leaves the `posix` and `os` clauses untouched, so a world could be covered
 * by somebody else's clause and nothing would fail. `tests/environment-gaps.test.ts` therefore runs
 * the HTTP questions against *every* no-HTTP world the register names rather than against the one
 * the test was written for, so a new member is covered by construction instead of by memory.
 */
const hasNoHttp = (environment: EnvironmentLike): boolean =>
  isMissing(environment.url) &&
  (!isMissing(environment.databasePath) ||
    !isMissing(environment.cluster) ||
    !isMissing(environment.posix) ||
    !isMissing(environment.os) ||
    !isMissing(environment.cloud) ||
    !isMissing(environment.container) ||
    !isMissing(environment.vscode));

const asArray = <T>(value: readonly T[] | undefined): readonly T[] => value ?? [];

/**
 * A stable spelling of the scenario a criterion sets up: its declared steps, keys in a fixed order.
 *
 * Used to decide whether two expectations are about *the same* observable. Two criteria that set up
 * the same state are comparable - differing values for one selector are then a contradiction rather
 * than a difference of circumstance - and two that do not are not comparable at all.
 *
 * Deterministic on purpose: this string is a map key, so an author reordering the keys of a step
 * (which the schema permits nowhere, but the parser does not forbid) must not silently change what
 * the contract is found to say.
 */
function canonicalSteps(steps: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (typeof value !== "object" || value === null) return value;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, ordered(entry)]));
  };
  return JSON.stringify(ordered(steps ?? []));
}

/** Cheap "did you mean" ranking: shared prefix length, then token overlap. */
function suggestNames(unknown: string, known: readonly string[], limit = 3): string[] {
  const tokenize = (value: string): string[] =>
    value.split(/[._-]/).filter((token) => token.length > 0);
  const unknownTokens = new Set(tokenize(unknown));

  const score = (candidate: string): number => {
    let prefix = 0;
    while (prefix < unknown.length && prefix < candidate.length && unknown[prefix] === candidate[prefix]) {
      prefix += 1;
    }
    const overlap = tokenize(candidate).filter((token) => unknownTokens.has(token)).length;
    return prefix + overlap * 3;
  };

  return [...known]
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

// ---------------------------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------------------------

/**
 * Goal-level gaps.
 *
 * Note the classifier in action: a missing `id` or `limits` block cannot change a verdict, so it
 * is `non_blocking` and will never reach a human. A missing `statement` or `acceptance` path makes
 * the goal unvalidatable, so it is `blocking` — but both have a derivation available, so neither
 * reaches a human either.
 */
export function detectGoalAmbiguities(goal: GoalLike, ctx: DetectorContext): Ambiguity[] {
  const found: Ambiguity[] = [];

  if (isMissing(goal.version)) {
    found.push(
      ambiguity({
        origin: "goal",
        path: "/version",
        kind: "missing_value",
        question: "Which goal-document schema version should this goal declare?",
        // A version number cannot change whether a criterion passed. Non-blocking by construction.
        blocking: isBlocking({}),
      }),
    );
  }

  if (isMissing(goal.id)) {
    found.push(
      ambiguity({
        origin: "goal",
        path: "/id",
        kind: "missing_value",
        question: "What identifier should this goal use?",
        blocking: isBlocking({}),
        context: { sourceLabel: ctx.sourceLabel },
      }),
    );
  }

  if (isMissing(goal.statement)) {
    found.push(
      ambiguity({
        origin: "goal",
        path: "/statement",
        kind: "missing_value",
        question:
          "What observable end state should this goal have? A goal statement must describe what is " +
          "true when the work is done, not what work is performed.",
        blocking: isBlocking({ makesUnexecutable: true }),
      }),
    );
  }

  if (isMissing(goal.acceptance)) {
    found.push(
      ambiguity({
        origin: "goal",
        path: "/acceptance",
        kind: "missing_value",
        question: "Which acceptance contract should be evaluated for this goal?",
        blocking: isBlocking({ makesUnexecutable: true }),
      }),
    );
  }

  if (isMissing(goal.environment)) {
    found.push(
      ambiguity({
        origin: "goal",
        path: "/environment",
        kind: "missing_value",
        question: "Which environment definition should this goal run in?",
        blocking: isBlocking({ makesUnexecutable: true }),
      }),
    );
  }

  for (const limit of [
    "maxIterations",
    "maxRuntimeMs",
    "maxCriterionMs",
    "networkPolicy",
    "networkAllowList",
    "filesystemWrite",
  ] as const) {
    if (isMissing(goal.limits?.[limit])) {
      found.push(
        ambiguity({
          origin: "goal",
          path: joinPointer("limits", limit),
          kind: "missing_value",
          question: `What should the ${limit} safety limit be?`,
          // A safety limit bounds what the run is permitted to do. None of them can change whether
          // a criterion passed, so none is blocking, and none is ever asked. Two of them
          // (`networkPolicy`, `filesystemWrite`) bound what the application may touch rather than
          // how long Veridian runs; the conclusion is the same for both kinds.
          blocking: isBlocking({}),
        }),
      );
    }
  }

  return found;
}

// ---------------------------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------------------------

/** Gaps in the criteria themselves: identity, gating, and contradictions. */
export function detectAcceptanceAmbiguities(
  contract: AcceptanceLike,
  ctx: DetectorContext,
): Ambiguity[] {
  const found: Ambiguity[] = [];
  const criteria = asArray(contract.criteria);

  if (isMissing(contract.version)) {
    found.push(
      ambiguity({
        origin: "acceptance",
        path: "/version",
        kind: "missing_value",
        question: "Which acceptance-contract schema version is this file written in?",
        // The field exists so a future dialect change is non-breaking. Its value cannot change a
        // verdict today (`const: 1`), so it is derived rather than asked.
        blocking: isBlocking({}),
      }),
    );
  }

  if (criteria.length === 0) {
    found.push(
      ambiguity({
        origin: "acceptance",
        path: "/criteria",
        kind: "missing_value",
        question: "What are the acceptance criteria? A contract with no criteria cannot validate anything.",
        blocking: isBlocking({ makesUnexecutable: true }),
      }),
    );
    return found;
  }

  criteria.forEach((criterion, index) => {
    // Built in one call per location. `joinPointer` escapes the tokens it is handed, so a pointer
    // that has already been built must not be passed back to it as a token: the separators would be
    // escaped too, and the path would name a key called `/criteria/2` instead of the second criterion.
    // A path that resolves to nothing is worse than no path, because the engine writes resolutions to
    // it and the failure report quotes it to whoever has to fix the contract.
    const at = (...tokens: readonly (string | number)[]): string => joinPointer("criteria", index, ...tokens);

    if (isMissing(criterion.id)) {
      found.push(
        ambiguity({
          origin: "acceptance",
          path: at("id"),
          kind: "missing_value",
          question: `Criterion at index ${index} has no id. What should it be called?`,
          blocking: isBlocking({ makesUnexecutable: true }),
        }),
      );
    } else if (!/^AC-[0-9]{3}$/.test(String(criterion.id))) {
      found.push(
        ambiguity({
          origin: "acceptance",
          path: at("id"),
          kind: "ambiguous_reference",
          question: `Criterion id "${String(criterion.id)}" does not match the AC-NNN form. Rename it?`,
          blocking: isBlocking({}),
        }),
      );
    }

    if (isMissing(criterion.description)) {
      found.push(
        ambiguity({
          origin: "acceptance",
          path: at("description"),
          kind: "missing_value",
          question: `What does criterion ${String(criterion.id ?? index)} assert, in one sentence?`,
          // Documentation only. A missing description cannot change the verdict.
          blocking: isBlocking({}),
        }),
      );
    }

    if (isMissing(criterion.mandatory)) {
      found.push(
        ambiguity({
          origin: "acceptance",
          path: at("mandatory"),
          kind: "missing_value",
          question: `Is criterion ${String(criterion.id ?? index)} mandatory?`,
          // Whether a criterion gates the run verdict is exactly a PASS/FAIL semantic.
          blocking: isBlocking({ onMandatoryPath: true }),
        }),
      );
    }

    if (isMissing(criterion.expect) || asArray(criterion.expect).length === 0) {
      found.push(
        ambiguity({
          origin: "acceptance",
          path: at("expect"),
          kind: "missing_value",
          question: `Criterion ${String(criterion.id ?? index)} declares no expectation, so it can never be decided. What should it assert?`,
          blocking: isBlocking({ makesUnexecutable: true }),
        }),
      );
    }
  });

  // Contradiction: one observable, in one scenario, expected to hold two different values.
  //
  // "One scenario" means the same declared steps, and it has to. An observable is only meaningful
  // relative to the sequence that produces it, so two criteria that reach the same selector by
  // different routes are describing different states of the same thing. AC-001 adding an item and
  // seeing one row, and AC-003 adding it, removing it and seeing none, is the *ordinary* shape of an
  // acceptance contract; reporting it as unsatisfiable would raise a blocking ambiguity against a
  // correct contract, and blocking an author's contract is the most expensive thing this file can do.
  //
  // What remains provably unsatisfiable is narrower, and it is what is checked here: one scenario,
  // one target, two values. No application can satisfy that, whatever the application does. Whether
  // two *different* scenarios can both hold is a question about what the application does, which is
  // exactly what Veridian refuses to model. So this detector stays inside what it can prove.
  const seen = new Map<string, { path: string; equals: unknown; id: string }>();
  criteria.forEach((criterion, index) => {
    const scenario = canonicalSteps(criterion.steps);
    asArray(criterion.expect).forEach((expectation, expectIndex) => {
      const path = joinPointer("criteria", index, "expect", expectIndex);
      if (isMissing(expectation.equals)) return;
      const observable = `${String(expectation.validator)} on ${String(expectation.target ?? "")}`;
      const key = `${observable}|${scenario}`;
      const prior = seen.get(key);
      if (!prior) {
        seen.set(key, { path, equals: expectation.equals, id: String(criterion.id ?? index) });
        return;
      }
      if (String(prior.equals) !== String(expectation.equals)) {
        found.push(
          ambiguity({
            origin: "acceptance",
            path,
            kind: "conflicting",
            question:
              `${criterion.id ?? `criterion[${index}]`} expects "${String(expectation.equals)}" but ` +
              `${prior.id} expects "${String(prior.equals)}" for the same target (${observable}) after ` +
              "the same steps. These cannot both hold. Which is correct?",
            blocking: isBlocking({ onMandatoryPath: true }),
            context: { conflictingPath: prior.path, key: observable },
          }),
        );
      }
    });
  });

  return found;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * Gaps in the expectations: unregistered validators, missing comparison keys, unresolvable
 * selectors. These are separated from acceptance-level gaps because they are about *how to
 * decide*, not *what to decide*.
 */
export function detectValidationAmbiguities(
  contract: AcceptanceLike,
  ctx: DetectorContext,
): Ambiguity[] {
  const found: Ambiguity[] = [];
  const descriptors = new Map(ctx.validatorDescriptors.map((d) => [d.name, d]));
  const criteria = asArray(contract.criteria);

  criteria.forEach((criterion, index) => {
    asArray(criterion.expect).forEach((expectation, expectIndex) => {
      const path = joinPointer("criteria", index, "expect", expectIndex);
      const at = (...tokens: readonly (string | number)[]): string =>
        joinPointer("criteria", index, "expect", expectIndex, ...tokens);
      const label = String(criterion.id ?? `criterion[${index}]`);

      if (isMissing(expectation.validator)) {
        found.push(
          ambiguity({
            origin: "validation",
            path: at("validator"),
            kind: "missing_value",
            question: `Which validator should ${label} use?`,
            blocking: isBlocking({ makesUnexecutable: true }),
          }),
        );
        return;
      }

      const name = String(expectation.validator);
      const descriptor = descriptors.get(name);

      if (!descriptor) {
        const suggestions = suggestNames(name, ctx.registeredValidators);
        found.push(
          ambiguity({
            origin: "validation",
            path: at("validator"),
            kind: "unresolvable_entity",
            question:
              `Validator "${name}" is not registered, so ${label} cannot be evaluated` +
              (suggestions.length > 0 ? `. Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : "?"),
            blocking: isBlocking({ makesUnexecutable: true }),
            candidates: suggestions.length > 0 ? suggestions : ctx.registeredValidators.slice(0, 3),
            context: { requested: name },
          }),
        );
        return;
      }

      if (descriptor.needsTarget && isMissing(expectation.target)) {
        found.push(
          ambiguity({
            origin: "validation",
            path: at("target"),
            kind: "underspecified",
            question: `Which ${descriptor.targetNoun ?? "element"} should ${name} inspect for ${label}?`,
            // Without a target there is nothing to observe, so the criterion cannot be decided.
            blocking: isBlocking({ makesUnexecutable: true }),
            context: { validator: name },
          }),
        );
      }

      const usedComparisons = descriptor.comparisons.filter(
        (comparison) => !isMissing((expectation as Record<string, unknown>)[comparison]),
      );
      if (descriptor.comparisons.length > 0 && usedComparisons.length === 0) {
        found.push(
          ambiguity({
            origin: "validation",
            path,
            kind: "underspecified",
            question:
              `${label} uses ${name} but states no comparison. It must set one of ` +
              `${descriptor.comparisons.join(", ")} - an expectation with no expected value cannot fail.`,
            // The dangerous direction: an expectation that always passes is a false PASS waiting
            // to happen. Blocking, deliberately.
            blocking: isBlocking({ onMandatoryPath: true }),
            context: { validator: name, comparisons: descriptor.comparisons },
          }),
        );
      }

      if (!isMissing(expectation.matches)) {
        try {
          new RegExp(String(expectation.matches));
        } catch (error) {
          found.push(
            ambiguity({
              origin: "validation",
              path: at("matches"),
              kind: "ambiguous_reference",
              question:
                `${label} uses an invalid regular expression "${String(expectation.matches)}": ` +
                `${error instanceof Error ? error.message : String(error)}. What should it be?`,
              blocking: isBlocking({ makesUnexecutable: true }),
            }),
          );
        }
      }
    });
  });

  return found;
}

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

/**
 * Environment gaps.
 *
 * The `/health/path` case is the clearest illustration of a fail-safe default: a health check
 * against `/` that fails classifies as `ENVIRONMENT_FAILURE`, and no run can be PASS while the
 * environment is invalid. So choosing `/` can only ever make the run *less* likely to report PASS —
 * which is precisely the condition under which a default is permitted.
 *
 * The rule has a boundary, and it is drawn by the document: every HTTP-shaped question here is
 * skipped for a world that has no address - one that names a file, or one whose address is a
 * substitute control plane. The argument above is sound for a world reached over a socket and
 * *meaningless* for one with no HTTP at all, where deriving `expectStatus: 200` invents a number
 * nothing will ever return and the run waits out its whole health timeout for it. `hasNoHttp` is that
 * boundary, and it reads the artifact because `core/clarification` is the lowest layer and may not
 * ask an adapter what it is.
 */
export function detectEnvironmentAmbiguities(
  environment: EnvironmentLike,
  ctx: DetectorContext,
): Ambiguity[] {
  const found: Ambiguity[] = [];

  if (isMissing(environment.adapter)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/adapter",
        kind: "missing_value",
        question: "Which environment adapter should run this application?",
        blocking: isBlocking({ changesEnvironmentMeaning: true }),
        candidates: ctx.registeredAdapters,
      }),
    );
  } else if (
    ctx.registeredAdapters.length > 0 &&
    !ctx.registeredAdapters.includes(String(environment.adapter))
  ) {
    const requested = String(environment.adapter);
    found.push(
      ambiguity({
        origin: "environment",
        path: "/adapter",
        kind: "unresolvable_entity",
        question: `Adapter "${requested}" is not registered. Registered: ${ctx.registeredAdapters.join(", ")}.`,
        blocking: isBlocking({ changesEnvironmentMeaning: true }),
        candidates: ctx.registeredAdapters,
      }),
    );
  }

  // What this particular world needs, asked of the artifact's author rather than discovered by the
  // adapter mid-run. `local-db` opens a database file; a document that names it and no file describes
  // a world nobody can build, and the repair is the operator's - there is no defensible default,
  // because inventing a path would pick a file rather than the one they meant. Reporting it here
  // turns "ENVIRONMENT_FAILURE at create()" into a question with a place to answer it.
  const declared = isMissing(environment.adapter) ? null : String(environment.adapter);
  const descriptor = asArray(ctx.adapterDescriptors).find((entry) => entry.kind === declared);
  for (const requirement of asArray(descriptor?.requires)) {
    // A requirement names a *place*, not a key: `cluster.name` is one level down. Both the lookup and
    // the reported path therefore go through the pointer vocabulary, so an answer the operator gives
    // is written back where the field actually is. Keying on the literal string instead would put a
    // `"cluster.name"` key at the document's root - a document the schema refuses as an unknown
    // property, naming a field the adapter will never read.
    const pointer = joinPointer(...requirement.field.split("."));
    if (!isMissing(getPointer(environment, pointer))) continue;
    found.push(
      ambiguity({
        origin: "environment",
        path: pointer,
        kind: "missing_value",
        question: requirement.question,
        blocking: isBlocking({ makesUnexecutable: true, changesEnvironmentMeaning: true }),
        context: { adapter: declared ?? "", reason: requirement.why },
      }),
    );
  }

  if (isMissing(environment.app)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/app",
        kind: "missing_value",
        question: "Which directory holds the application under test, relative to the environment file?",
        blocking: isBlocking({ makesUnexecutable: true }),
      }),
    );
  }

  if (isMissing(environment.start) || isMissing(environment.start?.["command"])) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/start",
        kind: "missing_value",
        question: "How should the application be started?",
        // Without a start command there is nothing to deploy into, so this is blocking. It has no
        // default: inventing a command would be a guess, not a conservative fallback.
        blocking: isBlocking({ makesUnexecutable: true, changesEnvironmentMeaning: true }),
        context: ctx.appDir ? { appDir: ctx.appDir } : {},
      }),
    );
  }

  const noHttp = hasNoHttp(environment);
  if (!noHttp && isMissing(environment.url)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/url",
        kind: "missing_value",
        question: "At which URL will the application be reachable once started?",
        blocking: isBlocking({ makesUnexecutable: true }),
        ...(ctx.defaultUrl ? { candidates: [ctx.defaultUrl] } : {}),
      }),
    );
  }

  if (!noHttp && (isMissing(environment.health) || isMissing(environment.health?.["path"]))) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/health/path",
        kind: "missing_value",
        question: "Which path should the environment health check probe?",
        blocking: isBlocking({ changesEnvironmentMeaning: true }),
        ...failSafeDefault(
          "/",
          "Probing `/` and being wrong yields a failed health check, which classifies as " +
            "ENVIRONMENT_FAILURE. An invalid environment can never produce a PASS, so choosing `/` " +
            "cannot make the run report PASS more readily than the truth.",
        ),
      }),
    );
  }

  if (isMissing(environment.reset?.["strategy"])) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/reset/strategy",
        kind: "missing_value",
        question: "How should the environment be reset between iterations?",
        blocking: isBlocking({}),
      }),
    );
  }

  // -------------------------------------------------------------------------------------------
  // The four remaining health fields.
  //
  // Each of these is reported even though it is trivially derivable, and the reason is *evidence*,
  // not resolution. A run that fails its health check is read by an external agent trying to work
  // out what went wrong, and "health returned 503" is only actionable next to "this run required
  // 200, which it took from the schema". A value that silently appeared inside the decoder leaves
  // no trace in the bundle, and an untraceable value in a validation system is indistinguishable
  // from a guess.
  // -------------------------------------------------------------------------------------------
  const health = environment.health ?? {};

  if (!noHttp && isMissing(health.expectStatus)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/health/expectStatus",
        kind: "missing_value",
        question: "Which HTTP status should the health check treat as a working environment?",
        blocking: isBlocking({ changesEnvironmentMeaning: true }),
        ...failSafeDefault(
          200,
          "Expecting the wrong status fails the health check, and a failed health check is an " +
            "ENVIRONMENT_FAILURE. No run is PASS while its environment is invalid, so 200 cannot make " +
            "the run report PASS more readily than the truth.",
        ),
      }),
    );
  }

  if (isMissing(health.timeoutMs)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/health/timeoutMs",
        kind: "missing_value",
        question: "How long may the environment take to become valid before the run gives up?",
        blocking: isBlocking({ changesEnvironmentMeaning: true }),
        ...failSafeDefault(
          20_000,
          "The timeout only decides how long Veridian waits for a precondition; it never decides a " +
            "verdict. Waiting longer can admit a slow environment into a run that then validates it " +
            "honestly, and cannot manufacture a criterion result - so it cannot produce a PASS the " +
            "truth would not produce.",
        ),
      }),
    );
  }

  if (isMissing(health.intervalMs)) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/health/intervalMs",
        kind: "missing_value",
        question: "How often should the health check be retried while waiting?",
        blocking: isBlocking({}),
        ...failSafeDefault(
          100,
          "The poll interval changes when a failure is *noticed*, not what is concluded. Any value " +
            "still ends in the same bounded loop with the same verdict.",
        ),
      }),
    );
  }

  if (!noHttp && isMissing(environment.browser?.["enabled"])) {
    found.push(
      ambiguity({
        origin: "environment",
        path: "/browser/enabled",
        kind: "missing_value",
        question: "Should a browser be driven for this environment?",
        blocking: isBlocking({ makesUnexecutable: true }),
        ...failSafeDefault(
          true,
          "Enabling the browser adds observation. Disabling it would remove the only input a web " +
            "criterion has, turning decidable criteria into INCONCLUSIVE; enabling it cannot " +
            "manufacture a PASS, it can only add a way to fail.",
        ),
      }),
    );
  }

  return found;
}

/** The default detector table. Order is irrelevant; each detector owns a disjoint set of paths. */
export function allDetectors(): readonly {
  readonly origin: string;
  readonly detect: (artifact: unknown, ctx: DetectorContext) => Ambiguity[];
}[] {
  return [
    { origin: "goal", detect: (a, c) => detectGoalAmbiguities(a as GoalLike, c) },
    { origin: "acceptance", detect: (a, c) => detectAcceptanceAmbiguities(a as AcceptanceLike, c) },
    { origin: "validation", detect: (a, c) => detectValidationAmbiguities(a as AcceptanceLike, c) },
    { origin: "environment", detect: (a, c) => detectEnvironmentAmbiguities(a as EnvironmentLike, c) },
  ];
}

// ---------------------------------------------------------------------------------------------
// The runtime stages: EXECUTE, OBSERVE (evidence) and the iteration decision
// ---------------------------------------------------------------------------------------------
//
// The detectors below inspect a *different kind of document* than the ones above. DEFINE inspects a
// document a human wrote; these inspect a document a run produced. They live in a separate table
// because a detector that fires on the wrong kind of document is not a bug anyone notices — it is a
// question nobody meant to ask, answered anyway and recorded as if it had been asked.
//
// Their paths are relative to the runtime document, not to a goal or acceptance file.

/**
 * What a criterion's observation did or did not yield.
 *
 * `observationError` is set when the world could not produce an observation at all. That is not a
 * test failure and it is not a pass — it is the absence of a measurement, which is precisely the
 * thing the protocol exists to keep out of a verdict.
 */
export interface CriterionOutcomeLike {
  readonly criterionId?: unknown;
  readonly mandatory?: unknown;
  /** Absent until the run decides it. The protocol fills it. */
  readonly status?: unknown;
  /** Where the *observation* gap is explained. Written by `detectExecutionAmbiguities`. */
  readonly note?: unknown;
  /**
   * Where the *evidence* gap is explained. A separate field on purpose: one criterion can be both
   * unmeasurable and unproven, and those are two different facts about it. Sharing a single field
   * would make the second question's answer overwrite the first's, which is a silent loss of exactly
   * the explanation the bundle exists to carry.
   */
  readonly evidenceNote?: unknown;
  readonly observationError?: unknown;
  readonly observationKind?: unknown;
  /** Required evidence kinds the observation did not produce. */
  readonly missingEvidence?: readonly unknown[];
}

export interface ExecutionLike {
  readonly criteria?: readonly CriterionOutcomeLike[];
}

const runtimeBlocking = isBlocking({});

/**
 * Nothing about a running iteration may be resolved by asking a human.
 *
 * A question asked mid-run puts the verdict behind a prompt: the same code in the same world against
 * the same acceptance criteria would then produce different results depending on who was watching.
 * These ambiguities are therefore non-blocking by construction, which makes rung 5 (ASK) unreachable
 * and leaves every runtime gap to the rungs that do not interrupt: DERIVE, INFER, a declared default,
 * and the run's own answer from material it already holds. Rung 4 is why a runtime gap that no earlier
 * rung can close now has somewhere to go other than a conservative default.
 */
const RUNTIME_NOTE =
  " (resolved without asking: a question asked mid-run would put the verdict behind a prompt)";

/**
 * Gaps in *observing*: the world produced no measurement.
 *
 * Note what is *not* being asked. The criterion's status is not in question — `evaluateCriterion`
 * decides it by rule, and a rule is not an ambiguity. What is in question is whether that status has
 * been *accounted for*: an `INCONCLUSIVE` that appears in a report with no recorded reason is
 * indistinguishable from a bug in the judge, and an agent reading the bundle has no way to tell the
 * two apart. So the entry condition is "the fact is present and unexplained", and the resolution
 * writes the explanation down.
 */
export function detectExecutionAmbiguities(
  execution: ExecutionLike,
  _ctx: DetectorContext,
): Ambiguity[] {
  const found: Ambiguity[] = [];

  asArray(execution.criteria).forEach((criterion, index) => {
    if (isMissing(criterion.observationError)) return;
    if (!isMissing(criterion.note) && String(criterion.note).length > 0) return;
    const label = String(criterion.criterionId ?? `criterion[${index}]`);
    const detail = String(criterion.observationError);

    found.push(
      ambiguity({
        origin: "execution",
        path: joinPointer("criteria", index, "note"),
        kind: "missing_value",
        question:
          `${label} produced no observation (${detail}) yet is reported as ` +
          `${String(criterion.status ?? "undecided")}. What accounts for that status?${RUNTIME_NOTE}`,
        blocking: runtimeBlocking,
        context: { observationError: detail, status: criterion.status ?? null },
        ...failSafeDefault(
          `the world produced no observation (${detail}), so ${label} is not a measurement of the ` +
            `application and cannot be reported as one`,
          "This default cannot make the run report PASS more readily than the truth: it adds a " +
            "recorded reason to a criterion the run has already declined to call PASS. Choosing a " +
            "reason that *excused* the gap would be the dangerous direction, and no such reason is " +
            "available to a default.",
        ),
      }),
    );
  });

  return found;
}

/**
 * Gaps in *proving*: a criterion asked for evidence the observation did not produce.
 *
 * The resolution does not manufacture the artifact — nothing can. It writes down why the criterion
 * is unproven, so the failure report states a reason instead of a shrug. Metric M5 counts evidence
 * completeness, and a count with no explanation is not auditable.
 */
export function detectEvidenceAmbiguities(
  execution: ExecutionLike,
  _ctx: DetectorContext,
): Ambiguity[] {
  const found: Ambiguity[] = [];

  asArray(execution.criteria).forEach((criterion, index) => {
    const missing = asArray(criterion.missingEvidence).map((kind) => String(kind));
    if (missing.length === 0) return;
    if (!isMissing(criterion.evidenceNote) && String(criterion.evidenceNote).length > 0) return;
    const label = String(criterion.criterionId ?? `criterion[${index}]`);

    found.push(
      ambiguity({
        origin: "evidence",
        path: joinPointer("criteria", index, "evidenceNote"),
        kind: "missing_value",
        question:
          `${label} required evidence that was never captured: ${missing.join(", ")}. ` +
          `What should the record say about it?${RUNTIME_NOTE}`,
        blocking: runtimeBlocking,
        ...failSafeDefault(
          `required evidence (${missing.join(", ")}) was not captured, so this criterion is not proven`,
          "Recording an absence cannot make the run report PASS more readily than the truth - the " +
            "rollup's `requiredEvidencePresent` guard already blocks PASS. What this adds is the " +
            "reason, in the form the external agent reads.",
        ),
      }),
    );
  });

  return found;
}

/**
 * The facts the iteration decision is made from.
 *
 * Every field is an observation about the run, never a conclusion. The loop that assembles this
 * deliberately does not decide first and confirm second: two sources for one decision is one source
 * too many, and when they disagree the one that wins is whichever ran last.
 */
export interface IterationLike {
  readonly iteration?: unknown;
  readonly maxIterations?: unknown;
  readonly elapsedMs?: unknown;
  readonly maxRuntimeMs?: unknown;
  readonly verdict?: unknown;
  /** `"none"` when the run has no way to change the application between iterations. */
  readonly repairGate?: unknown;
  /** Absent until the protocol fills it. */
  readonly decision?: unknown;
}

/** The decisions an iteration can end on. */
export const ITERATION_DECISIONS = ["complete", "continue", "stop"] as const;
export type IterationDecision = (typeof ITERATION_DECISIONS)[number];

/**
 * Ask whether the run may take another step, and make "no" the answer that needs no justification.
 *
 * Note the asymmetry. Every other detector's fail-safe default is a timid reading of a *value*; this
 * one's is a timid reading of *time*. Continuing is the optimistic direction — another iteration is
 * another chance for a repair to turn the run into a PASS — so continuing is the answer that must be
 * earned. It is granted only when every precondition lines up: the verdict is a repairable FAIL, a
 * repair path exists, iterations remain, and the clock has not run out.
 *
 * `maxIterations` and `maxRuntimeMs` are counted separately on purpose. A frozen or injected clock
 * makes the time bound unreachable, so an attempt bound is the only exit that survives it — and an
 * unbounded loop is the one failure mode this system may not have.
 */
export function detectIterationAmbiguities(
  iteration: IterationLike,
  _ctx: DetectorContext,
): Ambiguity[] {
  if (!isMissing(iteration.decision)) return [];

  const round = Number(iteration.iteration ?? 1);
  const maxIterations = Number(iteration.maxIterations ?? 1);
  const elapsedMs = Number(iteration.elapsedMs ?? 0);
  const maxRuntimeMs = Number(iteration.maxRuntimeMs ?? 0);
  const verdict = String(iteration.verdict ?? "UNKNOWN");
  const gate = String(iteration.repairGate ?? "none");

  const exhausted: string[] = [];
  if (gate === "none" || gate === "undefined") {
    exhausted.push(
      "no repair gate is installed, so another iteration would observe an unchanged application " +
        "and reach the same verdict with more evidence of nothing",
    );
  }
  if (round >= maxIterations) {
    exhausted.push(`the iteration budget is spent (${round} of ${maxIterations})`);
  }
  if (maxRuntimeMs > 0 && elapsedMs >= maxRuntimeMs) {
    exhausted.push(`the runtime budget is spent (${elapsedMs}ms of ${maxRuntimeMs}ms)`);
  }

  const decision: IterationDecision =
    verdict === "PASS"
      ? "complete"
      : verdict === "FAIL" && exhausted.length === 0
        ? "continue"
        : "stop";

  const rationale =
    decision === "complete"
      ? "Every mandatory criterion passed with its evidence present, so there is nothing left to repair."
      : decision === "continue"
        ? `The verdict is FAIL and every precondition for another iteration holds (repair gate ` +
          `"${gate}", iteration ${round} of ${maxIterations}, ${elapsedMs}ms of ${maxRuntimeMs}ms spent).`
        : `The verdict is ${verdict} and the run must stop: ${
            exhausted.length > 0
              ? exhausted.join("; ")
              : `a verdict of ${verdict} is not something a repair can change`
          }.`;

  return [
    ambiguity({
      origin: "iteration",
      path: "/decision",
      kind: "missing_value",
      question:
        `Iteration ${round} of ${maxIterations} finished with verdict ${verdict} after ${elapsedMs}ms. ` +
        `May the run take another step?${RUNTIME_NOTE}`,
      blocking: runtimeBlocking,
      candidates: ITERATION_DECISIONS,
      context: { verdict, repairGate: gate, iteration: round, maxIterations, elapsedMs, maxRuntimeMs },
      ...failSafeDefault(decision, rationale),
    }),
  ];
}

/**
 * The runtime detector table: EXECUTE, OBSERVE (evidence) and the iteration decision.
 *
 * Separate from {@link allDetectors} because these inspect a run's own output. One table per phase
 * boundary means a stage can only ever be asked the questions its document can answer.
 */
export function runtimeDetectors(): readonly {
  readonly origin: string;
  readonly detect: (artifact: unknown, ctx: DetectorContext) => Ambiguity[];
}[] {
  return [
    { origin: "execution", detect: (a, c) => detectExecutionAmbiguities(a as ExecutionLike, c) },
    { origin: "evidence", detect: (a, c) => detectEvidenceAmbiguities(a as ExecutionLike, c) },
    { origin: "iteration", detect: (a, c) => detectIterationAmbiguities(a as IterationLike, c) },
  ];
}
