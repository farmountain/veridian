# AGENTS.md

Agent instructions for the **Veridian** repository. This is the single always-on
instructions file for this workspace — do not add a second one
(`.github/copilot-instructions.md`) alongside it.

> **Status: the MVP is implemented and green, and eleven more sandbox worlds have landed.** Core, the
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
> `sim-mobile` is the twelfth and the eighth **simulated** one, and the first whose subject is a
> handset. A real application process provisions a substitute device by printing command vectors on
> its stdout, and the substitute holds the boot state, the installed bundles with their versions,
> permissions and grants, deep links, notifications, keychain entries and per-bundle log lines,
> answers a 22-command register in process, really spawns a bundle through `core/process.ts` and
> applies the launch deadline itself. Judged as a bundle rather than as the device. It says what it
> stands in for rather than hiding it - `MOBILE_SIMULATED_SURFACES` names nine surfaces and the
> reading carries `simulated` - and nothing is emulated: no emulator, no image and no booted system
> anywhere in the loop. It adds no step kind: the application provisions with the `run` steps the
> second world introduced, and three of its criteria use one.
> `npx tsc --noEmit` is silent and `node --test` reports 2531 passing tests over 422 suites -
> Veridian's own 2459 plus the 72 the VS Code Cockpit contributes, which the root runner discovers
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
- **The substrate may refuse a write, and a refusal is not an unreachability.** A refusal arrives as
  `HTTP 403` with a content precondition in the body - measured as
  `precondition blocked: PII risk=0.90 patterns=["PII:..."]` - and the honest response is to report the
  reason the substrate gave and keep writing on the next decision. This rule exists because the opposite
  one was believed here: the severity of the refusal had been read as "the substrate refuses every
  write", a claim about a frequency that nothing in the tree can check, because `HttpMemory#post()` sees
  one response at a time and cannot count attempts. Two consecutive writes succeeded while it was being
  cited. The mechanism was always right and is held by `tests/memory-port.test.ts` - a refused write
  reports `precondition blocked` and does **not** contain "unreachable", while a genuine `ECONNREFUSED`
  still does. *An error message may only name a cause the reporter observed*, and the same rule applies
  to a document describing how often a dependency fails.
- **A tool-availability error is evidence about the client, never about the operator.** The host renders
  an unavailable tool as *"Tool `mcp_hipcortex_open_intent` is currently disabled by the user, and cannot
  be called"* - and **that attribution is the message's, not a fact anyone measured.** This rule exists
  because the sentence was believed here: the phrase "by the user" was copied out of the error string and
  reported to the operator as a claim about their own configuration, then **written into a memory record**
  as durable fact, so it would have survived into every later session. The operator had disabled nothing.
  Re-running both tools answered immediately - `open_intent` returned
  `{"intent_id":"73765028-d043-4181-ba89-4974e10a8029","ok":true}` and `search_memory` returned five
  records - **in the same session in which both were reported as disabled.** Three errors compounded, and
  each is the reason this is a rule rather than a note: (a) *a string was read as a fact about a person* -
  the reporter observed a message and reported a choice; (b) **two different failures were merged into one
  story**, because the *first* `open_intent` rejection was not a disablement at all but a client-side
  schema error, `must have required property 'target_entity'`, and folding it into "your configuration is
  blocking me" gave one invented cause two pieces of apparent support; (c) *no retry preceded the
  diagnosis*. So: **quote a tool error verbatim, name no cause, and re-run the call before writing
  anything down** - and treat a claim about the *operator's* actions as the highest-burden claim available,
  because they can falsify it instantly and are the only one who knows. This is the fourth instance of one
  shape in this file (`--browser none` naming *"Playwright is not installed"*; `HttpMemory#post()` naming
  *"unreachable"*; the `sim-os` substitute naming a path it had not looked at), and the sharpest, because
  the rule was being enforced on other people's error strings in the same session it was broken on our
  own. Held by `tests/memory-port.test.ts`'s sibling discipline: an assertion about a failure names the
  failure the test actually produced.
- Environment observations must go through the intent/receipt path
  (`open_intent` → `accept_receipt`), never `add_memory`. The working arguments, measured here:
  `open_intent` takes `{ actor, target_entity }` - **`target_entity` is required**, and omitting it is
  the schema rejection quoted above, not an unreachability - and returns an `intent_id`;
  `accept_receipt` takes `{ actor, intent_id, observation, sensor_path, ok }` and answers `{"ok": true}`.
  A gate reading filed this way is a receipt, not a claim: the observation is the command, its exit code
  and its counts.
- If the server is unreachable, run `hipcortex start`, or say memory is unavailable — never
  silently skip the write. *Unreachable* means `ECONNREFUSED`, which is the one cause
  `tests/memory-port.test.ts` still allows that word to name.

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
                        no socket and no substitute still needed no core change either) + data-
                        observation.ts for the broker family (the eleventh, and the ninth reason
                        that rule holds, and the one that carries the request an application made
                        rather than a document a world holds - the `call`/`probe` pair whose two
                        halves answer opposite questions, and a reference grammar whose nouns fix
                        their own segment counts) + mobile-observation.ts for the handset family
                        (the twelfth, and the tenth reason that rule holds, and the one that carries
                        the register's result vocabulary, so a command the world does not implement
                        is `refused` while a resource it does not hold is `absent`) + the boundary
                        vocabulary (BoundaryPolicy/BoundaryReport) that keeps a declared safety limit
                        from being mistaken for an enforced one. `load.ts` carries each world's plan
                        block into the parsed `EnvironmentPlan`, which makes it the **twelfth**
                        additive place a new world must touch - a place an earlier census of those
                        places missed, so the figure is written down here rather than left to be
                        rediscovered by whoever adds the thirteenth.
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
                        lazy Playwright browser port. Playwright is a declared OPTIONAL PEER rather
                        than a dependency, so `npm ci` installs nothing for it and the absence is
                        what the world reports when it cannot observe.
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
adapters/sim-mobile/    SimMobileEnvironment - the twelfth world and the eighth SIMULATED one, and
                        the first whose subject is a handset. A real application process provisions
                        a substitute device by printing command vectors on its stdout, and the
                        substitute holds boot state, installed bundles with their versions,
                        permissions and grants, deep links, notifications, keychain entries and
                        per-bundle log lines, answers a 22-command register in process, really
                        spawns a bundle through `core/process.ts` and applies the launch deadline
                        itself, and refuses by name a path outside both the application's own tree
                        and its sandbox. No emulator, no image and no booted system anywhere in the
                        loop. `mobile-port.ts` is the substitute and `sim-mobile-environment.ts`
                        is the adapter, which declares the four `MOBILE_ENV` names the application
                        reads. It differs from the other `sim-*` ports in four ways its suites
                        state: a command the world does not implement is `refused` while a
                        resource it does not hold is `absent` (`MOBILE_ACTION_RESULTS`),
                        `rebuild()` deliberately keeps `calls` and `escapes` across a reset because
                        the boundary record describes the run rather than the world, a recorded
                        command has its secret flag value **redacted rather than omitted** so the
                        request's shape survives into the bundle, and the reading is
                        `core/environment/mobile-observation.ts`'s `mobile.device`.
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
validators/mobile/      Handset validators (device, os, screen, orientation, bundle, installed,
                        permission, deeplink, notification, logs, call, probe). Judge a reading in
                        core/environment/mobile-observation.ts - the twelfth family, and the tenth
                        reason that rule holds. It has no new step kind: the application provisions
                        through command vectors printed on its stdout and is acted on with `run`.
                        Five of the twelve are targetless - `device`, `os`, `screen`, `orientation`
                        and `installed` ask about the world itself. `mobile.deeplink` is spelled
                        without a hyphen because a validator name has to match
                        `^[a-z0-9]+(\.[a-z0-9]+)+$`, and `mobile.call` reads the requests the
                        **application** put to the device while `mobile.probe` reads the ones the
                        **criterion** issued - the same inversion `cloud.call`/`cloud.probe` and
                        `data.call`/`data.probe` carry.
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
examples/vscode-cockpit/ The twelfth demo, and the only one whose application is Veridian's own
                        client. It adds NO world: it runs the same `sim-vscode` substitute the eighth
                        demo uses, unchanged, and is separate because the application is different in
                        the one way that matters - it stages the real compiled Cockpit (the
                        manifest's own `files` allowlist, copied out of the manifest rather than
                        restated) into its app tree and judges that. It exists to separate two claims:
                        "the tests passed" and "the thing works". The Cockpit's 72-test suite was
                        green before and after the two defects this world found, because both were in
                        `vscode-port.ts` - the one file adapting the real editor API, and therefore
                        the one file a double of that API cannot falsify. Eleven criteria. Measured
                        against the published `0.2.1`: D1 (a discarded promise in `registerCommand`)
                        moves **exactly** `AC-008`, D2 (no shape check on an opened document) moves
                        **exactly** `AC-010`, and both repaired gives `PASS (COMPLETED, 1
                        iteration(s))` 11/11, exit 0. It is the one demo that needs a build product,
                        so it **refuses by name** when `extension/vscode/out` is absent, naming
                        `npm run build`, rather than skipping - a skipped check reports a green
                        suite. Its staged tree and its sandbox are both generated and ignored, and
                        `vscode.identity` pins the version in the manifest it stages, so a version
                        bump moves that expectation in the same pass.
