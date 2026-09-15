# AGENTS.md

Agent instructions for the **Veridian** repository. This is the single always-on
instructions file for this workspace — do not add a second one
(`.github/copilot-instructions.md`) alongside it.

> **Status: the MVP is implemented and green, and nine more sandbox worlds have landed.** Core, the
> `local-web` adapter, the Playwright validators, the CLI, the schemas and the canonical demo all exist.
> `local-db` - a second adapter and a second validator family, against a SQLite file with no browser -
> exists beside them, and is the proof that `EnvironmentAdapter` is a seam. `sim-k8s` is the third, and
> the first **simulated** world: a real application process really deploying itself into a substitute
> control plane over routes it really calls, with scheduler, kubelet, etcd and admission standing in.
> `sim-posix` is the fourth and the second simulated one, and it attacks a different axis: a real
> application process really provisioning a substitute Linux system through commands it really issues,
> judged as a **named account** rather than as root, with no virtual machine and no guest kernel
> anywhere in the loop. `sim-os` is the fifth and the third simulated one: the same shape one family
> out, with a substitute holding machine accounts, ACLs, registry store entries, services and ports,
> judged as `svc-audit` rather than as `SYSTEM`, and with no guest and no image anywhere in the loop.
> `sim-cloud` is the sixth and the fourth simulated one, and its subject is a **remote provider
> account**: a real HTTP server speaking a provider's own routes over loopback, holding buckets,
> objects, queues, secrets and principals and deciding every permission question with the account's
> own evaluator, judged as `svc-cart` rather than as an account root, with no cloud account, no
> session, no provider API and no outbound socket anywhere in the loop. It is one of three worlds that
> perform a `call` step, so a criterion can put its own request to the account rather than infer the
> account's answer from the application's traffic - `local-api` does it for every criterion, and
> `sim-data` for the ones that ask the broker a question of its own.
> `sim-container` is the seventh and the fifth simulated one, and its subject is a **container
> runtime**: a real application process really provisioning images and containers through commands it
> really issues, answered in process by a store of image and container records beside a register of
> runtime commands, judged on the tags, labels, digests, mounts, published ports, limits, healthchecks
> and captured output that store holds, with no Docker, no daemon, no image, no namespace and no cgroup
> anywhere in the loop. It is the world that states its own limits rather than hiding them: limits are
> declared and never enforced, an account is recorded and never switched to, and a published port is
> `exposed` and never `reachable`.
> `sim-vscode` is the eighth and the sixth simulated one, and its subject is an **extension host**:
> a real extension is loaded by a real Node process through a module this world resolves in place of
> `vscode`, and every action that needs the extension running starts a fresh host process - so an
> activation count is a count of host processes - while a generated substitute records contributions,
> commands, invocations, settings, status items, output channels, messages, subscriptions and the
> calls it refuses. Judged on those records, with no editor, no window and no installed VS Code
> anywhere in the loop. Its only evidence kind is `json`, and `snapshot-restore` is refused by name.
> `local-api` is the ninth and the first that is **not simulated at all**: a real service is started
> as a real child process and judged through its own HTTP interface over loopback, with nothing
> rendered and nothing stood in - so its reading carries no `simulated` field and its contract, rather
> than the application's own traffic, is what makes the requests. It reuses the `call` step the sixth
> world introduced, which is why a world with no new capability still needed no core change.
> `local-process` is the tenth and the second that is **not simulated at all**, and it attacks a
> subject with no socket in it: a real program is started as a real child process and judged on the
> text it printed on stdout and stderr, the code it exited with, a probe of whether it is still up and
> the files it really wrote under a real directory. So its reading carries no `simulated` field either,
> and - unlike every `sim-*` world - it has no `*_SIMULATED_SURFACES` constant and none is wanted,
> because nothing is stood in. It adds no step kind: a contract that provisions a tree does so with
> the `run` steps the second world introduced. Its family is the only one asked two different kinds of
> question, so it carries two target grammars - `app` or a bare 1-based position names a command, and
> a world-relative path names a file - and a path that leaves the root is **refused and recorded as a
> boundary crossing** rather than resolved, because opening the developer's own filesystem while
> calling it the sandbox's is the one thing this world must not do. Its family was the first asked two
> different kinds of question, and the eleventh world's family is the second - which is why neither
> claim is written as "the only one" any more.
> `sim-data` is the eleventh and the seventh **simulated** one, and its subject is not a document a
> world holds but a **request an application made**: the application really opens a TCP socket on
> loopback and really writes a broker protocol into it - length-prefixed frames, a CRC32C over each
> body, a version negotiated through `ApiVersions` before anything else is sent - and the substitution
> and the transport sit deliberately on opposite sides of that line, because `wire.ts` decodes and
> bounds-checks those bytes for real. No broker process, no replica follower, no on-disk log, no group
> coordinator, no rebalancer and no outbound socket. Its three limits are stated rather than hidden:
> replication is recorded and never performed, a group is joined once and never rebalanced, and a
> cleanup policy is a value the broker records and never applies. Its only evidence kind is `json`,
> written twice per criterion when there was traffic. Its family carries the same `call`/`probe` pair
> the sixth world's does, and the pair means the same inverted thing there: `data.call` reads the
> requests the **application** put to the broker, `data.probe` the ones the **criterion** itself
> issued, so a criterion's own request cannot be mistaken for evidence about the application.
> `npx tsc --noEmit` is silent and `node --test` reports 2190 passing tests -
> Veridian's own 2118 plus the 72 the VS Code Cockpit contributes, which the root runner discovers
> because it walks the tree. Five distribution routes ship - a clone, an npm package, the Cockpit (as
> a development install and as a `.vsix`), the extension marketplaces that `.vsix` is published to,
> and a container image - and there is still **no
> build step between the source tree and the running program**: Node 22 strips types and runs `.ts`
> straight from the source. `npm run build` exists only to produce the *compiled* copy an installed
> package needs, because Node refuses type-stripping under `node_modules`, and the Cockpit has its own
> `npm run build` and `npm run package` for the third runtime, because the extension host is not
> Node's loader either. Read [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) for what was
> built and [`docs/PLAN.md`](./docs/PLAN.md) for why.

## Project

- **Name:** Veridian. **Formerly AVF — "Agent Validation Fabric"** (renamed). The plan in
  `docs/PLAN.md` was written under the old name and still says "AVF" in places; read AVF as
  Veridian. Likewise the plan's `.avf/` persistence directory is now `.veridian/`.
- **Purpose:** Veridian is the **sandbox testing and validation layer for AI coding agents**.
  Coding agents are good at producing code but have an *environmental* problem: they cannot
  tell whether their code actually works. Veridian gives a **purely external** agent a real,
  isolated, reproducible world in which its generated software can be deployed, executed,
  interacted with, observed, validated against explicit acceptance criteria, reset, rerun, and
  accompanied by machine-verifiable evidence.
- **Stack:** **TypeScript / Node.js** for both Veridian Core and the VS Code extension
  (rationale: VS Code + Playwright + local process management all sit naturally in the Node
  ecosystem, so a single language avoids cross-language complexity). **Playwright** is the web
  observation/validation adapter. Persistence is **filesystem-first**: JSON Schema, YAML, JSONL,
  and SQLite or plain files. Explicitly excluded from core tooling: Kafka, PostgreSQL,
  Kubernetes, Redis, microservices.
- **Runtime version file:** [`.nvmrc`](./.nvmrc) pins Node 22, and `package.json` declares
  `engines.node >= 22.18.0`. The floor is real rather than courtesy: Veridian runs `.ts` directly,
  which needs native type-stripping.

## Governing principles

Two rules govern every design decision. If a proposal violates either, it is wrong.

1. > **The environment is the product. The agent is a client of the product.**
2. > **Do not build the intelligence that creates the software. Build the world that determines
   > whether the software actually works.**

The second has a direct consequence for the agent boundary:

- **Veridian owns:** environment, execution, observation, validation, evidence, reset, iteration state.
- **The external agent owns:** reasoning, code modification, repair strategy, implementation.

Veridian never reasons about *how* to write the code. It decides *whether the code works*.

## Hard scope boundary

Veridian **must not become** any of these. It *may integrate with* all of them; it must not
*compete with* them.

```
AI coding agent                              generic test framework
agent orchestration framework                browser automation framework
autonomous software development platform     Kubernetes management platform
replacement for Claude Code / Cursor /       cloud deployment platform
  Copilot / Codex / Gemini                   LLM framework
CI/CD platform
```

Concrete rejections that follow from this, and that reviewers should enforce:

- **Do not write our own browser automation.** Playwright is the adapter.
- **Do not make MCP the foundation.** MCP is an *interface to* Veridian, not Veridian.
  *"MCP is the door. Veridian is the building."*
- **Do not make VS Code the architecture.** *"VS Code ≠ Veridian."* The extension is the
  **Veridian Cockpit** — a thin client over a stable local Core interface, so that CLI, CI, and
  MCP can drive the same engine later.
- **Do not build a goal compiler, plugin marketplace, SaaS backend, or multi-agent framework.**
- **Do not put Postgres/Kafka/Redis/Kubernetes in the MVP.** The MVP runs on a local machine.

## Core invariants

- **The agent does not decide whether it succeeded.** `Agent = Actor`, `Veridian Environment =
  World`, `Validator = Judge`, `Evidence = Proof`. An agent saying "I believe this is fixed" is
  not a result.
- **`INCONCLUSIVE` is not `PASS`.** Never collapse a non-decisive status into success.
- **A run is `PASS` only if** ALL mandatory criteria pass **AND** the environment was valid
  **AND** there was no safety violation **AND** all required evidence exists.
- **Never report every failure as "test failed."** Classify using the failure taxonomy:
  `TEST_FAILURE, ENVIRONMENT_FAILURE, VALIDATOR_ERROR, APPLICATION_ERROR, TIMEOUT,
  SECURITY_VIOLATION, INFRASTRUCTURE_FAILURE, RESET_FAILURE, UNKNOWN`.
- **Reset is first-class.** A validator must never inherit contaminated state from a previous
  run. Reset is part of the product, not test cleanup.
- **Reproducibility is recorded, not assumed.** Every run captures git commit, app version,
  runtime/browser/Playwright versions, OS, env config, test data, seed, network policy,
  dependency versions, and timestamp.
- **Evidence is not optional decoration.** It is part of the validation result.

### Universal lifecycle

Every environment — no matter how exotic — exposes the same lifecycle semantics:

```
DEFINE → CREATE → START → DEPLOY → EXECUTE → OBSERVE → VALIDATE
       → COLLECT EVIDENCE → PASS/FAIL → RESET → REPEAT
```

```
EnvironmentAdapter:  create() start() deploy() execute() observe()
                     snapshot() restore() reset() stop() destroy()

Validator:           validate(criterion, observation) → ValidationResult

ValidationResult:    criterion_id, status, actual, expected, timestamp,
                     evidence, environment_id, run_id
                     status ∈ { PASS, FAIL, ERROR, SKIPPED, INCONCLUSIVE }
```

### Run state machine

```
CREATED → PREPARING → READY → EXECUTING → OBSERVING → VALIDATING
                                   PASS → COMPLETED
                                   FAIL → FAILED → RESETTING → READY
```

Terminal states: `COMPLETED, ABORTED, ERROR, MAX_ITERATIONS`. No ambiguous execution paths.

### Safety boundaries

Every execution has a maximum runtime, maximum iterations (`10` for MVP), resource cap, and
network / filesystem / process boundaries. **No infinite agent loop.** Veridian executes
potentially untrusted AI-generated code, so the adapter architecture must leave room for
stronger isolation later even though the MVP runs in a local trusted development mode.

## MVP scope — Web Sandbox Validation Environment only

**In:**

```
VS Code  +  Veridian Core  +  Local application  +  Browser
  +  Playwright  +  deterministic acceptance criteria  +  evidence  +  reset/replay
```

**Out (future adapters — do not start on these):**

```
Kubernetes   cloud        mobile farm        Windows/macOS VM
distributed execution     data lake / Hadoop / Spark / Kafka
multi-agent orchestration VM orchestration   desktop automation
SaaS backend              LLM training       sophisticated goal compiler
marketplace               plugin ecosystem   Chrome extension
```

**MVP success metrics** (not LOC, not adapter count): M1 ≥ 99% result consistency on repeat
runs · M2 100% of canonical demo defects detected · **M3 zero false PASS** · M4 100% reset
reproducibility · M5 100% evidence completeness.

**Canonical demo:** a Shopping Cart app with 3 deliberate defects and 4 acceptance criteria,
iterating FAIL → agent repair → PARTIAL → repair → PASS. That is the "aha" moment: *the agent
generated code that was proven to work in a real sandbox.*

## Working agreements

- **Verify before claiming.** A change is done only when its gate (typecheck / lint / test)
  has actually run and passed in the terminal. Report the command output, not an intention.
- **Never guess a command.** If no manifest (`package.json`, `pyproject.toml`, `Cargo.toml`)
  exists, ask or leave a `TODO` — do not fabricate an install/build/test command.
- **Keep changes surgical.** Add structure only when a concrete requirement demands it. No
  speculative abstractions, no "while I'm here" refactors, no building an adapter the MVP
  explicitly excludes.
- **Update this file** whenever you establish a convention future agents must follow
  (build commands, layout decision, gotcha). This file is the hand-off to the next session.

## Memory: HipCortex (required)

This project uses HipCortex as durable cross-session memory. Actor name: `Veridian`.
Server: `http://127.0.0.1:3030` (override with `HIPCORTEX_URL`).

- **Read before answering** anything about project state, architecture, decisions, or bugs.
  Query the substrate first (`search_memory` / `get_live_beliefs`) instead of relying on the
  current context window alone.
- **Write after** every decision, architectural choice, bug fix, reversal, or dead end.
- Prefer `/memory/ingest` (auto-classification) over hand-built records.
- Environment observations must go through the intent/receipt path
  (`open_intent` → `accept_receipt`), never `add_memory`.
- If the server is unreachable, run `hipcortex start`, or say memory is unavailable — never
  silently skip the write.

Full protocol: [`.github/skills/hipcortex-memory`](./.github/skills/hipcortex-memory/SKILL.md).

## Environment

- **OS / shell:** Windows, **PowerShell 5.1**. Chain commands with `;`, never `&&`.
- **`rtk` is not installed on this machine** — do **not** prefix commands with it, or the command
  fails with `CommandNotFoundException` before it runs. *This corrects an earlier instruction in this
  file that told agents to always use it.* If it ever appears on `PATH`, prefer it; it passes
  unrecognised commands through unchanged.
- **`node --test` takes files, not directories.** Bare `node --test` discovers every `*.test.ts`
  recursively and is how the suite is run; `node --test tests` fails with `Cannot find module`. Pass
  a file path, or nothing at all.
- **`$LASTEXITCODE` read after a pipeline is the pipeline's exit code** (`-1` from `Select-String`),
  not the command's. Read it from an unpiped invocation when the code matters.
- **The console code page mangles typographic punctuation** (`—` arrives as `鈥?`). Print ASCII
  punctuation in CLI output, error messages and demo narration.
- **Quoting trap:** PowerShell strips inner double quotes passed to native executables via
  `-c`/`-e`. Write a scratch script file instead of inlining quoted or multi-line code.
- **Cross-platform scripts only.** POSIX-only shell in `package.json` scripts (`rm -rf`,
  `export X=1`, `$(...)`) fails here with `NamedParameterNotFound`/`CommandNotFoundException`.
  Use `rimraf`/`cross-env`, or put the logic in a Node/Python script file.
- **A native command's stderr is rendered as a red `NativeCommandError` block, and the CLI writes to
  stderr on purpose.** `cli/support.ts` sends every log line there and nothing to stdout, deliberately:
  the run's result is a file and stdout is the summary a caller reads, so progress chatter in stdout
  would make the one machine-readable stream on the command line machine-unreadable. PowerShell 5.1
  does not distinguish that from a crash, so `npm run demo` prints an `At line:1 char:1` frame and a
  `RemoteException` wrapped around a line that says `veridian info: ...`. It is not a failure - read
  the **exit code**, not the paragraphs. Do not "fix" this by moving logs to stdout.
- **No polling.** Run long-lived processes in the background and continue; do not `Start-Sleep`.

## Layout

Everything in this tree now exists and holds real code. Single repository - do not
split it into multiple repos prematurely. Create a directory only when its first real file lands.

