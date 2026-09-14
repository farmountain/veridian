import type { ClarificationReport, ClarificationRecord } from "../clarification/types.ts";
import type { BoundaryReport, EnvironmentPlan, HealthReport, EvidenceArtifact } from "../environment/types.ts";
import type { IoPort } from "../io.ts";
import { SCHEMA_URIS, type SchemaSet } from "../schema/registry.ts";
import type { CriterionResult } from "../validation/types.ts";
import {
  BUNDLE_FILES,
  type EnvironmentRecord,
  type ReproducibilityRecord,
  type RunBundleLayout,
  type RunOutcome,
  type WrittenResult,
} from "./types.ts";

/**
 * Writing the bundle.
 *
 * Two rules shape this module.
 *
 * 1. **The bundle is written from a finished outcome.** The writer is handed a `RunOutcome` and
 *    never queries the live run, so `result.json` cannot disagree with the run that produced it.
 * 2. **`latest-result.json` and `latest-failure.md` are the product's Level-2 interface.** An
 *    external agent that never speaks to Veridian still needs to know what failed, and these two
 *    files are the whole of that conversation. They are written on every terminal path, including
 *    the successful one, because a file that exists only sometimes is a file nobody can rely on.
 */

/** `.veridian/runs/<run-id>/` and friends. Pure, so the CLI and tests agree on the layout. */
export function bundleLayout(veridianDir: string, runId: string): RunBundleLayout {
  const root = trimSlashes(veridianDir);
  const runsDir = `${root}/runs`;
  return {
    root,
    runsDir,
    runDir: `${runsDir}/${runId}`,
    snapshotsDir: `${root}/snapshots`,
    latestResult: `${root}/latest-result.json`,
    latestFailure: `${root}/latest-failure.md`,
  };
}

const trimSlashes = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// ---------------------------------------------------------------------------------------------
// Serialisation
//
// The bundle is a machine-readable artifact with a schema, so it uses the schema's names. The
// in-memory types use camelCase; the difference is real and is confined to this section.
// ---------------------------------------------------------------------------------------------

function serializeAssertion(assertion: CriterionResult["assertions"][number]): Record<string, unknown> {
  return {
    validator: assertion.validator,
    target: assertion.target,
    status: assertion.status,
    actual: assertion.actual ?? null,
    expected: assertion.expected ?? null,
    message: assertion.message ?? null,
    ...(assertion.failureKind ? { failure_kind: assertion.failureKind } : {}),
  };
}

export function serializeCriterion(criterion: CriterionResult): Record<string, unknown> {
  return {
    criterion_id: criterion.criterionId,
    description: criterion.description,
    mandatory: criterion.mandatory,
    status: criterion.status,
    actual: criterion.actual ?? null,
    expected: criterion.expected ?? null,
    timestamp: criterion.timestamp,
    message: criterion.message ?? null,
    missing_evidence: [...criterion.missingEvidence],
    environment_id: criterion.environmentId,
    run_id: criterion.runId,
    evidence: [...criterion.evidence],
    assertions: criterion.assertions.map(serializeAssertion),
  };
}

/** Flatten `{ ambiguity, resolution }` into the one record shape the schema declares. */
export function serializeClarificationRecord(record: ClarificationRecord): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: record.ambiguity.id,
    origin: record.ambiguity.origin,
    path: record.ambiguity.path,
    kind: record.ambiguity.kind,
    question: record.ambiguity.question,
    blocking: record.ambiguity.blocking,
    via: record.resolution.via,
    rungsAttempted: [...record.rungsAttempted],
  };

  const resolution = record.resolution;
  switch (resolution.via) {
    case "derived":
      return { ...base, value: resolution.value ?? null, evidence: resolution.evidence };
    case "inferred":
      return {
        ...base,
        value: resolution.value ?? null,
        confidence: resolution.confidence,
        source: resolution.source,
      };
    case "defaulted":
      return { ...base, value: resolution.value ?? null, assumption: resolution.assumption };
    case "answered":
      return { ...base, value: resolution.value ?? null, answer: resolution.answer };
    case "deferred":
      return { ...base, value: null, reason: resolution.reason };
  }
}

