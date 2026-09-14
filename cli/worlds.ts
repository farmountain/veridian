/**
 * The worlds this build ships, and the only place that knows which they are.
 *
 * A table, not a chain of `if`s. The chain is what this file replaced: `cli/veridian.ts` held
 * `const REGISTERED_ADAPTERS = ["local-web"]`, constructed `LocalWebEnvironment` unconditionally, and
 * refused every other adapter with a hard `if (environment.adapter !== "local-web")`. Adding a world
 * meant editing three places in the command layer, and the third of them - the literal guard - could
 * be forgotten while the first two were not, which is how a build ends up able to *describe* a world
 * it cannot *run*.
 *
 * Four facts per world, and each answers a question the command layer would otherwise have to hard
 * code:
 *
 *   - `kind`     — the `adapter` value a document states. The registration key.
 *   - `summary`  — what the world is, for a refusal that names the alternatives rather than the
 *                  absence of one.
 *   - `requires` — fields a document naming this world must state, asked as clarification gaps
 *                  before the run rather than discovered by the adapter mid-run. This is the one
 *                  field that could not live in `core/`: the core must not know any adapter's private
 *                  shape (§35 of `PLAN.md`), and `local-web` needs a `url` while `local-db` needs a
 *                  `databasePath`.
 *   - `build`    — the constructor, so the command layer never names an adapter class.
 *
 * `registeredAdapters()` derives the name list from this table rather than the table being kept in
 * step with a hand-written list beside it. A name declared twice will disagree with itself the first
 * time one copy is edited.
 */

import { LocalWebEnvironment } from "../adapters/local-web/index.ts";
import type { BrowserPort } from "../adapters/local-web/index.ts";
import { LocalDbEnvironment } from "../adapters/local-db/index.ts";
import { SimK8sEnvironment } from "../adapters/sim-k8s/index.ts";
import type { AdapterDescriptor, AdapterRequirement } from "../core/clarification/detect.ts";
import type { Logger } from "../core/clarification/types.ts";
import type { EnvironmentAdapter, EnvironmentPlan } from "../core/environment/index.ts";
import type { IoPort } from "../core/io.ts";
import type { ProcessRunner } from "../core/process.ts";

import { systemClock } from "./support.ts";

/** Everything a world needs to be built, passed once so a builder takes no other argument. */
export interface WorldContext {
  /** The plan, after every run-time choice (the browser flag among them) has been applied to it. */
  readonly environment: EnvironmentPlan;
  readonly io: IoPort;
  readonly logger: Logger;
  readonly processes: ProcessRunner;
  readonly stateDir: string;
  /**
   * The browser this run may drive, or `null` when the plan asked for none.
   *
   * A world that has no browser ignores it; a world that needs one is refused before it is built,
   * because `applyBrowserChoice` is what decides this and it runs before the adapter is chosen.
   */
  readonly browser: BrowserPort | null;
}

export interface World {
  readonly kind: string;
  readonly summary: string;
  readonly requires: readonly AdapterRequirement[];
  build(context: WorldContext): EnvironmentAdapter;
}

const WORLDS: readonly World[] = [
  {
    kind: "local-web",
    summary: "a local application started as a process and observed in a browser",
    // Nothing declared, and that is not an oversight: `/url` and `/start` are asked by the detector
    // directly, because they are fields every non-file-backed world needs rather than one adapter's
    // private shape. Declaring `url` here too would raise two blocking gaps at one pointer, and the
    // operator would be asked the same question twice with no way to tell the two apart.
    requires: [],
    build: ({ environment, io, logger, processes, stateDir, browser }) =>
      new LocalWebEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
        browser,
      }),
  },
  {
    kind: "local-db",
    summary: "a database file built by a script and read directly, with no application process and no page",
    requires: [
      {
        field: "databasePath",
        question: "Which database file should this world open?",
        why:
          "A file-backed world is the file it opens. There is no default, because inventing a path " +
          "would select a database rather than the one the run is meant to judge - and an empty one " +
          "would be created by the very act of opening it.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new LocalDbEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "sim-k8s",
    summary: "a simulated cluster the application deploys itself into, with no cluster software installed",
    // Three fields rather than one, and the split is the point: a namespace is what every reading is
    // scoped to, and an images directory is the registry the substitution reads. A world that
    // defaulted the namespace would silently judge a *different* namespace's objects when the
    // operator's manifest named one, and a world that guessed the registry would report every image
    // as absent for a reason that is not the application's fault.
    requires: [
      {
        field: "cluster.name",
        question: "What should this cluster be called?",
        why:
          "Every reading records the cluster it came from, so a substituted cluster has a name for " +
          "the same reason a real one does - and the name is what lets a reader of two bundles tell " +
          "which cluster each was judged in. There is no default: `sim-k8s` saying nothing is not a " +
          "declaration that it stood in for an unnamed cluster.",
      },
      {
        field: "cluster.namespace",
        question: "Which namespace does this run act in?",
        why:
          "A cluster is namespaced, so every reading, every apply and every criterion target is " +
          "resolved against one. Defaulting to `default` would judge whichever objects happen to sit " +
          "there instead of the ones the contract named, and the failure would look like a missing " +
          "deployment rather than a missing declaration.",
      },
      {
        field: "cluster.images",
        question: "Which directory holds the images the application's build produced?",
        why:
          "This world substitutes the container runtime and the registry, and what it substitutes " +
          "them *with* is the application's own build output. It names a directory rather than a " +
          "list because a list would be a second source of truth about what was built - and the " +
          "interesting failure, a manifest naming a tag nothing produced, would become a knob " +
          "instead of a disagreement between two artifacts the run really made.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimK8sEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
];

/** Every registered adapter kind, in registration order. Derived, never hand-listed. */
export function registeredAdapters(): readonly string[] {
  return WORLDS.map((world) => world.kind);
}

/** The same table in the shape the clarification ladder reads. */
export function adapterDescriptors(): readonly AdapterDescriptor[] {
  return WORLDS.map((world) => ({ kind: world.kind, requires: world.requires }));
}

/** The world registered under a kind, or `null`. Callers report the absence; nothing guesses. */
export function findWorld(kind: string): World | null {
  return WORLDS.find((world) => world.kind === kind) ?? null;
}

/** `local-web (a local application ...)`, one per line, for a refusal that names the alternatives. */
export function describeWorlds(): string {
  return WORLDS.map((world) => `  ${world.kind.padEnd(12)} ${world.summary}`).join("\n");
}