```
extension/vscode/       The VS Code Cockpit - a thin client, no validation logic. `src/port.ts`
                        declares the slice of the editor API the Cockpit uses, by hand, so every
                        decision is testable without an editor; only `src/host/vscode-port.ts` and
                        `src/host/activate.ts` import `vscode`, and `src/host-boundary.test.ts` holds
                        that as an executable rule. The one directory with a build step: the
                        extension host is not Node's loader, so it compiles to `out/`, and
                        `npm run smoke:out` is what loads that artifact (no test in the tree can).
                        `npm run package` produces `veridian-cockpit-<version>.vsix` and
                        `npm run smoke:vsix` reads it back as a zip, because the archive is a third
                        artifact no test in either tree can load; `src/packaging.test.ts` holds the editor floor, the
                        type floor, the allowlist and the licence copy. Read
                        `extension/vscode/README.md` for the install routes and the list of what
                        a real VS Code test host would still have to cover.
core/clarification/     The ambiguity protocol: ladder (derived → inferred → defaulted → self_prompted
                        → answered → deferred), detectors, JSON-pointer editing, the report. Lowest
                        layer. Rung 4 is the run answering its *own* gap from material it already
                        holds; it may eliminate a candidate the contract offered and may never invent
                        one, which is the whole safety argument for letting a run answer itself.
core/schema/            JSON Schema validation + the loader that reads schemas/.
core/goal/              Goal definition, loading, persistence, versioning.
core/acceptance/        AcceptanceCriterion + the engine that turns a contract into an
                        executable validation sequence (core/acceptance/plan.ts) + the register of
                        step kinds (core/acceptance/steps.ts), which is the one place a kind is
                        declared that the schema and the engine both read.
core/execution/         Run controller implementing the state machine above + the repair gate.
core/validation/        ValidationResult, validator registry, status semantics, verdict rollup.
core/environment/       EnvironmentAdapter interface + Environment Manager (lifecycle,
                        health checks, reset, snapshot/restore) + web-observation.ts, the shared
                        vocabulary that keeps validators from depending on adapters + db-observation.ts,
                        the same idea for the database family + k8s-observation.ts for the cluster
                        family + posix-observation.ts for the system family + os-observation.ts for the
                        machine family (the fifth, and the third proof that the rule holds - a validator
                        family that needs no core change to exist) + cloud-observation.ts for the
                        provider family (the sixth, and the fourth reason that rule holds, and the one
                        that carries the action vocabulary, the reference grammar and the refusal
                        vocabulary the substitute and the validators share) + container-observation.ts
                        for the runtime family (the seventh, and the fifth reason that rule holds, and
                        the one that carries the reference grammar, the renderings the validators
                        compare and the vocabulary for a command the world refuses) + vscode-
                        observation.ts for the extension-host family (the eighth, and the sixth
                        reason that rule holds, and the one that carries the reference grammar, the
                        renderings the validators compare, the seven simulated surfaces and the
                        vocabulary for a call the world refuses) + api-observation.ts for the HTTP
                        service family (the ninth, and the seventh reason that rule holds, and the
                        one that carries the exchange record, the pointer reader and the renderings a
                        non-browser reading needs - so a family whose world is entirely real still
                        needs no core change) + process-observation.ts for the program family (the
                        tenth, and the eighth reason that rule holds, and the one that carries the
                        two target grammars that family needs - a selector naming a command, a
                        world-relative path naming a file - beside the refusal that decides which
                        spellings of a path leave the world, so a validator family whose world has
                        no socket and no substitute still needed no core change either) + the boundary
                        vocabulary (BoundaryPolicy/BoundaryReport) that keeps a declared safety limit
                        from being mistaken for an enforced one.
core/evidence/          Evidence Engine. Writes the run bundle.
core/run/               Run identity, history, iteration state.
core/memory/            Optional durable memory client (HipCortex). Never required to run.
core/metrics/           M1..M5 as executable measurements over run bundles (metrics.ts is pure
                        functions over a reading; history.ts reads the reading off disk). Not
                        acceptance criteria: no browser can observe "the same code gave the same
                        result twice", so a web contract for these would be a lie.
core/definition.ts      DEFINE end to end: goal + acceptance + environment → a resolved plan.
core/assets.ts          Where Veridian's OWN files live, derived from import.meta.url. One level up
                        is the package root from the source tree and from dist/. Distinct from
                        io.ts, which resolves the OPERATOR's files against the working directory;
                        conflating the two is the defect this file exists to remove.
adapters/local-web/     LocalWebEnvironment — start/health-check/stop/reset a local app, and the
                        lazy Playwright browser port. Playwright is NOT a dependency.
adapters/local-db/      LocalDbEnvironment - build a SQLite file, read it, reset by rebuilding.
                        The second adapter, and the proof that EnvironmentAdapter is a seam rather
                        than a browser harness with an interface bolted on. `database-port.ts`
                        carries the measured facts about `node:sqlite`; the engine is reached by a
                        dynamic `import`, so there is no dependency to install either.
adapters/sim-k8s/       SimK8sEnvironment - the first SIMULATED world, and the first adapter whose
                        substitution is the point rather than a convenience. The application really
                        deploys itself, over a real HTTP control plane it really calls, into
                        namespaces the control plane really holds - and there is no cluster software
                        anywhere in the loop. `cluster-port.ts` is the substitute (its own HTTP
                        surface, so the application cannot tell the difference) and `index.ts` is the
                        front door; the substitution is declared in the plan and in `environment.json`.
adapters/sim-posix/     SimPosixEnvironment - the second SIMULATED world, and the one whose subject
                        is the operating system. A real application process provisions a real tree
                        by printing command vectors on its stdout; the substitute executes them and
                        holds accounts, groups, packages, inodes with modes and owners, units and
                        sockets. No VM, no image, no boot. `posix-port.ts` is the substitute (and
                        `posix-port.test.ts` is 20 tests over it), and `sim-posix-environment.ts` is
                        the adapter, which **refuses by name** a `snapshot-restore` reset it cannot
                        perform rather than silently downgrading it to a restart.
adapters/sim-os/        SimOsEnvironment - the third SIMULATED world, and the one whose subject is a
                        machine rather than a cluster or a system. Same shape as `sim-posix` one
                        family out: the application really provisions, by printing command vectors
                        the substitute really executes, and the substitute holds machine accounts,
                        file modes and ACLs with explicit and inherited entries, package records,
                        registry store entries, service definitions and ports. `os-port.ts` is the
                        substitute, and `sim-os-environment.ts` is the adapter, which declares the
                        five `OS_ENV` names the application reads - a host path this machine can
                        open and the world's own spelling of the same directory, because a program
                        that passed the host path to a `run` step would be refused.
adapters/sim-cloud/     SimCloudEnvironment - the fourth SIMULATED world, and the first whose subject
                        is a remote provider ACCOUNT rather than a container for files. A real HTTP
                        server speaks a provider's own routes over loopback, holds buckets, objects,
                        queues, secrets and principals, and decides every permission question with
                        the account's own evaluator (deny beats allow; an explicit deny beats
                        everything). `cloud-port.ts` is the substitute, `sim-cloud-environment.ts`
                        declares the five `CLOUD_ENV` names the application reads, and the reading
                        carries `simulated` naming each surface that is stood in for. No cloud
                        account, no session, no provider API and no outbound socket. This is the only
                        adapter that performs a `call` step, so a criterion can put its own request
                        to the account rather than infer the account's answer from the application's
                        traffic.
adapters/sim-container/ SimContainerEnvironment - the fifth SIMULATED world, and the one whose
                        subject is a container runtime. The application really provisions, by
                        printing command vectors the substitute really executes, and the substitute
                        holds image records (tags, labels, an image id derived from the layer list)
                        and container records (state, exit code, mounts, published ports, limits,
                        healthchecks, captured output) beside a register of runtime commands
                        answered in process. `container-port.ts` is the substitute and
                        `sim-container-environment.ts` is the adapter, which declares the four
                        `CONTAINER_ENV` names the application reads. It states its own limits rather
                        than hiding them: limits are **declared and never enforced**, an account is
                        **recorded and never switched to**, and a published port is `exposed` and
                        never `reachable`.
adapters/sim-vscode/    SimVSCodeEnvironment - the sixth SIMULATED world, and the first whose
                        subject is an editor's extension API. A real extension is loaded by a real
                        Node process through a module this world resolves in place of `vscode`;
                        every action that needs the extension running starts a fresh host process,
                        and every host process activates the extension, so an activation count is
                        a count of host processes. `vscode-port.ts` is the substitute, holding
                        contributions, commands, invocations, settings, status items, output
                        channels, messages, subscriptions and durable state beside the calls it
                        refuses by name; `sim-vscode-environment.ts` is the adapter, which declares
                        the four `VSCODE_ENV` names the application reads. Its only evidence kind
                        is `json` - there is no page to screenshot - and `snapshot-restore` is
                        refused by name rather than downgraded to a restart.
adapters/local-api/     LocalApiEnvironment - the ninth world, and the first that is NOT simulated
                        at all. It starts a real service as a real child process, waits for the
                        readiness line the service prints on stdout, and then puts the CONTRACT's own
                        requests to it over loopback - so a criterion asks the service directly rather
                        than inferring its answer from the application's traffic, and what it reads
                        back is the real status line, the real headers, the real byte count and a
                        pointer into the real body. `api-port.ts` is the client (the global `fetch`, a
                        timeout, and a client that never throws - a timeout is an observation, not a
                        crash) and `local-api-environment.ts` is the adapter, which refuses a request
                        aimed outside the service's own origin by name. It reuses the sixth world's
                        `call` step and adds none of its own, and it is the one world whose reading
                        carries no `simulated` field at all: nothing is stood in.
adapters/local-process/ LocalProcessEnvironment - the tenth world, and the second that is NOT
                        simulated at all, aimed at a subject with no socket in it. It starts a real
                        program as a real child process, waits for the readiness line the program
                        prints on stdout, and judges the text it printed on stdout and stderr, the
                        code it exited with, a probe of whether it is still up and the files it
                        really wrote under a real directory. `process-port.ts` is the file probe
                        (the seam takes the ACCESSION, never the declaration - the declaration is
                        what the reading records) and `local-process-environment.ts` is the adapter,
                        which declares the three `PROCESS_ENV` names the application reads. It adds
                        no step kind: a contract provisions a tree with the `run` steps the second
                        world introduced. There is no `*_SIMULATED_SURFACES` constant for this world
                        and none is wanted, which is why its reading carries no `simulated` field.
adapters/sim-data/      SimDataEnvironment - the eleventh world and the seventh SIMULATED one, aimed
                        not at a document a world holds but at a REQUEST AN APPLICATION MADE. The
                        application really opens a TCP socket on loopback and really writes a
                        broker protocol into it - length-prefixed frames, a CRC32C over each body,
                        and a version negotiated through `ApiVersions` before anything else is
                        sent - and the substitution and the transport are deliberately on opposite
                        sides of that line: `data-port.ts` holds topics, partitions with their
                        records and offsets, high watermarks and in-sync sets, consumer groups with
                        generations and members, committed positions and a meter, while `wire.ts`
                        decodes and bounds-checks the bytes for real. `protocol.ts` is the register
                        of twelve APIs, and it is the authority on how each is spelled. No broker
                        process, no replica follower, no on-disk log, no group coordinator, no
                        rebalancer and no outbound socket. `sim-data-environment.ts` declares the two
                        `DATA_ENV` names the application reads, of the five it declares. Its only
                        evidence kind is `json`, and it writes two of them per criterion when there
                        was traffic.
validators/playwright/  Playwright web validators (element, visible, value, text, count, url,
                        console.clean, network.ok).
validators/database/    Database validators (table, column, count, value). Judge a reading in
                        core/environment/db-observation.ts, which is what keeps them from importing
                        an adapter. Each declares its own `targetNoun`, so the clarification ladder
                        asks "which table" rather than "which element".
validators/k8s/         Cluster validators (applied, deployment, image, ready, pod, service, event).
                        Judge a reading in core/environment/k8s-observation.ts, on the same rule as
                        the database family - and the reason the third family needed no core change.
validators/posix/        System validators (ran, package, installed, user, file, contents,
                        permission, owner, service, running, port, probe). Judge a reading in
                        core/environment/posix-observation.ts - the fourth family, and the second
                        reason that rule holds. `owner` and `permission` are deliberately different
                        questions, which is why AC-009 exists to prove it.
validators/os/          System validators for a machine (ran, account, setting, file, contents,
                        owner, access, acl, service, running, principal, probe). Judge a reading in
                        core/environment/os-observation.ts - the fifth family, and the third reason
                        that rule holds. The three state questions about one file are split on
                        purpose: `owner` is who holds the object, `acl` is what was written on it
                        and whether each entry is explicit or inherited, and `access` is what one
                        named account may actually do. Three facts with three different repairs, so
                        one validator judging all three would report one defect where there are
                        three.
validators/cloud/       Provider-account validators (bucket, object, tag, policy, access, queue,
                        secret, call, setting, probe, meter). Judge a reading in
                        core/environment/cloud-observation.ts - the sixth family, and the fourth
                        reason that rule holds. The family prints what an operator reads rather than
                        raw JSON: a bucket, an object, a policy and a decision each render to a
                        spelling a failure report can quote. Two of the eleven are distinguished by
                        WHO ASKED, and the names read the way a reader does not expect: `cloud.call`
                        reads the request the **application** made and `cloud.probe` the one the
                        **criterion** made, which is why a criterion's own request cannot be
                        mistaken for evidence about the application. `cloud.call` is not the only
                        validator that makes its own request and the cloud plan is not the only plan
                        that admits the `call` step - `local-api` does too, for the whole of every
                        one of its criteria.
validators/container/   Runtime validators (runtime, image, tag, digest, label, env, state, alive,
                        exitcode, command, user, mount, port, limit, health, logs, stderr, call,
                        probe). Judge a reading in core/environment/container-observation.ts - the
                        seventh family, and the fifth reason that rule holds. It has no new step
                        kind: the application provisions through command vectors printed on its
                        stdout and is acted on with `run`, exactly as `sim-posix` and `sim-os` are.
                        The family prints what an operator reads rather than raw JSON, and the
                        renderings are part of each comparison: `container.limit` compares
                        `(declared, not enforced)` and `container.port` compares `(exposed)`,
                        because a value that omitted them would say a limit held and a port was
                        reachable when neither is true. `container.exitcode` is all lower case,
                        like every validator name in this tree.
validators/vscode/      Extension-host validators (host, identity, engine, activation,
                        contribution, command, invocation, setting, status, output, message, state,
                        subscription, file, refusal, call, probe). Judge a reading in
                        core/environment/vscode-observation.ts - the eighth family, and the sixth
                        reason that rule holds. It has no new step kind: the application provisions
                        by printing command vectors on its stdout and is acted on with `run`, and
                        the two `invoke`/`activate` vectors are how a criterion reaches into the
                        host. Five of the seventeen are targetless - `host`, `identity`, `engine`,
                        `activation` and `message` ask about the world itself - and two of those
                        are the checks that keep the substitution honest: a manifest whose `main`
                        escapes the extension's own directory is refused, and `engines.vscode` is
                        evaluated against the `apiVersion` the document declares.
validators/api/         HTTP-service validators (service, exchange, status, header, body, bytes,
                        json, log). Judge a reading in core/environment/api-observation.ts - the
                        ninth family, and the seventh reason that rule holds. It has no new step
                        kind: every criterion in the world makes its requests with `call`, which the
                        sixth world introduced. Three target grammars live in one family on purpose,
                        because the subjects are different kinds of thing: a bare 1-based position
                        addresses one exchange (`api.status`, `api.body`, `api.bytes`,
                        `api.exchange`), `<position>:<header-name>` addresses one header of one
                        exchange split at the first colon (`api.header`), and
                        `<position>/<json-pointer>` addresses one value inside one body (`api.json`),
                        so a contract can pin `1/WIDGET/unitPriceCents` without a deep comparison of
                        the whole document. `api.log` reads what the service printed on stdout or
                        stderr, which is the one part of a service's behaviour no response carries.
validators/process/     Program validators (host, probe, argv, state, exitcode, run, stdout,
                        stderr, file, kind, contents, size). Judge a reading in
                        core/environment/process-observation.ts - the tenth family, and the eighth
                        reason that rule holds. It has no new step kind: a criterion acts in the
                        world with `run`, and a program's own output is read as a stream. Its family
                        was the first asked two different kinds of question - the eleventh world's
                        is the second - so it carries two target
                        grammars and the *validator* chooses between them rather than the spelling:
                        a target naming a command is `app` (the program the world started) or a
                        bare 1-based position (the criterion's own `run` steps, which is why
                        `commandAt` is index-free for `app` and index-based for a position - the
                        program is the same program in every criterion, while "the second command"
                        is a fact about *this* criterion), and a target naming a file is a
                        world-relative path. A path that leaves the root is refused by
                        `processPath` - a leading separator, a drive letter, and a `..` that pops
                        past the root - and the adapter records the refusal as a boundary crossing
                        rather than reporting a missing file, because a resource that is absent and
                        a place that is out of bounds are two different observations. `process.file`
                        and `process.contents` read their target as a place and `process.exitcode`
                        reads its target as a selector, so neither can misread the other's
                        spelling.
validators/data/        Broker validators (node, topic, layout, partition, record, key, value,
                        group, member, commit, call, probe, meter). Judge a reading in
                        core/environment/data-observation.ts - the eleventh family, and the ninth
                        reason that rule holds. It has no new step kind: a criterion acts in the
                        world through a `run` step, and one of them expects the world to **refuse**
                        it rather than resolve it. Two of the thirteen are distinguished by WHO
                        ASKED, and the pair inverts the way a reader does not expect: `data.call`
                        reads the requests the **application** put to the broker and `data.probe`
                        the requests the **criterion** issued, so a contract cannot earn its own
                        pass with a request it made itself - and one criterion exists precisely to
                        depend on the two disagreeing, because the application's `CreateTopics` for
                        two fresh topics reads `ok` while the criterion's own for a topic the world
                        already holds reads `refused`. It carries two target grammars on purpose,
                        one per kind of question: a topic-shaped reference is split on `/` and each
                        noun fixes its own segment count (`cart-events`, `cart-events/0`,
                        `cart-events/0/2`, `cart-indexer`, `cart-indexer/member-1`,
                        `cart-indexer/cart-events/0`), with every other spelling refused and told
                        the count it wanted, while `data.call` and `data.probe` take an API name as
                        `protocol.ts` spells it and `data.meter` names a counter. `data.layout`
                        compares the topic's whole rendering, which carries the world's own limit
                        inside the value it compares - `replication 1 recorded` beside `isr [1]` -
                        because a substitute that is honest about its boundary has to carry that
                        honesty into the comparison rather than beside it.
cli/                    The interface that exists today: arguments, support, worlds.ts (the adapter
                        register and the requirements each adapter declares), veridian.ts.
schemas/                goal/acceptance/environment/run/result/ambiguity .schema.json - the
                        machine-readable contracts.
examples/shopping-cart/ The canonical demo: correct app + a run-time defect overlay + the goal,
                        contract and environment it is judged by.
examples/inventory-db/  The second demo, and the one that carries the argument: the same lifecycle,
                        verdict rules, evidence bundle and repair protocol against a world with no
                        process, no socket, no page and no console.
examples/sim-k8s/       The third demo, and the first simulated one: the application deploys itself
                        into a substitute control plane and is judged on what the substitute holds.
                        Two defects, ten criteria, and the world's composition recorded so a PASS is
                        traceable to a named substitute rather than to unexamined reality.
examples/sim-posix/     The fourth demo, and the first whose subject is an operating system: the
                        application provisions a substitute Linux system and is judged as a named
                        account. Four defects, thirteen criteria, one of which acts in the world
                        through a `run` step and one of which expects the world to **refuse** it.
examples/sim-os/        The fifth demo, and the same shape one family out: the application
                        provisions a substitute Windows system and is judged as `svc-audit` - an
                        account the loader refuses to let be `SYSTEM`, because an administrator
                        reads every file and a hardening contract judged as one is vacuous. Four
                        defects, seventeen criteria, with the same `run` step and the same expected
                        refusal. The `windows` family is declared, and the application **refuses**
                        any other family by name rather than adapting to it.
examples/sim-cloud/     The sixth demo, and the fourth simulated one: the application provisions a
                        remote provider account over routes it really calls, and is judged on the
                        resources that account holds. Four defects, twenty-seven criteria, one of
                        which acts in the world through a `call` step. Two identities matter and they
                        are not the same one: `cloud.principal` is who the application runs as, and
                        `svc-reader` is a reader account the program itself creates.
examples/sim-container/ The seventh demo, and the fifth simulated one: the application provisions
                        images and containers in a substitute runtime and is judged on the records
                        that runtime holds. Four defects, twenty-seven criteria, one of which acts
                        in the world through a `run` step and two of which expect the world to
                        **refuse** them. Three of the four defects are read by exactly one criterion
                        each, and are therefore the controls the fourth is read against - the fourth
                        is a one-character misspelling of a bind mount's source that moves **seven**
                        readings, which is what makes it the demo that shows one edit to a world is
                        never one fact.
examples/sim-vscode/    The eighth demo, and the sixth simulated one: a real extension is loaded by a
                        substitute extension host and judged on what that host recorded while it
                        ran. Four defects, twenty-three criteria, two of which act in the world
                        through a `run` step and one of which expects the world to **refuse** it.
                        Each defect is filed against exactly one criterion - the state the
                        extension kept, the line it logged, the message it showed and the status
                        item it wrote - and the defects are repaired in criterion order, so the
                        failing count descends `4 -> 3 -> 2 -> 1 -> 0`.
examples/local-api/     The ninth demo, and the first whose world is entirely REAL: a real service
                        is started and judged through its own HTTP interface over loopback, with no
                        page, no substitute and nothing rendered. Four defects, eight criteria, and
                        the same FAIL -> repair -> PASS loop. D2 and D3 are the controls - each is
                        read by exactly one criterion, so a reader watches one edit move one reading
                        before watching D1 move two (`AC-002` and `AC-003`) and D4 move two (`AC-006`
                        and `AC-007`). `AC-001` and `AC-008` never move at all, which is what says
                        the other six moved because of the edits rather than because the world is
                        flaky. Measured progression: `6 -> 4 -> 3 -> 2 -> 0` over five iterations.
examples/local-process/ The tenth demo, and the second whose world is entirely REAL - and the
                        first whose subject is a program rather than a page, a file of rows or a
                        service. Four defects, nine criteria. D2, D3 and D4 are the controls, each
                        read by exactly one criterion, so a reader watches one edit move one
                        reading; D1 then moves **three** at once (a release version constant the
                        program prints in its build summary, again in its verifier's summary and
                        again inside the manifest it writes - three separate true consequences of
                        one edited constant), and `AC-002`, `AC-007` and `AC-009` never move at all.
                        Its repair agent walks the table in array order, so the failing count
                        descends `6 -> 3 -> 2 -> 1 -> 0` over five iterations - the figures are the
                        run's own, and the demo's narration asserts them.
examples/sim-data/     The eleventh demo, and the seventh simulated one: the application opens a
                        real TCP socket on loopback and really writes a broker protocol into it, and
                        is judged on the topics, partitions, records, groups and committed offsets
                        the substitute holds. Four defects, twenty criteria. D1 (a cleanup policy),
                        D2 (the same error on the second topic) and D4 (a committed position one
                        short) are the controls, each read by exactly one criterion, so a reader
                        watches one edit move one reading; D3 then moves **two** at once, because one
                        release constant is printed in the four record payloads `AC-011` compares and
                        again in the checkpoint payload `AC-015` compares. The failing count
                        descends `5 -> 4 -> 3 -> 1 -> 0` over five iterations - read off the run's
                        own `iterations`, where the failing criteria per iteration are
                        `[AC-004, AC-005, AC-011, AC-014, AC-015]` then `[AC-005, AC-011, AC-014,
                        AC-015]` then `[AC-011, AC-014, AC-015]` then `[AC-014]` then none. D4 is the
                        defect this world exists to make observable: the pipeline delivers three
                        orders and commits `2`, so every record is correct, the log is complete, and
                        the one thing wrong is where the group will resume - a fact no record in the
                        data states, which is why the reading had to be about the request.
examples/defect-text.ts One implementation of the CRLF rule for a textual overlay on a source file.
                        Two demos injecting defects is two chances to teach the rule differently;
                        a third copy is where the rule gets broken.
Dockerfile              A DISTRIBUTION route, not a sandbox environment. Built and run in CI,
                        because this machine has no container runtime and an unbuilt
                        Dockerfile is a claim.
tsconfig.build.json     The build config. The base config is noEmit; this one emits to dist/ and
                        rewrites the .ts import specifiers to .js.
dist/                   GENERATED by `npm run build`. Never edited, never committed, and never
                        the way you run the code - the source is still the interface.
tests/                  Veridian's own tests (+ fixtures/helpers). See the tests instruction below.
scripts/                Bootstrap scripts that must run before anything is type-checked.
docs/                   Design documents. Indexed below.
```

