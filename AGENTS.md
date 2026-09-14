# AGENTS.md

Agent instructions for the **Veridian** repository. This is the single always-on
instructions file for this workspace — do not add a second one
(`.github/copilot-instructions.md`) alongside it.

> **Status: the MVP is implemented and green, and two more sandbox worlds have landed.** Core, the
> `local-web` adapter, the Playwright validators, the CLI, the schemas and the canonical demo all exist.
> `local-db` - a second adapter and a second validator family, against a SQLite file with no browser -
> exists beside them, and is the proof that `EnvironmentAdapter` is a seam. `sim-k8s` is the third, and
> the first **simulated** world: a real application process really deploying itself into a substitute
> control plane over routes it really calls, with scheduler, kubelet, etcd and admission standing in.
> `npx tsc --noEmit` is silent and `node --test` reports 694 passing tests - Veridian's own 634 plus
> the 60 the VS Code Cockpit contributes, which the root runner discovers because it walks the tree.
> Three distribution routes ship - a clone, an npm package, and the Cockpit - and there is still **no
> build step between the source tree and the running program**: Node 22 strips types and runs `.ts`
> straight from the source. `npm run build` exists only to produce the *compiled* copy an installed
> package needs, because Node refuses type-stripping under `node_modules`, and the Cockpit has its own
> `npm run build` for the third runtime, because the extension host is not Node's loader either. Read [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) for what was
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
                        Read `extension/vscode/README.md` for the install route and the list of what
                        a real VS Code test host would still have to cover.
core/clarification/     The ambiguity protocol: ladder (derived → inferred → defaulted → answered →
                        deferred), detectors, JSON-pointer editing, the report. Lowest layer.
core/schema/            JSON Schema validation + the loader that reads schemas/.
core/goal/              Goal definition, loading, persistence, versioning.
core/acceptance/        AcceptanceCriterion + the engine that turns a contract into an
                        executable validation sequence (core/acceptance/plan.ts).
core/execution/         Run controller implementing the state machine above + the repair gate.
core/validation/        ValidationResult, validator registry, status semantics, verdict rollup.
core/environment/       EnvironmentAdapter interface + Environment Manager (lifecycle,
                        health checks, reset, snapshot/restore) + web-observation.ts, the shared
                        vocabulary that keeps validators from depending on adapters + db-observation.ts,
                        the same idea for the database family + the boundary vocabulary
                        (BoundaryPolicy/BoundaryReport) that keeps a declared safety limit from being
                        mistaken for an enforced one.
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
validators/playwright/  Playwright web validators (element, value, text, count, url, console,
                        network).
validators/database/    Database validators (table, column, count, value). Judge a reading in
                        core/environment/db-observation.ts, which is what keeps them from importing
                        an adapter. Each declares its own `targetNoun`, so the clarification ladder
                        asks "which table" rather than "which element".
validators/k8s/         Cluster validators (applied, deployment, image, ready, pod, service, event).
                        Judge a reading in core/environment/k8s-observation.ts, on the same rule as
                        the database family - and the reason the third family needed no core change.
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
cannot be written inside the MVP, and the finding is recorded rather than the attempt made: the only
registered adapter is `local-web` and all eight registered validators are browser observations, so a
contract about a CLI would make every criterion `INCONCLUSIVE` and exit 2 - the same defect as
`--browser none` on the canonical demo. Dogfooding therefore needs a **non-web** adapter or
validator, which the scope boundary forbids building speculatively. Veridian's own self-validation is
its `node --test` suite, which `npm run gate` runs.

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
node --test                # the whole suite. 694 tests, 1.7s. No directory argument.
                           # 694 = the root's own 634 + the Cockpit's 60, because the runner walks
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
npm ci                     # install. Dev only: typescript, @types/node, @types/vscode.
                           # There is no runtime dependency, and Playwright is not one of them.
npm run gate               # typecheck, test, build, smoke:out - in that order.
                           # npx tsc --noEmit  -> silent
                           # node --test       -> 60 tests, 0 failing
                           # npm run build     -> out/, 6 files
                           # npm run smoke:out -> loads the compiled entry point, 14 checks