examples/sim-mobile/    The thirteenth demo, and the eighth simulated world: the app provisions a
                        substitute handset through commands it really issues, and is judged on the
                        bundles, permissions, deep links, notifications, keychain entries and log
                        lines that device holds. Four defects, twenty-five criteria, three of which
                        act in the world through a `run` step and one of which expects the world to
                        **refuse** it. Three of the four defects are the controls, each read by
                        exactly one criterion; the fourth spells a release constant that is printed
                        both in the bundle the device holds and in the notification body, so one
                        edit moves **two** readings. The failing count descends
                        `5 -> 4 -> 2 -> 1 -> 0` over five iterations.
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
acceptance/             Veridian judged by Veridian: `veridian-mvp.yaml` (the goal),
                        `acceptance.yaml` (7 criteria, judged by the `local-process` family) and
                        `environment.yaml`. Driven by `scripts/acceptance.mjs` through
                        `npm run acceptance`, which runs the contract TWICE - a first run that passes
                        and a second that fails is the signature of a world a run *inherited* rather
                        than *built*. It is deliberately not a `demo:*` script: a demo shows a defect
                        found and repaired, and this contract is observed once with `--no-repair`,
                        because the application it judges is the CLI itself and there is nothing to
                        repair.
                        It has **no `*-demo.test.ts` of its own**, and that asymmetry is deliberate
                        rather than an omission. The thirteen demo suites hold properties of a defect
                        table - the `correct` block present exactly once in the shipped program, the
                        criterion a defect is filed against, the progression the table predicts - and
                        a contract with no defects has none of those. What actually matters here is
                        held by *executing* it, which a CI job does, and the one property execution
                        cannot state is held by the fourth roster in `tests/demo-rosters.test.ts`:
                        that this route is named in the manifest, in both documents and in the
                        workflow, and that its step is ordered above the demo loop.
tests/                  Veridian's own tests (+ fixtures/helpers). See the tests instruction below.
scripts/                Bootstrap scripts that must run before anything is type-checked, beside
                        `acceptance.mjs` - the runner for the contract above, which lives here
                        because it is a script `package.json` names rather than a bootstrap step.
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

**There is now an `acceptance/` directory, and it took eleven worlds before one could be written.**
`docs/IMPLEMENTATION-PLAN.md` §5 and step 9 of its execution order call for
`acceptance/veridian-mvp.yaml` - Veridian judged by its own tool. It could not be written inside the
MVP, and the finding was recorded rather than the attempt quietly dropped: at the time, the only
registered adapter was `local-web` and all eight registered validators were browser observations, so a
contract about a CLI would have made every criterion `INCONCLUSIVE` and exited 2 - the same defect as
`--browser none` on the canonical demo.

**That reason is spent, and the directory is what says so rather than a paragraph claiming it.** Twelve
adapters are registered, eleven of them need no browser - `local-web` is the only one that drives one -
and `local-api`, `local-process` and `sim-data`
are precisely the "non-web adapter" this file once said the scope boundary forbade building
speculatively - they were not built speculatively, they were built because a world whose subject is an
HTTP contract is inside the boundary, a world whose subject is a program is too, and a world whose
subject is a request an application made is inside it as well, and once `local-api` existed a
non-browser contract about a program became expressible. So `acceptance/veridian-mvp.yaml` is written,
its seven criteria are judged by the `local-process` world, and `npm run acceptance` runs it.

**Two runs, not one, and the second run is the check.** `scripts/acceptance.mjs` invokes the contract
twice, requires both to be `PASS`, and exits 1 naming the cause when they disagree. A single run on a
fresh checkout would pass over a world that never rebuilt at all: `#rebuild` in
`adapters/local-process` empties the sandbox when the world is *created*, so run 1 starts clean
everywhere, and run 1 leaves its own `config.yaml` behind because nothing removes the tree at the end
of a run - only at the start of the next one. *A world a run inherits is not a world that run built*,
and this is the second time this repository has paid for that rule. The check was falsified rather than
trusted: blowing away `#rebuild` gives `run 1: exit 0 - PASS / run 2: exit 1 - FAIL`, with `AC-002` and
`AC-003` each naming the exit code of a command that answered 3, and the adapter was then restored byte
for byte.

**It is not a `demo:*` script, and the prefix would have been a lie.** A demo shows a defect found and
repaired; this contract has `maxIterations: 1` and is observed once with `--no-repair`, because the
application under it is the CLI itself and there is nothing to repair. Borrowing the prefix would have
enrolled it in three checks that a false statement satisfies - *every declared demo is run by a CI job*,
*README.md lets a reader run every declared demo*, and the roster guard that holds both - so
`tests/demo-rosters.test.ts` holds a roster of its own for it, across the four places that name it:
`package.json`, `README.md`, `AGENTS.md` and `.github/workflows/ci.yml`.

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
node --test                # the whole suite. 2531 tests over 422 suites, ~7s. No directory argument.
                           # 2531 = the root's own 2459 + the Cockpit's 72, because the runner walks
                           # the tree and reaches extension/vscode/src/*.test.ts. The inclusion is
                           # measured rather than assumed: a test title that exists only in the
                           # Cockpit appears twice in this run. Neither figure is
                           # the whole story on its own: the root tsconfig EXCLUDES extension/**, so
                           # `npx tsc --noEmit` here does not typecheck the Cockpit and the root gate
                           # is not the extension's gate.
npm run gate               # typecheck then test. Run this before claiming anything is done.

npm run build              # tsc -p tsconfig.build.json, then node scripts/copy-assets.mjs
npm run smoke:dist         # drive the COMPILED CLI from a temp directory; asserts exit 2, not 3
npm run smoke:mcp          # spawn the real MCP server as a child and drive it over a pipe;
                           # 8 checks and exit 0. No build: the source tree is the program.
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
                           # 12 files, 119.75 KB, at the extension root. Deliberately NOT in `gate`:
                           # a packaging tool's output is not part of the source tree's contract,
                           # and making the local gate depend on `vsce` would make every local run
                           # need it. CI runs it, and runs the check below against it.
npm run smoke:vsix         # read that archive back as a zip and assert what it holds: the entry
                           # point `main` names, the manifest field-for-field, the absence of
                           # src/, tests and node_modules, the licence and the readme byte for
                           # byte, and every compiled file identical to the build's. 35 checks.
                           # Exit 1 if the archive is stale, incomplete or wider than the
                           # manifest allowlists.
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
falsified five ways rather than trusted: adding `src` to the allowlist fails both negative checks and
exits 1; adding a byte to a compiled file *after* packaging fails the byte-identity check and exits 1;
appending a line to the licence copy fails with `the licence in the archive is the repository's, byte
for byte (1327 bytes)` and exits 1; appending a line to `extension/vscode/README.md` *after* packaging
fails `the readme in the archive is the source's, byte for byte` and exits 1 - the check
that had to be written before it could be falsified, because the readme is the marketplace's long
description and until this pass it was the one file in the archive compared for *existence* and nothing
else, so an archive built before the last edit to it shipped a description that disagreed with the
repository while every check here passed; and taking `LICENSE` out of `files` is the instructive one,
because `vsce` prints `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`, packages **10** files
and **exits 0** - so the packaging step reports nothing wrong and `smoke:vsix` is what fails. *A
warning is not a check, and a file a packaging tool copies by convention is a file nothing promised to
compare.*

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
npm run demo:vscode                         # the eighth demo, and the sixth simulated world: a real
                                            # extension is loaded by a substitute extension host and
                                            # judged on what that host recorded while it ran. No editor,
                                            # no window and no installed VS Code anywhere in the loop.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 23/23 criteria, the failing count descending
                                            # 4 -> 3 -> 2 -> 1 -> 0.
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
npm run demo:data                           # the eleventh demo, and the seventh simulated world -
                                            # and the first whose subject is a REQUEST the application
                                            # made: a real TCP socket, a real broker protocol written
                                            # into it, and a substitute on the other end. No broker
                                            # process, no replica follower, no on-disk log and no
                                            # outbound socket. Exit 0 when it passes: measured, 5
                                            # iterations and 20/20 criteria, the failing count
                                            # descending 5 -> 4 -> 3 -> 1 -> 0.