function serializeClarifications(reports: readonly ClarificationReport[]): Record<string, unknown> {
  const sum = (pick: (report: ClarificationReport) => number): number =>
    reports.reduce((total, report) => total + pick(report), 0);

  return {
    questionsAsked: sum((report) => report.questionsAsked),
    rounds: sum((report) => report.rounds),
    elapsedMs: sum((report) => report.elapsedMs),
    budgetExhausted: reports.some((report) => report.budgetExhausted),
    unresolvedBlocking: sum((report) => report.unresolvedBlocking),
    byVia: {
      derived: sum((report) => report.byVia.derived),
      inferred: sum((report) => report.byVia.inferred),
      defaulted: sum((report) => report.byVia.defaulted),
      answered: sum((report) => report.byVia.answered),
      deferred: sum((report) => report.byVia.deferred),
    },
    records: reports.flatMap((report) => report.records.map(serializeClarificationRecord)),
  };
}

export function serializeEnvironment(record: EnvironmentRecord): Record<string, unknown> {
  return {
    adapter: record.adapter,
    app: record.app,
    app_path: record.appPath,
    url: record.url,
    command: record.command,
    args: [...record.args],
    env: record.env,
    health: record.health,
    reset: record.reset,
    browser: record.browser,
    valid: record.valid,
    health_report: record.healthReport,
    boundary: {
      network: {
        policy: record.boundary.network.policy,
        allow: [...record.boundary.network.allow],
        enforcement: record.boundary.network.enforcement,
      },
      filesystem_write: {
        policy: record.boundary.filesystemWrite.policy,
        enforcement: record.boundary.filesystemWrite.enforcement,
      },
      crossings: record.boundary.crossings.map((entry) => ({
        boundary: entry.boundary,
        subject: entry.subject,
        criterion_id: entry.criterionId,
        at: entry.at,
      })),
    },
    transitions: record.transitions.map((entry) => ({ ...entry })),
  };
}

/**
 * Required-evidence completeness (metric M5).
 *
 * A criterion that passed while its required screenshot is missing has not been proven, so this is
 * computed from the criteria rather than trusted from a counter someone increments along the way.
 */
export function evidenceCompleteness(criteria: readonly CriterionResult[]): {
  readonly missing: readonly string[];
  readonly complete: boolean;
} {
  const missing = criteria.flatMap((criterion) =>
    criterion.missingEvidence.map((kind) => `${criterion.criterionId}:${kind}`),
  );
  return { missing, complete: missing.length === 0 };
}

export function serializeResult(
  outcome: RunOutcome,
  ledger: { readonly artifacts: readonly EvidenceArtifact[]; readonly missing: readonly string[] },
  bundlePath: string,
): Record<string, unknown> {
  const complete = ledger.missing.length === 0;
  return {
    run_id: outcome.runId,
    goal_id: outcome.goalId,
    state: outcome.state,
    iteration: outcome.iteration,
    verdict: outcome.verdict,
    insufficientInformation: !outcome.guards.informationSufficient,
    environmentValid: outcome.guards.environmentValid,
    safetyViolation: outcome.safetyViolation,
    reasons: [...outcome.reasons],
    guards: { ...outcome.guards },
    limits: { ...outcome.limits },
    criteria: outcome.criteria.map(serializeCriterion),
    failure:
      outcome.failure === null
        ? null
        : {
            kind: outcome.failure.kind,
            message: outcome.failure.message,
            criterion_id: outcome.failure.criterionId ?? null,
            detail: outcome.failure.detail ?? null,
          },
    clarifications: serializeClarifications(outcome.clarifications),
    iterations: outcome.iterations.map((entry) => ({
      ...entry,
      // Snake-cased like the rest of the bundle, and mapped rather than spread for the same reason
      // `serializeCriterion` is: `criterion_id` is the name every other artifact in this directory uses.
      criteria: entry.criteria.map((item) => ({ criterion_id: item.criterionId, status: item.status })),
    })),
    environment: outcome.environment === null ? null : serializeEnvironment(outcome.environment),
    evidence: {
      bundlePath,
      complete,
      missing: [...ledger.missing],
      artifacts: ledger.artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        criterion_id: artifact.criterionId ?? null,
        bytes: artifact.bytes ?? null,
      })),
    },
    reproducibility: { ...outcome.reproducibility },
  };
}

// ---------------------------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------------------------

export interface RunBundleOptions {
  readonly io: IoPort;
  readonly layout: RunBundleLayout;
  readonly clock: { iso(): string };
  /** When supplied, `result.json` is validated against the result contract before it is written. */
  readonly schemas?: SchemaSet | undefined;
}