npm run smoke:out          # alone: resolve the manifest's `main`, activate it twice under a
                           # recording double of `vscode` (scripts/vscode-stub.mjs), and assert the
                           # registered commands equal the six the manifest declares. Exit 1 if the
                           # compiled file the manifest names is not there.
```

**`npm run smoke:out` exists for the same reason `npm run smoke:dist` does, one runtime further out.**
`node --test` runs `.ts`; the extension host runs `out/*.js`; so the six files that ship are covered by
nothing in this tree. It was falsified rather than trusted - pointing `main` at a path the build does
not produce makes it fail naming that path and exit 1. It is also only *necessary*, never sufficient:
`scripts/vscode-stub.mjs` is a recording double, and `extension/vscode/README.md` names what only a
real VS Code test host could exercise.

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
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) has four jobs. `gate` runs `npm run gate` on
`ubuntu-latest` and `windows-latest` (both resolving Node from `.nvmrc`). `demo` runs the canonical
demo on ubuntu, asserts that `--browser none` really exits 2, and uploads `.veridian/` as an artifact.
`distribution` runs `npm run smoke:dist` and then a full `npm pack` -> install into a clean directory
-> run round trip, because that is the only check that reads `files` and `bin` the way a consumer
does. `container image` builds the Dockerfile and requires the container to run the CLI **and** to
resolve its own schemas from a browserless run.

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
is why `extension/vscode` is the *only* directory in the repository with a build step.

What the phase produced, all measured on this machine:

```
npx tsc --noEmit    silent (exit 0)
node --test         60 tests, 0 failing
npm run build       out/, 6 files
npm run smoke:out   14 checks, exit 0
npm run gate        exit 0
```

- `src/port.ts` declares by hand the slice of the editor API the Cockpit uses, so the *decisions* are
  testable without an editor; `src/host-boundary.test.ts` makes "only the two host files may import
  `vscode`" an executable rule, and it was falsified (prepending such an import to an ordinary test
  fails it, naming the cause and the remedy).
- `scripts/vscode-stub.mjs` and `scripts/smoke-out.mjs` cover the **compiled** artifact, because
  `node --test` runs `.ts` and the host runs `out/*.js` - the same gap `npm run smoke:dist` closes for
  the package. Falsified: a `main` the build does not produce fails the check and exits 1.
- **Not built and not claimed: a `.vsix`.** Packaging needs `@vscode/vsce`, which is not a dependency
  here and whose output has never been produced on this machine; the shipping install route is the
  development install against a checkout (F5, configured in `.vscode/launch.json` and
  `.vscode/tasks.json`). The list of what only a real VS Code test host could exercise is written out
  in [`extension/vscode/README.md`](./extension/vscode/README.md) rather than left implied.
- `extension/vscode/out/` is generated, never edited, never committed, and ignored by `.gitignore`
  for the same reason `dist/` is: a generated tree that is not ignored is one `git add .` away from
  being committed.

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

## Documentation

| Document | Contents |
|----------|----------|
| [`README.md`](./README.md) | The front door: what Veridian is, the two governing rules, the quickstart, the canonical demo's real output, the CLI and its exit codes, M1..M5, the contract formats, the layout, and what is deliberately out of scope. **Keep it true; correct it in the same pass as the change that falsifies it.** |
| [`docs/PLAN.md`](./docs/PLAN.md) | The authoritative product and architecture specification: product definition, scope boundary, execution lifecycle, acceptance/validation model, MVP scope, repo structure, 4-week build plan, Definition of Done, roadmap. **Read before any non-trivial design decision.** |
| [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) | What was actually built against that plan: module inventory, the decisions taken and the ones reversed, the open items. **Read before assuming something is missing.** |
| [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md) | Why the goal's safety limits are applied rather than only recorded: the audit that found the third clause of the `PASS` rule unfalsifiable, the self-prompted questions that resolved it, the four-move design, and what the implementation changed about the plan. |
| [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) | What comes after the MVP: the npm, Docker and VS Code routes, the next adapters in the order they can be **proven**, the self-prompting resolution table that ordered them, and the environments that are blocked with their blocker named. **Read before promising an adapter.** |
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