npm run demo:cockpit                        # the twelfth demo, and the only one whose application
                                            # is Veridian's OWN client: the compiled Cockpit, staged
                                            # into a substitute extension host and judged on what it
                                            # really did while loaded. It adds no world - it reuses
                                            # `sim-vscode` unchanged. Needs `npm run build` inside
                                            # `extension/vscode` first, and REFUSES by name when
                                            # `out/` is absent rather than skipping. Exit 0 when it
                                            # passes: measured, 1 iteration and 11/11 criteria.
npm run demo:mobile                         # the thirteenth demo, and the eighth simulated world:
                                            # the app provisions a substitute handset through
                                            # commands it really issues, judged on the bundles,
                                            # permissions, deep links, notifications and logs that
                                            # device holds. No emulator, no image, no booted system.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 25/25 criteria, the failing count descending
                                            # 5 -> 4 -> 2 -> 1 -> 0.
npm run demo:no-browser                     # the same demo with `--browser none`. Every criterion is
                                            # a browser observation, so this must end INCONCLUSIVE
                                            # (exit 2). It shows the refusal, not the aha.
npm run acceptance                          # Veridian judged by Veridian: its own contract - goal,
                                            # criteria and world - judged by the `local-process`
                                            # adapter, and run TWICE inside one invocation, so a world
                                            # the second run inherits is proved to be one it rebuilt
                                            # rather than one the first left behind. Not a `demo:*`
                                            # script: it is observed once with `--no-repair` because the
                                            # application under it is the CLI itself. Exit 0 when it
                                            # passes: measured, run 1 and run 2 both
                                            # `PASS (COMPLETED, 1 iteration(s))`, 7/7 criteria.
npm run acceptance:ladder                   # the second self-acceptance route, and it judges what the
                                            # first cannot: not the command line as a *product* but a
                                            # *run* as a witness. Each of its four criteria issues its
                                            # own `veridian validate` against `acceptance/ladder/
                                            # fixtures/`, then reads that nested run's own
                                            # `latest-result.json` for the rung each gap reached, the
                                            # reason a resolution deferred, the origin it was raised
                                            # from and the rungs attempted. Run TWO passes for the same
                                            # reason the route above is a script. Writes to
                                            # `sandbox/ladder/outer` - a sibling of the sandbox, never
                                            # `.veridian/` - so it cannot contend for the single-slot
                                            # summary. Exit 0 when it passes: measured, ~21 s wall for
                                            # both passes, each `PASS (COMPLETED, 1 iteration(s))`,
                                            # 4/4 criteria.
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
need compiling. `scripts/acceptance.mjs` is `.mjs` on the same ground as the first - it drives the CLI
through a child process, so it has to be runnable whatever state the tree's types are in.