export class RunBundle {
  readonly #io: IoPort;
  readonly #layout: RunBundleLayout;
  readonly #clock: { iso(): string };
  readonly #schemas: SchemaSet | undefined;
  readonly #artifacts: EvidenceArtifact[] = [];
  /**
   * Artifact path -> its index in `#artifacts`, so a path written twice occupies one row.
   *
   * The bundle is last-write-wins per path: `screenshots/AC-001.png` is the same file on iteration
   * one and on iteration four, because the layout names an artifact by criterion and not by
   * iteration. A ledger that only appends therefore describes a bundle that does not exist. The
   * canonical demo's passing run listed four `AC-001.observation.json` rows for one file, four
   * different sizes for the same path, and an external agent enumerating `evidence.artifacts` was
   * handed a thirty-six row inventory of ten artifacts with no way to tell which size is on disk.
   * The ledger follows the bundle: the newest write to a path is the one a reader will find there.
   */
  readonly #artifactAt = new Map<string, number>();

  constructor(options: RunBundleOptions) {
    this.#io = options.io;
    this.#layout = options.layout;
    this.#clock = options.clock;
    this.#schemas = options.schemas;
  }

  get layout(): RunBundleLayout {
    return this.#layout;
  }

  async init(): Promise<void> {
    await this.#io.mkdirp(this.#layout.runDir);
    await this.#io.mkdirp(`${this.#layout.runDir}/${BUNDLE_FILES.screenshots}`);
    await this.#io.mkdirp(`${this.#layout.runDir}/${BUNDLE_FILES.trace}`);
    await this.#io.mkdirp(`${this.#layout.runDir}/${BUNDLE_FILES.artifacts}`);
    await this.#io.mkdirp(this.#layout.snapshotsDir);
  }

  /** Copy the definition in. A bundle that depends on the repository still existing is not a bundle. */
  async writeDefinition(goalText: string, acceptanceText: string): Promise<void> {
    await this.#io.writeTextFile(this.#file(BUNDLE_FILES.goal), goalText);
    await this.#io.writeTextFile(this.#file(BUNDLE_FILES.acceptance), acceptanceText);
  }

  async writeEnvironment(record: EnvironmentRecord): Promise<void> {
    await this.#io.writeTextFile(this.#file(BUNDLE_FILES.environment), json(serializeEnvironment(record)));
  }

  /** The Ambiguity Resolution Protocol's audit trail for this run. */
  async writeClarifications(reports: readonly ClarificationReport[]): Promise<void> {
    await this.#io.writeTextFile(this.#file(BUNDLE_FILES.clarifications), json(serializeClarifications(reports)));
  }

  /**
   * Append one line to the execution log.
   *
   * Appended immediately rather than buffered, because the log's most valuable line is the one
   * written just before a crash or a timeout. A buffer that is flushed at the end loses exactly the
   * evidence that would explain the end.
   */
  async log(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    const suffix = Object.keys(fields).length === 0 ? "" : ` ${JSON.stringify(fields)}`;
    const line = `${this.#clock.iso()} ${event}${suffix}\n`;
    const path = this.#file(BUNDLE_FILES.executionLog);
    const existing = (await this.#io.readTextFile(path)) ?? "";
    await this.#io.writeTextFile(path, existing + line);
  }

  /** Relative path inside the bundle for an artifact of a given kind, e.g. `screenshots/AC-001.png`. */
  artifactPath(kind: EvidenceArtifact["kind"], criterionId?: string | null): string {
    const name = criterionId ?? "run";
    switch (kind) {
      case "screenshot":
        return `${BUNDLE_FILES.screenshots}/${name}.png`;
      case "trace":
        return `${BUNDLE_FILES.trace}/${name}.zip`;
      case "dom":
        return `${BUNDLE_FILES.artifacts}/${name}.dom.html`;
      case "console":
        return `${BUNDLE_FILES.artifacts}/${name}.console.log`;
      case "network":
        return `${BUNDLE_FILES.artifacts}/${name}.network.json`;
      case "log":
        return `${BUNDLE_FILES.artifacts}/${name}.log`;
      case "json":
        return `${BUNDLE_FILES.artifacts}/${name}.json`;
    }
  }

  async writeArtifact(artifact: EvidenceArtifact, data: Uint8Array | string): Promise<void> {
    const path = this.#file(artifact.path);
    if (typeof data === "string") await this.#io.writeTextFile(path, data);
    else await this.#io.writeBinaryFile(path, data);
    this.#index({ ...artifact, bytes: artifact.bytes ?? byteLength(data) });
  }

  /** Record an artifact that was written by an adapter directly, without going through the writer. */
  record(artifact: EvidenceArtifact): void {
    this.#index(artifact);
  }

  /** Add an artifact, or replace the row already standing for its path - see `#artifactAt`. */
  #index(artifact: EvidenceArtifact): void {
    const seen = this.#artifactAt.get(artifact.path);
    if (seen === undefined) {
      this.#artifactAt.set(artifact.path, this.#artifacts.length);
      this.#artifacts.push(artifact);
      return;
    }
    this.#artifacts[seen] = artifact;
  }

