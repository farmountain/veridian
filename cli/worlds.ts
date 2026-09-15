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
import { LocalApiEnvironment } from "../adapters/local-api/index.ts";
import { LocalProcessEnvironment } from "../adapters/local-process/index.ts";
import { LocalDbEnvironment } from "../adapters/local-db/index.ts";
import { SimK8sEnvironment } from "../adapters/sim-k8s/index.ts";
import { SimCloudEnvironment } from "../adapters/sim-cloud/index.ts";
import { SimContainerEnvironment } from "../adapters/sim-container/index.ts";
import { SimDataEnvironment } from "../adapters/sim-data/index.ts";
import { SimOsEnvironment } from "../adapters/sim-os/index.ts";
import { SimPosixEnvironment } from "../adapters/sim-posix/index.ts";
import { SimVSCodeEnvironment } from "../adapters/sim-vscode/index.ts";
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
  {
    kind: "sim-vscode",
    summary:
      "a simulated editor host an extension is installed into and activated by, with no editor and no extension host behind it",
    // Three fields, and the third is why this world is a *kind of subject* rather than a directory the
    // application writes into. A host name is what every reading names - a criterion asserting the
    // engine it was judged against is asserting a declared fact, and a world that invented one would
    // make every such criterion unfalsifiable. An `apiVersion` is the number an extension's own
    // `engines.vscode` floor is compared against, which is the one *decision* this world makes rather
    // than records: a real host refuses to load an extension whose floor does not admit it, and this
    // repository has already paid for a quiet version of that defect once (the Cockpit declared a floor
    // six minor releases below the first host that could load its entry point, so it installed cleanly
    // and never started). And a `root` is a **sandbox** directory rather than the application's own:
    // the world is rebuilt on every reset, so pointing it at the extension's source would delete the
    // code under test on the first iteration.
    //
    // Asked as three pointers rather than as one `vscode` object for the reason `sim-container` records
    // here and `sim-k8s` paid for: the ladder resolves a requirement against a *place*, so a single
    // `vscode` field would report the whole block missing however much of it the document already
    // stated, and the operator's answer would be written over the fields they had already written
    // correctly.
    //
    // `activationEvent` is deliberately *not* required. Its absence is a third answer - the manifest
    // decides - and the reading records which event was really fired, so a criterion asserting one
    // asserts something the world observed rather than something the plan assumed. Asking for it would
    // turn "let the extension declare itself" into a question the operator has to answer.
    requires: [
      {
        field: "vscode.host",
        question: "Which editor host is this world standing in for?",
        why:
          "Every reading records it, and the identity is what makes a run bundle traceable to a named " +
          "substitute rather than to unexamined reality. There is no default: this adapter substitutes " +
          "an editor host, and a substituted host that will not say which one it stands in for cannot " +
          "be judged against anything.",
      },
      {
        field: "vscode.apiVersion",
        question: "Which editor API version should this world answer as?",
        why:
          "It is the number an extension's `engines.vscode` floor is compared against, and that " +
          "comparison decides whether the extension is loaded at all. A plan that defaulted it would " +
          "silently admit or refuse a manifest against a host nobody chose, and the failure mode is " +
          "the quiet one: the extension is present, nothing errors, and it never activates.",
      },
      {
        field: "vscode.root",
        question: "Where should this world keep the installed extensions, its host and the extension's own state?",
        why:
          "This is the sandbox the world builds and rebuilds, and it is a *different* directory from " +
          "the application's own source - which the adapter states in so many words, because a program " +
          "that installs its extension out of the wrong one would have every criterion report the " +
          "extension absent for a reason that is not the extension's fault. There is no default: a " +
          "sandbox that drifted from the directory the adapter installs into would make every reading " +
          "describe a host the criteria never acted on.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimVSCodeEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "sim-data",
    summary:
      "a simulated message broker the application publishes to and consumes from, with no broker software behind it",
    // Two fields, and they are one declaration rather than two conveniences: the adapter refuses a
    // plan with no `data` block outright, because this world's subject *is* the broker. A cluster is
    // a name for the world every reading is scoped to, and a node id is the identity the broker
    // announces and the one the application is handed through `VERIDIAN_DATA_NODE_ID` - so a run
    // without either records evidence about a broker nothing names, and a *second* node id would be a
    // second identity for a world that has exactly one.
    //
    // `host` and `port` are deliberately absent even though the adapter reads them, and they are the
    // one pair in this table that is derivable rather than declared: `schemas/environment.schema.json`
    // gives `host` a default of `127.0.0.1` and `port` a default of `0`, and `0` is the request that
    // the operating system choose the listener, which is what a substitute wants. Declaring them here
    // would make the operator answer a question the document can already answer, and a requirement is
    // a question the operator is *forced* to answer, not a field that may be absent.
    //
    // Asked as two pointers rather than as one `data` object for the reason every world after
    // `sim-k8s` records here: the ladder resolves a requirement against a *place*, so a single `data`
    // field would report the whole block missing however much of it the document already stated.
    //
    // This world *does* declare a `*_SIMULATED_SURFACES` constant (`DATA_SIMULATED_SURFACES`), and it
    // is the one place in this file where a socket world and a no-HTTP world are the same world: the
    // broker is reached over a real TCP listener this machine can open, and it speaks a binary
    // protocol rather than HTTP, so it is asked for no url and no health path. That is why the
    // detector's `hasNoHttp` carries a `data` clause - the predicate asks about the *surface*, not
    // about the transport.
    requires: [
      {
        field: "data.cluster",
        question: "What should this broker's cluster be called?",
        why:
          "Every reading records the cluster it came from and the broker announces it in its own " +
          "handshake, so a criterion of the form \"this is the log we certified\" is a claim about a " +
          "named cluster rather than about brokers in general. There is no default: `sim-data` saying " +
          "nothing is not a declaration that it stood in for an unnamed broker, and the name is what " +
          "lets a reader of two bundles tell which one each run was judged in.",
      },
      {
        field: "data.nodeId",
        question: "Which node identity does this broker announce?",
        why:
          "It is the identity the substitute answers handshakes with and the one the application is " +
          "handed, so it is what decides whether a program connected to *this* world or to something " +
          "else on that port. Defaulting it would put a node into the evidence that nobody chose, and " +
          "the failure it would hide is the interesting one: a program that reached a broker other " +
          "than the one the criteria were written about.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new SimDataEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "local-api",
    summary:
      "a local HTTP application asked its own routes directly, with no browser and no page",
    // One field, and it is the whole reason this world is a *kind of subject* rather than a place to
    // keep files. A service name is what every reading names, and it is what distinguishes two
    // readings of the same server: a criterion asserting which service answered is asserting a
    // declared fact, and a world that inferred the name from a port number would make every such
    // criterion unfalsifiable. It is also the field that makes this world's refusal honest - the
    // adapter compares the plan's service against the one the application announced, and a plan that
    // defaulted it could not tell "the wrong server answered" from "the right one did" (see
    // `local-api-environment.ts`, which names both in the defect it raises).
    //
    // Asked as a pointer rather than as one `api` object for the reason every world after `sim-k8s`
    // records here: the ladder resolves a requirement against a *place*, so a single `api` field
    // would report the whole block missing however much of it the document already stated.
    //
    // `url` and `start` are deliberately absent, and that is not an oversight - they are asked by the
    // detector directly, because they are fields every socket world needs rather than one adapter's
    // private shape (`local-web` records the same reasoning). Declaring `url` here too would raise two
    // blocking gaps at one pointer and the operator would be asked the same question twice with no way
    // to tell the two apart.
    //
    // There is no `*_SIMULATED_SURFACES` constant for this world and none is wanted: the server is a
    // real process answering real requests over loopback. The application is judged against itself,
    // not against a substitute, which is why this entry sits beside `local-web` and `local-db` rather
    // than beside the six `sim-*` worlds.
    requires: [
      {
        field: "api.service",
        question: "Which service is the application this world judges?",
        why:
          "Every reading of this world names it, and the adapter checks the name the application " +
          "announces against the name the plan states - so an answer is what makes 'a different " +
          "server answered on that port' a detectable failure rather than a silent one. There is no " +
          "default: a plan that invented a service name could neither confirm nor deny that the " +
          "process it started is the one the criteria were written about.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new LocalApiEnvironment(environment, {
        io,
        clock: systemClock,
        logger,
        processes,
        stateDir,
      }),
  },
  {
    kind: "local-process",
    summary:
      "a local program run as a real child process, judged on its exit code, its two streams and the files it wrote",
    // Two fields, and both are the world rather than a convenience. A host is what every reading
    // names, for the reason `local-api` records one: a criterion asserting *which* world answered is
    // asserting a declared fact, and a world that inferred the name from a pid would make every such
    // criterion unfalsifiable. A root is the directory every path a criterion names is resolved
    // inside - so a defaulted root would judge the contract against whichever directory the runner
    // happened to start in, which is exactly how a suite passes from the wrong folder.
    //
    // `application` is deliberately absent from this list even though the adapter reads it. It is the
    // optional half of the world: a contract that provisions a tree with its own `run` steps needs no
    // long-lived program, so requiring it would make the simplest shape of this world unwritable - and
    // a requirement is a question the operator is forced to answer, not a field that may be null.
    //
    // Asked as pointers rather than as one `process` object for the reason every world after `sim-k8s`
    // records here: the ladder resolves a requirement against a *place*, so a single `process` field
    // would report the whole block missing however much of it the document already stated.
    //
    // There is no `*_SIMULATED_SURFACES` constant for this world and none is wanted. The child
    // process is a real process, the files are files on this machine, and the exit code is the one the
    // kernel reported - nothing is stood in. That is why this entry sits beside `local-web`,
    // `local-db` and `local-api` rather than beside the six `sim-*` worlds, and why the readings it
    // produces carry no `simulated` field at all.
    requires: [
      {
        field: "process.host",
        question: "What should this world be called?",
        why:
          "Every reading of this world records the host it came from, and the name is the thing a " +
          "criterion can assert so that a run which silently judged a different world is a detectable " +
          "failure rather than a silent one. There is no default: a world that invented a name could " +
          "neither confirm nor deny that the process it started is the one the criteria were written " +
          "about.",
      },
      {
        field: "process.root",
        question: "Which directory do this world's files live in?",
        why:
          "Every path a criterion names is resolved inside it, so this is the answer that decides " +
          "what `out/report.txt` means - and a defaulted root would resolve the contract against the " +
          "directory the runner happened to be started in. It is stated relative to the world's own " +
          "application directory, the way `databasePath` is, so a bundle quotes a path a reader can " +
          "take back to the document it came from.",
      },
    ],
    build: ({ environment, io, logger, processes, stateDir }) =>
      new LocalProcessEnvironment(environment, {
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