**CI runs the same gates, on both platforms, and now the artifacts too.**
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) has seven jobs. `gate` runs `npm run gate` on
`ubuntu-latest` and `windows-latest` (both resolving Node from `.nvmrc`). `demo` runs the canonical
demo on ubuntu, asserts that `--browser none` really exits 2, and uploads `.veridian/` as an artifact.
`browserless worlds` runs twelve of the fourteen declared demos and names the world that regressed,
because before that job existed no CI ran any of them - it ran seven under the name `simulated
worlds` until the name stopped describing its own membership, and `demo:api`, `demo:local-process`,
`demo:data` and `demo:cockpit` were declared, shipped, documented and run by nothing.
**It also carries the one command the `for world` loop cannot**: `npm run acceptance`, the
self-acceptance contract, which is not a `demo:*` script and would otherwise be a command the manifest
declares and no job executes - the four-name defect again, one script over. That step is **added and
not yet observed**: it has not run on a runner, which is exactly the state this file calls an
unexecuted check, so its first green run is part of the change rather than a follow-up.
`distribution` runs `npm run smoke:dist` and then a
full `npm pack` -> install into a clean directory -> run round trip, because that is the only check
that reads `files` and `bin` the way a consumer does. `MCP surface` runs `npm run smoke:mcp`, which
spawns the real server as a child and drives it over a real pipe - the fourth artifact check, and the
only one whose artifact is a running program rather than a file. It is a **job of its own** rather
than a step inside `distribution`, because everything in that job needs `npm run build` and this
check does not: the source tree *is* the program. `container image` builds the Dockerfile and
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
It degrades honestly (`INCONCLUSIVE`, never `PASS`) and names the command that fixes it. **The route
is declared rather than documented**: Playwright is an optional peer dependency
(`peerDependencies` with `peerDependenciesMeta.playwright.optional: true`), so a package manager
states the requirement at install time while `npm install veridian` still succeeds without it.
Nothing is installed by the declaration, so the degradation above is unchanged - which is the point,
because a peer that *was* installed would have made the honest `INCONCLUSIVE` unreachable. The
version floor is a lower bound (`>=1.40.0`) rather than a pin, because the adapter declares the slice
of the API it uses structurally and every property in that slice is optional, so a newer Playwright
fails at `launch()` with a named cause rather than being refused at install time.
`tests/package-manifest.test.ts` holds the declaration in both places it is written.

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
npm run package     veridian-cockpit-0.4.0.vsix, 12 files, 119.75 KB
npm run smoke:vsix  35 checks, exit 0
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
`adapters/*`, `validators/*`, `cli/*` or `mcp/*`. `validators/*` must not import `adapters/*` - the
shared vocabulary lives in `core/environment/web-observation.ts` for exactly that reason. `cli/*` may
import all of them, and so may `mcp/*`, which imports `core/*` only through its public entry points -
measured rather than assumed, `mcp/server.ts` names `core/io.ts`, `core/evidence/index.ts`,
`core/definition.ts` and `core/clarification/index.ts` and nothing inside them.
`core/clarification` is the lowest layer of all. **This rule is stated in full in six places, and
`mcp/` landing left five of them stale** - this entry, `README.md`'s layering paragraph, the layering
block in `.github/instructions/typescript.instructions.md` and the one in
`docs/IMPLEMENTATION-PLAN.md` each named three prohibitions for a four-layer tree, and
`docs/ISOLATION-AND-MCP-PLAN.md`'s own §3 paragraph on where `mcp/` sits called `cli/*` "the only
layer allowed to import all three". `docs/ISOLATION-AND-MCP-PLAN.md` §4.5 is the only statement that
was right, and it was right because it was written by the same change that landed the layer: it
predicted this drift in as many words (*"a new layer is exactly the change that makes a stale rule
look current"*). That the same document carried both statements, 180 lines apart, is the sharpest
form of the finding - a file can be right about a rule and cite the old version of it in the same
breath. Nothing failed, because a rule enforced by hand has no guard over its own prose -
`tests/mcp-demo.test.ts` holds the first clause by walking `core/` and requiring it to name the
surface nowhere, which is the code and not the documents. All five were corrected in the same pass,
and found by **grep** for the rule's spelling rather than by reading any of them - and **two of the
five were reachable only by widening that grep**: `README.md` and `ISOLATION-AND-MCP-PLAN.md`'s §3
paragraph state the rule through an *exclusive marker* ("the only layer") and contain the words "must
not import" nowhere at all, so a pattern built from the phrase the searcher already has in mind finds
only the copies that use that phrase. A seventh site, `core/environment/web-observation.ts`, states
two of the clauses as the reason that file exists and names no consumer layer, so it is a citation
and not a statement of the rule - *a count that includes both is a count that will be corrected
again.*
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
  occurrence of the shape the `db.query` / `db.rowCount` entries record. The **fourth** is the
  observation vocabulary, and it is the first whose enumeration is a *chain of ordinals*: `AGENTS.md`'s
  `core/environment/` layout row and `README.md`'s layering paragraph both listed the twelve
  `*-observation.ts` files, and both were one family short while each clause carried its own ordinal -
  so `the eleventh` was already spoken for and the row misinformed rather than merely omitting. Both
  are corrected, and `tests/observation-vocabulary.test.ts` holds them. **And the guard's own first
  draft was the same defect one layer in, which is why this paragraph exists**: it asked its question
  of the *whole document*, and every stem in `AGENTS.md` is named at least twice (once in the ordinal
  chain, once in a `validators/` row; `data` and `mobile` three times), so it would have passed with
  the chain two families short - the exact drift it was written after. That was found by *counting*
  the stems rather than by reasoning about the guard, and the fix is a scope (the enumeration only,
  with two in-guard controls asserting the scope held) plus three falsifying probes. *A set test over
  a whole document cannot see a block that is short when every member of that block is also named
  elsewhere in the document - and the way to know is to count, not to reason.*

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
  the measured run was `1456` and `1396` - and the count stood at `2258` and `2186` when that sentence
  was written, which is the rule demonstrating itself. **Then it moved again, by exactly what the next
  pass contributed.** The ordering assertion added to `tests/demo-rosters.test.ts` made the root run
  report `2259` and this tree's own `2187`, and the figure had to be corrected in four more places
  across `AGENTS.md` and `README.md` in the same pass - *a number in prose is a claim that the very
  edit which changes it falsifies, which is why the only durable fix is to re-measure rather than to
  promise, and why this entry is a record rather than a guard.* **The three prose repairs were then
  probed rather than trusted**: reverting the artifact name to `veridian-sim-evidence`, the header
  ordinal to *"The tenth demo"* and the quickstart count to `2258` each left the suite at
  `2259 pass / 0 fail`, which is the measurement behind calling them corrections rather than guards.
  No guard was added for any of them, because there is nothing for one to compare against: the
  artifact's name has no machine-readable source of truth beside it, an ordinal in a file's header is
  read by no code, and a count cannot be pinned by a test that itself changes the count. *Both are the same defect as a roster printed in a
  document: a number is a claim about the code, and the cheapest way to hold it is to read the code -
  the difference is that a number cannot be pinned by a test the way a name can, so it has to be
  re-measured at the moment the document is touched.* **It moved a third time, for the same reason and
  by four suites rather than one**: the W1 boundary migration and the `sim-data` world took the root run
  to **2305** and this tree's own to **2233** (the Cockpit's 72 unchanged), and the figure was corrected
  in four places across `AGENTS.md` and `README.md` in the same pass. The four suites are
  `tests/sim-vscode-environment.test.ts`, `tests/sim-container-environment.test.ts`,
  `tests/sim-data-environment.test.ts` and `tests/sim-cloud-environment.test.ts`, each of which gained
  an assertion that its world hands the runner a file allowance - the first three as new files, the
  fourth growing in place. The entry's own figures are left standing above because a record of what was
  measured then is not made false by what is measured now. **A fourth movement came from W4's guard,
  and it is the smallest one yet**: `tests/package-manifest.test.ts` contributed 8 tests, taking the
  root run to **2313** and this tree's own to **2241** (the Cockpit's 72 unchanged), corrected in the
  same four places. It was measured by running `node --test` rather than by adding 8 to 2305, which is
  the whole point of the rule - and the addition would have been right, which is exactly why a figure
  that happens to be reachable by arithmetic is the figure nobody goes back and checks. **A fifth
  movement came from W5, and it is the first one this record can attribute only in part**: the root run
  now reports **2321** and this tree's own **2249** (the Cockpit's 72 re-measured by running its own
  `node --test` rather than assumed, and the suite count still **377**). Two of the eight are named
  outright - `tests/runtime-report-slices.test.ts` contributes 4 and has no `describe`, so it moves the
  test count and not the suite count, and `tests/demo-rosters.test.ts` gained one `it` block when the
  fourth roster was generalised from a constant into a set - and the remaining four are **not
  attributed here**, because they were never measured at the moment they were written: an earlier gate
  in this stretch read **2316** where the document then said 2313, and the difference was not chased.
  That is the honest half of this rule, and the half worth keeping: *a figure that is re-measured is
  corrected, and a figure whose movement is not measured is only ever restated.* **A sixth movement is
  the first one this record can attribute in full, because a single new file caused all of it**:
  `adapters/sim-mobile/mobile-port.test.ts` contributes **49** tests over **14** suites, taking the
  root run to **2370** tests over **391** suites and this tree's own to **2298** (the Cockpit's 72
  re-measured by running its own `node --test`, not assumed, and still **72**). Both figures were
  measured by running `node --test` on both trees. The decomposition itself was **measured rather than
  assumed** this time, which is the part the record had never done before: 2370 - 72 = 2298 rests on
  the claim that the Cockpit's tests are *inside* the root run, so that claim was checked directly by
  searching the root run's own output for a test title that exists only in the Cockpit
  (*"the manifest and the Cockpit declare the same commands"*) and finding it there **twice**. *A
  decomposition is an arithmetic claim about two measurements, and it is only as good as the evidence
  that its two halves are nested rather than disjoint.* **A seventh movement is the second one
  attributable in full, and this time every contributing file was measured alone rather than inferred
  from the total**: the root run reports **2456** tests over **410** suites and this tree's own
  **2384**, with the Cockpit's 72 re-measured by running its own `node --test` and still **72** -
  though its `# suites` line reads **0**, because no test in that tree sits inside a `describe`, so the
  root run's 410 suites are all this tree's own rather than the 338 a subtraction would have produced.
  Three files account for the whole test movement: `tests/sim-mobile-demo.test.ts` **34** tests over
  **6** suites, `validators/mobile/mobile-validators.test.ts` **48** over **12**, and
  `tests/sim-mobile-environment.test.ts` **4** over **1** - 86 tests and 19 suites, which is exactly
  2370 + 86 and 391 + 19. `adapters/sim-mobile/mobile-port.test.ts`'s **49** over **14** is
  deliberately absent from that sum, because it was already inside the previous figure: *a file that
  has not moved since the last measurement is not part of this movement, and adding it back would
  have produced an attributed total that reconciles with nothing.* **An eighth movement is the first
  caused by a *test* rather than by a world, and the first whose second figure deliberately did not
  move**: `tests/clarification-ladder.test.ts` contributes **5** tests over **0** suites, taking the
  root run to **2461** tests with the suite count unchanged at **410**. The unchanged half is the
  load-bearing one, because that file holds five bare `it` blocks and no `describe`, so a reader who
  expected the suite count to rise with the test count would have gone looking for a missing
  `describe` that was never wanted - and the temptation is real, because every earlier movement in
  this record moved both figures. Re-measured by running `node --test` on both trees (the Cockpit's
  **72** re-measured rather than assumed, its `# suites` still **0**), with the decomposition proved
  the way the seventh movement proved it: a title that exists only in the Cockpit *("the manifest and
  the Cockpit declare the same commands")* appears **twice** in the root run's own output. **A ninth
  movement is the first moved by a guard rather than by a world or by a ladder**:
  `tests/observation-vocabulary.test.ts` contributes **5** tests over **1** suite, taking the root run
  to **2466** tests over **411** suites and this tree's own to **2394** (the Cockpit's **72**
  re-measured by running its own `node --test` rather than assumed, its `# suites` still **0**, so all
  411 of the root run's suites are this tree's own rather than the 339 a subtraction would have
  produced). Both figures were predicted before they were measured - 2461 + 5 and 410 + 1 - and both
  predictions were **right**, which is precisely the case this record exists to distrust: *an
  arithmetic total that happens to reconcile is the total nobody goes back and checks*, and the eighth
  movement is the entry above recording a figure whose movement was not measured at the moment it was
  written. The decomposition was proved the way the seventh and eighth were. **A tenth movement is the
  first caused by a documentary guard rather than by a world, a ladder or an observation vocabulary**:
  `tests/docs-roster.test.ts` contributes **4** tests over **1** suite, taking the root run to **2476**
  tests over **413** suites and this tree's own to **2404** (the Cockpit's **72** re-measured by running
  its own `node --test` rather than assumed, its `# suites` still **0**, so all 413 of the root run's
  suites are this tree's own rather than the 341 a subtraction would have produced). The prediction was
  2472 + 4 and 412 + 1, and both were **right** - which is the ninth movement's own warning, so both
  figures were taken by running `node --test` on both trees and the decomposition proved the way the
  seventh, eighth and ninth were: a title that exists only in the Cockpit *("the manifest and the
  Cockpit declare the same commands")* appears **twice** in the root run's own output. The four live
  prose sites were corrected in the same pass - `AGENTS.md`'s status banner and its build block,
  `README.md`'s quickstart and its layout table - while every figure in the movements above was left
  standing, because *a record of what was measured then is not made false by what is measured now*.
  **An eleventh movement is the first caused by a *surface* rather than by a world, a ladder, an
  observation vocabulary, a guard or a document**: `mcp/server.test.ts` contributes **45** tests over
  **6** suites, taking the root run to **2521** tests over **419** suites and this tree's own to
  **2449** (the Cockpit's **72** re-measured by running its own `node --test` rather than assumed, its
  `# suites` still **0**, so all 419 of the root run's suites are this tree's own rather than the 347 a
  subtraction would have produced). The prediction was 2476 + 45 and 413 + 6, and both were **right** -
  the ninth movement's own warning again, so both figures were taken by running `node --test` on both
  trees and the decomposition proved the way the seventh through tenth were: a title that exists only
  in the Cockpit *("the manifest and the Cockpit declare the same commands")* appears **twice** in the
  root run's own output. One further fact about this movement is worth keeping: the counts moved only
  once the **two failures inside it were repaired in the product** - `get_failure` read an absent
  `failure` key as a present one, and answered a failure report path for a run that recorded no failure
  - so the movement is a measurement of a *working* suite rather than of a longer one.
  The four live prose sites were corrected in the same pass - `AGENTS.md`'s status banner
  and its build block, `README.md`'s quickstart and its layout table - while every figure in the
  movements above was left standing, for the reason the tenth movement states.
  **A twelfth movement is the first caused by a *guard* over that surface rather than by the surface
  itself**: `tests/mcp-demo.test.ts` contributes **10** tests over **3** suites, taking the root run to
  **2531** tests over **422** suites and this tree's own to **2459** (the Cockpit's **72** re-measured
  by running its own `node --test` rather than assumed, its `# suites` still **0**, so all 422 of the
  root run's suites are this tree's own rather than the 350 a subtraction would have produced). The
  prediction was 2521 + 10 and 419 + 3, and both were **right** - the ninth movement's own warning for
  the third time, so both figures were taken by running `node --test` on both trees and the
  decomposition proved the way the seventh through eleventh were: a title that exists only in the
  Cockpit *("the manifest and the Cockpit declare the same commands")* appears **twice** in the root
  run's own output *and* **twice** in the Cockpit's own. What distinguishes this movement from every
  one before it is the file that did **not** move the counts: `scripts/mcp-smoke.mjs` was written in
  the same stretch and contributes nothing to either figure, because it is a **script outside the
  discovery glob** - the same deliberate asymmetry `scripts/acceptance.mjs` already carries, and the
  reason `npm run smoke:mcp` is declared in the manifest and executed by a job rather than by the
  suite. *A count that moved is not the same claim as "the change was measured", and the half of this
  pass the count cannot see is the half that checks the program actually runs.* The four live prose
  sites were corrected in the same pass, as were the eleventh movement's - `AGENTS.md`'s status banner
  and its build block, `README.md`'s quickstart and its layout table.
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
  in the archive is the repository's, byte for byte (1327 bytes)"* and exit 1, and taking `LICENSE` out
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
- **A file a packaging tool copies by convention is a file nothing promised to compare, and the
  readme is the one a marketplace shows.** `smoke:vsix` byte-compared the six compiled files, the
  icon and the licence, and asked of `extension/readme.md` only that it *existed* - while that file is
  the extension's long description and sits inside the artifact the upload carries. So editing it
  *after* packaging shipped a description that disagreed with the repository, and every check here
  passed. Found by editing it after a packaging pass and then asking which files this script actually
  reads back; fixed by comparing its bytes to the source's, beside the licence comparison it mirrors;
  falsified by appending a line to `extension/vscode/README.md` after packaging -
  `FAIL the readme in the archive is the source's, byte for byte`, exit 1, restored byte
  for byte to `30A9464E...`. *A check a tool's convention makes look redundant is a check nobody
  writes - and the order is: edit every file that travels, then package, then read the archive back.*

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
  test simply did not know it had been. The list names **nine** shapes and the derived set names the
  nine worlds that declare one, and the test is what proves the detector has not quietly lost one - a
  figure re-measured rather than recalled, and one that had already drifted to `seven` in this very
  paragraph by the time the two worlds after the eighth landed. *A test that
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