  get artifacts(): readonly EvidenceArtifact[] {
    return this.#artifacts;
  }

  async writeResult(outcome: RunOutcome): Promise<WrittenResult> {
    const completeness = evidenceCompleteness(outcome.criteria);
    const bundlePath = `${this.#layout.runDir}/`;
    const result = serializeResult(outcome, { artifacts: this.#artifacts, missing: completeness.missing }, bundlePath);
    const text = json(result);

    // Validated only when a schema set is available, so that a test with no schemas still writes a
    // bundle. When it *is* available the check is unconditional: a result that does not satisfy its
    // own contract must not become the artifact an external agent reads.
    this.#schemas?.get(SCHEMA_URIS.result).assert(result);

    await this.#io.writeTextFile(this.#file(BUNDLE_FILES.result), text);
    await this.#io.writeTextFile(this.#layout.latestResult, text);

    const failureText = renderFailureReport(outcome, this.#artifacts, completeness.missing);
    await this.#io.writeTextFile(this.#layout.latestFailure, failureText);
    await this.#io.writeTextFile(`${this.#layout.runDir}/failure.md`, failureText);

    return {
      path: `${this.#layout.runDir}/${BUNDLE_FILES.result}`,
      latestPath: this.#layout.latestResult,
      failurePath: this.#layout.latestFailure,
      artifacts: [...this.#artifacts],
      missing: completeness.missing,
      complete: completeness.complete,
    };
  }

  #file(name: string): string {
    return `${this.#layout.runDir}/${name}`;
  }
}

function byteLength(data: Uint8Array | string): number {
  return typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
}

// ---------------------------------------------------------------------------------------------
// The failure report
// ---------------------------------------------------------------------------------------------

const statusMark = (status: string): string =>
  status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : status;

/**
 * The prose half of the Level-2 interface.
 *
 * It states *what was observed*, and stops there. Veridian owns "whether the code works"; the agent
 * owns "what to do about it". A report that suggests a fix would be Veridian reasoning about the
 * application, which is precisely the boundary the product is built on — so the closing section
 * describes the mechanism (repair, reset, re-observe) rather than the change.
 */
export function renderFailureReport(
  outcome: RunOutcome,
  artifacts: readonly EvidenceArtifact[],
  missingEvidence: readonly string[],
): string {
  const mandatory = outcome.criteria.filter((criterion) => criterion.mandatory);
  const lines: string[] = [];
  const head = `${outcome.verdict}`;

  lines.push(`# Run ${outcome.runId} - ${head}`);
  lines.push("");
  lines.push(
    `Goal \`${outcome.goalId}\` - iteration ${outcome.iteration} of ${outcome.limits.maxIterations} - ` +
      `state ${outcome.state} - captured ${outcome.reproducibility.capturedAt}`,
  );
  lines.push("");

  if (outcome.verdict === "PASS") {
    lines.push(
      `All ${mandatory.length} mandatory criteria passed, the environment was valid, and every ` +
        "required piece of evidence was captured.",
    );
    lines.push("");
  } else {
    lines.push(
      `**${outcome.failure?.kind ?? "UNKNOWN"}** - ${outcome.failure?.message ?? "no failure detail recorded"}`,
    );
    lines.push("");
    lines.push("Why this verdict:");
    for (const reason of outcome.reasons) lines.push(`- ${reason}`);
    if (outcome.reasons.length === 0) lines.push("- (no reasons recorded - this is a defect)");
    lines.push("");
  }

  if (missingEvidence.length > 0) {
    lines.push("## Evidence that could not be captured");
    lines.push("");
    lines.push(
      "These are required by the acceptance contract and are absent. A criterion is not proven " +
        "without them, whatever its status says.",
    );
    lines.push("");
    for (const entry of missingEvidence) lines.push(`- ${entry}`);
    lines.push("");
  }

  lines.push("## Criteria");
  lines.push("");
  for (const criterion of outcome.criteria) {
    const gate = criterion.mandatory ? "mandatory" : "optional";
    lines.push(`### ${criterion.criterionId} - ${statusMark(criterion.status)} (${gate})`);
    if (criterion.description) lines.push(criterion.description);
    lines.push("");
    for (const assertion of criterion.assertions) {
      const target = assertion.target ? ` target=${assertion.target}` : "";
      const expected = assertion.expected === undefined ? "" : ` expected=${JSON.stringify(assertion.expected)}`;
      const actual = assertion.actual === undefined ? "" : ` actual=${JSON.stringify(assertion.actual)}`;
      lines.push(
        `- \`${assertion.validator}\`${target}: ${statusMark(assertion.status)}${expected}${actual}` +
          (assertion.failureKind ? ` [${assertion.failureKind}]` : ""),
      );
    }
    if (criterion.message) lines.push(`- ${criterion.message}`);
    lines.push("");
  }

  const cited = artifacts.filter((artifact) => artifact.criterionId !== null && artifact.criterionId !== undefined);
  if (cited.length > 0) {
    lines.push("## Evidence");
    lines.push("");
    for (const artifact of cited) lines.push(`- ${artifact.kind} ${artifact.criterionId}: \`${artifact.path}\``);
    lines.push("");
  }

  lines.push("## What happens next");
  lines.push("");
  if (outcome.verdict === "PASS") {
    lines.push("Nothing. The run is complete and the result stands on its own.");
  } else {
    lines.push(
      "Veridian does not propose changes to the application; it reports what it observed. If a " +
        "repair is attempted, the environment is reset and every criterion is observed again from " +
        "a clean world - a repair is only believed once it has been re-proven.",
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * The world this run measured, for the bundle and for a human reading the log.
 *
 * The boundary is taken as a *report* rather than a pre-built record because the plan and the report
 * are the two halves of one fact - what was declared, and what was done - and pairing them here is
 * what makes it impossible to write one without the other.
 */
export function environmentRecord(
  plan: EnvironmentPlan,
  health: HealthReport | null,
  transitions: readonly EnvironmentRecord["transitions"][number][],
  valid: boolean,
  boundary: BoundaryReport,
): EnvironmentRecord {
  return {
    adapter: plan.adapter,
    app: plan.app,
    appPath: plan.appPath,
    url: plan.url,
    command: plan.start.command,
    args: plan.start.args,
    health: plan.health,
    reset: plan.reset,
    browser: plan.browser,
    env: plan.env,
    valid,
    healthReport: health,
    boundary: {
      network: {
        policy: plan.boundary.network,
        allow: [...plan.boundary.allow],
        enforcement: boundary.network,
      },
      filesystemWrite: {
        policy: plan.boundary.filesystemWrite,
        enforcement: boundary.filesystemWrite,
      },
      crossings: boundary.crossings.map((entry) => ({ ...entry })),
    },
    transitions: transitions.map((entry) => ({
      from: entry.from,
      to: entry.to,
      at: entry.at,
      reason: entry.reason,
    })),
  };
}

/**
 * Reproducibility is *recorded*, not assumed (PLAN.md §19).
 *
 * Everything Veridian cannot observe with certainty is `null` rather than a plausible guess. A
 * `gitCommit` of `"unknown"` would read as a value; `null` reads as the absence it is.
 */
export async function captureReproducibility(options: {
  readonly clock: { iso(): string };
  readonly veridianVersion: string;
  readonly gitCommit?: string | null;
  readonly gitDirty?: boolean | null;
  readonly playwright?: string | null;
  readonly browser?: string | null;
  readonly networkPolicy?: string | null;
}): Promise<ReproducibilityRecord> {
  const timezone = process.env["TZ"] ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  return {
    capturedAt: options.clock.iso(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    veridian: options.veridianVersion,
    gitCommit: options.gitCommit ?? null,
    gitDirty: options.gitDirty ?? null,
    playwright: options.playwright ?? null,
    browser: options.browser ?? null,
    timezone: timezone ?? null,
    networkPolicy: options.networkPolicy ?? null,
    env: {},
  };
}
