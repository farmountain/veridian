/**
 * The second world: a database.
 *
 * ## Why this adapter exists in the order it does
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` calls this the phase that tests the architecture rather
 * than adding a feature. The reason is that a *database* world shares almost nothing with a *web*
 * world: there is no address, no page, no browser, no HTTP status to health-check on, and no DOM to
 * read. If the product's claim that a new environment can be added without rewriting the core holds
 * anywhere, it has to hold here. Where it did not hold, the core was changed and the change is
 * recorded in that document rather than absorbed quietly.
 *
 * ## What this adapter has to prove, and how
 *
 * 1. **The application really executes.** A `sqlite3` world ran the application's own real client
 *    against these files, wrote real rows, and set `DATABASE_PATH`. This adapter drives that process
 *    with the same `ProcessRunner` the web adapter uses; it is not a fixture reader.
 * 2. **The interfaces are real.** The database is a real SQLite file on disk, opened by the real
 *    `node:sqlite` engine and queried with real SQL.
 * 3. **The substitution is declared.** The *engine* is SQLite where the application was written for
 *    PostgreSQL: some SQL would behave differently, and no verdict from this world may be read as a
 *    claim about PostgreSQL. The world records `engine` below, the example says so in its own
 *    documentation, and readiness is answered as `ok: true` - a *verdict* this adapter reached by
 *    opening the file and running `SELECT 1` - rather than as an HTTP status code it does not have.
 *
 * ## Why a missing database is a refusal rather than a create
 *
 * Measured, not assumed: `new DatabaseSync(path)` **creates the file when it does not exist.** An
 * adapter that opened the database to say hello would therefore bring an empty world into being and
 * then report it healthy. Every path here checks existence first, and `start` fails when the build
 * command did not leave a database behind - because a world that was never built must not be able to
 * reach the point where criteria are judged in it.
 */

import { decodeStep } from "../../core/acceptance/plan.ts";
import type { Clock, Logger } from "../../core/clarification/types.ts";
import type {
  ArtifactKind,
  BoundaryCrossing,
  BoundaryReport,
  EnvironmentAdapter,
  EnvironmentPlan,
  EvidenceArtifact,
  HealthProbe,
  Observation,
  ObservationRequest,
} from "../../core/environment/types.ts";
import type { DbObservationData, DbQueryReading, DbValue } from "../../core/environment/db-observation.ts";
import { DB_OBSERVATION_KIND } from "../../core/environment/db-observation.ts";
import { BUNDLE_FILES, bundleLayout } from "../../core/evidence/index.ts";
import { EnvironmentError, failure } from "../../core/failure.ts";
import type { IoPort } from "../../core/io.ts";
import type { ProcessRunner } from "../../core/process.ts";
import { runToCompletion } from "../../core/process.ts";
import { sqliteDatabase } from "./database-port.ts";
import type { DatabasePort, DbStatementOutcome } from "./database-port.ts";

export interface LocalDbEnvironmentOptions {
  readonly io: IoPort;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  /** Veridian's state directory, relative to the io root - `.veridian`. Evidence is written under it. */
  readonly stateDir: string;
  /** The storage port. Injected so the adapter's own behaviour can be tested without SQLite. */
  readonly database?: DatabasePort;
  /** How long the build command may take. Generous: it is a one-off, not a retry. */
  readonly buildTimeoutMs?: number;
}

/**
 * The engine this adapter substitutes, recorded in every reading.
 *
 * A constant rather than a field of the plan: the plan may describe the application's storage only
 * as "a database", and it is *this* adapter that decides which engine answers. A verdict that names
 * the engine it was reached against is one step away from being a claim about PostgreSQL, and that
 * step is the operator's to take knowingly - the environment document says so.
 */
export const DB_ENGINE = "sqlite";

/** The tail of a process's output, for a message a human has to read at three in the morning. */
const tail = (text: string, limit = 600): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const MISSING_DATABASE_PATH =
  "this world has no `databasePath`, and the local-db adapter drives a SQLite file - " +
  "add `databasePath` to the environment document, or use an adapter whose world is a process on a port";

const MISSING_BUILD_COMMAND =
  "this world declares no `start.command`, and the local-db adapter will not judge a database it did " +
  "not build - a database file left over from an earlier run is not the world this contract describes";