- **A probe is falsified by the test it breaks, not by a string it searches for - and a needle naming
  a string the failing assertion never reaches reports the reverse of what happened.** The third form
  of the same defect, found while falsifying `adapters/sim-mobile/mobile-port.ts` against its own
  suite. The escape probe replaced the boundary predicate with an unconditional acceptance, and it
  **fired**: `tests=49 pass=46 fail=3`, naming `refuses a path outside both trees a command may open,
  and records the attempt` and `records which client made the crossing`. The harness nevertheless
  printed `verdict: did not fire`, because it searched the output for
  `outside both directories a command may open` - the **reason string** the refusal path builds, which
  the coverage never reaches: the first assertion the tree evaluates is `call.result === "refused"`,
  and it fails there. So the three probes were tightened to declare `breaks: [<test title>, ...]` and
  to require **every** declared title to appear in the scraped failing-test names, which is a claim
  about what the probe *moved* rather than about what the file happens to contain. That distinction
  is load-bearing rather than stylistic: the other two probes' original needles were `absent` and
  `<redacted>`, and neither is evidence of anything. `absent` is a word that appears in the
  **titles** of the tests the probe broke, so it would have read `FIRED` with the probe disabled;
  `<redacted>` appears in no failing title at all and was matching somewhere else in the output
  entirely. So two verdicts that read `FIRED` were coincidentally right about coverage and had never
  been computed from it. *A substring is a question about a document; the question was "which tests
  did this break", and only the failing-test names answer it.* This is the
  fourth time this repository has recorded a harness reporting something it did not measure, after
  the CRLF anchor, the column-zero `not ok` scrape, and the probe that restored the file before
  running the suite - and the generalisation they now share is one sentence: **a harness's verdict
  has to be computed from the same evidence a reader would use, or it is a second opinion about the
  wrong thing.**

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

- **A published artifact is not a repaired artifact, and a version a marketplace already serves can
  never be replaced - only superseded.** The Cockpit's own 72-test suite was green *before* the
  repair and green *after* it, which is the point: **a green unit suite and a working artifact are
  two independent claims**, and only the second one is the product. The claim was settled by putting
  the real compiled Cockpit inside `sim-vscode` and judging it with eleven acceptance criteria -
  the world installs the archive's own manifest, activates it in a real child process, invokes its
  commands and reads what it wrote to a channel. That world reported two defects, both in
  `extension/vscode/src/host/vscode-port.ts`, both invisible to the suite:
  `registerCommand` wrapped the handler and then wrote `void handler().catch(...)` - **a discarded
  promise is not a discarded wrapper**, so `vscode.commands.registerCommand` answered `undefined`
  and every caller that chained on its answer failed; and `openPath` used the answer of
  `workspace.openTextDocument` with `.then` on no shape check at all. The falsification is what makes
  the reading a measurement rather than an impression: patching each defect back into the *staged
  compiled* artifact moved **exactly one** criterion each (`AC-008`, `AC-010`), and restoring the
  artifact returned the run to `PASS 11/11` with complete evidence. Note *where* the probe had to
  reach: `vscode-port.ts` is **not** a member of the world's `MODULE_REGISTER`, so no registry edit
  could have exercised it - the probe patches the compiled bytes, and it must snapshot its golden copy
  from a **known-good** state, because a snapshot taken after the artifact was already patched
  silently converts the control into a second copy of the defect. Then the part that costs money:
  **the archive attached to `v0.2.1` had been built before the repair.** Read back by expanding the
  downloaded asset and reading `extension/out/host/vscode-port.js` inside it - the discard defect
  present, the shape guard absent, and the bytes differing from the build - and the **VS Code
  Marketplace was serving that same `0.2.1`** (`lastUpdated 2026-09-15T15:36:02.787Z`), so the
  defective build was public and the version could not be overwritten. `npm run package` succeeding
  says only that a file was written; it says nothing about whether the file is current. The version
  moved to `0.2.2`, and the rule this repository now holds is: **after every repackage, read the
  attached asset back and hash it** - the same discipline `smoke:dist`, `smoke:out` and `smoke:vsix`
  already apply one runtime out, applied to the one artifact that leaves the machine for a place
  nobody here can inspect.

