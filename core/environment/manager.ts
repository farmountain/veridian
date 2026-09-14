import type { Clock, Logger } from "../clarification/index.ts";
import {
  EnvironmentError,
  classifyError,
  failure,
  type Failure,
  type FailureKind,
} from "../failure.ts";
import { probeUrl } from "./load.ts";
import type {
  BoundaryReport,
  EnvironmentAdapter,
  EnvironmentPlan,
  HealthProbe,
  HealthReport,
  Observation,
  ObservationRequest,
} from "./types.ts";

/**
 * The environment manager: the only thing permitted to move an environment through its lifecycle.
 *
 * Two rules are enforced here rather than left to the adapter, because an adapter that got either of
 * them wrong would still *work* — it would just be wrong in a way that only shows up as a false PASS:
 *
 * 1. **A health-check failure is an `ENVIRONMENT_FAILURE`, never a test failure.** The application
 *    not being reachable is not evidence about the application's behaviour. Collapsing the two is
 *    how "the server was not up" becomes "the feature is broken", which sends an external agent off
 *    to repair code that was never at fault.
 * 2. **A failed reset is a `RESET_FAILURE`.** Reset's contract is stronger than start's: it must
 *    yield a *working* world. If it cannot, the run must end rather than continue against state that
 *    may have been inherited from the iteration before.
 *
 * Both rules need the same thing — a decision made *after* the adapter has spoken — so both live
 * above the adapter boundary, where the retry policy and the classification can see the whole story.
 */

export const ENVIRONMENT_STATES = [
  "defined",
  "creating",
  "created",
  "starting",
  "started",
  "deploying",
  "deployed",
  "ready",
  "resetting",
  "stopped",
  "destroyed",
  "error",
] as const;
export type EnvironmentState = (typeof ENVIRONMENT_STATES)[number];

export interface EnvironmentTransition {
  readonly from: EnvironmentState;
  readonly to: EnvironmentState;
  readonly at: string;
  readonly reason: string;
}

export interface EnvironmentReady {
  readonly ok: true;
  readonly id: string;
  readonly state: "ready";
  readonly health: HealthReport;
  readonly transitions: readonly EnvironmentTransition[];
}

export interface EnvironmentFailure {
  readonly ok: false;
  readonly id: string | null;
  readonly state: EnvironmentState;
  readonly health: HealthReport | null;
  readonly failure: Failure;
  readonly transitions: readonly EnvironmentTransition[];
}

export type PrepareResult = EnvironmentReady | EnvironmentFailure;
export type ResetResult = EnvironmentReady | EnvironmentFailure;

export interface EnvironmentManagerOptions {
  readonly adapter: EnvironmentAdapter;
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Injected so a health-retry test does not spend real wall-clock time being patient.
   *
   * This is the only reason the port exists. A `setTimeout` reached from inside the manager would
   * make every retry test either slow or flaky, and the retry policy is precisely the part of this
   * file most worth testing.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class EnvironmentManager {
  readonly #adapter: EnvironmentAdapter;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #sleep: (ms: number) => Promise<void>;

  #state: EnvironmentState = "defined";
  #id: string | null = null;
  #plan: EnvironmentPlan | null = null;
  #baselineSnapshotId: string | null = null;
  #transitions: EnvironmentTransition[] = [];

  constructor(options: EnvironmentManagerOptions) {
    this.#adapter = options.adapter;
    this.#clock = options.clock;
    this.#logger = options.logger;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  get state(): EnvironmentState {
    return this.#state;
  }

  get id(): string | null {
    return this.#id;
  }

  /** The plan this manager is driving. Exposed so the run bundle can record what was actually built. */
  get plan(): EnvironmentPlan | null {
    return this.#plan;
  }

  get transitions(): readonly EnvironmentTransition[] {
    return [...this.#transitions];
  }

  /**
   * Forwarded verbatim from the adapter, and deliberately not remembered here.
   *
   * The manager could cache this, and caching would be wrong: the crossings accumulate while the run
   * works, so a value read at `prepare()` and re-served later would describe the world the run
   * started in rather than the world it used - the same defect `envRecord()` was fixed for. The call
   * is cheap and the answer is only correct at the moment it is asked for.
   *
   * Before a plan has been prepared there is no adapter state to report, so the answer is the empty
   * one: nothing was declared, so nothing was refused. It is not `enforced` - a world that has not
   * been built cannot be said to hold anything.
   */
  boundaries(): BoundaryReport {
    if (this.#plan === null) {
      return { network: "not-requested", filesystemWrite: "unsupported", crossings: [] };
    }
    return this.#adapter.boundaries();
  }

  /**
   * DEFINE → CREATE → START → DEPLOY → (health).
   *
   * Unlike the eight-step lifecycle in PLAN.md §5, `snapshot` is not always taken: it happens at the
   * end of a successful prepare and *only* when the plan asked for `snapshot-restore`. Taking one
   * unconditionally would be a cost paid by every run for a capability most runs do not use.
   */
  async prepare(plan: EnvironmentPlan): Promise<PrepareResult> {
    this.#plan = plan;
    this.#state = "defined";
    this.#transitions = [];
    this.#baselineSnapshotId = null;

    const created = await this.#step("creating", "created", "create the environment", () =>
      this.#adapter.create(),
    );
    if (!created.ok) return created.result as EnvironmentFailure;

    this.#id = created.value.id;
    this.#logger.info("environment created", { id: this.#id, adapter: plan.adapter });

    const started = await this.#step("starting", "started", "start the application", () =>
      this.#adapter.start(this.#id as string),
    );
    if (!started.ok) return started.result as EnvironmentFailure;

    const deployed = await this.#step("deploying", "deployed", "deploy into the environment", () =>
      this.#adapter.deploy(this.#id as string),
    );
    if (!deployed.ok) return deployed.result as EnvironmentFailure;