Also at repo root: `README.md`, `AGENTS.md` (this file), `LICENSE` (BSD 2-Clause), `package.json`,
`tsconfig.json`, `.nvmrc`, `.gitignore`, and `.vscode/` (the two files the Cockpit's F5
development-install route needs, kept as plain JSON so a parser can check them). **`README.md` is the front door** - the first thing a reader opens - and this file is
the hand-off to the next agent. They answer different questions: the README says what Veridian is and
how to see it work, this file says how to change it without breaking a rule it paid for. When a change
alters what the README claims - a command, an exit code, quoted output - correct the README in the
same pass, because a README that describes a command that no longer behaves that way is the same
defect as a validator that reports a pass it did not observe.

There is deliberately **no `acceptance/` directory.** `docs/IMPLEMENTATION-PLAN.md` §5 and step 9 of
its execution order call for `acceptance/veridian-mvp.yaml` - Veridian judged by its own tool. It
could not be written inside the MVP, and the finding is recorded rather than the attempt quietly
dropped: at the time, the only registered adapter was `local-web` and all eight registered validators
were browser observations, so a contract about a CLI would have made every criterion `INCONCLUSIVE`
and exited 2 - the same defect as `--browser none` on the canonical demo.

**That reason is now spent, and the file has to say so rather than keep quoting it.** Eleven adapters
are registered, ten of them need no browser, and `local-api`, `local-process` and `sim-data` are
precisely the "non-web adapter" this paragraph said the scope boundary forbade building
speculatively - they were not built speculatively, they were built because a world whose subject is an
HTTP contract is inside the boundary, a world whose subject is a program is too, and a world whose
subject is a request an application made is inside it as well, and once `local-api` existed a
non-browser contract about a program became expressible. So the honest statement is no
longer "it cannot be written" but **"it has not been written"**. Veridian's own self-validation is
still its `node --test` suite, which `npm run gate` runs, and a `acceptance/veridian-mvp.yaml` remains
the next piece of dogfooding rather than a blocked one.

`.veridian/` is created at runtime and is not committed.

### Persistence on disk

Veridian state lives under `.veridian/` — filesystem-first, so it stays portable, debuggable,
Git-friendly, and independently inspectable:

```
.veridian/
├── config.yaml
├── environments/
├── goals/
├── runs/
│   └── <run-id>/
│       ├── goal.yaml
│       ├── acceptance.yaml
│       ├── environment.json
│       ├── execution.log
│       ├── result.json
│       ├── artifacts/AC-00N.observation.json
│       ├── artifacts/repair-<iteration>.log
│       ├── screenshots/AC-00N.png
│       └── trace/AC-00N.zip
└── snapshots/
```

**A `trace` artifact reports `bytes: null`, and that is a contract rather than a gap.** The archive is
declared when the criterion is observed, but Playwright writes it when the page closes, so its length
does not exist yet at declaration time; the adapter records `null` rather than a guess. The *path* is
derived once and used for both the bundle's spelling and the OS's, so the file the bundle names is the
file on disk - which is the property a reader needs, because a size can be read from the filesystem
and a wrong size cannot be detected from the bundle at all. One trace per criterion, not one per run:
the file is a recording of that criterion's actions, and `tests/local-web-environment.test.ts` holds
the path.

**`artifacts/repair-<iteration>.log` is the only file in the bundle that is not evidence about the
application.** It is the *actor's* own output - the repair command's stdout, stderr, command line, exit
code and working directory - written before the run acts on its answer, so an external agent can read
whoever repaired the code while the run is still going. It is keyed by iteration rather than named once
because the bundle is last-write-wins per path and a second repair would otherwise overwrite the first
attempt's explanation. Nothing in the verdict reads it; a repair is believed only once the criteria are
re-observed from a clean world, which is why it is safe to store verbatim.

`.veridian/latest-result.json` and `.veridian/latest-failure.md` are the Level-2 agent feedback
artifacts — an external agent reads them to learn what failed without Veridian having to drive it.

## Build / test commands

**The source tree is the program, and there is no build step between the two** - but there is now a
build step **for the artifact**, and the difference matters enough to state twice. Node 22 strips
types and executes `.ts` directly, so development, the gate and the demo all run the source. An
*installed* Veridian cannot be that source, because Node refuses to strip types under `node_modules`,
so `npm run build` compiles it to `dist/` and copies the schemas in. The **VS Code Cockpit** is the
third runtime and has a build step for the same class of reason rather than a preference: the
extension host loads JavaScript and is not Node's loader, so `extension/vscode` compiles to `out/`.
Every command below was executed on this machine and is quoted from its real output.

```powershell
npm ci                     # install. Runtime: yaml. Dev: typescript, @types/node.
                           # Also runs `prepare`, which is `npm run build`, so dist/ exists afterwards.
npx tsc --noEmit           # typecheck. Currently silent - a single error means a real regression.
node --test                # the whole suite. 2190 tests, ~7s. No directory argument.
                           # 2190 = the root's own 2118 + the Cockpit's 72, because the runner walks
                           # the tree and reaches extension/vscode/src/*.test.ts. Neither figure is
                           # the whole story on its own: the root tsconfig EXCLUDES extension/**, so
                           # `npx tsc --noEmit` here does not typecheck the Cockpit and the root gate
                           # is not the extension's gate.
npm run gate               # typecheck then test. Run this before claiming anything is done.

npm run build              # tsc -p tsconfig.build.json, then node scripts/copy-assets.mjs
npm run smoke:dist         # drive the COMPILED CLI from a temp directory; asserts exit 2, not 3
```

The Cockpit has its own gate, and it is **three** commands rather than one, because the extension is
the only tree that ships compiled:

```powershell
cd extension/vscode
npm ci                     # install. Dev only: typescript, @types/node, @types/vscode,
                           # @vscode/vsce, ovsx. There is no runtime dependency, and Playwright is
                           # not one of them - which is why reading the archive is done with
                           # node:zlib by hand rather than with a zip library.
npm run gate               # typecheck, test, build, smoke:out - in that order.
                           # npx tsc --noEmit  -> silent
                           # node --test       -> 72 tests, 0 failing
                           # npm run build     -> out/, 6 files
                           # npm run smoke:out -> loads the compiled entry point, 15 checks
npm run smoke:out          # alone: resolve the manifest's `main`, activate it twice under a
                           # recording double of `vscode` (scripts/vscode-stub.mjs), and assert the
                           # registered commands equal the six the manifest declares. Exit 1 if the
                           # compiled file the manifest names is not there.
npm run package            # vsce package --no-dependencies
                           # The archive lands at veridian-cockpit-<version>.vsix - `vsce` takes the
                           # name and the version out of the manifest it packages, so the filename
                           # cannot claim a version the extension inside it does not have.
                           # 12 files, 118.70 KB, at the extension root. Deliberately NOT in `gate`:
                           # a packaging tool's output is not part of the source tree's contract,
                           # and making the local gate depend on `vsce` would make every local run
                           # need it. CI runs it, and runs the check below against it.
npm run smoke:vsix         # read that archive back as a zip and assert what it holds: the entry
                           # point `main` names, the manifest field-for-field, the absence of
                           # src/, tests and node_modules, the licence byte for byte, and every
                           # compiled file identical to the build's. 34 checks. Exit 1 if the
                           # archive is stale, incomplete or wider than the manifest allowlists.
```

**`npm run smoke:out` exists for the same reason `npm run smoke:dist` does, one runtime further out.**
`node --test` runs `.ts`; the extension host runs `out/*.js`; so the six files that ship are covered by
nothing in this tree. It was falsified rather than trusted - pointing `main` at a path the build does
not produce makes it fail naming that path and exit 1. It is also only *necessary*, never sufficient:
`scripts/vscode-stub.mjs` is a recording double, and `extension/vscode/README.md` names what only a
real VS Code test host could exercise.

**`npm run smoke:vsix` is the same argument once more, and it is the one with a third-party tool in
the middle.** A `.vsix` is a zip that `vsce` builds from an allowlist in the manifest, and every
decision about what travels is made by that tool and by nothing in this tree. The script opens the zip
itself - central directory, stored and deflated entries, `inflateRawSync` - because there is no
runtime dependency here and adding one to read an archive would be the tail wagging the dog. It was
falsified four ways rather than trusted: adding `src` to the allowlist fails both negative checks and
exits 1; adding a byte to a compiled file *after* packaging fails the byte-identity check and exits 1;
appending a line to the licence copy fails with `the licence in the archive is the repository's, byte
for byte (1388 bytes)` and exits 1; and taking `LICENSE` out of `files` is the instructive one, because
`vsce` prints `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`, packages **10** files and
**exits 0** - so the packaging step reports nothing wrong and `smoke:vsix` is what fails. *A warning
is not a check.*

**The marketplaces are a declared route now rather than a habit.** `vsce publish` and `ovsx publish`
were named in `extension/vscode/README.md` as the third distribution route while `ovsx` was installed
nowhere and declared nowhere - so the route existed only as prose a maintainer had to reproduce from
memory, which is this repository's recurring defect: *a route named in a document that nothing in the
tree can execute.* `npm run publish:vsce` and `npm run publish:ovsx` are one script,
`scripts/publish-vsix.mjs`, and the flag at its centre is what keeps the route honest: `--packagePath`.
Bare `vsce publish` and bare `ovsx publish` each *package* the directory themselves, so a maintainer
running one would upload a second build rather than the archive `smoke:vsix` had just read back - and
`vsce publish <version>` runs `npm version`, editing one of the several files that carry the version
number. The archive's name is resolved by `scripts/vsix-archive.mjs` instead of repeated, because the
smoke test needs that same answer and two copies of one rule is how a publisher ends up uploading an
archive nobody produces. Neither command is in `gate`, for the reason the README already gave: a token
and a claimed publisher name are needed, and the source tree's gate must not require a credential or a
third party to be reachable. Two things were **measured rather than assumed**. The missing-archive
guard was falsified by renaming the archive away - it names `npm run package` and exits 1. And the
token message was corrected by running the route: the first draft claimed the publisher would *refuse*
without `OVSX_PAT`, and it does not refuse - it asks (`? Personal Access Token for namespace
'farmountain':`), so the message says that instead, and the USAGE warns that a non-interactive caller
has no terminal to answer it. *An error message may only name a cause the reporter observed.*

**The archive travels by one more route, and until this pass a document had not named it: the release
itself.** Release `v0.2.1` carried **no asset at all** - the marketplaces were described, the tag was
pushed, and the one address a reader without a marketplace account can walk to was empty. It was found
by listing the release's assets rather than by reading the README that described the routes, because a
route described and a route reachable are two different claims. `gh release upload v0.2.1
extension/vscode/veridian-cockpit-0.2.1.vsix --clobber` is the command, and the upload's own success
line is **not** the evidence: `gh release download` returns a file whose SHA-256 matches both the local
archive's hash and the `digest` the release API reports, which is the only reading that says the thing
a reader will download is the thing `smoke:vsix` read back. *A step whose name states an outcome must
fail when that outcome does not happen* - and this file already paid for that rule once, when the
`demo` job's step named *"upload the evidence bundle"* reported success and carried nothing.

The `.vsix` is generated and is **ignored rather than committed**, for the reason `dist/` and `out/`
are: a committed archive is a binary nobody can diff against the extension it claims to be, and it is
one `git add .` away from being committed. The rule in `.gitignore` is `*.vsix` rather than one
filename, so a second target added to the `package` script cannot arrive unignored. **The release is
therefore the only durable address for a built archive**, which is what makes attaching it to the tag
part of the release rather than a follow-up.

**`npm run smoke:dist` is not optional when the build, the packaging or the asset resolution
changes.** Every test in `tests/` covers `.ts` files that are never shipped; without this, the
artifact that *is* shipped is covered by nothing, which is the unverified claim this project has
already paid for twice. It asserts exit 2 specifically: with `--browser none` every criterion is a
browser observation, so a healthy run is four `INCONCLUSIVE` criteria - while exit 3 means the built
CLI could not find the schemas it shipped with. That number was not chosen by reasoning; the check was
falsified by reverting the asset root in the compiled `dist/cli/veridian.js`, and it failed with
`schema "schemas/goal.schema.json" could not be read` and exit 3.

Running things:

```powershell
node cli/veridian.ts <command> [flags]      # or: npm run veridian -- <command> [flags]
node cli/veridian.ts metrics --defects AC-001,AC-002,AC-003
                                            # M1..M5 over the runs on disk. Reads bundles; starts
                                            # nothing. Exits 1 if a metric was violated, 2 if there
                                            # is no run to measure.
npm run demo                                # the canonical demo. Asks the environment document for
                                            # its browser, so the three-defect FAIL -> repair -> PASS
                                            # progression actually runs. Exit 0 when it passes.
npm run demo:db                             # the second demo: the same loop against a SQLite file,
                                            # with no browser at all. Exit 0 when it passes.
npm run demo:k8s                            # the third demo, and the first simulated world: the app
                                            # deploys itself into a substitute control plane. Exit 0
                                            # when it passes.
npm run demo:posix                          # the fourth demo, and the second simulated world: the app
                                            # provisions a substitute Linux system through commands it
                                            # really issues, judged as a named account. Exit 0 when it
                                            # passes.
npm run demo:os                             # the fifth demo, and the third simulated world: the app
                                            # provisions a substitute Windows system and is judged as
                                            # `svc-audit`, which the loader refuses to let be SYSTEM.
                                            # Exit 0 when it passes.
npm run demo:cloud                          # the sixth demo, and the fourth simulated world: the app
                                            # provisions a substitute provider account over routes it
                                            # really calls, judged as `svc-cart`, with no cloud account,
                                            # no session and no outbound socket. Exit 0 when it passes.
npm run demo:container                      # the seventh demo, and the fifth simulated world: the app
                                            # provisions images and containers in a substitute runtime
                                            # and is judged on the records it holds. No Docker, no
                                            # daemon and no image anywhere in the loop. Exit 0 when it
                                            # passes: measured, 5 iterations and 27/27 criteria.
npm run demo:api                            # the ninth demo, and the first whose world is NOT
                                            # simulated: a real service is started and judged through
                                            # its own HTTP interface over loopback, with the contract
                                            # rather than the application making the requests. No
                                            # page, no substitute, nothing rendered. Exit 0 when it
                                            # passes: measured, 5 iterations and 8/8 criteria, with
                                            # the failing count descending 6 -> 4 -> 3 -> 2 -> 0.
npm run demo:local-process                  # the tenth demo, and the second whose world is NOT
                                            # simulated - and the first whose subject is a program:
                                            # a real child process judged on what it printed, what
                                            # it exited with, whether it is still up and the files
                                            # it really wrote. No socket, no page, no substitute.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 9/9 criteria, the failing count descending
                                            # 6 -> 3 -> 2 -> 1 -> 0.
npm run demo:no-browser                     # the same demo with `--browser none`. Every criterion is
                                            # a browser observation, so this must end INCONCLUSIVE
                                            # (exit 2). It shows the refusal, not the aha.
npm run e2e:install                         # one-time: fetch the Playwright browser
npm run e2e                                 # the canonical demo, --browser playwright explicitly
```

**`--browser none` cannot show the canonical demo, and saying so cost a broken front door.** The
script used to pass `--browser none`, which made the one command a reader is most likely to type
abort at iteration 1 with four `INCONCLUSIVE` criteria and exit 2. A demo that cannot demonstrate is
not a demo. The flag is still useful - it is how you watch the loop refuse to judge what it did not
observe - so it is its own script now, with narration that says what it will show.

**There is no `npm run format`, and there should not be one yet.** The script used to run
`prettier --write .` while `prettier` was not installed, so it could only ever fail with
`prettier: not found`; it has been removed rather than left behind as a broken command a reader might
run and then have to diagnose. The `PostToolUse` formatter hook is a documented no-op for the same
reason (see below). Do not install a formatter to "fix" this without asking - the format of the tree
is currently hand-maintained and consistent, and a first `prettier --write` would touch almost every
file.

`scripts/e2e-install.mjs` is `.mjs` **on purpose**: it is the bootstrap that fetches Playwright, so
it has to be runnable before anything in the repository has been type-checked. `scripts/copy-assets.mjs`
is `.mjs` for a related reason: it runs *after* `tsc` in the same npm script, so it must not itself
need compiling.