- **A command block is a roster, and a roster that omits a command a reader was promised is the
  fourth occurrence of one shape.** `package.json` declares thirteen `demo*` scripts; `AGENTS.md`'s
  `Running things:` block listed eleven and named neither `demo:vscode` nor `demo:data` - both
  declared, both shipped, both described at length in `README.md`, and both absent from the one block
  a reader copies from. `README.md`'s own prose roster beneath its quickstart block omitted
  `demo:cockpit` in the same way. Nothing failed, because a list of names in a document is read by
  nothing that could disagree with it - the shape this file already records three times (`db.query`,
  `db.rowCount`, `web.visible`). `tests/demo-rosters.test.ts` now derives the roster from the manifest
  and compares it against the **fenced code blocks** of both documents rather than against the whole
  file, because the drift was a missing *block* entry while the same demo was described at length in
  the layout table. It tolerates exactly one named exemption - `demo:no-browser` is introduced in its
  own paragraph rather than in the quickstart - and asserts beside it that the exempted name is still
  printed somewhere on the page, so a named exemption cannot quietly become an omission. Its first run
  failed on a **correct** document: the header comment stated the reader-versus-roster distinction
  while the code asserted the stricter claim, and *a comment describing what an implementation does is
  not the implementation*. It was split into four `it` blocks for the same reason, so that a failure
  names one property instead of whichever fired first. Falsified 3/3: deleting the `demo:cockpit`
  fence line from either document, and inventing a demo into `README.md`, each failed the subtest that
  names it. **And the roster has a third list, which was the one nobody read.** `AGENTS.md`'s
  *"Running things:"* block and `README.md`'s quickstart are two documents; `.github/workflows/ci.yml`
  is a third statement of the same roster, and it said something different. The `worlds` job ran
  **seven** demos while `package.json` declared thirteen, so `demo:api`, `demo:local-process`,
  `demo:data` and `demo:cockpit` were declared, shipped and documented in `README.md` while **no CI job
  executed them** - and the build was green, because a job that runs seven of thirteen demos passes.
  Fixed in `623aab9` and proved by run `35033297178`, where the job's own log carries eleven
  `##[group]npm run demo:X` markers by name. The demos are run from `for world in db k8s ...; do`
  rather than from `strategy.matrix`, so `demosInWorkflow` reads the loop's own world list and unions
  it with the demos named literally (`npm run demo`, `npm run demo:no-browser`), and discards any
  match containing `$` because `echo "::group::npm run demo:$world"` is itself a line of the file. The
  file was then seven `it` blocks over three rosters, falsified 3/3 at the workflow too - a world dropped
  from the loop, the refusal demo dropped from the canonical job, and an invented demo added to the
  workflow, each naming its subtest before being reverted. *A guard that reads two of three statements
  of one roster is a guard that can be green while the third is wrong - and the count of `it` blocks is
  a number in prose, so it gets re-measured whenever this entry is touched.*

- **A guard has to read every spelling of the thing it is looking for, or it reports a correct document
  as wrong.** The self-acceptance route is named in **four** places - the manifest declares it,
  `README.md`'s quickstart fence and `AGENTS.md`'s command block print it, and
  `.github/workflows/ci.yml` runs it - so `tests/demo-rosters.test.ts` grew a fourth roster, as its own
  `describe` block holding all four, on the same argument as the three already there. Its workflow
  reader matched only `run: |` followed by bare command lines, which is how the demo loop is written,
  while the new step is an inline `run: npm run acceptance` scalar - so the check failed against a
  **correctly** running the command, and the only reason that is known rather than suspected is that
  the workflow was *read* after the check failed instead of edited until it went green. Both spellings
  are now accepted by one line-shaped pattern rather than a substring, because a `#` comment naming a
  script is a note *about* CI, and a roster that accepted one would be satisfied by the paragraph
  explaining why the command exists. Falsified **4/4** - the route was deleted from each of the four
  places in turn, each run failed naming that place and no other, and every file was restored byte for
  byte with the harness printing the endings it detected (`manifest="\r\n" ...`). *A guard that reads
  one spelling of a multi-spelling thing is the same defect as a guard that reads two of three
  statements of one roster, one layer in: the document is right and the check is wrong.*

  **A roster is not a `describe` block, and the count this entry's predecessor promised to re-measure
  is therefore two numbers rather than one.** The file is now **twelve** `it` blocks over **four**
  rosters, held in **three** `describe` blocks - because the manifest, the two command blocks and the
  workflow are four *places* while two of them are read by the same pair of assertions, so "four
  rosters" counts subjects and "three describe blocks" counts the code's grouping. Writing one figure
  for both is how a correct file came to be described by a sentence that was wrong about it. The fifth
  assertion in the fourth roster is the newest, and it is there because the step's *position* was a
  claim made only by a comment: the self-acceptance step has to sit **above** the demo loop, because
  every run in that job writes the same `.veridian/latest-result.json` and the upload step carries the
  whole of `.veridian/` - so the reading a reader opens first is whichever run wrote that file last,
  and the artifact's own comment says that has to be `cockpit`. Falsified 2/2 by a harness that
  computes each file's ending from the file it is about to edit and prints what it detected
  (`ci.yml="\r\n"`): moving the step back below the loop fails *"runs it before the demo loop, so the
  artifact's newest reading is the Cockpit's"*, and deleting it fails *"is run by a CI job, rather
  than only described by one"*, with the file restored byte for byte after each probe. *A comment
  about CI is read by nothing; an ordering claim is held only by a check that reads the order.*