    const health = await this.#awaitHealth("ENVIRONMENT_FAILURE");
    if (!health.ok) return this.#fail(health, "the environment never became valid");

    this.#to("ready", `health check passed after ${health.report.attempts} attempt(s)`);
    await this.#takeBaseline(plan);

    return {
      ok: true,
      id: this.#id as string,
      state: "ready",
      health: health.report,
      transitions: this.transitions,
    };
  }

  /** DECIDE → RESETTING → READY. The state a validator must never inherit. */
  async reset(): Promise<ResetResult> {
    const plan = this.#plan;
    const id = this.#id;
    if (plan === null || id === null) {
      return this.#refuse("RESET_FAILURE", "reset was requested before the environment was prepared");
    }

    this.#to("resetting", `reset via ${plan.reset.strategy}`);
    try {
      if (plan.reset.strategy === "snapshot-restore") {
        if (this.#baselineSnapshotId === null) {
          throw new EnvironmentError(
            "reset.strategy is snapshot-restore but no baseline snapshot exists. A restore with " +
              "nothing to restore is not a reset.",
          );
        }
        await this.#adapter.restore(id, this.#baselineSnapshotId);
      } else {
        // `restart` and `custom` are the adapter's business: only it knows whether resetting means
        // respawning a process, reloading, or running a command the author supplied.
        await this.#adapter.reset(id);
      }
    } catch (error) {
      const classified = asResetFailure(error);
      this.#logger.warn("reset failed", { message: classified.message });
      this.#state = "error";
      return { ok: false, id, state: "error", health: null, failure: classified, transitions: this.transitions };
    }

    const health = await this.#awaitHealth("RESET_FAILURE");
    if (!health.ok) return this.#fail(health, "the environment was not valid after reset");

    this.#to("ready", `reset complete after ${health.report.attempts} health attempt(s)`);
    return { ok: true, id, state: "ready", health: health.report, transitions: this.transitions };
  }

  async execute(request: ObservationRequest): Promise<Observation> {
    return this.#adapter.execute(this.#requireReady("execute"), request);
  }

  async observe(request: ObservationRequest): Promise<Observation> {
    return this.#adapter.observe(this.#requireReady("observe"), request);
  }

  async snapshot(): Promise<string> {
    return this.#adapter.snapshot(this.#requireReady("snapshot"));
  }

  async restore(snapshotId: string): Promise<void> {
    await this.#adapter.restore(this.#requireReady("restore"), snapshotId);
  }

  /**
   * STOP → DESTROY, best effort, never throwing.
   *
   * It is called from error paths, so a throw here would replace a precise failure with a vague one
   * — the module would report "stop failed" and lose the reason the run was ending. It is also the
   * only defence against an orphaned child process outliving the run that spawned it.
   */
  async teardown(): Promise<void> {
    const id = this.#id;
    if (id === null || this.#state === "destroyed") return;

    try {
      this.#to("stopped", "stop the application");
      await this.#adapter.stop(id);
    } catch (error) {
      this.#logger.warn("stop failed", { message: messageOf(error) });
      this.#to("destroyed", "destroy the environment - stop had already failed");
      return;
    }

    try {
      this.#to("destroyed", "destroy the environment");
      await this.#adapter.destroy(id);
    } catch (error) {
      // Recorded as destroyed regardless: the environment is no longer usable, and leaving it in a
      // half-state would let a later `prepare` believe it had a world to reuse.
      this.#logger.warn("destroy failed", { message: messageOf(error) });
      this.#to("destroyed", "destroy the environment - reported gone after a failed cleanup");
    }
  }

  // -------------------------------------------------------------------------------------------

  #requireReady(operation: string): string {
    if (this.#state !== "ready" || this.#id === null) {
      throw new EnvironmentError(
        `cannot ${operation}: the environment is "${this.#state}", not "ready". Veridian does not ` +
          "run criteria against a world it has not validated.",
      );
    }
    return this.#id;
  }

  #to(to: EnvironmentState, reason: string): void {
    const from = this.#state;
    this.#state = to;
    this.#transitions.push({ from, to, at: this.#clock.iso(), reason });
  }

  async #takeBaseline(plan: EnvironmentPlan): Promise<void> {
    if (plan.reset.strategy !== "snapshot-restore") return;
    try {
      this.#baselineSnapshotId = await this.#adapter.snapshot(this.#id as string);
      this.#logger.debug("baseline snapshot taken", { snapshotId: this.#baselineSnapshotId });
    } catch (error) {
      // A missing baseline is not fatal here; it becomes fatal at reset, where it is reported as the
      // RESET_FAILURE it is. Failing the whole run at prepare time would blame the environment for a
      // limitation of the reset strategy the author chose.
      this.#logger.warn("baseline snapshot failed", { message: messageOf(error) });
    }
  }

  async #step<T>(
    entering: EnvironmentState,
    leaving: EnvironmentState,
    reason: string,
    action: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; result: EnvironmentFailure }> {
    this.#to(entering, reason);
    try {
      const value = await action();
      this.#to(leaving, `${reason} - ok`);
      return { ok: true, value };
    } catch (error) {
      const classified = classifyError(error, "ENVIRONMENT_FAILURE");
      this.#logger.warn(`${reason} failed`, { kind: classified.kind, message: classified.message });
      return { ok: false, result: await this.#failWith(classified) };
    }
  }

  /**
   * Poll until healthy, or until either of two independent limits is reached.
   *
   * Two limits rather than one because they fail differently. The elapsed-time limit is the product
   * requirement — a run must not spend its whole budget waiting for a server that will never come
   * up. The attempt limit is the safety net for a clock that does not advance (a frozen test clock,
   * a container with a suspended monotonic timer), where "elapsed" would stay at zero forever and
   * the loop would hang. A bounded loop with two independent exits cannot hang.
   */
  async #awaitHealth(
    onFailure: FailureKind,
  ): Promise<{ ok: boolean; report: HealthReport; failure: Failure | null }> {
    const plan = this.#plan as EnvironmentPlan;
    const id = this.#id as string;
    const url = probeUrl(plan);
    // What a reader is told to look at. A world with no address is named by its adapter rather than
    // by whatever an empty string would render as, so no failure message reads "no response from ".
    const where = url ?? `the ${plan.adapter} world`;
    const expectStatus = plan.health.expectStatus;
    const timeoutMs = plan.health.timeoutMs;
    const intervalMs = Math.max(1, plan.health.intervalMs);
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
    const startedAt = this.#clock.now();

    let attempts = 0;
    let statusCode: number | null = null;
    let message: string | null = null;
    let patternSeen: boolean | null = null;

    for (;;) {
      attempts += 1;

      let probe: HealthProbe;
      try {
        probe = await this.#adapter.probe(id);
      } catch (error) {
        // A probe that throws is an unhealthy environment, not a Veridian defect: an adapter that
        // cannot complete a request has, from the run's point of view, the same information as one
        // whose request was refused.
        probe = { ok: null, statusCode: null, message: messageOf(error), patternSeen: null };
      }

      statusCode = probe.statusCode;
      if (probe.message !== null) message = probe.message;
      if (probe.patternSeen !== null) patternSeen = probe.patternSeen;

      // Readiness has two honest shapes and which applies is the world's business, not the
      // manager's. A world with a status code is judged by it. A world without one - a database file
      // that either opens or does not - is judged by the adapter's own verdict, because there is no
      // number to compare and inventing one (200 for "the file opened") would record a fact the
      // world never produced. A world that answers neither way is never ready: the fallthrough is
      // `false`, so an adapter that says nothing cannot become healthy by being silent.
      const statusOk =
        probe.ok !== null ? probe.ok : expectStatus !== null && statusCode === expectStatus;
      // A declared ready pattern is a *required* signal when the adapter can observe stdout, and an
      // unobservable one when it cannot. Recording `null` rather than `true` keeps the report honest
      // about which of those two happened.
      const patternOk = plan.health.readyPattern === null || patternSeen !== false;

      if (statusOk && patternOk) {
        return {
          ok: true,
          report: {
            ok: true,
            message:
              url === null
                ? `healthy: ${where} reported ready`
                : `healthy: ${url} returned ${statusCode}`,
            attempts,
            elapsedMs: this.#clock.now() - startedAt,
            url,
            statusCode,
            readyPatternSatisfied: plan.health.readyPattern === null ? null : patternSeen,
          },
          failure: null,
        };
      }

      const elapsedMs = this.#clock.now() - startedAt;
      if (elapsedMs >= timeoutMs || attempts >= maxAttempts) {
        // Every branch names a cause the manager actually observed, and "expected 200" is printed
        // only when a 200 was in fact expected - so a database world is never told it failed an HTTP
        // check it never had.
        const detail =
          url === null
            ? `${where} never became ready`
            : statusCode === null
              ? `no response from ${url}`
              : `expected ${String(expectStatus)} from ${url}, received ${statusCode}`;
        const patternDetail =
          plan.health.readyPattern !== null && patternSeen === false
            ? `; stdout never matched /${plan.health.readyPattern}/`
            : "";
        return {
          ok: false,
          report: {
            ok: false,
            message: `${detail}${patternDetail}`,
            attempts,
            elapsedMs,
            url,
            statusCode,
            readyPatternSatisfied: plan.health.readyPattern === null ? null : patternSeen,
          },
          failure: failure(onFailure, `${detail}${patternDetail}`, {
            detail: message === null ? null : `probe said: ${message}`,
          }),
        };
      }

      await this.#sleep(intervalMs);
    }
  }

  async #fail(
    health: { report: HealthReport; failure: Failure | null },
    why: string,
  ): Promise<EnvironmentFailure> {
    const classified =
      health.failure ?? failure("ENVIRONMENT_FAILURE", health.report.message, { detail: why });
    return this.#failWith(classified, health.report);
  }

  async #failWith(classified: Failure, health: HealthReport | null = null): Promise<EnvironmentFailure> {
    this.#state = "error";
    // Best-effort teardown so a partially started application does not outlive its run and hold a
    // port hostage for the next one.
    await this.teardown();
    return {
      ok: false,
      id: this.#id,
      state: "error",
      health,
      failure: classified,
      transitions: this.transitions,
    };
  }

  #refuse(kind: FailureKind, message: string): EnvironmentFailure {
    return {
      ok: false,
      id: this.#id,
      state: this.#state,
      health: null,
      failure: failure(kind, message),
      transitions: this.transitions,
    };
  }
}

/**
 * During reset, an environment-layer throw is a *reset* failure.
 *
 * The general classifier maps `EnvironmentError` to `ENVIRONMENT_FAILURE`, which is right everywhere
 * except here. Reset's postcondition is stronger than start's — it must hand back a working world —
 * so when it throws, the informative name for what happened is `RESET_FAILURE`. Reporting it as an
 * environment failure would blame a world that was, until the reset, perfectly usable.
 */
function asResetFailure(error: unknown): Failure {
  const classified = classifyError(error, "RESET_FAILURE");
  if (classified.kind !== "ENVIRONMENT_FAILURE") return classified;
  return failure("RESET_FAILURE", classified.message, { detail: classified.detail });
}