**CI runs the same gates, on both platforms, and now the artifacts too.**
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) has six jobs. `gate` runs `npm run gate` on
`ubuntu-latest` and `windows-latest` (both resolving Node from `.nvmrc`). `demo` runs the canonical
demo on ubuntu, asserts that `--browser none` really exits 2, and uploads `.veridian/` as an artifact.
`simulated worlds` runs the seven browserless demos and names the world that regressed, because
before that job existed no CI ran any of them. `distribution` runs `npm run smoke:dist` and then a
full `npm pack` -> install into a clean directory -> run round trip, because that is the only check
that reads `files` and `bin` the way a consumer does. `container image` builds the Dockerfile and
requires the container to run the CLI **and** to resolve its own schemas from a browserless run, and
`VS Code Cockpit` runs the extension's own gate and reads the packaged `.vsix` back - the root gate
neither typechecks nor tests that tree, because the root tsconfig excludes `extension/**`.

**Both of those last two jobs have now run, and that is why they can be cited.** They were added and
pushed in one commit, which means they existed for a short window as exactly the thing this file
warns about - an unexecuted check. Run `34845548864` on `41d16f8` has all five jobs green, so the
Dockerfile is a built image rather than a correct-looking file, and `npm pack` is a working install
rather than a configuration. Docker cannot be exercised on this machine at all, which is precisely
why the job has to exist and why watching its first run is part of the change rather than a follow-up.

**And the newest run - `34853388649` on `135919e`, the `sim-k8s` commit - was green while one of its
steps did nothing.** The `demo` job's last step is named *"upload the evidence bundle"*; it reported
`No files were found with the provided path: .veridian/`, uploaded nothing, and the build passed. Two
causes, both worth stating. `.veridian/` is a **hidden** directory and `upload-artifact@v4` excludes
hidden files by default, so the path was searched and nothing in it was eligible; and the step was
configured `if-no-files-found: warn`, so the failure to carry the one thing it exists to carry was a
line in a list of warnings a reader learns to skip - alongside two Node-20 deprecation notices, which
is what makes that list easy to skip. Both are fixed (`include-hidden-files: true`,
`if-no-files-found: error`), and the point is the same one this file makes about guards: **a step
whose name states an outcome must fail when that outcome does not happen, or the name is a claim.**
Every green run up to this one carried the same silent no-op, which is why the defect was found by
reading *this* run's annotations rather than by reading the workflow - the workflow looks correct.
The fix is confirmed on run `34853562503`, where the same step now carries
`veridian-evidence` at **257,359 bytes** - read from the API rather than inferred from a warning
that stopped appearing, because "the warning is gone" and "the artifact exists" are different claims
and only the second one is the one this step makes.

*Written into `AGENTS.md`:* **a requirement that names a *place* must be resolved as a pointer, not
read as a literal key**; **two implementations of one rule disagree the first time a world arrives
that only one of them was written for**; **a capability report must be derived from what the code did,
not from a literal list beside it**; **a test that asks whether a value is in a list cannot see a list
that is wrong in a different way**; **a register whose members are schema `oneOf` branches needs a
guard of its own**; **a read must not mutate the record it reads**; **a resource that is absent and a
request that is refused are two different observations, and HTTP already has a word for each**; and
**a step whose name states an outcome must fail when that outcome does not happen**.

The `demo` exit-2 step reads `$?` after `set +e` because Actions runs bash with `-e`, which would
abort on the 2 before the assertion could look at it. Both new exit-code assertions use the same
shape.

## Distribution

**Three routes ship: a clone, a package, and the Cockpit.** This section used to say the shipped
model was a clone and the registry path was declined. That reversal is recorded rather than quietly
dropped, because the reasons it was declined were correct and are now the reasons the build exists.
The third route is in `extension/vscode/`; the reasoning behind it is in **The third runtime** below,
and it is the same reasoning one layer out.

Node 22 strips types and runs `.ts` directly - **but not for files under `node_modules`**:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for
files under node_modules
```

Verified for the import path *and* for the `bin`/main-entry path, while the same `.ts` outside
`node_modules` runs fine. So `"bin": "./cli/veridian.ts"` works from a checkout - and from
`npm link` against one - and can never work for anyone who installs the package into `node_modules`.
**A package must therefore deliver compiled JavaScript**, which is what `npm run build` produces:

- `tsconfig.build.json` extends the base config, turns `noEmit` off, and sets `outDir: "dist"` with
  `rewriteRelativeImportExtensions`, which is what turns the tree's `.ts` import specifiers into
  `.js`. Without that flag the build cannot even be configured, because `allowImportingTsExtensions`
  is only legal alongside `noEmit` or a rewrite.
- `scripts/copy-assets.mjs` carries `schemas/` into `dist/`, because `SCHEMA_URIS` are
  package-relative and a distribution carrying code but not its contracts would install cleanly and
  fail at the first command.
- `files: ["dist"]` is the allowlist. `bin` points at `./dist/cli/veridian.js`, and `tsc` preserves
  the shebang, which is the one detail that makes that entry runnable rather than merely present.

The second blocker was a genuine defect and is fixed rather than worked around. The schema set
resolved through `core/schema/registry.ts` as repo-relative paths (`schemas/goal.schema.json`) while
`nodeIo`'s root defaulted to `process.cwd()`, so an installed CLI would report a missing goal schema
sitting inside its own package - the worst kind of error, because it sends the reader to inspect the
one thing that is not broken. `core/assets.ts` now derives the asset root from `import.meta.url`, so
one level up is the package root from the source tree *and* from `dist/`. **A caller's files resolve
against the working directory; Veridian's own files resolve against the module.** Two roots, and
conflating them is the defect. `tests/assets.test.ts` holds both halves.

What the package deliberately does **not** include is Playwright, and that is still a real
limitation rather than a detail: an installed Veridian cannot observe a page until its user adds one.
It degrades honestly (`INCONCLUSIVE`, never `PASS`) and names the command that fixes it. Settling
that properly needs a peer-dependency story, which is the next thing a distribution phase owes.

Guards, in place of the old `private: true`:

- `prepublishOnly` runs `npm run gate`, so a package whose own tests are red cannot leave the machine.
- `prepare` runs `npm run build`, so `npm pack`, `npm publish` and a git-URL install all carry a fresh
  `dist/` without anyone remembering to build first. **`npm ci` runs it too**, which is why a broken
  build fails at install rather than at test.
- `npm run smoke:dist` drives the *compiled* CLI from a temporary directory and asserts exit 2. Every
  test in `tests/` covers `.ts` files that are never shipped, so without this the shipped `.js` is
  covered by nothing - the exact unverified claim this project refuses to make. CI also runs a full
  `npm pack` -> install -> run round trip, which is the only check that reads `files` and `bin` the
  way a consumer does.

`Dockerfile` is a route of its own and is a *distribution* route, not a sandbox environment - "Docker"
names two unrelated things in this project and only one of them is packaging. It is verified in CI
because Docker is not installed on this machine, and a Dockerfile that has never been built is a
claim. A container-the-application adapter is a different thing entirely and is recorded as blocked
in [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md).

### The third runtime: `extension/vscode`

The VS Code Cockpit is the fourth route and the third runtime, and **it is compiled for a reason that
is a fact rather than a preference**: the extension host is not Node's loader. It loads JavaScript, so
it cannot strip types and cannot run the `.ts` the rest of Veridian runs directly. That is the same
class of constraint as `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, one runtime further out, and it
is why `extension/vscode` is the *only* directory in the repository with a build step - and, since the
phase below, **two** generated artifacts rather than one.

What the phase produced, all measured on this machine:

```
npx tsc --noEmit    silent (exit 0)
node --test         72 tests, 0 failing
npm run build       out/, 6 files
npm run smoke:out   15 checks, exit 0
npm run package     veridian-cockpit-0.2.1.vsix, 12 files, 118.70 KB
npm run smoke:vsix  34 checks, exit 0
npm run gate        exit 0
```

- `src/port.ts` declares by hand the slice of the editor API the Cockpit uses, so the *decisions* are
  testable without an editor; `src/host-boundary.test.ts` makes "only the two host files may import
  `vscode`" an executable rule, and it was falsified (prepending such an import to an ordinary test
  fails it, naming the cause and the remedy).
- `scripts/vscode-stub.mjs` and `scripts/smoke-out.mjs` cover the **compiled** artifact, because
  `node --test` runs `.ts` and the host runs `out/*.js` - the same gap `npm run smoke:dist` closes for
  the package. Falsified: a `main` the build does not produce fails the check and exits 1.
- **The shipping install routes are the development install and a `.vsix`.** The development install
  is a checkout plus F5, configured in `.vscode/launch.json` and `.vscode/tasks.json`; the packaged
  route is `npm run package`, and `scripts/smoke-vsix.mjs` reads the archive back because a `.vsix` is
  a third artifact that no test in either tree can load. The list of what only a real VS Code test
  host could exercise is written out in [`extension/vscode/README.md`](./extension/vscode/README.md)
  rather than left implied.
- `src/packaging.test.ts` holds six facts that are each a way the extension ships broken: that the
  editor floor admits the module format the build emits, that `@types/vscode` is not ahead of that
  floor, that the manifest's `files` allowlist covers the entry point the manifest names, that
  `extension/vscode/LICENSE` is still the repository's licence byte for byte, that the manifest names
  and allowlists the extension icon, and that the icon is the project's own logo byte for byte. It
  reads the floor, the `module` setting and the allowlist out of the files rather than restating them.
- `extension/vscode/out/` and `extension/vscode/veridian-cockpit-<version>.vsix` are generated,
  never edited, never committed, and ignored by `.gitignore` for the same reason `dist/` is: a
  generated tree that is not ignored is one `git add .` away from being committed. The archive rule
  is `*.vsix` rather
  than one filename, so a second target added to the `package` script cannot arrive unignored.

Consequence for anyone touching the CLI: **the source is still the interface.** Keep `cli/veridian.ts`
runnable by `node` directly, and never introduce a step between the source tree and the running
program. The build produces a *second* copy for people who install it; it does not become the way you
run the code.

## Rules this build has paid for

Each of these cost a real defect. They are not style preferences; each one is a way a run has
already reported something that was not true.