- **A metric that compares two readings must first establish that they are readings of the same
  thing, and the identity it needs may not be in the thing it compares.** M1 asks "did the same code
  give the same result twice", and `signature()` answered with the iteration index, each criterion's
  id and status, and the verdict - **no goal, no adapter**. A criterion id is a name *inside one
  contract*: both the cart demo and the inventory demo name `AC-001`..`AC-004` and both repair them in
  ascending criterion order, so two runs of `shopping-cart` on `local-web` and one of `inventory-db` on
  `local-db` produced **byte-identical signatures** and `veridian metrics` printed
  `M1 result consistency: yes (3 runs, ...)`. That is a false PASS by construction, in the one place
  whose entire purpose is to refuse one, and it was found by running the reproduction rather than by
  reading the function - the criteria collided because the *contracts* collide, which no amount of
  reading `metrics.ts` reveals. The fix carries the subject on the reading (`RunSnapshot.goalId`,
  `.adapter`, from the bundle's own `goal_id` and `environment.adapter`, `null` when absent) and
  **groups the population before comparing anything**, which is also why `signature()` is left
  subject-blind on purpose: `compareTo` should not have a question to ask about two unrelated claims.
  Three states, not two - the runs agreed, the runs disagreed, and this population is not a question
  M1 can answer - so `ConsistencyReport` gained `measured`, `formatMetrics` prints three lines, and
  the CLI counts a violation only when `measured && !consistent`. Writing it as `runs > 1 &&
  !consistent`, which is what it was, worked for the single run by accident and would have accused a
  clean-but-heterogeneous history of a divergence it had refused to look for: **a false FAIL beside
  the false PASS, and the second one would have hidden the first.**

- **A test whose fixtures cannot be told apart does not test the gate that tells them apart, and the
  green suite is what hides it.** The first version of the mixed-population test used three runs with
  *identical* signatures - the reproduction, and the reason the defect went unnoticed - so removing
  the comparison gate left every assertion passing: `differences` was empty because the signatures
  agreed, not because the population had been refused. Falsifying the guard is what found this, and it
  found it only because the probe was run rather than trusted; the test now carries a positive control
  that asks the same two readings of **one** subject and asserts the machinery *does* name a delta, so
  the empty list is evidence of a refusal. *A test that passes whether or not the rule holds is not a
  test* - and the fixture that made the defect invisible is exactly the fixture a test written from
  the defect will reach for.

- **A probe harness that restores the file before running the suite reports "did not fire" for
  reasons that have nothing to do with the code.** The M1 harness patched `metrics.ts` correctly,
  restored it, and *then* ran `node --test` - so all four probes reported `did not fire` against the
  **unpatched** file, which reads as four rules that are not held. A probe that measures the original
  is a verdict about work that did not happen, and it is the same failure the repository already
  records at the CRLF anchor and at the column-zero `not ok` scrape. The harness now patches, runs,
  then restores, decides each file's ending from the file it is about to edit and prints what it
  detected, and asserts the anchor was present before patching and that the patch changed the file.
  Under it all four probes fire by name: removing the comparison gate, widening `measured`, treating
  an absent subject as a match, and dropping the formatter's mixed branch each fail the subtest that
  names the property.

- **A premise in prose is neither a name nor a count, and the guard over a document cannot hold it.**
  Moving the confine seam into `core/process.ts` did not touch `core/environment/types.ts`, and it
  falsified a bolded invariant inside that file's doc block: *"The three worlds that confine a child
  are exactly the three that answer this question with a measurement"*. True when written, because
  only three worlds confined a child at all; after the migration **all twelve** hand the runner a file
  allowance (eleven when the migration landed - `sim-mobile` arrived after it and does the same, which
  is why this figure had to be re-measured rather than carried), so the left side of that equality
  denotes every row while the right side still holds of three. The same premise was repeated in
  `tests/boundary-roster.test.ts` as an explanation (*"the
  other eight act in process and hold no boundary to measure"*, which was the superseded spelling
  while eleven worlds existed) and as an assertion title and
  message, and nothing failed: the assertion's **set** stayed correct, because the migration left the
  network arm alone, so what went stale was the **reason**. It was found by searching the tree for the
  claim rather than by reading the file the change touched, which is the only way it could have been
  found. The correction is narrower and is now what all four places say - the separation is **a front
  door, not a child**: the two worlds whose every request passes a guarded route answer `enforced`,
  `local-process` has no door and answers `unenforceable` because `--allow-net` does not exist on this
  runtime, and the other nine answer `unsupported` - two `enforced` plus one `unenforceable` plus nine
  `unsupported` is the twelve. And the guard over that doc block was **measured
  rather than assumed** to be useless against it: patching the false sentence back in leaves
  `tests/boundary-roster.test.ts` at **14 pass / 0 fail** (exit 0, line ending detected first, anchor
  asserted present, edit asserted to have changed the file, file restored byte for byte), because that
  block asserts only that the prose **names** all four enforcement values and all three worlds - *a
  guard that holds a vocabulary's membership cannot hold its meaning.* Three kinds of prose claim now
  have three recorded fates: a **name** can be pinned by a test that reads the code, a **count** can
  only be re-measured when the document is touched, and a **premise** can be invalidated by a change
  that never opens the file it lives in - so the way to hold one is to search for it.

- **A guard's *purpose* is the property it must hold; its *mechanism* is only how it was measured,
  and the two drift apart in silence.** `tests/boundary-roster.test.ts` exists so that *"a twelfth
  world cannot join either side of this split in silence"* - that is its purpose, and it is right.
  Its mechanism paired the rows it had walked off `adapters/` against a `readdirSync` of the
  **directory names** under `adapters/`, so what it actually asserted was that every directory under
  `adapters/` holds a world. That is a claim about the tree's **layout** rather than about the
  **code**, and it was true for exactly as long as the two happened to coincide. `adapters/sim-mobile/`
  is where they stop coinciding: it holds a substitute device port, a 49-test suite and a reading
  vocabulary, and **no adapter** - so the guard's first assertion failed with
  `every adapter directory contributed exactly one row to this guard's walk`, `actual` naming
  `'sim-mobile'` and `expected` not. The directory is not a world, so it cannot escape a split about
  worlds; what *can* is an **adapter nobody classified**, and that is found by selecting on
  `implements EnvironmentAdapter` - robust to the filename, the directory and the filing - which
  measured exactly the twelve `*-environment.ts` files and nothing else. The guard's walk now derives
  its population that way, and a register cross-check beside it holds the complementary failure in
  **both** directions: an adapter nothing can construct, and a declared world with nothing behind it.
  *The tempting repair was to write the missing adapter, and it was the wrong one* - a twelfth world
  is not one file but a plan block, a schema, a loader, a `WORLDS` entry, a surfaces-guard extension,
  a validator family and a demo (`docs/GAP-CLOSURE-DESIGN.md` W2 specifies all of it and
  `docs/BOUNDARY-SPINE-DESIGN.md` decision 6 defers it), and **a declared world with no adapter
  behind it is worse than none, because the register cross-check now names it** - which is what the
  falsification probe watched happen when an unregistered adapter file was seeded into the tree and
  the guard failed with *"every adapter in `adapters/` is a world `cli/worlds.ts` declares, and every
  world it declares has one"*. Falsified rather than trusted, three probes, each firing by name and
  message and each restored byte for byte: the old directory-name walk back in place (`fail=1`), the
  seeded unregistered adapter (`fail=2`), and `asksForConfinement` answering `false` for everyone
  (`fail=3`). *A guard whose mechanism is a naming convention is a guard whose coverage is a
  coincidence, and a guard whose stated purpose survives a change to its mechanism is the guard
  working - read the purpose, then fix the mechanism, and never widen the claim to fit.*

- **A test built from a positive cap cannot see where a bound is placed, and the input that can see
  it is the cap already reached.** `core/clarification/engine.ts` checks the per-run round budget
  **before** it spends a round, which is what makes the worst case a bound that was already reached
  rather than one that is one over - and the guard written for the ladder
  (`tests/clarification-ladder.test.ts`) was first drafted with `maxSelfPromptRoundsPerAmbiguity: 2`
  for the bound and a *positive* per-run cap for the placement. Falsified rather than trusted, by
  moving the cap block below `rounds += 1;` and `this.#selfPromptRounds += 1;` in a probe: the
  bound subtest **still passed**, because with a positive cap the two placements differ only in a
  boundary the per-gap cap already covers. The subtest that failed was the one whose policy sets
  `maxSelfPromptRoundsPerRun: 0` - a cap already spent, where *check first* answers `attempts: 0`
  and *increment first* answers `attempts: 1`. *A test whose inputs cannot reach the difference
  cannot see the difference*, and a guard about a before/after placement therefore has to be written
  from the degenerate case rather than the typical one; the same file's four properties were each
  falsified by a probe naming exactly one subtest, 4 of 4, with the tree restored byte for byte.

- **A read allowance and a write allowance answer two different questions, and `--allow-fs-read` is
  an allowlist rather than a widening.** `demo:k8s` was found failing at `INCONCLUSIVE (ABORTED, 0
  iteration(s))`, exit 2, and the cause was not the cluster and not the application: the adapter
  confined the deploy child with `readRoots: [appPath]`, while `examples/sim-k8s/app/deploy.mjs`
  imports `yaml`. The permission model **enforces its allowlists against the interpreter's own module
  resolution**, so `node_modules/yaml/package.json` was refused - `ERR_ACCESS_DENIED`,
  `permission: FileSystemRead` - **before the program's first statement ran**, the child exited 1,
  preparation reported `ENVIRONMENT_FAILURE`, and the run aborted with no iteration to observe: an
  `ENVIRONMENT_FAILURE` wearing the application's clothes. Correlated exactly rather than assumed:
  an import census over `examples/**` returned three lines, and `sim-k8s` is the only world whose
  application imports a real package - and the only world that failed. The repair extends the
  *existing* allowance (`readRoots: [appPath, ...dependencyReadRoots(appPath)]`, derived by walking
  **up** the way Node does) and leaves `writeRoots` alone, so the measured `filesystemWrite`
  dimension is unchanged. *A program's source and its dependencies are two directories, and a
  permission model that enforces allowlists does not know the difference.*
- **The guard that should have caught it asserts the presence of an allowance, never its width - and
  the unchanged test count is the measurement that proves nothing in the tree held the rule.**
  `tests/boundary-roster.test.ts` selects every adapter via `implements EnvironmentAdapter` and asks
  `asksForConfinement(text)` whether `confinement:` appears at all; every assertion is about
  membership, none about content. So the `sim-k8s` regression was green in the suite and red in the
  demo, and the repair left the suite at **2466 tests unchanged** - which is not a coincidence but
  the diagnosis: a suite whose count does not move when a rule is repaired and re-broken is a suite
  that never held it. The guard that does hold it (`tests/sim-k8s-environment.test.ts`, asserting the
  runner's allowance reaches the dependencies the application imports) moved the run to **2472 over
  412 suites**, and it was falsified **2 of 2** - an adapter-only allowance breaks the adapter guard,
  and a derivation that stops at the start directory breaks four confinement subtests beside it.
  *Two independent claims: "the allowance is declared" and "the allowance covers what the program
  reads" - and a guard written against one of them cannot see the other.* Its sibling: a guard that
  asserts a helper's output against a literal cannot hold a helper that walks the **real** filesystem,
  because the literal is then a property of the machine the test happens to run on.
- **A count in prose is a claim, and a handoff that recalls one is a claim too.** Twelve worlds have
  landed and `AGENTS.md`'s own summary line says so correctly (*"the MVP is implemented and green,
  and eleven more sandbox worlds have landed"* - 1 plus 11 is 12), but six other places still said
  eleven or thirteen, and **the handoff that listed them was itself wrong twice**: it flagged
  `AGENTS.md:7` and `AGENTS.md:814` as drift, and measurement showed the first is an MVP-plus-eleven
  decomposition and the second reads *"Twelve adapters are registered, eleven of them need no
  browser"*, which is internally consistent. Both false flags were caught by **counting**
  (`adapters/*-environment.ts` returns 12, `demo*` scripts in `package.json` return 14, the ci.yml
  loop names 12) rather than by reading, and the six real corrections were then applied against those
  measurements: two manifest descriptions, three `ci.yml` comments and one `AGENTS.md` clause. *A
  number cannot be pinned by a test the way a name can - which is why the only durable fix is to
  re-measure at the moment the document is touched, and why a handoff that recalls a count instead of
  taking one inherits the same defect it is reporting.* The extension's description travels inside a
  packaged artifact, so correcting it required a repackage and a readback - and the readback is the
  half that matters: **the archive's hash moved** (`85BD2672DFE9A6B5` to `FB0898395806AB19`, 122303
  to 122304 bytes) and `smoke:vsix` compared the archived manifest field-for-field, which is the only
  thing that says the file a reader downloads is the file the correction is in.
- **A readback that globs a directory selects by name order, and a name order is not the artifact you
  meant.** The distribution-route script resolved the built archive with
  `Get-ChildItem *.vsix | Select-Object -First 1` and returned **`veridian-cockpit-0.2.2.vsix`** - the
  stale one - because both versions are gitignored and accumulate, and `0.2.2` sorts before `0.3.0`.
  A hash read off the wrong file is a measurement of something, and it is not a measurement of the
  build. The archive name has a single definition in this tree (`scripts/vsix-archive.mjs`, the same
  one `smoke:vsix` uses) and it is resolved from the manifest's own `version` field rather than from
  the directory listing. *A readback that globs answers "which file is first" when the question was
  "which file did the build just write".*

- **A guard over an index is the fifth time this repository has asked "does the document name the
  code", and the first whose *falsification harness* was itself wrong.** `AGENTS.md` obliges a
  one-line index entry per new document in as many words - *"Add a one-line index entry here for each
  new doc"* - and nothing held it: `docs/` gained an eighth file (`ISOLATION-AND-MCP-PLAN.md`) while
  the Documentation table still listed seven, and the drift was silent for exactly the reason the
  `db.query` / `db.rowCount` / `web.visible` / observation-vocabulary entries already record - *a list
  of names in a document is read by nothing that could disagree with it*. The nearest existing checks
  each name one document for their own purpose and none enumerates the directory, so a new document
  could arrive un-indexed in silence, which is what happened. `tests/docs-roster.test.ts` now reads the
  directory and the table together, and the **scope** is the load-bearing part rather than a stylistic
  choice: `AGENTS.md` names the first document in its table repeatedly below the table - in the status
  banner, in the AVF-rename note, in two rosters - so a question asked of the whole file would pass
  with the table two rows short: the vacuous pass `tests/observation-vocabulary.test.ts` discovered in
  its own first draft, arriving here at the second guard to need the same correction.
  **Then the probe that falsified the guard fired for the wrong reason, and what caught it was the
  probe's own control.** Its guard-deletion needle was the document path spelled as a markdown link,
  which matched **three** lines rather than the single table row, so the control printed `1 time(s)`
  where an independent count taken then said **7** - and a probe that deletes every reference reports
  `FIRED` while leaving the scope it claims to test entirely unexercised. The anomaly was turned into a
  repair by *measuring* it rather than by re-running and hoping, the needle was re-aimed at a phrase
  unique to the table row, and the control then read `5` - which reconciled exactly with `7 - 2`
  occurrences on the deleted line - and was itself able to fail the probe through a threshold. *A probe's verdict has to be computed from the tests it broke,
  and its control has to be reconciled against an independent count: a control that is only printed is
  decoration.* This is the sixth time this repository has recorded a harness reporting something it did
  not measure, after the CRLF anchor, the column-zero `not ok` scrape, the probe that restored the file
  before running the suite, the substring needle, and the probe that read the wrong file's count.

## Documentation

| Document | Contents |
|----------|----------|
| [`README.md`](./README.md) | The front door: what Veridian is, the two governing rules, the quickstart, the canonical demo's real output, the CLI and its exit codes, M1..M5, the contract formats, the layout, and what is deliberately out of scope. **Keep it true; correct it in the same pass as the change that falsifies it.** |
| [`docs/PLAN.md`](./docs/PLAN.md) | The authoritative product and architecture specification: product definition, scope boundary, execution lifecycle, acceptance/validation model, MVP scope, repo structure, 4-week build plan, Definition of Done, roadmap. **Read before any non-trivial design decision.** |
| [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) | What was actually built against that plan: module inventory, the decisions taken and the ones reversed, the open items. **Read before assuming something is missing.** |
| [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md) | Why the goal's safety limits are applied rather than only recorded: the audit that found the third clause of the `PASS` rule unfalsifiable, the self-prompted questions that resolved it, the four-move design, what the implementation changed about the plan, and §10 - what §8 anticipated and what arrived. Its own superseded Q4 answer is kept and marked rather than rewritten, because the error is the instructive part. |
| [`docs/GAP-CLOSURE-DESIGN.md`](./docs/GAP-CLOSURE-DESIGN.md) | The seven work items that close the remaining gaps (W1..W7), the census each was designed against, and the audit trail of what executing them decided: §9's F1..F6 are the findings of the first one - an operator's reset command is not the application's child, an account has no path, the absence of `--allow-net` does not break a socket-using world, six port-level spawns are the substitute acting rather than the application provisioning, the guard was falsified in two halves, and a document's stated premise did not survive the seam. **Read before building a world or moving a seam**, because the findings are the parts of the design that turned out to be wrong. |
| [`docs/BOUNDARY-SPINE-DESIGN.md`](./docs/BOUNDARY-SPINE-DESIGN.md) | The design the boundary work was executed against: the eight gaps as they were found, the self-prompted questions each one resolved into, the `confinement.ts` seam and its two-stage probe, and the acceptance criteria the work was judged by. **Read before changing what a world reports about its own boundaries**, because the vocabulary it defines is now derived by `tests/boundary-roster.test.ts` rather than recalled. |
| [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) | What comes after the MVP: the npm, Docker and VS Code routes, the next adapters in the order they can be **proven**, the self-prompting resolution table that ordered them, and §5's reframing of what "blocked" actually means - every remaining row names the `sim-*` world that answers it, because a world may be simulated and a real-infrastructure absence is not a blocker. **Read before promising an adapter.** |
| [`docs/GAP-CLOSURE-PLAN.md`](./docs/GAP-CLOSURE-PLAN.md) | The implementation plan for W2 - `sim-mobile`, which was the last unbuilt world and is now the twelfth. Twelve additive places each measured at a file and an anchor rather than recalled (the twelfth being `core/environment/load.ts`, which an earlier census missed), the six guards the change trips and the expected failure of each, and the falsification probe for every claim. **Read before building a thirteenth world**, because it is the checklist a world has to satisfy and the record of what one of the six guards does when a directory is not a world. |
| [`docs/ISOLATION-AND-MCP-PLAN.md`](./docs/ISOLATION-AND-MCP-PLAN.md) | The plan for the two halves of W6, the one item of the seven that was designed rather than built. §3.1 defers the isolation substrate to a CI-proven phase, and its absence here is a **measurement**: `docker` is not on `PATH` and `node --permission` rejects `--allow-net` with `bad option`, exit 9, taken with a positive control. §3.2 and §4 build the MCP Level-3 surface as a **fourth consumer** beside `cli/` and `extension/vscode/` and never as the foundation, §3.3 answers `PLAN.md` §55's `❌ MCP server` by reading the three prohibition lists separately and showing two of them were already crossed in shipped code, and the fourteen tool rows across §23 and §45 collapse to nine spellings of eight capabilities under a register guard. **Read before building an MCP surface or an isolation substrate**, because every claim in it is measured at a file and an anchor, and the deliverable is a self-binding plan rather than code. |
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
  the twelve families' arrays - each member an object with a `.name` beside its `targetNoun`, its
  `validate` and the rest. A guard that did `list.includes("data.record")` would be false for a
  registered validator, and a guard that iterated the array and printed each member would print
  `[object Object]` in a message meant to name a family. Measured: the roster is **135** members
  (`8+4+7+12+12+11+19+17+8+12+13+12`). *A vocabulary is a list of things, and whether a member is a string
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