export class LocalDbEnvironment implements EnvironmentAdapter {
  readonly kind = "local-db";

  readonly #plan: EnvironmentPlan;
  readonly #io: IoPort;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #processes: ProcessRunner;
  readonly #database: DatabasePort;
  readonly #buildTimeoutMs: number;
  readonly #stateDir: string;

  #id: string | null = null;
  /** The database file as an absolute path the port accepts. Derived once, in `create()`. */
  #file: string | null = null;
  /** Whether this world's build command has run in *this* environment's lifetime. */
  #built = false;

  /**
   * Every statement this world refused because it would have left the database.
   *
   * A database is one file, and SQL's `ATTACH DATABASE` opens *another* - which is a real, reachable
   * way for a criterion to write outside the world it is being judged in. It is refused here, and
   * the refusal is recorded for the same reason the web adapter keeps its network crossings.
   *
   * `reset()` deliberately does not clear it: a reset restores the world; it does not restore the
   * record. An iteration that reached outside the boundary must not be followed by a clean one that
   * reports `PASS`, with the evidence of the violation destroyed by the very act of repairing it.
   */
  readonly #crossings: BoundaryCrossing[] = [];

  constructor(plan: EnvironmentPlan, options: LocalDbEnvironmentOptions) {
    this.#plan = plan;
    this.#io = options.io;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#processes = options.processes;
    this.#database = options.database ?? sqliteDatabase();
    this.#buildTimeoutMs = options.buildTimeoutMs ?? 120_000;
    this.#stateDir = options.stateDir.replace(/[\\/]+$/, "");
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  async create(): Promise<{ readonly id: string }> {
    // Both refusals happen here, before anything runs, so a document that cannot describe this world
    // fails as a definition problem naming the missing field rather than as a timeout in the middle
    // of a run.
    const relative = this.#plan.databasePath;
    if (relative === null || relative === "") throw new EnvironmentError(MISSING_DATABASE_PATH);
    if (this.#plan.start.command === "") throw new EnvironmentError(MISSING_BUILD_COMMAND);

    if (this.#id === null) {
      this.#id = `local-db:${relative.replace(/\\/g, "/")}`;
    }
    // Resolved through the io port, so a relative `databasePath` lands in the application directory
    // and an absolute one is used as written - the rule `core/io.ts` already enforces for a caller's
    // paths. Every other method derives from this, so no two of them can disagree about which file
    // the world is.
    this.#file = this.#io.resolve(this.#plan.appPath, relative);
    this.#logger.debug("environment.create", { id: this.#id, database: this.#file });
    return { id: this.#id };
  }

  async start(id: string): Promise<void> {
    this.#requireId(id);
    await this.#build();
    this.#built = true;
  }

  /**
   * Nothing to copy into the world.
   *
   * The same reasoning as the web adapter's: the application under test is the user's own working
   * tree. A `deploy` that copied files would give the run a *different* tree from the one the agent
   * edits, and then a `PASS` would be evidence about a copy nobody repairs. Kept as an explicit
   * recorded no-op rather than an empty body, so a reader can tell "nothing to do" from "not done".
   */
  async deploy(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.deploy", {
      id,
      note: "the application runs in place from its own directory; there is nothing to deploy",
      command: this.#plan.start.command,
    });
  }

  async execute(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, true);
  }

  async observe(id: string, request: ObservationRequest): Promise<Observation> {
    return this.#capture(id, request, false);
  }

