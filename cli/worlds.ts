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
import { SimCloudEnvironment } from "../adapters/sim-cloud/index.ts";
import { SimContainerEnvironment } from "../adapters/sim-container/index.ts";
import { SimOsEnvironment } from "../adapters/sim-os/index.ts";
import { SimPosixEnvironment } from "../adapters/sim-posix/index.ts";
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
  {
    kind: "sim-posix",
    summary: "a simulated POSIX-like system the application provisions itself, with no container and no VM",
    // Three fields, and each is a fact that decides what a reading *means* rather than a convenience.
    // A permission is judged against an account, so a world that defaulted the account would produce
    // a verdict about nobody; a distribution is what "this is the image we hardened" is a claim
    // about; and a sandbox root that drifted from the directory the adapter wrote to would make every
    // reading about a different tree than the one the criteria acted on. The *sandbox directory* is
    // not asked for, because `sim-posix` builds it - it is a declared place, not an input.
    requires: [
      {
        field: "posix.distribution",
        question: "Which system is this world standing in for?",
        why:
          "Every reading records the distribution, because a criterion of the form \"this is the " +
          "image we hardened\" is a claim about a named system and not about systems in general. " +
          "There is no default: this adapter substitutes a POSIX-like system, and a substituted " +
          "system that will not say which one cannot be judged against anything.",
      },
      {
        field: "posix.user",
        question: "Which account do the criteria act as?",
        why:
          "A file's permissions decide whether the account running the criterion can read it, so the " +
          "substituted world keeps an inode's owner and mode and answers `open(2)` the way the real " +
          "call would. Without a named account there is no \"as whom\", and a hardening contract " +
          "judged as nobody is not a hardening contract. `root` is refused rather than defaulted, " +
          "because root reads every file and would pass a contract no ordinary user can satisfy.",
      },
      {
        field: "posix.root",
        question: "Where should the sandbox tree live?",
        why:
          "This is the host path the machine opens the world from, and it is resolved against the " +
          "application directory the way every other path in this document is. There is no default: " +
          "a sandbox root that drifted from the directory the adapter wrote to would make every " +
          "reading describe a different tree than the one the criteria acted on, and the failure " +
          "would look like a missing file rather than a misdescribed world.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimPosixEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "sim-os",
    summary:
      "a simulated Windows or macOS system the application provisions itself, with no VM and no guest",
    // Four fields, and the fourth is what makes this world different from `sim-posix` rather than a
    // second copy of it. A *family* is not a label on a reading: it decides whether a path separates
    // with a backslash, whether the configuration store is a registry hive or a preference domain, and
    // how an access decision is reached at all - so it is the one field this world cannot derive.
    // A *release* is what "this is the build we certified" is a claim about, and there is no default
    // for it for the same reason there is none for a distribution. The *account* is what every access
    // question is decided as, and `sim-os` refuses a privileged account for exactly the reason
    // `sim-posix` refuses `root`: `SYSTEM` and `wheel` hold every permission, so a hardening contract
    // judged as one of them reports a pass for a machine no ordinary account can log into. And the
    // *root* is the host path the machine opens the world from; a root that drifted from the directory
    // the adapter wrote to would make every reading describe a different tree than the one the criteria
    // acted on.
    requires: [
      {
        field: "os.family",
        question: "Which family is this world standing in for?",
        why:
          "The family decides how a path is spelled, how the configuration store is addressed, and " +
          "whether the world folds the case of a path - so a plan that defaulted it would resolve " +
          "every criterion's target by the wrong rules and report the operator's own spelling as a " +
          "refusal. There is no third answer: this world stands in for Windows or for macOS, and a " +
          "substituted system that will not say which one cannot be judged against anything.",
      },
      {
        field: "os.system",
        question: "Which release is this world standing in for?",
        why:
          "Every reading records it, because a criterion of the form \"this is the build we certified\" " +
          "is a claim about a named release and not about a family in general - and the two families " +
          "differ between their own releases in ways a contract can care about. Defaulting it would " +
          "put a version into the evidence that nobody chose.",
      },
      {
        field: "os.user",
        question: "Which account do the criteria act as?",
        why:
          "A file's access control list decides whether the account running the criterion may read it, " +
          "so the substituted world keeps its own security record and answers the access question the " +
          "way the system would. Without a named account there is no \"as whom\". A privileged account " +
          "- `SYSTEM`, `Administrator`, `root` or `wheel` - is refused rather than defaulted, because " +
          "it holds every permission and would pass a contract no ordinary account can satisfy.",
      },
      {
        field: "os.root",
        question: "Where should the system's sandbox tree live?",
        why:
          "This is the host path the machine opens the world from, and it is resolved against the " +
          "application directory the way every other path in this document is. There is no default: " +
          "a sandbox root that drifted from the directory the adapter wrote to would make every " +
          "reading describe a different tree than the one the criteria acted on, and the failure " +
          "would look like a missing file rather than a misdescribed world.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimOsEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "sim-cloud",
    summary:
      "a simulated provider account the application provisions itself, with no credentials and no cloud",
    // Four fields, and they are one declaration rather than four conveniences: the adapter refuses a
    // plan with no `cloud` block outright, because this world's subject *is* the account, and a
    // substituted account that will not say whose it is cannot be judged against anything. The
    // *principal* is the one that decides a verdict rather than a reading - every access question is
    // decided as it, so a privileged principal is refused for exactly the reason `sim-posix` refuses
    // `root` and `sim-os` refuses `SYSTEM`: it holds every permission, and an access contract judged
    // as one reports a pass for an account no ordinary caller has.
    //
    // Asked as four pointers rather than as one `cloud` object because the ladder resolves a
    // requirement against a *place*: a single `cloud` field would report the whole block missing
    // however much of it the document already stated, and the operator's answer would be written over
    // the fields they had already written correctly.
    requires: [
      {
        field: "cloud.provider",
        question: "Which provider is this world standing in for?",
        why:
          "Every reading records it and the provisioner's own output is written in its terms, because " +
          "a criterion of the form \"this is the deployment we certified\" is a claim about a named " +
          "provider and not about providers in general. There is no default: this adapter substitutes " +
          "a provider account, and a substituted account that will not say which provider it is " +
          "stands in for cannot be judged against anything.",
      },
      {
        field: "cloud.region",
        question: "Which region is this account in?",
        why:
          "A bucket is created in a region and a reading carries it, so a region is where the " +
          "application's own provisioning commands land rather than a label on the run. Defaulting it " +
          "would put a location into the evidence that nobody chose, and would silently accept a " +
          "program that provisioned somewhere the operator did not ask for.",
      },
      {
        field: "cloud.account",
        question: "What is this account called?",
        why:
          "It is the identity every reading is scoped to and the name the adapter's environment id is " +
          "built from, so a run without one records evidence about an account nothing names. There is " +
          "no default for the same reason there is none for a cluster name: `sim-cloud` saying " +
          "nothing is not a declaration that it stood in for an anonymous account.",
      },
      {
        field: "cloud.principal",
        question: "Which principal do the criteria act as?",
        why:
          "Every access decision is decided as this principal, which is what makes an authority " +
          "criterion a question about a named caller rather than about authority in general. A " +
          "privileged principal - `root`, `account-root`, `owner`, `administrator` or `admin` - is " +
          "refused by the loader rather than defaulted, because it holds every permission and would " +
          "pass an access contract no ordinary caller can satisfy.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimCloudEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "sim-container",
    summary:
      "a simulated container runtime the application provisions itself, with no engine and no image store behind it",
    // Three fields, and the third is what makes this world a different *kind* of subject rather than a
    // second copy of `sim-posix`. A runtime name is what every reading is scoped to and what the
    // adapter's environment id is built from - `docker` and `podman` are different worlds to a contract
    // that names one, and this world will not answer to a name nobody chose. A *platform* is not a
    // label on a reading: it decides how a path inside a container is spelled and whether a binary in
    // an image could ever execute, so the loader refuses a platform this substitution does not
    // implement by name rather than adapting to it. And a *root* is the host path the machine opens
    // the world from - the one fact that lets the adapter tell a bind mount's host source from its
    // in-container destination, which is the two-filesystems problem this world exists to make
    // explicit. The sandbox is not asked for: it is a declared place this world builds, not an input.
    //
    // Asked as three pointers rather than as one `container` object because the ladder resolves a
    // requirement against a *place*: a single `container` field would report the whole block missing
    // however much of it the document already stated, and the operator's answer would be written over
    // the fields they had already written correctly.
    requires: [
      {
        field: "container.runtime",
        question: "Which container runtime is this world standing in for?",
        why:
          "Every reading records it and the provisioning program is told it, because a criterion of " +
          "the form \"this is the image we shipped\" is a claim about a named runtime and not about " +
          "runtimes in general. There is no default: this adapter substitutes a runtime, and a " +
          "substituted runtime that will not say which one it stands in for cannot be judged against " +
          "anything.",
      },
      {
        field: "container.platform",
        question: "Which platform should this world build containers for?",
        why:
          "The platform decides how a path inside a container is spelled, so a plan that defaulted it " +
          "would resolve every criterion's container-side target by the wrong grammar and report a " +
          "correct path as absent. A platform this substitution does not implement is refused by the " +
          "loader, by name, before a world exists - because the alternative is a run whose every " +
          "reading describes a container nobody described.",
      },
      {
        field: "container.root",
        question: "Where should this world keep its images and containers?",
        why:
          "This is the host path the machine opens the world from, and it is also the second of the " +
          "two places a host path in a command may name - the first being the application's own " +
          "directory. There is no default: a sandbox root that drifted from the directory the adapter " +
          "wrote to would make every build context and every bind mount resolve against a different " +
          "tree than the one the criteria acted on, and the failure would look like a missing " +
          "directory rather than a misdescribed world.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimContainerEnvironment(environment, {
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
