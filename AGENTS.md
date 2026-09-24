# AGENTS.md

Agent instructions for the **Veridian** repository. This is the single always-on
instructions file for this workspace �?do not add a second one
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
> `npx tsc --noEmit` is silent and `node --test` reports 2649 passing tests over 438 suites -
> Veridian's own 2557 plus the 92 the VS Code Cockpit contributes, which the root runner discovers
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

- **Name:** Veridian. **Formerly AVF �?"Agent Validation Fabric"** (renamed). The plan in
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
- **Do not make VS Code the architecture.** *"VS Code �?Veridian."* The extension is the
  **Veridian Cockpit** �?a thin client over a stable local Core interface, so that CLI, CI, and
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

Every environment �?no matter how exotic �?exposes the same lifecycle semantics:

```
DEFINE �?CREATE �?START �?DEPLOY �?EXECUTE �?OBSERVE �?VALIDATE
       �?COLLECT EVIDENCE �?PASS/FAIL �?RESET �?REPEAT
```

```
EnvironmentAdapter:  create() start() deploy() execute() observe()
                     snapshot() restore() reset() stop() destroy()

Validator:           validate(criterion, observation) �?ValidationResult

ValidationResult:    criterion_id, status, actual, expected, timestamp,
                     evidence, environment_id, run_id
                     status �?{ PASS, FAIL, ERROR, SKIPPED, INCONCLUSIVE }
```

### Run state machine

```
CREATED �?PREPARING �?READY �?EXECUTING �?OBSERVING �?VALIDATING
                                   PASS �?COMPLETED
                                   FAIL �?FAILED �?RESETTING �?READY
```

Terminal states: `COMPLETED, ABORTED, ERROR, MAX_ITERATIONS`. No ambiguous execution paths.

### Safety boundaries

Every execution has a maximum runtime, maximum iterations (`10` for MVP), resource cap, and
network / filesystem / process boundaries. **No infinite agent loop.** Veridian executes
potentially untrusted AI-generated code, so the adapter architecture must leave room for
stronger isolation later even though the MVP runs in a local trusted development mode.

## MVP scope �?Web Sandbox Validation Environment only

**In:**

```
VS Code  +  Veridian Core  +  Local application  +  Browser
  +  Playwright  +  deterministic acceptance criteria  +  evidence  +  reset/replay
```

**Out (future adapters �?do not start on these):**

```
Kubernetes   cloud        mobile farm        Windows/macOS VM
distributed execution     data lake / Hadoop / Spark / Kafka
multi-agent orchestration VM orchestration   desktop automation
SaaS backend              LLM training       sophisticated goal compiler
marketplace               plugin ecosystem   Chrome extension
```

**MVP success metrics** (not LOC, not adapter count): M1 �?99% result consistency on repeat
runs · M2 100% of canonical demo defects detected · **M3 zero false PASS** · M4 100% reset
reproducibility · M5 100% evidence completeness.

**Canonical demo:** a Shopping Cart app with 3 deliberate defects and 4 acceptance criteria,
iterating FAIL �?agent repair �?PARTIAL �?repair �?PASS. That is the "aha" moment: *the agent
generated code that was proven to work in a real sandbox.*

## Working agreements

- **Verify before claiming.** A change is done only when its gate (typecheck / lint / test)
  has actually run and passed in the terminal. Report the command output, not an intention.
- **Never guess a command.** If no manifest (`package.json`, `pyproject.toml`, `Cargo.toml`)
  exists, ask or leave a `TODO` �?do not fabricate an install/build/test command.
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
  (`open_intent` �?`accept_receipt`), never `add_memory`. The working arguments, measured here:
  `open_intent` takes `{ actor, target_entity }` - **`target_entity` is required**, and omitting it is
  the schema rejection quoted above, not an unreachability - and returns an `intent_id`;
  `accept_receipt` takes `{ actor, intent_id, observation, sensor_path, ok }` and answers `{"ok": true}`.
  A gate reading filed this way is a receipt, not a claim: the observation is the command, its exit code
  and its counts.
- If the server is unreachable, run `hipcortex start`, or say memory is unavailable �?never
  silently skip the write. *Unreachable* means `ECONNREFUSED`, which is the one cause
  `tests/memory-port.test.ts` still allows that word to name.