  /**
   * Readiness is a verdict, not a status code.
   *
   * "Ready" means the database file exists *and* opens *and* answers `SELECT 1`. That is the whole
   * question a reader would ask, and it is answered here rather than converted into a number that
   * `#awaitHealth` would have to compare against a fictional expectation. `ok: false` carries the
   * engine's own message, because a probe may only name a cause it observed.
   */
  async probe(id: string): Promise<HealthProbe> {
    this.#requireId(id);
    const file = this.#requireFile();
    if (!(await this.#io.exists(file))) {
      return { ok: false, statusCode: null, message: `no database file at ${file}`, patternSeen: null };
    }
    try {
      await this.#database.inspect({ path: file, statements: ["SELECT 1"] });
      return { ok: true, statusCode: null, message: null, patternSeen: null };
    } catch (error) {
      return { ok: false, statusCode: null, message: describe(error), patternSeen: null };
    }
  }

  /**
   * Photograph the database file.
   *
   * Unlike a live process, a database *is* a file, so this is a real snapshot rather than a reset in
   * name only - which is exactly why the refusal in the web adapter is not copied here. The copy is
   * named after the environment and the moment, so two snapshots in one run cannot collide.
   */
  async snapshot(id: string): Promise<string> {
    this.#requireId(id);
    const file = this.#requireFile();
    if (!(await this.#io.exists(file))) {
      throw new EnvironmentError(`there is no database at ${file} to snapshot`);
    }
    const name = `${id.replace(/[^A-Za-z0-9._-]/g, "-")}-${String(Date.now())}.db`;
    const snapshotsDir = this.#snapshotsDir();
    await this.#io.mkdirp(snapshotsDir);
    await this.#io.copyFile(file, `${snapshotsDir}/${name}`);
    this.#logger.debug("environment.snapshot", { id, snapshot: name });
    return name;
  }

  async restore(id: string, snapshotId: string): Promise<void> {
    this.#requireId(id);
    const file = this.#requireFile();
    const source = `${this.#snapshotsDir()}/${snapshotId}`;
    if (!(await this.#io.exists(source))) {
      throw new EnvironmentError(`there is no snapshot \`${snapshotId}\` to restore`);
    }
    await this.#io.copyFile(source, file);
    this.#logger.debug("environment.restore", { id, snapshot: snapshotId, database: file });
  }

  /**
   * Reset is first-class, and for a database world "restarting" means rebuilding the file.
   *
   * There is no process to kill: the world *is* the file, so the only reset that can be real is one
   * that puts the file back into the state the contract describes. `restart` re-runs the documented
   * build command - the same command that built the world in the first place - which is a real reset
   * because it re-creates the schema and the seed data rather than trusting whatever the previous
   * criterion left behind. `snapshot-restore` puts the file back instead, which is stronger when the
   * operator has one. `custom` runs the operator's own command and falls back to a rebuild.
   */
  async reset(id: string): Promise<void> {
    this.#requireId(id);
    const { strategy, command } = this.#plan.reset;

    if (strategy === "snapshot-restore") {
      throw new EnvironmentError(
        "reset.strategy is `snapshot-restore`, and no snapshot was taken for this reset - take one with " +
          "`snapshot()` before the first criterion, or use `restart`, which rebuilds the database from " +
          "the environment's own build command",
      );
    }

    if (strategy === "custom" && command !== null) {
      const result = await runToCompletion(
        this.#processes,
        {
          command,
          args: [],
          cwd: this.#plan.appPath,
          env: this.#plan.env,
          onStdout: (chunk) => this.#logger.debug("reset.stdout", { chunk: chunk.trimEnd() }),
          onStderr: (chunk) => this.#logger.warn("reset.stderr", { chunk: chunk.trimEnd() }),
        },
        this.#buildTimeoutMs,
      );
      if (result.timedOut || result.code !== 0) {
        throw new EnvironmentError(
          result.timedOut
            ? `the reset command \`${command}\` did not finish within ${String(this.#buildTimeoutMs)}ms`
            : `the reset command \`${command}\` exited with code ${String(result.code)}: ${tail(result.stderr)}`,
        );
      }
      this.#logger.debug("environment.reset", { id, strategy, command });
      return;
    }

    if (strategy === "custom") {
      this.#logger.warn("environment.reset", {
        id,
        strategy,
        note: "a custom strategy was requested without a command; falling back to rebuilding the database",
      });
    }

    await this.#build();
    this.#logger.debug("environment.reset", { id, strategy: "restart", database: this.#file });
  }

  /**
   * Nothing stays running between calls, so there is nothing to stop.
   *
   * A database world has no long-lived process: the build command has already exited by the time
   * `start()` returns, and each observation opens the file, reads it and closes it. Recorded rather
   * than left empty so a reader can tell this apart from a method nobody implemented.
   */
  async stop(id: string): Promise<void> {
    this.#requireId(id);
    this.#logger.debug("environment.stop", { id, note: "a database world holds no process open between calls" });
  }

  async destroy(id: string): Promise<void> {
    this.#requireId(id);
    this.#built = false;
    this.#id = null;
    this.#file = null;
  }

  // ---- observation ----------------------------------------------------------------------------

  async #capture(id: string, request: ObservationRequest, act: boolean): Promise<Observation> {
    this.#requireId(id);
    if (!this.#built) {
      throw new EnvironmentError("this environment has not been started; call start() before observing it");
    }
    const base = {
      kind: DB_OBSERVATION_KIND,
      capturedAt: this.#clock.iso(),
      environmentId: id,
      runId: request.runId,
    };

    try {
      const file = this.#requireFile();
      if (!(await this.#io.exists(file))) {
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure("ENVIRONMENT_FAILURE", `there is no database at ${file}; the world was never built`),
        };
      }

      // Decoded with `decodeStep` - the same function that produced the wire records - so a step kind
      // this world cannot perform is named instead of silently skipped. Skipping it would judge the
      // criterion in a world it never acted on, which is a verdict the observation cannot justify.
      const steps = request.steps.map((raw, index) => decodeStep(raw, request.criterionId, index));
      const unsupported = act ? steps.findIndex((step) => step.kind !== "sql") : -1;
      if (unsupported !== -1) {
        const step = steps[unsupported];
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "VALIDATOR_ERROR",
            `the local-db adapter performs \`sql\` steps, and step ${String(unsupported + 1)} of ` +
              `${request.criterionId} is \`${step === undefined ? "unknown" : step.kind}\` - the criterion ` +
              "would be judged in a world it never acted on",
          ),
        };
      }