- **A textual overlay on a source file must be re-expressed in that file's own line ending.** The
demo's multi-line defect is authored with `\n`; a Windows checkout holds `cart.js` in CRLF, so the
edit matched nothing and the demo reported a `PASS` the application never earned. `defects.ts`
computes the file's newline and converts, and `examples/shopping-cart/demo.ts` learned the same
lesson the hard way - its own copy of the replacement left a defect injected and still printed
"restored the correct app". **There is exactly one implementation of undoing a defect
(`repairOne`), and a function that changes a file must not announce a change it has not verified.**
- **A test that asserts a property of the checked-out file is asserting a property of the developer's
platform, not of the program.** The rule above is right, and the first test written for it was wrong
in the one way that rule does not cover: it read `examples/inventory-db/app/build.mjs` and asserted
`body.includes("\r\n")`. Measured, `git ls-files --eol` reports the committed blob as **`lf`**,
`core.autocrlf` is `true` on this machine and `false` in CI, and there is no `.gitattributes` to
normalise either way - so that assertion was a statement about Windows, and `gate (ubuntu-latest)`
failed on it at `416/417` the first time the workflow ran. It could never have passed there. The
property is not "the file is CRLF"; it is "the overlay is expressed in the file's own ending". Do
**not** "fix" this with `.gitattributes` forcing `eol=lf`: that would delete the CRLF checkout that
naturally reproduces the original defect, and the natural reproduction is worth more than the
tidiness. *The same shape as the `resolveSibling` defect one section down, one layer out: there the
platform was the filesystem, here it is the developer's git configuration.*
- **And that test proved nothing even where it passed, which is the worse half.** Every block in the
inventory demo's defect table is a **single line** - `quantityOnHand: 30,`, `return Math.round(dollars
* 100);`, `WHERE quantity_on_hand < reorder_level` - so `newlineOf`/`inStyle` never touched them and
the line-ending rule was never reached. Measured rather than argued: replacing `newlineOf` with a
function that always returns `"\n"` left that test **16/16 green**. The comment above it claimed "D1's
block is multi-line precisely so that a mismatch would be visible here", and that sentence was false
about the very table it described. The rule is now held by `tests/defect-text.test.ts`, against the
shared implementation, with synthetic multi-line blocks and both endings supplied by the test; under
the same probe it fails **4 subtests**, which is the difference between a test and a comment. The demo
test keeps the honest half - that *its* table is single-line, and therefore ending-insensitive by
construction, so the rule cannot be exercised there and must be tested somewhere it can be. *A test
that passes whether or not the rule holds is not a test. And a green suite is not evidence that a rule
is held - it is evidence that nothing has broken it yet; the evidence is what happens when you break
it on purpose.*
- **A contradiction detector must key on (observable, scenario), not (validator, target).** Two
criteria reading the same selector with different values are the *ordinary* shape of a contract -
add an item and expect 1 row, add and remove and expect 0. Keyed on the target alone, the detector
raised three blocking questions about a correct contract. Whether two different scenarios can both
hold is a question about the application, which Veridian refuses to model.
- **`joinPointer` escapes the tokens it is given, so a pointer that has already been built must
never be passed back in as a token.** Doing so produced `/~1criteria~12/expect/0` - a path naming a
single key, which resolves to nothing. A path is not decoration: the engine writes the operator's
resolution to it and the failure report quotes it. Build paths with the flat form,
`joinPointer("criteria", index, "expect", expectIndex, "target")`.
- **A gap's path names a place that may not exist yet - its container, however, must.**
`hasPointer(document, parentOf(entry.path))` is the invariant; asserting the leaf resolves is wrong,
because a missing key *is* the gap. `tests/definition-resolution.test.ts` holds this line and also
asserts no path carries `~1`.
- **An absolute path must stay absolute.** `nodeIo` joined every caller's path onto its root, so
`--goal D:\repo\examples\goal.yaml` was looked for at `D:\repo\D:\repo\...` and reported as "the
goal file does not exist" - naming a file that was sitting right there, which sends the reader to
check the one thing that is not broken. `memoryIo` had always handled this; the real filesystem now
matches it.
- **Layering is enforced by hand because nothing else enforces it.** `core/*` must not import
`adapters/*`, `validators/*` or `cli/*`. `validators/*` must not import `adapters/*` - the shared
vocabulary lives in `core/environment/web-observation.ts` for exactly that reason. `cli/*` is the
only layer allowed to import all three. `core/clarification` is the lowest layer of all.
- **`tsconfig.json` is strict in ways that change how you write code:** `verbatimModuleSyntax`
(every type-only import needs `import type`), `erasableSyntaxOnly` (no enums, no parameter
properties, no namespaces), `noUncheckedIndexedAccess` (indexing yields `T | undefined`, so
`arr[i] ?? fallback`), and `allowImportingTsExtensions` (imports carry the `.ts` extension).
- **A bundle ledger that only appends describes a bundle that does not exist.** The bundle is
last-write-wins per path: `screenshots/AC-001.png` is the same file on iteration one and iteration
four, because the layout names an artifact by criterion and not by iteration. `RunBundle` appended
every write anyway, so the canonical demo's passing run listed **36 artifacts for 10 files**, naming
`artifacts/AC-001.observation.json` four times with four different sizes (4096, 4096, 3010, 3010) and
leaving a reader no way to tell which size is the file on disk. The ledger is now keyed by path
(`#artifactAt`), so the newest write to a path replaces the row standing for it. *An inventory that
disagrees with `Get-ChildItem` is a claim, not a record.*
- **The loop's three counts collapse different failures into the same numbers, so they cannot be
compared as a substitute for the criteria.** `passed: 3, failed: 1` is what a run reports whether
AC-001 broke or AC-003 broke, and a repeat-run consistency check (M1) that compares counts would call
two runs equal that failed different criteria - the one thing "the same code produced the same result
twice" is supposed to mean. `IterationSummary` now carries `criteria` (every criterion's status *as
that iteration observed it*), because the bundle keeps only the final iteration's per-criterion
detail and the earlier iterations are otherwise unrecoverable.
- **A schema that re-lists a vocabulary its engine owns will fall behind it, and the failure mode is
not a lint warning.** `result.schema.json` enumerated the clarification `origin` values and omitted
`iteration`, which the run itself produces mid-loop, so `finish()` threw while writing the result,
which meant `writeResult` never landed, which meant `world.teardown()` was skipped and the process
outlived its own `INCONCLUSIVE -> stop` (a four-iteration hang, no bundle). The schema now `$ref`s
`ambiguity.schema.json`, and `tests/schema-vocabulary.test.ts` holds the line. *One definition,
referenced.* The same failure was found in the **types**: `IterationSummary` was declared word for
word in both `core/evidence/types.ts` and `core/execution/types.ts`, which is how a field added to one
goes missing from the artifact supposed to contain it. It is now declared once, in the evidence layer
that owns the bundle shape, and re-exported by the execution layer - the same direction `RunOutcome`
already travels.
- **An environment record built before the loop describes the world the run started in, not the world
it used.** `world.transitions` grows while a run works - the reset between iterations is the event it
exists to show - and `loop.ts` read it once, at `prepare()`, then wrote that same value into
`environment.json` and into every `result.json` afterwards. The canonical four-iteration demo resets
the world **three times**, and its bundle recorded seven transitions ending at `ready` before the
first observation: the record said the run never reset. Nothing failed, because nothing was checking -
which is the point. The record is now built by a function, `envRecord()`, called at each write site,
and `finish()` rewrites `environment.json` so the bundle does not end up holding two readings of one
fact (this file frozen at `ready`, `result.json` listing three resets). Found by building the metrics:
M4 counts `from: "resetting"` transitions, and it reported a violation on a run whose own execution log
showed the resets. *A metric that can only agree with you is not a metric - this one disagreed, and it
was right.* `tests/execution-loop.test.ts` holds both halves.
- **A run-time flag has to reach the *plan*, not just the object built from it.** `--browser none`
decided whether to construct a browser and then handed the adapter the environment document, where
`browser.enabled` was still `true`. The adapter can see only the plan, so with no page and a plan that
promised one it named the single cause it could not rule out - "Playwright is not installed" - for a
run where Playwright *was* installed and the operator had switched the browser off on purpose. Four
`INCONCLUSIVE` criteria, one false dependency to go install, and a bundle whose `environment.json`
recorded a world (`browser.enabled: true`, `reproducibility.browser: chromium`) the run never used.
`applyBrowserChoice()` now derives the effective plan once in `cli/arguments.ts` and the CLI builds the
adapter, the loop *and* the record from it; the message for a disabled plan is a fact about the plan,
which is the only thing the adapter ever knew. *An error message may only name a cause the reporter
observed.* `tests/cli-arguments.test.ts` holds the derivation; the two adapter messages were already
held by `tests/local-web-environment.test.ts`.
- **A delta names its subject and its verb in the same order, or it accuses the wrong run.** M1's
differences printed `${runId} vs ${against}: ${detail}` where the detail was assembled
baseline-first: over a real history it read `run-...-073547 vs run-...-072554: verdict: PASS vs
INCONCLUSIVE` about a run that was `INCONCLUSIVE` and a baseline that was `PASS` - an invitation to
debug the healthy run, and one this agent nearly took. The detail is now built run-first, matching the
prefix, and the test looks each value up *by the ids in the prefix* rather than matching a literal
string, so a reordering fails instead of merely changing. *A line that is only ever read by whoever
wrote it agrees with itself.*
- **Print ASCII in anything a console will display.** This machine's code page renders an em dash as
`鈥?`, so a CLI message or a demo line using one arrives as noise. The rule covers every string the program
can print, not just CLI narration: criterion messages, failure reasons, the `failure.md` written into
a bundle, and test titles, because a test runner prints those too. Re-measured rather than trusted:
the tree carries 259 non-ASCII characters and **none is in a string Veridian prints**. 208 sit on
comment lines, 11 are `§` in the `description` fields of `schemas/*.schema.json` - metadata that
`core/schema` never reads, let alone quotes back, since a violation is reported as a `path` and a
`message` - and the remainder is a trailing comment in `.github/hooks/format.mjs`. The only
descriptions that reach a bundle's `failure.md` are the operator's own, read out of their
`acceptance.yaml`. The figure that used to stand here - "roughly thirty such strings" - did not
reproduce when it was checked. *An inventory that only checks the output you happen to look at is a
claim, not a record; so is a count nobody can reproduce.*
- **A runtime documented as "runs TypeScript directly" may still refuse the one copy that ships.**
Both this file and the README said "no build step: Node 22 strips types and runs `.ts` directly". True
for every file in this repository, and false under `node_modules` -
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, raised for an import and for a `bin` entry alike - so
`"bin": "./cli/veridian.ts"` could never have run for anyone who installed the package. The claim was
not wrong about the codebase; it was wrong about the world the codebase would be shipped into, and a
distribution claim is only ever about that world. Distribution is now three routes (`## Distribution`):
the clone still runs source, and the package runs `dist/`, which is why `npm run smoke:dist` exists -
**the shipped artifact is the one no test in `tests/` can reach, so it needs a check of its own.**
- **A file the install path resolves through the *caller's* directory is a file the installed program
  cannot find.** `loadSchemaSet` read `schemas/goal.schema.json` through the operator's `nodeIo`,
  which was correct for exactly as long as the only way to run Veridian was from its own repository
  root. Installed, that path resolves inside the *user's* project, and the error named a missing goal
  schema sitting inside the package - the worst kind, because it sends the reader to inspect the one
  thing that is not broken. The fix is two roots and a vocabulary for them: `core/assets.ts` resolves
  Veridian's own files against `import.meta.url`, `io.ts` resolves the operator's against the working
  directory, and `cli/veridian.ts` uses one port for each. `tests/assets.test.ts` holds both halves.
  *The defect was invisible to the whole suite because every test shared the property that hid it -
  they all ran from the repository root. This is the same shape as "a guard no code path can trip is
  not a guard", one layer out: an environment every test shares is an environment no test varies.*
- **A client that discards a response body is blind by its own hand, and one that then names a cause
it never observed is worse than blind.** `HttpMemory#post()` read only `response.status`, so the
substrate's `403 {"error":"precondition blocked: PII risk=0.90 patterns=[\"PII:...\"]"}` reached the
log as the bare word `HTTP 403`, under a warning that went on to assert the substrate was
**unreachable**. It was reachable and healthy; a content precondition had refused the write. The
false diagnosis was not cosmetic: it sent this agent through four scratch probes and four terminal
runs hunting a host, a payload size, a record type and a header - all four eliminated, none ever at
fault - while the answer had been returned and thrown away two lines earlier. `#post()` now carries
the status *and* the substrate's own stated `error` (preferred over the raw body, flattened and
bounded to 300 characters, and guarded so a non-JSON refusal cannot become a parse error), and the
warning claims only that memory became unusable. `tests/memory-port.test.ts` holds both halves: a
refused write reports `precondition blocked` and does **not** contain "unreachable", while a genuine
`ECONNREFUSED` still does. *An error message may only name a cause the reporter observed - and the
reporter is the only one holding the evidence.* This is also why `core/memory/` has tests now: the
port had none, which is why the defect reached a demo run.

- **A metric that reports `none` for a comparison it never made is the comfortable pass it exists to
  refuse.** `formatMetrics` printed `M3 false PASS: none` whenever it found no false passes, including
  when `--defects` had named nothing - and without a named defect, half of M3 (a `PASS` that blessed
  code known to be broken) is not comparable, because nothing said what was broken. The line claimed a
  clean bill on the strength of the half it could still check. `M2` had always answered correctly
  (`INCONCLUSIVE (no known defects were named to detect)`), so the two ground-truth-dependent metrics
  disagreed about how to behave when the ground truth was absent - and `README.md` already promised
  the behaviour M3 did not have. M3 now says `INCONCLUSIVE`, naming what was left out, while a false
  pass it *did* find is still printed. Found by running the metrics over a paired
  browser/browserless pair, which is also what proves M1 discriminates on real bundles: two worlds,
  one codebase, and M1 named each criterion that moved. `tests/run-metrics.test.ts` holds both halves;
  stashing the fix fails exactly one of the two, which is the difference between a test that passes
  and a test that tests.

- **A platform CI claims to cover, but has never run, is a platform that does not pass.** This file
  said CI "runs `npm run gate` on `ubuntu-latest` and `windows-latest`", and the workflow did - but the
  repository had no remote until this session, so the workflow had never executed once. Its first run
  found **two** defects, both on ubuntu, and both the same bug: a leading separator - or the empty
  first path segment that stands for it - silently dropped. `resolveSibling` (`core/goal/load.ts`)
  skipped every empty segment in order to collapse `.`, `..` and `//`, which deleted the POSIX root
  along with them, so `/home/runner/.../acceptance.yaml` came back as `home/runner/.../acceptance.yaml`
  and `loadDocument` reported as missing a file sitting in plain sight; the demo exited 3 before it
  ever reached a browser. `core/schema/validate.test.ts` built its repository root from `url.pathname`
  with the leading `/` stripped - the very strip that leaves a Windows drive letter intact and turns a
  POSIX path relative - so all six of its schema subtests said `could not be read`. Windows sees
  neither, because `D:/x/a.yaml` has no leading separator and no empty first segment to lose. Both now
  go through the platform-aware primitive (`fileURLToPath`, and a rooted check before the collapse),
  and `core/goal/load.test.ts` exercises the POSIX cases on every platform - which is the only way one
  developer on one platform can hold a two-platform claim. *An inventory that only checks the output
  you happen to look at is a claim, not a record; so is a check that has never run.*

- **A guard that no code path can trip is not a guard, and a bundle field that is a literal is a claim
  pretending to be a record.** The `PASS` rule has three clauses and the third - "there was no safety
  violation" - could not be false. `networkPolicy` and `filesystemWrite` were declared in
  `schemas/goal.schema.json`, defaulted by the clarification ladder, parsed into `GoalLimits`, and then
  read by nothing that could act on them: no occurrence in `core/execution/**`, `core/environment/**`,
  `adapters/**` or `validators/**`. `rollup`'s `noSafetyViolation` was implemented and tested, and
  `loop.ts` read an `options.safetyViolation` the CLI never set, so the value it tested was always
  `null`; `core/evidence/writer.ts` then wrote `safetyViolation: null` as a **literal**, so even a
  violation nobody detected could not have been recorded. The structural cause is the `--browser none`
  defect recurring one layer down: `EnvironmentPlan` had no boundary field, so the adapter - which sees
  only the plan - could not have enforced one even in principle. *A run-time fact has to reach the
  plan, not just the object built from it.* The plan now carries `boundary`, the adapter installs a
  route guard it can actually hold and reports the rest `unsupported`, the loop reads the world's
  crossings when it builds its verdict, and `environment.json` pairs each declared policy with the
  enforcement measured for it. Full audit and design in
  [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md).

- **A reset restores the world; it does not restore the record.** The adapter accrues boundary
  crossings for the run and never clears them on `reset()`, which looks wrong the first time it is
  read - the world it is describing is a fresh one. Clearing them is the defect: an iteration that
  reached outside the boundary would be followed by a clean one, and the run would report `PASS` with
  an empty `crossings` list, the evidence of the violation destroyed by the very act of repairing it.
  That is the shape of false pass M3 exists to refuse. `tests/execution-loop.test.ts` holds it - a
  crossing seen in an early iteration still fails the run after the reset - and the reason is written
  at the field rather than only in the test.

- **The package manager validates the dependency tree, not the metadata that describes the package.**
  Moving `bin` to `./dist/cli/veridian.js` left `package-lock.json`'s root entry still naming
  `cli/veridian.ts`, and `npm ci` accepted the pair without complaint - it was checked by building the
  mismatched manifest-plus-lockfile in a temporary directory and watching the install proceed past the
  sync check. That is the **same shape** as the licence drift this repository already paid for, where
  the lockfile said `UNLICENSED` while the manifest said `MIT` for as long as one had been edited
  without the other. `name`, `version`, `license`, `bin`, `dependencies`, `devDependencies` and
  `engines` are each written in **two** places and reconciled by nothing, so a change to any of them in
  `package.json` has to move the lockfile's root entry in the same pass. `npm install
  --package-lock-only --ignore-scripts` is the tool; `git diff --stat package-lock.json` should show
  one line. *An identifier declared in several places is a claim that will disagree with itself if the
  places are edited independently - and the thing you would expect to catch it does not even look.*

- **A validator family that decides every verdict in its world had no unit coverage, while the other
  family had 26 kB of it.** `validators/playwright/web-ui-validators.test.ts` is a thorough suite;
  `validators/database/` had none, so `db.table`, `db.column`, `db.count` and `db.value` - the four
  functions that decide *every* database criterion's status - were exercised only end to end, by one
  demo, through one contract. The whole family's status semantics were held by a single example. This
  is the same shape as "the shipped artifact is the one no test in `tests/` can reach", one layer in: a
  *verdict path* reachable only through one happy-path demo is a path whose failure modes are untested.
  `validators/database/db-validators.test.ts` now holds the roster, the malformed-observation path, each
  comparison and each status, at 68 tests - **and it was falsified rather than trusted**: replacing the
  number branch in `compareCell` with a single text comparison makes four subtests fail, each naming a
  different property. *Compare families by the coverage they declare, not by whether they are
  implemented - "it works" and "it is tested" are different claims.*

- **A roster in prose and a roster in a registry are two lists of the same thing, and only one of them
  is executable.** `db.query` was named as a member of the database validator family in `README.md`,
  in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` **and** in this file's own layout table, while
  `DB_VALIDATORS` held four entries and no source file mentioned the name anywhere. Nothing failed,
  because a list of names in a document is read by nothing that could disagree with it. It was found
  by the new suite's *first* assertion, which pins `registry.names()` to the four the code exports -
  a measurement of the code, against which three documents were wrong. *A list of names in a document
  is a claim about the code, and the cheapest way to hold it is a test that reads the code.* **This is
  the same shape as a count that does not match the run, and as an identifier written in both
  `package.json` and its lockfile**: a fact recorded in prose drifts because nothing reads it.

- **A requirement that names a *place* must be resolved as a pointer, not read as a literal key.** The
  worlds register declares each adapter's requirements as dot-paths (`cluster.name`,
  `health.path`, `database.path`), and the detector read each one with `Object.hasOwn(environment,
  requirement.field)` - so `cluster.name` was looked for as a key with a literal dot in its name, was
  absent from every correct document, and `clarify` raised three *blocking* gaps for values that were
  sitting in the file. Worse, the operator's answer would have been written to the literal key, so the
  gap would have reappeared on the next run: a question the answer cannot close. Fixed by routing every
  requirement through `getPointer`/`joinPointer` on the split path, which is the same helper the ladder
  already used for criteria. `tests/environment-gaps.test.ts` drives the *real* descriptor table rather
  than a fixture, and holds both halves - a missing nested requirement is reported at its pointer whose
  *container* exists, and an answer lands where the adapter reads it. *A path is not decoration: it is
  where the operator's answer is written and what the failure report quotes.*

- **Two implementations of one rule disagree the first time a world arrives that only one of them was
  written for.** "This world has no HTTP" was decided in two places: the detector's `hasNoHttp`, which
  knew only about a *database file*, and the environment loader's `readBrowser`, which infers a browser
  from the presence of a `url`. `sim-k8s` is a world with neither, so the detector asked it for a URL
  and handed it `expectStatus: 200`, the ladder derived `browser.enabled: true`, and the loader then
  refused the pair it had just been handed - `this definition cannot be run`, before the run ever
  reached the cluster. The predicate now lives once, on the shape of the world (`url`, `databasePath`,
  `cluster`), and the loader and the detector agree because there is one of them. *An environment
  predicate duplicated across two layers is a claim about agreement that nothing checks - and the
  divergence is not a near miss, it is `INCONCLUSIVE` on every criterion at best and a false promise at
  worst.*

- **A capability report must be derived from what the code did, not from a literal list beside it.** The
  `sim-k8s` and `local-db` adapters warned for *every* evidence kind a criterion requested, including the
  `json` artifact the same function had written two statements earlier - so the demo printed
  `produces \`json\` artifacts and cannot produce \`json\`` thirty times, and a reader who learned to skip
  those lines had learned to skip the one that is true. The set is now read off the artifacts actually
  written, so it cannot disagree with them. *A second list is free to drift from the writes; a derived
  one is not - and a sentence that contradicts itself is worse than silence, because it trains the
  reader.*

- **A test that asks whether a value is in a list cannot see a list that is wrong in a different way.**
  The first version of the new suite's strongest assertion was
  `!raised.includes(pointerOf(requirement.field))` - and it **passed with the literal-key defect
  deliberately reintroduced**, because that defect moved the reported path from `/cluster/name` to
  `/cluster.name`: a different list, containing neither the string the test looked for. It now keys on
  `context.reason`, which is unique per requirement and not templated, and asserts the resulting path
  list is empty - under the same probe it fails **three** subtests. *A membership test is a question
  about one string, and a defect is a claim about a set.*

- **A register whose members are schema `oneOf` branches needs a guard of its own.** `STEP_KINDS` in
  `core/acceptance/` and the `Step.oneOf` branches in `schemas/acceptance.schema.json` are the same
  vocabulary written twice, in two languages, reconciled by nothing - so a step kind the engine
  implements and the schema rejects (or the reverse) is a criterion no document can express. Exactly
  this had already happened once in this repository to a *validator name* (`db.rowCount`, unwritable
  under the schema's `^[a-z0-9]+(\.[a-z0-9]+)+$`). `tests/step-kinds.test.ts` now reads the schema and
  pins the register to it. *A vocabulary the engine owns and the schema re-states falls behind the
  engine, and the failure mode is not a warning: it is a document that cannot be written.*

- **A read must not mutate the record it reads.** The substitute control plane recorded a pod's events
  *inside* the derivation of its snapshot, so the first read of a namespace wrote `count: 1` and the
  second wrote `count: 2` - and M1, which compares exactly these documents, would have called one
  cluster two different worlds. A real cluster records its events when its controller acts, not when a
  client looks. `adapters/sim-k8s/cluster-port.test.ts` reads twice and asserts the two documents are
  `deepEqual` and that every count is still one. *An observation that edits what it observes cannot be
  repeated, and a measurement nobody can repeat is an opinion.*

- **A resource that is absent and a request that is refused are two different observations, and HTTP
  already has a word for each.** The substitute control plane answered every route it did not serve
  with `405`, so a request for a resource the cluster does not hold came back as
  `GET is not supported for /apis/apps/v1/namespaces/dev/configmaps` - a message **naming a cause the
  server had not observed**, since `GET` was served and the *resource* was what was missing. It sends
  the reader to inspect their method. A criterion over that status has only one honest translation,
  `INCONCLUSIVE`, for a question whose answer was actually known. An unknown resource is a `404`
  naming it; an unsupported method on a known resource is a `405`. Both are now answered by their own
  condition, and `cluster-port.test.ts` holds each. *A substitute that merges `404` and `405` makes the
  verdict unearned, and an error message may only name a cause the reporter observed.*

- **A probe must be shown to change the thing it claims to change, and to measure the thing it claims
  to measure.** The root `node --test` run reported **695** against a documented 634, and the first two
  probes each pointed somewhere wrong. `git status --short` found the first cause: a stray
  `?? bundle.test.ts` at the repository root, 0 bytes, left behind by a falsification probe whose
  cleanup had failed - and **an empty file is still a test to a discovery runner**, so a failed probe
  had added a test to the very count it was measuring. Deleting it moved the run to 694. The second
  probe *appeared* to exonerate the root runner: renaming `extension` to `extension.hidden` reported
  695 both ways. It proves nothing - **renaming a directory inside the tree does not remove it from a
  recursive glob**, and the tree still held `extension.hidden/vscode/src/*.test.ts`. The decisive
  probe was to ask the root run whether it contained test names that exist *only* in the extension
  (`the manifest and the Cockpit declare the same commands` matched twice): it does. The decomposition
  is 634 + 60 = 694. In the same session a path check printed
  `preLaunchTask matches a declared task : False` for two labels that are byte-identical, because the
  probe rested on a `.Count` produced by a PowerShell pipeline rather than on a count of the objects it
  was assumed to count; compared directly, the two match. *A "control" that does not change the thing
  it claims to change is not a control, and a failed probe is not evidence about the code - in both
  cases the files were right and the measurement was wrong.*

- **A generated tree that is not ignored is one `git add .` away from being committed, and a comment in
  a configuration file is a check you cannot run.** `extension/vscode/out/` existed and was **not**
  ignored - `git check-ignore -v` matched `node_modules/` for the extension's dependencies and nothing
  for its build output, so the next `git add .` would have committed the compiled tree, the same defect
  class as committing `dist/`. The rule is now explicit and re-verified (`IGNORED_EXIT=0`). The other
  half is the `.vscode/launch.json` written first with a `//` block explaining its pre-launch task:
  the configuration was correct and **unverifiable**, because the file stopped being plain JSON to the
  parser anything would use to check it. The comment was moved into the documentation and the file
  reduced to JSON that parses, after which its four path facts could be - and were - asserted.
  *Anything you cannot check, you have to take on faith, and this repository does not.*

- **A flag's value is not an operand.** The `sim-posix` substitute's `adduser` took "the words that do
  not start with `-`" as its operands, so `adduser --system --home /var/lib/cart-web cart` created an
  account named `/var/lib/cart-web` and treated the real name as a group to join - and it **exited 0**,
  so the world reported success for a command it had not performed. A criterion asking whether `cart`
  exists could then never pass, however many iterations re-observed it, and the symptom was a single
  criterion that stopped moving while the rest of the progression descended cleanly. Found by reading
  the bundle's own exec artifact for that criterion, where the account name beginning with `/` was
  sitting in plain sight. *A criterion that stays `FAIL` after its defect has been repaired is a
  defect in the criterion, the target spelling, the substitute, or the reading - not in the repair*,
  and an exit code of 0 is not evidence that a command did what its name says. Held by two tests, each
  falsified by deleting one `index += 1`.

- **A world a run inherits is not a world that run built.** `stop()` keeps the `sim-posix` sandbox on
  purpose, because a bundle quotes paths inside it - so the *next* run's first observation can read the
  previous run's files. `prepare()` made directories without clearing, so the second run's first
  iteration read a `/etc/veridian/policy.conf` that run had never installed (its own application had
  written `policy.cfg`, which is the defect under test) and **two criteria reported `PASS` on an
  artifact from someone else's run**. The next `reset()` wiped it, so the symptom was a progression one
  iteration out of step rather than an error, and the run still ended `PASS` with 13/13 - a false
  `PASS`, the class this product exists to make impossible. It was found by running the demo twice in a
  row and comparing the two progressions, not by reading the port, and the demo's own narration had
  been *right* the whole time while the world was wrong. `prepare()` and `reset()` are now one
  implementation, `rebuild()` - *two implementations of one rule disagree the first time a world arrives
  that only one of them was written for* - and `posix-port.test.ts` holds it by writing a file into the
  tree by hand, asserting it **is** readable first (so the test cannot pass vacuously), then requiring
  it to be gone after a fresh `prepare()`. Falsified: restoring the old `prepare()` fails that test
  alone, 19/20.

- **A repair the world never observed is not a repair.** The first measured `sim-posix` run's second
  iteration was identical to its first, because a change written to the tree had not been re-read by
  the world that judged it. On this adapter the repair is a file write against a tree the *next*
  iteration rebuilds, so the reset is what makes the fix observable - but the rule generalises: *a loop
  that reports progress from its own intentions is reporting the wrong run.*

- **An evidence bundle that omits the actor's own transcript is a bundle a reader cannot audit.** The
  repair agent's stdout was not persisted; diagnosing the `adduser` defect required reconstructing what
  the agent had done from the injected program, the exec record and the reading - the bundle held the
  criteria's evidence and not the actor's decisions. **Built.** `RepairOutcome.transcript` carries the
  gate's own output, `CommandRepairGate` fills it on every answer including the timeout (where the
  partial output is the evidence explaining why the command never finished), and the loop writes it to
  `artifacts/repair-<iteration>.log` *before* it acts on the answer - a transcript that landed after
  the verdict it explains would be a file a reader reaches only once the run is over, and the mid-run
  write is the one an external agent actually reads. It is registered with `kind: "log"` and
  `criterion_id: null`, because a transcript backs no criterion and naming the nearest one would be a
  claim the file cannot support, and it is named in the *same* `iteration.repair` log line as the
  decision it belongs to, because two events could disagree about which iteration the file describes.
  Nothing in the verdict reads it: a repair is believed only once the criteria are re-observed from a
  clean world, which is exactly why it is safe to store verbatim. Held by `tests/command-repair-gate.test.ts`
  (11 tests) and five tests in `tests/execution-loop.test.ts`; falsified rather than trusted - deleting
  `transcript` from one of the three returns fails three named subtests, and making the path
  iteration-independent fails *"keys each transcript to its own iteration"*.

- **A message that copies its input is not a summary, and a bound by lines is not a bound.** The repair
  note quoted the tail of the actor's stderr - `lines.slice(-3)` - which is unbounded in the one
  direction that matters: a command printing a single 4000-character line put all 4000 characters into
  `result.json`, `latest-failure.md` *and* `execution.log`, three files a reader scans rather than
  reads. Found by a test that asserted the note stays a note, which is the assertion that would have
  been written as a formality if the line-based version had been trusted. `tail()` now flattens and caps
  at the same 300 characters `core/memory`'s port already applied to a refused write, keeping the last
  characters because that is where a failure states its cause, with a leading `...` so the reader is
  told something was dropped rather than left to guess. The cap is on the *note*; the transcript beside
  it is the record and is stored whole. Reverting `tail` to the line-based version fails the test that
  names the rule.

- **A record nobody is told about is one nobody reads.** `writeRepairTranscript` names the path it chose
  on the console as well as in the bundle: an operator watching a run in a terminal has no way to guess
  that the actor's output was kept, and which path a transcript lands at is the loop's decision, so the
  loop is what reports it.

- **A step whose name states an outcome must fail when that outcome does not happen** - restated one
  layer in, because the fourth demo is where it was found again. `AC-013` expects the world to *refuse*
  a command naming a path outside the sandbox, and judges the refusal rather than the exit code, so a
  substitute that resolved the escaping path would read the developer's own tree while calling it the
  sandbox's. The criterion's own description carries the limitation it knows about: the validator reads
  the world's *result* and not its stated *reason*, so it cannot distinguish a path that escapes from a
  command the world does not implement. *A verdict may only claim what its reading observed.*

- **A check that waits a fixed number of turns is asserting the machine's schedule, not the program's
  behaviour.** `extension/vscode/scripts/smoke-out.mjs` activated the compiled Cockpit and then awaited
  a single `setTimeout(..., 0)` before reading the status bar, justified by a comment saying one turn
  "is enough for a synchronous dashboard read to have landed". That justification was false about the
  read: `refresh()` awaits `readLastSummary`, which is real `fs` I/O. So the turn is a race, and the run
  that lost it printed `1 of the compiled extension's checks failed` about a **healthy** extension - the
  next three runs of the same gate, one of them from a deleted `out/`, passed unchanged. That is what a
  schedule assertion looks like when it breaks, and *"it passed twice" is not evidence about the run it
  failed on*. The wait is now bounded and keyed on the condition (`settled`), and **the probe is to make
  the thing being awaited arrive late**: with one extra turn injected before the dashboard is written,
  the bounded wait passes and the old fixed-turn wait fails **both** dashboard checks. The bound is the
  other half - a wait that cannot fail would be worse than the sleep it replaced, because it would turn
  every check after it into a formality. The same edit added a check nothing had: the no-folder window
  must *hide* the status bar, which the old sequence never asserted. *A test that waits on a clock is
  testing the clock.*

- **A substitute that resolves a token as a path cannot tell a grant from an escape.** `osEscapes`
  tested a token against `^[A-Za-z]:` to recognise a drive, so `icacls <path> /grant x:(R)` - an
  account named `x` - was refused as a boundary crossing, and so was any registry value whose data
  began `a:b`. The world reported "this names a place outside the sandbox" about a *permission grant*,
  which sends the reader to inspect the path. A drive **path** has a separator after the colon; a grant
  token does not, and a token whose tail has no separator is `parseGrant`'s question, not the escape
  predicate's. Tightened to `^([A-Za-z]):[\\/]`, and the tightening loses nothing: a drive-relative
  spelling (`D:secrets.txt`) still reaches the command, whose own resolution refuses it by name. *An
  error message may only name a cause the reporter observed - and here the reporter named a path it had
  not looked at.* Held in `adapters/sim-os/os-port.test.ts`.

- **A command that skips the world's own path grammar gives one world two answers for one question.**
  Every path-taking command in the substitute (`where`, `icacls`, `chmod`, `reg`) resolved through the
  family's grammar and refused what it cannot express; `type`/`cat` went straight to the host mapping,
  and `path.join` accepts a separator the grammar does not have. So in a Windows world `type
  /etc/os-release` looked *inside the sandbox* for `etc/os-release` and answered "cannot find the path
  because it does not exist" - a missing-file answer for a spelling the world would have **refused**,
  and a second grammar for one world's paths. Resolved first, the two commands agree: both refuse the
  other family's spelling, for the stated reason. *This is the same shape as the environment predicate
  written twice - two implementations of one rule disagree the first time a world arrives that only one
  of them was written for.*

- **Two readings of one fact in one log is one reading too many.** `create()` logged the *resolved*
  sandbox root while `environment.start` logged `this.#plan.os?.root` - the document's own spelling,
  which may be relative to the io root. A reader asking "where did this world actually live" would
  trust the second, and it is not a path this machine can open. The same edit added both to the
  `os.exec` line (`root` as the document spells it, `host` as this machine can open it) rather than
  replacing one with the other, because a log holding only the first cannot answer the question and a
  log holding only the second cannot be compared with the document the reader is holding. *A record
  that disagrees with itself is not a harder record to read; it is a wrong one.*

- **A guard whose null branch is reachable by omitting a field is a guard no document reaches.**
  `linkAcceptance` refuses a contract that names a different goal - but `finalizeAcceptance` sets
  `goalId` to `null` when `goal_id` is absent, the schema does not require it, and
  `examples/sim-os/acceptance.yaml` **did not carry one**. So the newest world's cross-goal
  contradiction guard - the check that stops one goal's criteria being evaluated against another's
  environment - was dormant, while every other demo's contract exercised it. Nothing failed, because a
  guard's unreached branch is silent by construction. The field is now declared, which is what makes
  the guard's live branch live for that demo. *The third occurrence in this repository of "a guard no
  code path can trip is not a guard", after the boundary clauses that could not be false and the
  `--browser none` flag that never reached the plan.* Found by asking why `latest-result.json` had no
  `goal_id` where the other demos' did.

- **A list of variable names recalled in a test is a claim about two files that nothing reconciles.**
  A test asserting the environment names the `sim-os` adapter declares listed `VERIDIAN_OS_HOST_ROOT`
  among them - a name that exists in **neither** file. Its neighbours (`VERIDIAN_OS_ROOT`,
  `VERIDIAN_OS_FAMILY`, `VERIDIAN_OS_SYSTEM`, `VERIDIAN_OS_USER`) were right, so it read as a typo in
  a list rather than as a claim nothing checks, and the list is exactly what a reader consults to learn
  the interface. It now reads the names out of the application's own source
  (`readProvision().match(/VERIDIAN_OS_[A-Z_]+/g)`) and intersects that set with the adapter's - so the
  test's subject is the agreement, not one recalled spelling of it. *Two files that must agree need a
  test that reads both, or the agreement is an opinion.*

- **An assertion against a literal cannot fail, so it is not a test.** The same suite carried
  `assert.match(JSON.stringify(...), /"simulated":"substitute"/)` - a regex matched against a string
  the test itself had just built. It would have passed with the field removed, with the value changed,
  and with the whole reading replaced by a constant. Replaced by an assertion on the reading the code
  actually produced. *This is the falsification probe written as a permanent test: if you cannot say
  what would make it fail, it cannot be doing work.*

- **A roster written as a shared prefix plus suffixes reads as complete while hiding an omitted
  name.** `README.md` printed the browser family as `element, value, text, count, url, console,
  network` - which required the reader to expand `console` into `console.clean` and `network` into
  `network.ok`, and which **omitted `web.visible` entirely**: implemented, exported in
  `WEB_UI_VALIDATOR_NAMES`, registered in `cli/veridian.ts`, and named by no document at all. Found by
  `tests/readme-rosters.test.ts` on its first run, which parses the README's layout block and compares
  each family's printed roster against the constant the code exports - not by reading the README, which
  looked complete. Falsified twice: deleting one name from the README fails the comparison naming it,
  and restoring the shorthand fails *"which is not a validator name - the family prefix was factored
  out into the column, and that is how a name went missing"*. *A document that prints a vocabulary must
  print every member in full, and the cheapest way to hold it is a test that reads both.* The third
  occurrence of the shape the `db.query` / `db.rowCount` entries record.

- **A predicate written as an `||` chain covers a new world with somebody else's block.** Adding
  `os` to `hasNoHttp` left the earlier `posix` test passing unchanged - it iterates its own kind, so the
  new world's predicate could have been wrong in its own way with nothing failing.
  `tests/environment-gaps.test.ts` now runs the HTTP questions against **every** no-HTTP world the
  register names, and it was falsified rather than trusted: deleting `!isMissing(environment.os)` fails
  with `sim-os was asked /url, and it has no address`. *A test that iterates a list can only cover the
  list it was written with; the coverage has to come from the register.*

- **A reading is about the run that wrote it, not the run you meant.** Reading
  `.veridian/latest-result.json` to quote the fifth demo's progression returned four `INCONCLUSIVE`
  criteria - the last run in the bundle was the `--browser none` cart demo, not the `sim-os` demo. The
  figures quoted in `README.md` were re-measured after re-running the demo. *A bundle is a file; the
  verdict in it belongs to whoever wrote it last.*

- **A sub-resource is a query parameter, and a router that matches only the path cannot tell two
  requests apart.** The sixth world's defect D2 is one word: a tagging request aimed at an object
  instead of at the bucket that owns it. The substitute's route table keyed on the path alone, so
  `.../objects/cart.js?tagging` and `.../buckets/cart-assets?tagging` both landed on the same handler
  and the criterion read `PASS` for both - a defect that is *invisible to the world under test* rather
  than missed by it. The sub-resource is now part of the route (`#misplacedSubResource` answers a
  sub-resource asked of the wrong resource with a stated reason naming both) and the log line carries
  `routeAddress`, the request as it was actually made including its query. *A route is a request, not a
  path - and a criterion that can only distinguish two requests by their query string is a criterion
  the router has to be able to distinguish them for.*

- **A refusal with an empty body is an observation nobody can read.** The substitute answered every
  refusal with a status code and nothing else, so the `call` reading recorded *that* a request was
  refused and never *why* - and a criterion about a permission decision is a criterion about the
  reason. `refusalBody(reason, status, message)` now renders `{ kind, reason, status, message }` at
  every refusal site, and the adapter carries it into the reading. *A status code is a verdict; the
  body is the evidence, and a validator may only quote what it was given.*

- **A meter is a count of events, so it is part of the world and has to be reset with it.** The
  sixth world's meter describes the account's *current life*: a reset begins a new one, because a bill
  that carries a previous world's writes into a fresh one describes two worlds with one number. The
  rule generalises past cost: any reading that is a function of the run's own history - a counter, a
  log, an event list - is state, and a reset that restores the resources and not the history leaves a
  bundle whose evidence belongs to an iteration the reader is not looking at.

- **A capability only one world has must be refused by name everywhere else, or a contract that means
  nothing there is silently judged there.** `call` is the sixth step kind and the only one that puts
  *the criterion's own* request to the world; the other four adapters refuse it by name, and the cloud
  plan - and only the cloud plan - admits it. That refusal is the reason a cloud contract cannot drift
  onto a world where "make this request and read the answer" has no meaning. *A vocabulary that grows
  must grow its refusals with it: a step kind recognised by the schema and unhandled by a world is a
  criterion reported `INCONCLUSIVE` at best and fabricated at worst.*

- **A rendering pin must be measured against the source, not recalled.** The action vocabulary admits
  `s3` as a service segment and camel-case verbs (`putBucketVersioning`, `createBucket`), so the
  pattern that guards it is `/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/` - which the first attempt, a
  tidy `/^[a-z]+(\.[a-z][A-Za-z]*)+$/` recalled from the *validator* naming rule, rejected outright.
  The two rules are different because the two vocabularies are different, and the one next door looked
  close enough to reuse. `statementSpelling` had the same shape of error in its own doc comment: it
  described four fields and renders three (principal is deliberately absent, because a statement is
  read for what it grants rather than for whom it happens to name). *An assertion about a message is an
  assertion about the code's wording - read the wording from the source.*

- **A defect table and the test that reads its `correct` blocks must both convert line endings, and
  the half that fails silently is the negative one.** The sixth demo's test asserted
  `program.includes(defect.correct)`, and `D4` is the only entry whose block is multi-line - so on this
  Windows checkout, which holds `provision.mjs` in CRLF, that assertion could never match a block
  authored with `\n`. `examples/defect-text.ts` exists to encode exactly this (`defectStates` converts
  through `inStyle` before counting) and the test was written as if it did not. It now goes through
  `occurrences(program, inStyle(block, newlineOf(program)))` and asserts an exact count of **1** for
  the correct form and **0** for the defective one - which is stronger than the old check in the way
  that matters, since `String.replace` edits the first match and a second occurrence would leave one
  site unedited. And the rule is not only about the positive half: an ending-blind `!includes(defective)`
  is **true for every file**, so the assertion that the shipped program is correct was the one that
  could fail while the assertion that it is not defective could not. *A line-ending-blind assertion
  measures the developer's `core.autocrlf`, and its negative half passes vacuously - which is worse
  than failing, because it reports a rule held that nothing checked.* This is the second time this
  repository has paid for this rule and the first time the *test* paid rather than the demo; the entry
  above about `defects.ts` is the first.

- **An assertion that every identity in a contract equals the plan's identity assumes the contract
  holds one identity.** The sixth demo's contract names `principal/svc-cart` - the account the
  application runs as, which the plan states - **and** `principal/svc-reader`, a reader the program
  itself creates for the front end. Both are legitimate, and the test that asserted every name in the
  contract equalled `cloud.principal` failed on a *correct* contract. It now derives the set from the
  contract, asserts it is exactly those two, that neither is privileged, and that each is either the
  plan's principal or a name the program actually creates - so a future criterion naming an account
  nobody wrote fails, which is the check that keeps a criterion from judging a policy that does not
  exist. *Read the document before asserting what it cannot contain: "the identity the run judges as"
  and "the identity a criterion asks about" are two different questions, and a contract may answer
  both.*

- **When a test fails, read the failure before choosing a hypothesis - and only then decide whether
  the product or the test is wrong.** Both failures this segment were the test's, and both were
  diagnosed by reading the assertion rather than by re-running it: one asserted a property of the
  developer's git configuration, the other a property the contract never had. Neither was a guess -
  each was a reading of the failure message, which named the value and the expectation. The
  complementary rule is the repository's older one: a green suite is evidence that nothing has broken,
  not that a rule is held. Both fixes were therefore **falsified** - one by filing a defect against a
  criterion no defect claims, one by putting a typo into a `correct` block - and each probe failed the
  named subtests before being reverted. *"The test is wrong" is not a hypothesis; it is a
  conclusion, and it needs the same evidence as the reverse.*

- **A comment beside a narration line that claims what a test does becomes false the moment the test
  changes.** The demo's `filed against: ...` line carried a comment explaining that the filed criteria
  excluded the criteria that move *with* a defect - a claim that was true of an earlier test and
  contradicted the one that shipped, which asserts the report names every further criterion that moves.
  The narration and its comment are one artefact; a change to either has to be read against the other
  in the same pass. *Prose next to code is a claim about the code, and it goes stale at exactly the
  moment the code moves.*

- **A one-character edit is never one fact, and a defect table needs controls before it can have a
  headline.** The seventh demo's bind mount is misspelled by one character (`./contxt` for `./context`),
  and that single character moves **seven** readings: the mount criterion reads `source absent`, the
  container it belongs to stays `created` and never `running`, its healthcheck never runs, both of its
  captured output streams are empty, and the criterion's own `exec` never reaches a process - because
  every one of those is a *separate true consequence* of a mount the world could not resolve. That is
  what makes the other three defects the controls: `D1`, `D2` and `D3` are each read by exactly one
  criterion, so a reader can see one edit produce one reading before watching one edit produce seven.
  *A defect table whose entries all move many criteria has no control in it, and a demo with no control
  cannot show that its readings are caused by the edit rather than by the world being flaky.*

- **A program's completeness line must count the arrays it actually sent.** The seventh demo's
  provisioner prints `cart-web provisioned: N files, M commands` where both figures are read off the
  arrays it wrote - which is why no test may assert that the application's source *contains* that
  sentence. It does not, and could not: a line assembled from a constant and two lengths is not a
  literal anywhere in the file. Assert it against a reading of the run, or against the pattern the
  readiness check matches, and nowhere else. Its sibling: **an application may not read stdin**, because
  `nodeProcessRunner` spawns with `stdio: ["ignore", "pipe", "pipe"]` - so a program that prompts gets
  an immediate EOF, not a hang, and a criterion that waits for the prompt waits forever.

- **A self-declaration about a program is a legitimate defect target precisely because nothing in the
  world reads it.** `D3` edits the service-start banner the application prints on stderr. No validator
  in the family consults it, no other criterion moves with it, and it changes nothing about the world -
  which is exactly what makes it the control: it is the one defect whose consequence is *only* the
  criterion that names it, so a run that repaired it can be distinguished from a run that repaired the
  world around it. *A defect that changes no state is not a weaker defect; it is the measurement that
  the rest of the table is calibrated against.*

- **A world's stated limits belong in the value the criterion compares, or the comparison asserts
  something the world does not do.** `container.limit` compares `memory 268435456 bytes, cpus 1, pids 64
  (declared, not enforced)` and `container.port` compares `18080:8080/tcp (exposed)`. Drop the
  parenthetical and both comparisons become false claims: the first would say a limit *held*, the second
  that a port was *reachable*. A substitute that is honest about its own boundary has to carry that
  honesty into the comparison, not only into its documentation. *A rendering helper's name is not the
  value its sibling validator compares - read the helper before writing the expectation.*

- **An assertion that every expectation on a criterion is one validator is a claim the contract never
  made.** The seventh demo's `AC-026` is judged by `container.probe` **and** by `container.logs` - both
  legitimate, because the criterion asks whether the probe succeeded and what the container said while
  it ran. A test that asserted every expectation on that criterion was `container.probe` failed on a
  *correct* contract. It now derives the validator set from the contract and asserts the one property
  that actually matters: every name in it is a registered validator. *Read the document before
  narrowing it - "the validator this criterion is about" and "the validators this criterion uses" are
  two different questions.*

- **A repair agent walks the defect table in criterion order, so a test that walks it backwards is
  testing its own loop.** `repair.ts` picks the first unrepaired defect whose criterion is failing, so
  the seventh demo repairs `D1` then `D2` then `D3` then `D4` - and the first version of the demo test
  asserted the reverse order (`D4` first) and failed against a working agent. The order is a property
  of `repair.ts`, not of the table, and a test that re-derives it from its own iteration must read the
  file it is describing. The repair counts it asserts are `[4, 3, 2, 1, 0]`.

- **A correction to a count in prose is a correction to a claim about a register, so read the
  register.** `README.md` said a step is "one of seven kinds" while `core/acceptance/steps.ts` holds
  **eleven** in `STEP_KINDS` - a figure that had drifted through four new worlds without anything
  reading it. The same pass found `AGENTS.md` quoting `1273` tests and `1213` of the tree's own, where
  the measured run was `1456` and `1396` - and the count stands at `2190` and `2118` as this is
  written, which is the rule demonstrating itself. *Both are the same defect as a roster printed in a
  document: a number is a claim about the code, and the cheapest way to hold it is to read the code -
  the difference is that a number cannot be pinned by a test the way a name can, so it has to be
  re-measured at the moment the document is touched.*

- **A document that names what a world *substitutes* is making a claim about a `*_SIMULATED_SURFACES`
  constant, and a claim nothing reads drifts.** `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 recorded
  `sim-posix` as substituting *"Kali's attack network"*, and `POSIX_SIMULATED_SURFACES` says the
  opposite in as many words: its `egress` member reads *"the sandbox has no network beyond its own
  loopback listeners; egress is refused, not routed"*, and `posix-port.ts` refuses the one command that
  would need one with the reason `this world has no egress; nothing outside 127.0.0.1 can be reached
  from the sandbox`. So the cell named a surface the world deliberately refuses as though it were a
  feature, and omitted four the world does declare (`package-index`, `permissions`, `egress`,
  `provisioning`). It was found by comparing the two lists, not by reading the sentence - which read as
  complete, because three of its four tokens were right and the fourth had the shape of a name. The
  five `sim-*` cells now print their constants' members verbatim, and `tests/simulated-surfaces.test.ts`
  reads both sides: a declared world must print exactly the declared set, and a world the document
  calls **built** may not print a backticked surface no constant declares. Three assertions, each
  **falsified rather than trusted**: restoring the original sentence fails subtest 1 with both sides
  printed; reintroducing `attack-network` as a backticked member fails the same subtest with a message
  naming the invented surface; and putting a backticked name on `local-web`'s row while camel-casing
  one container surface fails all three, exit 1. *This file now states the rule about three different
  vocabularies - a validator name, a step kind, and a simulated surface - and the third was still in
  the wild because it is the one no schema carries: `STEP_KINDS` and the validator rosters have
  `schemas/` files that re-state them, and nothing re-states a surface.*

- **An engine floor is a claim about the world a file ships into.** `extension/vscode/package.json`
  declared `"engines": { "vscode": "^1.94.0" }` **and** `"type": "module"`, so the compiled
  `out/host/activate.js` is an ES module - and the Node.js extension host could not load one until
  VS Code **1.100**. The declared floor was six minor releases below the first host that can activate
  the file, so on 1.94 through 1.99 the extension would install cleanly and then never start, which is
  the worst shape a compatibility claim can take: nothing errors at install time. Read out of the
  release notes rather than recalled - *"ESM support for extensions - The NodeJS extension host now
  supports extensions that use JavaScript-modules (ESM). All it needs is the `"type": "module"` entry
  in your extension's `package.json` file."* The floor is now `^1.100.0` and `@types/vscode` matches
  it, and `src/packaging.test.ts` reads the module format out of `tsconfig.json` and the floor out of
  the manifest and asserts the second admits the first - so the pair cannot drift apart again.
  Falsified by restoring `^1.94.0` and watching it fail naming the version. *A package that installs
  and cannot start is indistinguishable from a working one until somebody uses it.*
- **A packaging tool packs what the manifest allowlists, and warns rather than fails about a licence
  it cannot find.** `vsce` force-includes exactly two things - the manifest and the README - and
  derives everything else from the manifest's `files`. With `files: ["out"]` the extension's licence
  was outside the allowlist, so it did not travel, `vsce` printed `WARNING LICENSE, LICENSE.md, or
  LICENSE.txt not found`, packaged **10** files and **exited 0**. A warning is not a check, so the
  build stayed green over an extension that would have been redistributed without the licence it is
  redistributed under. `LICENSE` is now listed, the copy at `extension/vscode/LICENSE` is compared
  byte for byte against the repository by `src/packaging.test.ts` and again inside the archive by
  `smoke:vsix`, and both halves were falsified - appending a line to the copy fails with *"the licence
  in the archive is the repository's, byte for byte (1388 bytes)"* and exit 1, and taking `LICENSE` out
  of `files` fails *only* the archive's licence check, because the packaging step reports nothing.
  *The tool's behaviour was read out of the tool* - both the licence filter and the `LICENSE` to
  `LICENSE.txt` rename come from `@vscode/vsce`'s own source, after the first hypothesis (that `files`
  was widening to `src/`) was falsified by an archive whose `src/` list was empty.
- **An archive is a claim about the extension, and a stale one is the quiet failure.** `npm run gate`
  rebuilds `out/`; packaging is a separate step and a separate tool. An archive built before the last
  source edit installs an extension nobody compiled, and *both* of the things a reader would check
  first - its file count and its manifest - are entirely correct. `smoke:vsix` compares every compiled
  file in the archive with the build's bytes, so staleness is a failure rather than a silent second
  copy. Falsified: a byte appended to `out/bundle.js` after packaging fails *"every compiled file in
  the archive is byte-identical to the one on disk"* and exits 1. *An archive has to be read back to
  be known, which is the same reason `smoke:dist` and `smoke:out` exist - one runtime further out
  each time, and never optional.*

- **A guard built on a `*_SIMULATED_SURFACES` constant has to be extended in three places at once, and
  the new entry has to be falsified.** `tests/simulated-surfaces.test.ts` reads four things that must
  agree for the eighth world to be covered: the constant's import, its entry in `DECLARED`, the
  document's world table, and the row's `Status` cell. Adding the import and the table entry while the
  document said `vscode-host ... planned` would have left the world unchecked - and a loop over a
  correct list passes for the *wrong* reason right up until a member is missing. The entry was
  therefore falsified by deleting `` `workspace` `` from the document row: `2 pass / 1 fail`, naming
  `'workspace'`, then reverted. The same shape one file over: `tests/readme-rosters.test.ts` was
  extended with the ninth validator family and falsified by dropping `vscode.probe` from the README's
  roster (`1 pass / 1 fail`, naming it), because a roster guard that has never been broken is a guard
  nobody has watched work. *A document that prints a vocabulary must print every member in full - and
  the way to know the guard holds it is to take one out and watch it fail.*

- **A predicate written twice is a diverging pair, and the half that lags is the one nobody reads.**
  `hasNoHttp` in `core/clarification/detect.ts` decides whether a world is asked for a `url`, a
  `health.path` and a `browser.enabled`, and it had grown its **eighth** clause
  (`!isMissing(environment.vscode)`) when the eighth world landed. `tests/environment-gaps.test.ts`
  carried the same vocabulary a second time, by hand, as `NO_HTTP_KEYS`, and its derived assertion
  named the six non-HTTP worlds it expected to cover - so the *test* had fallen one world behind the
  *detector*. Nothing failed, because the detector was right: the world was skipped correctly and the
  test simply did not know it had been. The list now names seven shapes and the derived set names
  seven worlds, and the test is what proves the detector has not quietly lost one. *A test that
  re-states a predicate rather than iterating the register can only cover the worlds it was written
  with* - the same rule the `hasNoHttp` `||`-chain entry already records one layer up, arriving this
  time at the test rather than at the code.

- **A vocabulary spelled as a `oneOf` of `const` branches is invisible to an `enum` walker, so the
  guard keeps passing while describing nothing.** `tests/schema-vocabulary.test.ts` exists to hold
  `RUNGS` and the ambiguity schema to one list. The ladder is written as `oneOf` branches of
  `const` - one branch per rung - because that is what lets each branch carry its own fields
  (`evidence`, `confidence`/`source`, `assumption`, `answer`, `reason`). A walker that collected only
  `enum` arrays therefore found **no** ladder and reported no disagreement, which is the vacuous
  pass, not the clean one. `via` had been listed in the vocabulary's `slots` since the guard was
  written, so the guard *named* the slot it could not see. The walker now reads `const` strings too,
  groups them by their parent `oneOf`, and a second assertion pins the schema's rung order to the
  engine's own walk - because a schema that prints the rungs in one order while the engine walks them
  in another documents a ladder nobody implements. *This is the fifth occurrence of "a vocabulary the
  engine owns and the schema re-states", and the new twist is the shape of the re-statement: an
  `enum` is one list, a `const` group is one list written as N siblings, and a guard that reads one
  spelling is blind to the other.* Read the schema's own JSON before trusting a walker's silence.

- **Inserting a rung renumbers every rung after it, and prose is read by nothing.** Adding
  `self_prompted` between `defaulted` and `answered` invalidated **six** independent claims, none of
  which any compiler reads: four numbered rung markers in doc comments and a test title
  (`core/clarification/engine.ts`, `core/clarification/types.ts` x3,
  `core/clarification/engine.test.ts`); the ladder roster printed in this file's own layout block
  (`(derived → inferred → defaulted → answered → deferred)`); and, in
  `docs/IMPLEMENTATION-PLAN.md`, the `Resolution` union, the ladder diagram, the heading *"3.5 The
  exit - four independent stops"*, the row `| maxRungsPerAmbiguity | 3 |` naming a policy field that
  **does not exist in `Policy` at all**, the claim *"No rung is retried. The ladder is a straight
  line, so it terminates in <= 5 steps by construction"* (rung 4 is exactly the rung that may retry),
  and two port-class names recalled rather than read (`CliPromptPort`, `ScriptedPromptPort`; the code
  exports `createCliPromptPort` and `scriptedPromptPort`). `npx tsc --noEmit` stayed silent through
  every one of them, and so did the whole suite. The test title was the one that *mattered* - it read
  *"stop 4 - the ladder is a straight line, so termination needs no budget"* and it was asserting a
  product-wide property that the new rung makes false - so it was retitled to name its own subject
  (*"with no self-prompt port every rung is attempted once"*), which is true, rather than deleted.
  *A numbered marker, a heading that counts its contents, and a roster in a document are three
  spellings of one claim: "this is what the code holds". The cheapest way to hold a name is a test
  that reads the code, and the only way to hold a number is to re-measure at the moment the document
  is touched - which is why this file says so in four separate entries now.*

- **A probe's anchor text obeys the file's line endings, and a skipped probe reports a verdict it did
  not earn.** The rung-4 falsification harness edits `core/clarification/engine.ts` by string
  replacement, and its second probe - the one that deletes the wall-clock ceiling - was authored with
  `\n` while the file holds `\r\n`. The anchor did not match, so the probe printed
  `SKIPPED - the anchor text is not in the file` and the harness went on to print
  `verdict: every probe fired = false` - a **true** reading of the harness with a **wrong** implied
  cause, since the two probes that did fire proved the code was fine and only the third was untested.
  The fix is three lines - detect the file's EOL, and route every anchor and replacement through it -
  after which the probe fired on its first re-run and named subtest 26, *"the wall-clock ceiling is
  the bound an attempt cap cannot replace"*. *This is the third time this repository has paid for the
  CRLF rule and the first time it was paid at a probe rather than at a demo or a test*, and the
  distinction is worth keeping: a skipped probe does not fail, it **silently reduces coverage**, so
  the harness must not treat "did not fire" as "did not matter". *A probe that cannot run is not
  evidence, and a verdict line computed over a skipped probe is a claim about work that did not
  happen.*

- **An assertion about a message must read the message's wording from the code, not recall it.**
  The new `createSelfPromptPort` suite asserted the decline note matched
  `/confirmed:2|"confirmed":2/` - the colon-shaped field format a reader expects from a structured
  logger. `consoleLogger` renders fields as `key=value` inside parentheses, so the measured line is
  `veridian debug: self-prompt declined (path=/target attempt=1 confirmed=2)` and the assertion failed
  against **correct product code**. The failure message printed `actual:` with the real line, which is
  what made the diagnosis a reading rather than a guess, and the assertion was replaced by that exact
  line. *The generalisation is not "logging tests are brittle" - it is that a test asserting a
  message's shape is asserting a property of the formatter, so it has to quote the formatter rather
  than an expectation of it.* The same pass produced its sibling: the port's hostile-inputs loop
  wrote `candidates: candidates as readonly string[]` and `npx tsc --noEmit` answered `TS2352`,
  *"Conversion of type `number[] | boolean[] | ...` to type `readonly string[]` may be a mistake"* -
  a cast is a claim, and when the compiler disputes it the type should be declared
  (`readonly (readonly unknown[])[]`) rather than asserted away.

- **The empty string is a value a criterion writes on purpose, and the one guard that read it as a
  missing field was the one asking the wrong question.** The tenth world's `AC-002` asserts
  `process.stdout` `equals: ""` - "the program wrote nothing to stdout while refusing" - and
  `clarify` refused the contract, reporting *"states no comparison"*, because the predicate deciding
  whether an expectation compares anything was `isMissing`, and `isMissing("")` is `true`.
  `isMissing` answers *"did the author supply a value"*, which is the right question for every field
  the ladder fills in and the wrong one here, and the code already said so twice: `core/validation/
  assertions.ts`'s `statedComparisons` keys on the property being **present**, and
  `core/acceptance/plan.ts` refuses on the same presence test - so `core/clarification/detect.ts` was
  the one place that disagreed, and the tenth contract was the first to write the sentence and be
  refused for it. The failure mode was the worst one available: a **run-blocking** question the
  operator could not answer, because they had already answered it. The fix is narrow on purpose -
  `statesComparison(key, value)` accepts `""` for `equals` and keeps `contains: ""` and
  `matches: ""` refused, because every string contains the empty string and the empty pattern matches
  everything, and those two genuinely are the always-passing expectation the check exists to refuse.
  *Widening `isMissing` itself would have been the easier edit and the wrong one: the defect was in
  the guard's predicate, not in the input, and a guard relaxed at the wrong seam stops guarding.*

- **A path field resolved at one seam and re-resolved at the next is a doubled path, and the marker
  of the defect is an error naming a path the operator never typed.** The tenth world's plan gets its
  own copy of a rule the ninth world wrote: `databasePath` and `appPath` are resolved against the io
  root by the loader, so anything an adapter resolves *again* becomes `…/sandbox/…/sandbox`. Measured
  rather than reasoned about: the first run reported `ENOENT` for a doubled sandbox root while the
  directory was sitting there under the single spelling. The accessor is now one function,
  `#hostRoot(block) = this.#io.resolve(block.root)`, called at every accession site (the file probe,
  the `PROCESS_ENV` table, both `#spawn` sites and both `hostRoot` readings), so the second
  resolution cannot be written by hand anywhere. The complementary half is the distinction that makes
  the fix non-mechanical: **a value handed to a *child process* must be absolute** - the child's cwd
  is the application's own directory, not the tree root - **while a value the adapter itself opens
  against the process cwd may stay root-relative.** *A rule paid for at one world and not restated at
  the next is a rule that has not been learned; the second occurrence is the one that proves it.*

- **A reading's field is not inert: a validator family's rendering helpers are part of its contract
  surface.** `process.host` is a *targetless* validator - it asks about the world itself - so the
  string it compares is not read out of the raw observation by the criterion but built by
  `renderHost(data)`, and `renderHost` reads `data.root`. Which means the observation's `root` field
  does not merely describe the world: it **is** the value `"cart-builder (root sandbox)"` is compared
  against, and any edit to how that field is produced silently changes what a targetless criterion
  asserts. Held by a test that reads the contract's own expectation and the adapter's own reader
  rather than by a comment. *A field nobody's criterion names directly is a field nothing appears to
  depend on - and the renderers are where that appearance is wrong.*

- **A contract that pins the byte count of a stream the application composed from a value the world
  supplies is pinning that value.** `AC-002` originally compared the whole of `process.run`'s
  rendering, `"exit 2, stdout empty, stderr 2 lines (N bytes)"`, and the refusal quotes the absolute
  path it could not read - so `N` moved with the length of this machine's checkout, and the assertion
  was about the operator's directory name rather than about the program's behaviour. It now compares
  `"exit 2, stdout empty, stderr 2 lines"` and lets the family's `process.size` reading carry the
  length where a length is the point. The distinction that keeps the rule from over-reaching is in
  the same file: `AC-005` legitimately pins `42` bytes of a file whose text the program composes from
  a constant, and legitimately compares the other refusal's rendering *with* its `(36 bytes)`,
  because nothing in that stream is machine-dependent. *The question is never "is a byte count too
  strict"; it is "does this length depend on something outside the world". Found by running the
  contract against the correct program rather than by reading it.*

- **A defect aimed at a criterion must not take down the world.** `D3` was first authored to misspell
  the word `ready` in the daemon's banner - which is the line the world's `start.readyPattern` waits
  for - so `probe()` timed out, the run never came up, and the criterion it was filed against never
  got the chance to move. The demo reported `INCONCLUSIVE` four times and exit 2 for a defect whose
  *intent* was to be observable. It now misspells `channel` instead: the banner still names the
  daemon, the pattern still matches, the world starts, and the criterion reads `FAIL` for the reason
  it was written to catch. Held by a guard that asks the source, with each defect applied in turn,
  whether the readiness line survives - *and the positive control beside it* (`assert.notEqual(edited,
  program, …)`) is what keeps that question from being asked of a defect whose block is not in the
  file at all. *A comment saying "do not aim a defect at the readiness line" is not a guard; the
  guard is a test that applies the defect and re-reads the line.*

- **A reading must record the world's own spelling of a declaration, and the host path that
  declaration resolved to must be a second named reader of the same field rather than the same
  expression read twice.** The tenth world's reading carried the *accession* path - the absolute,
  machine-specific spelling - so whether `AC-003` passed depended on how the operator had spelled
  their `--goal`, which is an artefact of the command line and not of the world. Proved by a
  one-variable experiment rather than argued: the same tree, run twice, with `--goal examples/
  local-process/goal.yaml` and with the absolute path, gave `exit 0` and `exit 1` respectively, with
  `AC-001` the only mover. There are now two named readers of one field and they are documented as
  reading it for opposite purposes: `#hostRoot(block)` is the accession, used wherever this machine
  must open the directory, and `#declaredRoot(block)` is the declaration, used wherever something is
  *written down* - so the reading records `"root": "sandbox"`, which is what the environment document
  says and what a human can check against it. `adapters/local-process/process-port.ts` carries the
  same distinction at its own seam: `FileProbeRequest.root` takes the **accession, never the
  declaration**. *A field that is both an input to the agent and an output of the recording is two
  fields in one slot; name them separately or a future edit will conflate them.*

- **A defect's `criterionId` is a claim that its block sits on that criterion's code path, and the
  only way to hold that claim is to compile, inject, run and watch.** `D4` was filed against `AC-006`
  - a criterion about the narration `add` prints on stdout - while its block edited the *stderr*
  branch inside `verify()`, so the criterion it named could never have moved however many iterations
  the loop ran. Nothing failed: the demo still descended to zero, because `D4` had *some* effect
  somewhere else, and a reach table written from the defects' names agreed with the names. It was
  retargeted to `add()`'s own `say("out", …)` line, and the row probe that caught it - edit the block,
  run the program, read what the world answers - now stands as the guard, with the reach map derived
  from the engine's parsed comparisons rather than recalled. *A defect table and the criteria its
  entries name are two lists of the same thing, and only one of them can be executed.*

- **A scan for which criteria a defect moves is a substring test over serialized text, and one
  document's serialization of a value can be a substring of another's.** The first version of the
  tenth world's reach derivation asked whether `JSON.stringify(expectation.raw)` contained
  `"equals":4` - and `AC-006`'s size expectation serializes as `"equals":42`, so `D2` was credited
  with a criterion it does not touch and the derivation disagreed with the run. It now reads the
  values through the keys the engine itself parsed (`expectation.comparisons.map((key) =>
  expectation.raw[key])`) and compares them **typed** - `value === 4` for a number, `typeof value ===
  "string" && value.includes(needle)` for a string - so the question is about a value and never about
  how a document happens to render one. *Serialization is not meaning: a text scan answers "does this
  string appear", and the question was "is this the value".* Held and falsified (`equalsNumber(4)` →
  `equalsNumber(404)` fails the row it belongs to).

- **A guard about a *line the world prints* must be asked of the source with the defect applied, not
  of the defect's block.** The tenth demo's `D3` is safe only for as long as the line it edits is not
  the line the readiness pattern waits for, and the property is about the *edited* program, so it
  cannot be read off the defect's own text: the guard composes `program.replace(defect.correct,
  defect.defective)`, asserts the result differs from the shipped program - which is the positive
  control that stops a stale anchor from passing vacuously - and only then asserts the readiness
  literal survives. Both halves are needed and both were measured. The rule is written at the field in
  `examples/local-process/defects.ts` as well as in the test, because the next author of a defect
  reads the table and not the suite. *A guard that asks a defect a question about itself answers a
  question about its spelling; the world only ever sees the edited file.*

- **A test that re-states a predicate rather than iterating the register can only cover the worlds it
  was written with - and the recurrence is the proof.** `core/clarification/detect.ts`'s `hasNoHttp`
  grew a clause per world and was **correct** when the tenth landed (`!isMissing(environment.process)`
  as its eleventh clause); `tests/environment-gaps.test.ts` carried the same vocabulary a second time,
  by hand, as `NO_HTTP_KEYS` and a derived set naming the worlds it expected - and neither had been
  extended. Nothing failed, because a stale *test* list is silent by construction: the detector
  skipped the new world correctly and the test simply did not know it had been. This is the **second**
  occurrence of exactly this shape, after the `||`-chain that covered a new world with somebody else's
  block. Fixed by adding the shape and the world, **falsified 2/2** (dropping the detector's clause
  fails with *"was asked /url, and it has no address"*; dropping the test's key fails with *"one
  registered world per no-HTTP shape"*). *The fix procedure is: read the code first, then the test -
  never the other way round, because the code is the thing that was right.*

- **A probe harness must decide the file's line ending from the file it is about to edit, and it must
  print what it detected.** This is the CRLF rule discharged by construction instead of by
  remembering, and it exists because remembering had already failed twice at probes. Every harness
  written since computes `eolOf(path)` per file, composes each anchor and each replacement through it,
  and reports the detected endings on its own output line
  (`line endings: detect.ts="\r\n" gaps.test.ts="\r\n"`), so a future EOL mismatch is visible in the
  transcript rather than in a wrong verdict. *A harness that hard-codes its ending is a harness that
  silently under-tests on one platform; a harness that prints what it detected is one whose coverage
  can be read.*

- **A world that stands nothing in gets no simulated-surface constant and no `simulated` field, and
  the absence is a claim rather than an omission.** `local-process` is the second world in this tree
  that is entirely real, so there is no `PROCESS_SIMULATED_SURFACES` and none is wanted, its reading
  carries no `simulated` key, and `cli/worlds.ts` says so where the adapter is registered rather than
  leaving it to be inferred from the file's silence. The distinction the whole set rests on is that a
  simulated world must be *recorded* as simulated and a real one must not be decorated: a field
  reading `simulated: none` would suggest the other answer had been available. And the corollary that
  has now held eight times: a tenth validator family whose world has no socket, no page and no
  substitute still needed **no change in `core/`** beyond its own reading vocabulary.
  `tests/local-process-demo.test.ts` asserts the absence directly, because a claim nobody reads is a
  claim that drifts. *Two worlds' worth of proof that `EnvironmentAdapter` is a seam is worth more
  than two worlds' worth of interface; the rule that keeps the proof honest is "say which, and say
  it where the world is registered".*

## Documentation

| Document | Contents |
|----------|----------|
| [`README.md`](./README.md) | The front door: what Veridian is, the two governing rules, the quickstart, the canonical demo's real output, the CLI and its exit codes, M1..M5, the contract formats, the layout, and what is deliberately out of scope. **Keep it true; correct it in the same pass as the change that falsifies it.** |
| [`docs/PLAN.md`](./docs/PLAN.md) | The authoritative product and architecture specification: product definition, scope boundary, execution lifecycle, acceptance/validation model, MVP scope, repo structure, 4-week build plan, Definition of Done, roadmap. **Read before any non-trivial design decision.** |
| [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) | What was actually built against that plan: module inventory, the decisions taken and the ones reversed, the open items. **Read before assuming something is missing.** |
| [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md) | Why the goal's safety limits are applied rather than only recorded: the audit that found the third clause of the `PASS` rule unfalsifiable, the self-prompted questions that resolved it, the four-move design, and what the implementation changed about the plan. |
| [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) | What comes after the MVP: the npm, Docker and VS Code routes, the next adapters in the order they can be **proven**, the self-prompting resolution table that ordered them, and §5's reframing of what "blocked" actually means - every remaining row names the `sim-*` world that answers it, because a world may be simulated and a real-infrastructure absence is not a blocker. **Read before promising an adapter.** |
| [`extension/vscode/README.md`](./extension/vscode/README.md) | The Cockpit's front door. `src/host/activate.ts` points here, so it has to exist and say what the extension is not (VS Code is not Veridian), how to install it for development, and - explicitly - what only a real VS Code test host could exercise and what no check in this tree can reach at all. |

Add a one-line index entry here for each new doc instead of duplicating its content in this file.

## Agent customizations

| File | Applies when |
|------|--------------|
| [`AGENTS.md`](./AGENTS.md) | Always. This file. |
| [`docs/PLAN.md`](./docs/PLAN.md) | Any design, scope, or architecture decision. |
| [`.github/skills/hipcortex-memory/`](./.github/skills/hipcortex-memory/SKILL.md) | Any read or write of project memory. |
| [`.github/instructions/tests.instructions.md`](./.github/instructions/tests.instructions.md) | Auto-attaches to test files via `applyTo`. |
| [`.github/instructions/typescript.instructions.md`](./.github/instructions/typescript.instructions.md) | Auto-attaches to every `*.ts` file via `applyTo`. |
| [`.github/agents/verifier.agent.md`](./.github/agents/verifier.agent.md) | Delegated gate runs. Read-only by design. |
| [`.github/agents/cockpit-operator.agent.md`](./.github/agents/cockpit-operator.agent.md) | Driving or reading a Veridian run through the Cockpit or the CLI. Read-only by design. |
| [`.github/prompts/new-module.prompt.md`](./.github/prompts/new-module.prompt.md) | `/` → **Add a Module**. |
| [`.github/hooks/format.json`](./.github/hooks/format.json) | `PostToolUse` on every file write. |
| [`.github/hooks/format.mjs`](./.github/hooks/format.mjs) | The hook's implementation. Never installs anything, never exits non-zero. |

**The formatter hook is a no-op until a formatter appears in a manifest.** It never installs
anything (`npx --no-install`, interpreter probes) and never exits non-zero, so it cannot break
a session. It runs `ruff`/`black` for Python, `prettier` for JS/TS, `rustfmt`, or `gofmt`
whenever the manifest configures them. Since the stack is now settled on TypeScript, expect
`prettier` to activate as soon as a `package.json` declaring it as a dependency lands.

Once the first TypeScript source lands, add a language-specific `applyTo` instruction (e.g.
`**/*.ts`) for style conventions. **Done:** `typescript.instructions.md` is that instruction, and it
auto-attaches to `**/*.ts`. It was written from the flags in `tsconfig.json` and from the shape the
tree already holds rather than from a preference, because a style guide invented for a codebase that
already has a style is a second rulebook rather than a description.

- **A `replace_string_in_file` whose `oldString` and `newString` are identical fails with "Input and
  output are identical", and that is the tool doing its job.** It happened in this session twice: the
  new text was a copy of the *result* of a previous insert rather than the intended change, so
  submitting it would have been a no-op that read as an edit. **A diff that is not a diff is not an
  edit** - and the failure is the only thing that says so, because both halves of the call looked
  correct. Copy the `oldString` out of the file and compose the `newString` from the intent, then read
  the two side by side before submitting.

- **A documentary guard's extension point can be a row that must be *split*, and the row that hides
  two worlds is the row that hides both.** `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` section 5 carried
  ``| `local-api` / `local-process` | real child process, real HTTP | - | planned (Phase D) |`` - one
  row naming two worlds, one of which was about to become **built**. Adding a row would have left a
  duplicate; editing the status would have claimed `local-process` was built. The row had to be
  **divided** before either fact could be stated. Its sibling: the guard's second question - *a world
  the document calls **built** may not print a backticked surface no constant declares* - is only
  exercised when a **real** world becomes built, and `local-api` is the first such world, so the probe
  in this session was the first time that branch *could* fail. *A guard with three extension points
  has three ways to fall behind: the import, the table entry, and the row that was never made.*

- **A `run` step's payload is `argv` in the engine and a bare array of strings in the schema, so a
  contract author and the code that reads their contract spell the same step two different ways.** The
  engine declares `{ kind: "run"; argv: readonly string[] }` (`core/acceptance/steps.ts`), while
  `acceptance.schema.json` expresses the step as `"run": { "type": "array", "items": { "type": "string" } }`.
  There is no `command` anywhere - not in the schema and not on the parsed step - so reading `.command`
  yields `undefined` for every provisioner vector, which presents as a world that reports "no command
  was issued" for a program that issued fifteen. *The schema is the half a contract author reads and the
  type is the half the engine reads, and neither one can see the other's spelling.*

- **A guard that counts a world's whole history while its message claims to describe one run is a guard
  that can pass on a run it should refuse.** `sim-cloud`'s `#deployApplication()` refuses a provisioner
  that exited zero without asking the account anything - *"the substitute holds exactly what the
  application asked it to hold"* - and it read `this.#cloud.calls().filter(...)`, a count of the
  account's **entire life**. `clear()` deliberately never clears the call log (it moves the meter's
  baseline instead, because the meter is a reading of the current life and the log is the record of
  every request the account ever answered), so after a `restart` reset whose re-provisioned application
  connected **zero** times, the *first* provisioning's call still satisfied the count: the world had
  just been emptied, the guard's own message claimed the application had asked it to hold something,
  and every criterion afterwards would have named an absent bucket for a reason the application was not
  responsible for - an environment failure wearing the application's clothes. The fix is a **watermark**
  read before the child runs (`const callsBefore = this.#cloud.calls().length;`) and applied in the
  read (`.slice(callsBefore)`), the same shape `sim-container` already used for its escape tally and
  `sim-data` was written with from the start. *The second occurrence is the one that proves the rule was
  not learned - and the third is the one that shows the corrected form spreading.* Two things about how
  it was found, both of which are the reason this entry exists rather than being folded into the
  previous one: the defect was **invisible to the suite**, and the first version of the test that was
  written to hold the fix after it **passed with the defect deliberately reintroduced**. The cause was
  the test **double**, not the test and not the product: `tests/sim-cloud-environment.test.ts`'s
  `fakePort().clear()` did `records.length = 0`, wiping the very log the real port keeps, so a double
  that reset the log agreed with a watermark and with a cumulative count alike. *A double that does not
  reproduce the property the guard is about makes the guard untestable - and a test that passes whether
  or not the rule holds is not a test.* The double now moves a `meterFrom` baseline exactly as
  `cloud-port.ts` does, and the probe - reverting `.slice(callsBefore)` in the adapter - fails exactly
  one named subtest, `counts the request the application made in this run, not the one the last run
  made`. Its sibling defect is in the probe harness itself and is worth keeping: the scraper matched
  `/^not ok \d+ - /` at column zero, and a subtest's line is **indented under its suite's**, so it
  printed the *suite* name and declared the probe unfired - **a verdict computed over a probe that had
  fired**. `^\s*` is the fix. *A skipped probe silently reduces coverage, and a badly scraped one
  silently reports the reverse; both are the harness claiming something it did not measure.*

- **A member of a vocabulary must be looked up through the world's own spelling, and a world may hold
  two spellings of one member that are both correct.** `adapters/sim-data/protocol.ts`'s `DATA_APIS`
  names an API `"ApiVersions"` and registers it at key `18` with versions `[0]`, and the function two
  lines below renders that same member for a reading as `ApiVersions(18) v0` -
  `` `${api.name}(${api.key}) v${api.versions.join(", v")}` ``. So a contract names the API the way the
  register spells it, and the world answers with the version list it advertises: **two different
  strings about one member, and neither is a typo.** *A vocabulary with a lookup form and a display form
  has two spellings of every member, and the wrong one does not look wrong - it reads as the member's
  name.*

- **A register's array field can answer a different question from the one its name suggests.**
  `DATA_APIS` registers `Fetch` at key `1` with `versions: [0, 2]`, and that array lists **every version
  this world can read**. `data-port.ts`'s `#versionOf(key)` returns `versions[0] ?? 0` - the lowest -
  and it is what both `run()` and `#fetch()` use to choose the shape the answer is encoded in. So the
  register answers *which versions can arrive*, the accessor answers *which version will be answered
  at*, and a reader who takes the first array for the second has a fact about the world that is true and
  a conclusion that is not. *A field named for a set answers a question about the set; the question
  "which one does this use" is a different question and needs a different name.*

- **A spelled-number table is a vocabulary, and a document's capitalisation is a fact about the
  document.** `examples/sim-data/acceptance.yaml` states AC-013's figure in words - *"Thirty-three is
  the figure the encoder really produces for one topic named `cart-events` with three partitions"* -
  while the expectation eleven lines below pins `equals: member-1 (range) handed 33 byte(s)`, and other
  criteria in the same file say `one`. The prose and the value are the same claim written twice, and
  **only the numeric half is read by anything.** *A number written as a word is a number no test can
  compare - which is exactly why it is the half that drifts, and exactly why the prose has to be
  re-measured whenever the value is.*

- **A runtime pattern cannot be matched against a template source, so the check has to compare the two
  shapes rather than the two strings.** `examples/sim-data/environment.yaml` waits for
  `cart-broker provisioned: \d+ requests, \d+ topics, \d+ records`, and the program it waits for prints
  that sentence by interpolation - `` say(`cart-broker provisioned: ${String(requests)} requests,
  ${String(TOPICS.length)} topics, ${String(produced)} records`) ``. The pattern describes what the
  program **prints**; the source holds the expression that will print it, so applying one to the other
  compares a number against the code that computes one and **can never match**. `tests/sim-data-demo.test.ts`
  therefore splits both sides on their own placeholder - `/\\d\\+/` and `/\$\{String\([^)]*\)\}/` - and
  asserts the word lists are equal. *A test that applies a regex to a template asserts a mismatch and
  calls it a defect; the claim was that the pattern is this sentence's own words with each figure
  replaced, and that is the claim the assertion has to make.*

- **An expectation that contradicts a render helper's own branches is the expectation that is wrong,
  because the helper is the code that produces the string.** `renderPartition` in
  `core/environment/data-observation.ts` has two shapes: `partition 0: 3 record(s), offsets 0..2, hw 3,
  isr [1]` for a partition that holds records, and `partition 1: 0 record(s), empty, hw 0, isr [1]` for
  one that holds none. `examples/sim-data/acceptance.yaml` pins both - and writing the `offsets a..b`
  form where the `empty` branch belongs is a claim about the helper that the helper contradicts, so the
  failure lands on the **criterion** rather than on the application. *Read the helper before writing
  the expectation: a rendering function with two branches has two correct strings, and the second is the
  one the reader who saw only the first case will get wrong.*

- **`allValidators()` returns objects, not strings, so a roster compared against it has to read a
  property.** `cli/validators.ts` declares `export function allValidators(): Validator[]` and returns
  the eleven families' arrays - each member an object with a `.name` beside its `targetNoun`, its
  `validate` and the rest. A guard that did `list.includes("data.record")` would be false for a
  registered validator, and a guard that iterated the array and printed each member would print
  `[object Object]` in a message meant to name a family. Measured: the roster is **123** members
  (`8+4+7+12+12+11+19+17+8+12+13`). *A vocabulary is a list of things, and whether a member is a string
  or a record is the first fact to read - a comparison against the wrong one is false for every member
  and reads as an empty register.*

- **An evidence-kind claim must be read off the writes, not off the design.** `sim-data` was described
  as producing `json` **and** `log` artifacts, and `adapters/sim-data/sim-data-environment.ts`'s
  `#captureEvidence` writes exactly two files and passes `"json"` for both - one per criterion, written
  twice when there was traffic, and there is **no `log` write anywhere in the file**. So the claim named
  a kind the world cannot produce and omitted the count that is the real fact. *This is the same shape
  as the adapter that warned for every evidence kind including the `json` it had just written, one
  document out instead of one statement out: a capability is what the code did, and a list beside the
  code is free to disagree with it.*

- **One name in several vocabularies has to be read at each definition, never carried across.**
  `call` is a **step kind** (`core/acceptance/steps.ts`, the eleventh) that puts the criterion's own
  request to a world, admitted by three adapters - and it is also a **validator name** in two families,
  `cloud.call` and `data.call`, where it answers a different question entirely: not "make this request"
  but "read the request the **application** made". The two are not the same concept wearing one word;
  they are two concepts that happen to share a spelling, and the pair inverts where a reader expects it
  (`data.call` reads the application's traffic, `data.probe` reads the criterion's own). *A vocabulary
  that grows by reusing a word has to have each use read at its own definition - carrying the meaning of
  one across to the other produced three false "only the cloud plan admits `call`" claims in this
  repository's documentation, each of which read as complete.*