Full protocol: [`.github/skills/hipcortex-memory`](./.github/skills/hipcortex-memory/SKILL.md).

## Environment

- **OS / shell:** Windows, **PowerShell 5.1**. Chain commands with `;`, never `&&`.
- **`rtk` is not installed on this machine** �?do **not** prefix commands with it, or the command
  fails with `CommandNotFoundException` before it runs. *This corrects an earlier instruction in this
  file that told agents to always use it.* If it ever appears on `PATH`, prefer it; it passes
  unrecognised commands through unchanged.
- **`node --test` takes files, not directories.** Bare `node --test` discovers every `*.test.ts`
  recursively and is how the suite is run; `node --test tests` fails with `Cannot find module`. Pass
  a file path, or nothing at all.
- **`$LASTEXITCODE` read after a pipeline is the pipeline's exit code** (`-1` from `Select-String`),
  not the command's. Read it from an unpiped invocation when the code matters.
- **The console code page mangles typographic punctuation** (`—` arrives as `�?`). Print ASCII
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

The tree, directory by directory, and what each one is for: **`docs/LAYOUT.md`**. Read it before
adding a directory, or before deciding which layer a new file belongs to - the layering rules it
records are enforced by hand, and nothing else enforces them.

## Build / test commands

Every gate, smoke check and demo command, with the output each was measured against:
**`docs/BUILD-AND-TEST-COMMANDS.md`**. Read it before running a gate or claiming one passed.

## Distribution

The routes Veridian ships by, and the reasoning behind the build step and the packaging guards:
**`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`**. Read it before changing anything that travels off this
machine.

## Rules this build has paid for