      const statements: string[] = [];
      if (act) {
        for (const step of steps) {
          if (step.kind !== "sql") continue;
          const escape = this.#refuseEscape(step.statement, request.criterionId);
          if (escape !== null) return { ...base, data: null, artifacts: [], error: escape };
          statements.push(step.statement);
        }
      }
      const inspection = await this.#database.inspect({ path: file, statements });

      const failed = inspection.results.find((outcome) => outcome.error !== null);
      if (failed !== undefined) {
        return {
          ...base,
          data: null,
          artifacts: [],
          error: failure(
            "APPLICATION_ERROR",
            `the database refused \`${failed.statement}\`: ${failed.error ?? "no message"}`,
          ),
        };
      }

      const last = inspection.results[inspection.results.length - 1];
      const data: DbObservationData = {
        engine: DB_ENGINE,
        database: file,
        tables: inspection.tables,
        // `null` here is a fact rather than a gap: `observe()` does not act, so it cannot see the
        // result of a query it did not run, and the acceptance plan's own query is a step.
        query: last === undefined || !act ? null : queryOf(last),
      };

      const relativeRunDir = bundleLayout(this.#stateDir, request.runId).runDir;
      const artifacts = await this.#captureEvidence(request, data, relativeRunDir);
      return { ...base, data, artifacts, error: null };
    } catch (error) {
      return { ...base, data: null, artifacts: [], error: failure("ENVIRONMENT_FAILURE", describe(error)) };
    }
  }

  /**
   * What this world did about the plan's boundaries.
   *
   * `unsupported` for both, and not silently. The build command runs as an ordinary child process
   * with the operator's own privileges, so nothing here holds a network or a filesystem boundary: a
   * world whose database file is an absolute path will read and write wherever that path points.
   * Reporting `enforced` for a boundary this adapter cannot express is the defect the whole boundary
   * path exists to remove.
   *
   * The crossings list is empty and is still reported, because its emptiness means exactly one
   * thing here - the adapter never held a guard, so it never saw a refusal. That is *why* the two
   * policies above read `unsupported`, and the pair is what a reader has to be able to compare.
   */
  boundaries(): BoundaryReport {
    return {
      network: this.#plan.boundary.network === "allow" ? "not-requested" : "unsupported",
      filesystemWrite: "unsupported",
      crossings: [...this.#crossings],
    };
  }

  /**
   * Write down what was seen.
   *
   * The reading is always written, whatever the criterion declared, because a judgement cites values
   * that came from here and evidence for a judgement has to be in the bundle (M5). A database world
   * produces no screenshot and no trace, so a criterion that declares one of those gets the
   * missing-evidence guard rather than an artifact invented to satisfy it - `INCONCLUSIVE`, never a
   * `PASS` on evidence that does not exist.
   */
  async #captureEvidence(
    request: ObservationRequest,
    data: DbObservationData,
    relativeRunDir: string,
  ): Promise<readonly EvidenceArtifact[]> {
    const id = request.criterionId;
    const artifacts: EvidenceArtifact[] = [];
    const write = async (relative: string, kind: ArtifactKind, contents: string): Promise<void> => {
      await this.#io.writeTextFile(`${relativeRunDir}/${relative}`, contents);
      artifacts.push({ path: relative, kind, criterionId: id, bytes: contents.length });
    };

    await write(
      `${BUNDLE_FILES.artifacts}/${id}.observation.json`,
      "json",
      `${JSON.stringify(data, null, 2)}\n`,
    );

    if (data.query !== null) {
      // The query and its result, on their own, because this is the artifact a human reads when a
      // database criterion fails: what was asked and what came back, without the schema around it.
      await write(
        `${BUNDLE_FILES.artifacts}/${id}.query.json`,
        "json",
        `${JSON.stringify(data.query, null, 2)}\n`,
      );
    }

    // Only the kinds this call did *not* write are worth a warning, and the set is read off the
    // artifacts rather than from a literal list beside them. The literal was here first and it was
    // wrong in the one direction that matters: the loop warned for `json` while holding a `json`
    // artifact it had written two lines above, so every criterion reported "produces `json` and cannot
    // produce `json`" - a sentence that contradicts itself, emitted three times per criterion, and a
    // reader who learns to skip these lines has learned to skip the one that is true. A second list
    // would also be free to disagree with the writes; derived from them it cannot.
    const written = [...new Set(artifacts.map((artifact) => artifact.kind))].sort();
    const produces = written.length === 0 ? "no" : `\`${written.join("`, `")}\``;
    for (const kind of request.evidence) {
      if (written.includes(kind)) continue;
      this.#logger.warn("environment.evidence", {
        criterionId: id,
        kind,
        note:
          `the local-db adapter writes ${produces} artifacts for a criterion and cannot produce ` +
          `\`${kind}\`; the criterion will report the artifact as missing rather than being handed a substitute`,
      });
    }
    return artifacts;
  }

  // ---- build ----------------------------------------------------------------------------------

  /**
   * Run the documented build command and require it to have left a database behind.
   *
   * The existence check is the point of this method. `new DatabaseSync(path)` creates a missing file,
   * so an adapter that skipped the check would report a world as ready whenever the build command did
   * nothing at all. Here, a build that produced no database fails the run as an environment failure -
   * which is the honest classification, because it is the *sandbox* that could not be brought up and
   * the application never got a chance to be wrong.
   */
  async #build(): Promise<void> {
    const file = this.#requireFile();
    const { command, args, readyPattern } = this.#plan.start;
    this.#logger.info("environment.build", { command, args, cwd: this.#plan.appPath, database: file });

    const result = await runToCompletion(
      this.#processes,
      {
        command,
        args,
        cwd: this.#plan.appPath,
        env: this.#plan.env,
        onStdout: (chunk) => this.#logger.debug("build.stdout", { chunk: chunk.trimEnd() }),
        onStderr: (chunk) => this.#logger.warn("build.stderr", { chunk: chunk.trimEnd() }),
      },
      this.#buildTimeoutMs,
    );

    if (result.timedOut) {
      throw new EnvironmentError(
        `the build command (\`${command}\`) did not finish within ${String(this.#buildTimeoutMs)}ms`,
      );
    }
    if (result.code !== 0) {
      throw new EnvironmentError(
        `the build command (\`${command}\`) exited with code ${String(result.code)}: ${tail(result.stderr)}`,
      );
    }
    // A declared readiness pattern is honoured here as it is in the web adapter: it is the build's own
    // signal that it finished. Checked against the *combined* output, because a seed script that
    // narrates to stderr is ordinary and a pattern is not a channel.
    if (readyPattern !== null && !new RegExp(readyPattern).test(`${result.stdout}\n${result.stderr}`)) {
      throw new EnvironmentError(
        `the build command (\`${command}\`) never printed /${readyPattern}/; output: ${tail(result.stdout)}`,
      );
    }
    if (!(await this.#io.exists(file))) {
      throw new EnvironmentError(
        `the build command (\`${command}\`) exited successfully and left no database at ${file} - ` +
          "this adapter creates nothing it was not asked to build, so the world would be one it never made",
      );
    }
  }

  /**
   * Refuse a statement that would leave the database, and record that it was tried.
   *
   * ## What this guard is, and what it is not
   *
   * It is a real refusal of a real escape: `ATTACH DATABASE` makes SQLite open a *second* file, so a
   * criterion could otherwise reach any path the operator's account can write. It is checked on the
   * statement's leading keyword, which is sufficient because a prepared statement holds exactly one
   * SQL statement - `node:sqlite` refuses trailing content - so there is no second statement for a
   * leading-keyword check to miss.
   *
   * It is *not* a filesystem sandbox. The build command runs with the operator's own privileges and
   * this adapter cannot see where that process writes, which is why `boundaries()` reports
   * `filesystemWrite` as `unsupported` and does not promote itself to `enforced` on the strength of
   * this one check. The two facts are stated separately on purpose: the *policy* is unenforced, and
   * a *crossing* was observed and stopped. Collapsing them into one number would be the overclaim
   * this whole path exists to prevent.
   */
  #refuseEscape(statement: string, criterionId: string): Observation["error"] {
    // No policy check here, and its absence is the decision rather than an omission.
    //
    // `filesystemWrite` is `"deny" | "sandbox"`, and this adapter can honour neither for `ATTACH`:
    // `deny` forbids the write outright, and `sandbox` promises to confine it while this adapter has
    // no sandbox to confine a second database *in* - which is why `boundaries()` reports the policy
    // `unsupported` rather than `enforced`. So an `if (policy === ...) return null` would be a branch
    // no goal could reach, and a guard no code path can trip is not a guard. The policy appears below
    // only to *name* what was declared, never to decide. When a container-backed world can really
    // confine a second file, the permission belongs to that world and to its own boundary report.
    if (!/^\s*attach\b/i.test(statement)) return null;

    const subject = statement.replace(/\s+/g, " ").trim().slice(0, 120);
    this.#crossings.push({ boundary: "filesystemWrite", subject, criterionId, at: this.#clock.iso() });
    return failure(
      "SECURITY_VIOLATION",
      `\`${subject}\` would open a database outside this world, and the goal declares ` +
        `filesystemWrite: ${this.#plan.boundary.filesystemWrite}`,
    );
  }

  /**
   * Where snapshots live.
   *
   * The same directory `RunBundleLayout` calls `snapshotsDir` - one level under the state directory
   * and outside any run, because a snapshot outlives the run that took it. Spelled from the state
   * directory rather than from a bundle layout, because no run id is involved and inventing one to
   * reach the path would be a placeholder standing where a fact belongs.
   */
  #snapshotsDir(): string {
    return `${this.#stateDir}/snapshots`;
  }

  #requireFile(): string {
    const file = this.#file;
    if (file === null) throw new EnvironmentError("this environment has not been created; call create() first");
    return file;
  }

  #requireId(id: string): void {
    if (this.#id === null) {
      throw new EnvironmentError("this environment has not been created; call create() first");
    }
    if (this.#id !== id) {
      // A manager driving two environments, or a stale handle. Cheap to catch, and catching it beats
      // watching one database's rows appear in another's evidence.
      throw new EnvironmentError(`this environment is \`${this.#id}\`, but it was addressed as \`${id}\``);
    }
  }
}

/**
 * A statement's result as the shared reading.
 *
 * `columns` is taken from the prepared statement rather than from the first row, so a query that
 * returned nothing still reports the columns it selected - which is the difference between `db.value`
 * answering "the query selected no such column" and answering "no rows came back".
 */
function queryOf(outcome: DbStatementOutcome): DbQueryReading {
  return {
    statement: outcome.statement,
    // Ordered as selected, and not deduplicated: `SELECT id, id FROM t` has two columns, and a
    // reading that collapsed them would make a criterion about one of them unanswerable.
    columns: [...outcome.columns],
    rows: outcome.rows.map((row) => [...row] as readonly DbValue[]),
  };
}