Every rule that cost a real defect, with the defect it cost: **`docs/RULES-PAID-FOR.md`**. This is
the register to write in - a new rule belongs there, with the observation that produced it. Read the
entries that bear on what you are touching; do not read it whole, because it is the largest document
in the tree and most passes need none of it.

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
| [`docs/ISOLATION-AND-MCP-PLAN.md`](./docs/ISOLATION-AND-MCP-PLAN.md) | The plan for the two halves of W6, the one item of the seven that was designed rather than built. §3.1 defers the isolation substrate to a CI-proven phase, and its absence here is a **measurement**: `docker` is not on `PATH` and `node --permission` rejects `--allow-net` with `bad option`, exit 9, taken with a positive control. §3.2 and §4 build the MCP Level-3 surface as a **fourth consumer** beside `cli/` and `extension/vscode/` and never as the foundation, §3.3 answers `PLAN.md` §55's `�?MCP server` by reading the three prohibition lists separately and showing two of them were already crossed in shipped code, and the fourteen tool rows across §23 and §45 collapse to nine spellings of eight capabilities under a register guard. **Read before building an MCP surface or an isolation substrate**, because every claim in it is measured at a file and an anchor, and the deliverable is a self-binding plan rather than code. |
| [`docs/INSTRUMENT-AND-PROMPT-PLAN.md`](./docs/INSTRUMENT-AND-PROMPT-PLAN.md) | The two gap classes found by running `veridian metrics` over the 142-run history and reading the answer: the three ways the **instrument** reported something untrue about the runs on disk (W-A scopes M3's ground truth by subject, W-B splits M4's two conflated properties, W-C makes a `PASS` clause carry its reading), and whether the clarification ladder's self-prompting rung is reachable at each lifecycle point and its exit bounded (W-D). §1 records the measured decomposition behind M3's 117 accusations - twelve subjects, none of them `shopping-cart@local-web`, whose own scoped reading is **0** - and refutes an earlier hypothesis about `ded994` rather than dropping it. §5 states exactly what its repair does **not** claim. **Read before touching `core/metrics/` or adding a rung**, because its falsification table's last row is a probe that must leave the suite green. |
| [`docs/DIGITAL-TWIN-DESIGN.md`](./docs/DIGITAL-TWIN-DESIGN.md) | The bidirectional digital-twin vision aligned against this tree: the six claimed gaps classified as satisfied / partial / missing with a `file:line` or a command output behind each, the measured defect it opens with (`environment.json`'s writer drops the ten per-world declaration blocks the plan carries, while the two flat identity fields survive), the four words the vision wants that already exist here, the constraint the vision did not state (an imported world enters through `prepare()`, because this repository has paid for an inherited world three times), and Phases 0-4 each with an acceptance criterion derived from M1..M5 and a falsification probe. Its section 0 records that KARM was unavailable for it and that no KARM output is cited. **Read before building anything called a twin, an ELI or a materialization**, because the recommendation is a join and a name rather than a new layer. |
| [`docs/DIGITAL-TWIN-PLAN.md`](./docs/DIGITAL-TWIN-PLAN.md) | The execution half of the digital-twin work, written at the only level that decides anything - the file, the anchor and the assertion: W0 (the world identity survives the bundle, where `EnvironmentRecord` declares none of the ten per-world blocks the plan carries and a `sim-cloud` bundle can name its adapter and not its account), W1 (the ELI as a join over `listRuns`/`readRunHistory`, reusing the subject string M1 already computes so it cannot answer a question M1 refuses), W2 (`dENV` and the export predicate carried on `BOUNDARY_ENFORCEMENTS`' declared-versus-measured shape rather than a vocabulary of its own), W3 (the ESI interchange document, export only, staged at `prepare()` or not at all) and W4 (the Cockpit surface, deferred until W0-W3 are green) - each with its acceptance criterion, the falsification probe that would break it and the guard already in the tree that must still pass. Its section 2 records the seven open questions and the rung each was settled at, and says in as many words that the rungs were **not** executed; section 5 names what the plan refuses; section 6 holds the import half outside the exit condition until the isolation substrate exists. **Read before building anything the design's phase list allows**, because it is the checklist those phases have to satisfy and it is written at a file and an anchor rather than as a phase list. |
| [`docs/LAYOUT.md`](./docs/LAYOUT.md) | The tree, directory by directory, and what each one is for, including the layering rules that are enforced by hand and nothing else does. Moved verbatim out of `AGENTS.md` so the always-on file stays a budget rather than a library. **Read before adding a directory**, or before deciding which layer a new file belongs to. |
| [`docs/BUILD-AND-TEST-COMMANDS.md`](./docs/BUILD-AND-TEST-COMMANDS.md) | Every gate, smoke check and demo command, each quoted from the output it was measured against, beside the platform traps that make a command fail before it runs. **Read before running a gate or claiming one passed.** |
| [`docs/RULES-PAID-FOR.md`](./docs/RULES-PAID-FOR.md) | The register of every rule that cost a real defect, each with the observation that produced it. It is the largest document in the tree. **Read the entries that bear on what you are touching; do not read it whole**, and write a new rule there rather than in `AGENTS.md`. |
| [`extension/vscode/README.md`](./extension/vscode/README.md) | The Cockpit's front door. `src/host/activate.ts` points here, so it has to exist and say what the extension is not (VS Code is not Veridian), how to install it for development, and - explicitly - what only a real VS Code test host could exercise and what no check in this tree can reach at all. |
| [`docs/phases/`](./docs/phases/README.md) | The phase program: thirteen phase files, one each, written so that one phase plus the tree it touches fits in one context window. The index carries the closed list of eight status words and the source document each phase argues from. **Read the index and then exactly one phase file** - reading the directory is the cost the split exists to remove. |

Add a one-line index entry here for each new doc instead of duplicating its content in this file - **and one for each new directory that holds documents**, naming the directory itself, so that a whole tree cannot arrive unindexed the way `docs/phases/` did. `tests/docs-roster.test.ts` asks both questions.

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
| [`.github/prompts/new-module.prompt.md`](./.github/prompts/new-module.prompt.md) | `/` �?**Add a Module**. |
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

- **A document that credits a guard with coverage is a claim about that guard's *selection*, and the
  selection is where the claim fails.** `docs/phases/README.md` closed by naming
  `tests/docs-roster.test.ts` as what keeps the phase index current, and that guard cannot see the
  directory at all: its selection reads the **top level** of `docs/` - one `readDirSync` on one
  directory - and its row parser's character class contains no `/`, so it is flat-only in **both**
  halves, able neither to list a nested file nor to parse a nested row. The guard is not the defect.
  Its subject is `docs/`, it was written for a flat directory, and it does exactly what it says; the
  sentence beside it was the thing that was true of nothing. The replacement is a guard of its own
  (`tests/phases-roster.test.ts`) filed where the reader was looking, and the reason it is a file and
  not a row is that a nested document's questions are not the flat one's: this one asks whether every
  phase file on disk has a row, whether every row names a file, whether every row's status is the word
  its own phase file states, whether every status is a word the document itself **declares** (parsed
  from the document rather than restated in the test), and whether the byte total it prints is the
  arithmetic of the files it names - five questions of the table, and a sixth asked of the phase files
  themselves rather than of the table: that each carries a `## Context budget` heading with **both** a
  `**Read:**` and a `**Do not read:**` line. The sixth is a question of *shape* rather than of
  agreement, because a budget has nothing to agree with, and it is asked because a file naming only
  what to read is a file whose reader fills the window with the first list and never reaches the
  second - which is the failure the directory was built to prevent, and therefore the one thing in it
  worth checking rather than trusting. *"Nothing guards this" and "the guard you named guards something
  else" look identical from a sentence and are different facts - so read a guard's selection before the
  document that cites it, and make a nested document's guard read the nested document.*

- **A scope-collapse probe must break the scope's identifying marker, not a cell beside it.** The guard
  over the phase index asks its questions of the twelve-row table, and its control asserts the scope did
  not collapse to nothing while a second asserts the walk began at the table. The probe written to
  falsify that control edited **cell 4** of the header row - and it would have reported `MISSED` against
  a **working** guard, because the guard recognises its table from **cells 0 and 1** alone, so a header
  whose later cells are nonsense is still the same scope. Deleting the header row outright is what
  collapses it, and under that probe the control fires. The same lesson is written at the walk itself:
  the phase files are selected by `/^\d{2}-[\w.-]+\.md$/` rather than by a hand-kept list, and the
  declared vocabulary is parsed out of the document rather than restated in the test, so the guard has
  nothing to fall behind. *This is the same shape as the CRLF anchor that never matched, the
  column-zero `not ok` scrape, the probe that restored the file before running the suite, and the
  substring needle: **a probe aimed at the wrong part of the thing it tests reports the reverse of what
  happened**, and the only way to know is to check that the probe changed the state its assertion
  reads. A probe that edits a neighbouring cell is a probe that measures the guard's tolerance rather
  than its scope.*

- **A probe aimed at an assertion's *needle* weakens the assertion instead of violating it, and it
  reports a guard with a hole where there is none.** Closing the phase program produced this three times
  in one pass, which is why it is a rule rather than an instance. `tests/memory-port.test.ts` holds *"a
  refused write reports `precondition blocked` and does **not** contain 'unreachable'"*, and the obvious
  probe edits that assertion - `doesNotMatch(warning.message, /unreachable/)` becomes `/refused/`. The
  suite stays at `6 pass / 0 fail`, which reads as a guard that cannot fail. It cannot: the second needle
  is a **weaker** question, so the assertion passes more easily, and what the probe changed is the
  *question* rather than the *answer*. The probe that works edits the port - `describeFailure`'s `status`
  string, `#degrade`'s `error` field - because those are the values the assertions observe. The same
  mistake was made twice more in the same pass: phase 05's AC-9 import probe was first written as *swap
  one import for another*, which is a module-level crash reported as `not ok 1 - src\twin.test.ts` rather
  than as a named assertion - it **looked** like a firing probe while the guard never ran - and phase 05's
  schema probe was written against a two-line `required` block that is in fact one line, so `Replace`
  returned its input and the probe changed nothing at all. *A probe is a measurement of the code; a probe
  that edits the expectation measures the expectation, and a probe whose change marker is never printed
  is indistinguishable from one that works.*

- **A restore has to be verified by a status check, because a failed restore presents as a passing
  probe.** The same pass hit this directly: `Set-Content` on `core/memory/memory.ts` failed with
  `the process cannot access the file ... because it is being used by another process` - a transient
  Windows lock on a file a Node process had just read - and **the restore silently did not happen**. The
  next command in the same batch then reported `3 fail`, which is the *probe's* state read as though it
  were the restoration check. `git status --porcelain <path>` is what caught it, and
  `git checkout -- <path>` is the reliable restore for a file that is unmodified in `HEAD`, because it
  does not depend on a handle being free. *Restore with the tool that cannot half-succeed, and assert the
  restore with a status reading rather than with the suite going green* - because a suite that is green
  after a restore and a suite that was green all along are the same output.
