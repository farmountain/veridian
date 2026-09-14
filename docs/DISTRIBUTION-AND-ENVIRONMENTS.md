# Veridian - Shipping It, and Growing the Worlds It Can Judge

This document answers a request that arrived after the MVP shipped: *implement npm, VS Code
extension and Docker install routes, and implement every sandbox environment we planned.*

It exists because the honest answer is not "yes, all of it now". It is a plan with a measured
starting point, a phased order, an acceptance test per phase, and a named blocker wherever a phase
cannot be proven on the machine it must be proven on.

Read it as the successor to `docs/IMPLEMENTATION-PLAN.md` - that document covers what was built for
the MVP, this one covers what comes after it.

---

## 1. The request, decomposed

| # | Asked for | Status before this work | Source of the plan |
|---|-----------|-------------------------|--------------------|
| 1 | npm install route | Declined at ship time | this doc, Phase A1 |
| 2 | Docker install route | Never attempted | this doc, Phase A2 |
| 3 | VS Code extension | Specified, not built | `PLAN.md` §30, this doc, Phase B |
| 4 | Database environment | Roadmap "Later" | `PLAN.md` §38, this doc, Phase C |
| 5 | Linux / Kali / Windows / macOS | Roadmap Tier 2-3 | blocked, §5 |
| 6 | Kubernetes, cloud, data platform | Roadmap Tier 4-5 | blocked, §5 |

Nothing in this list is forbidden. `PLAN.md` §3 forbids Veridian becoming a *Kubernetes management
platform*, a *cloud deployment platform*, a *CI/CD platform*; it explicitly permits integrating with
all of them. An adapter that deploys the application under test into an existing cluster and judges
it is integration. A control plane that manages clusters is competition. Every phase below is on the
integration side of that line, and that is the test each one has to pass.

`PLAN.md` §55 additionally gates Kubernetes, VM orchestration, cloud and distributed execution out of
the *four-week MVP*. The MVP is now complete (`v0.1.0`), so that gate has expired on its own terms -
but it expired into "next", not into "now", because of the finding in §2.

---

## 2. The finding that decides the order

The request also said *implement with validation/testing*. So before planning any adapter, this
machine was probed for the isolation mechanism each adapter would need:

```
docker                   NOT INSTALLED
kubectl                  NOT INSTALLED
vagrant / qemu           NOT INSTALLED
sqlite3 / psql           NOT on PATH      (the CLI - see below)
wsl                      present (podman-machine-default)
node / git / code        present
```

**The interpretation that used to stand here was wrong, and it was wrong about this project's own
subject.** It read the probe as a list of blockers: no `qemu`, therefore no Linux world; no cluster,
therefore no Kubernetes world; no credentials, therefore no cloud world. That asks *"is the real
infrastructure installed?"* - and Veridian does not ship infrastructure. **Veridian ships worlds.**
Building the world the software runs in *is the product*, and a world may be simulated. The
infrastructure probe was evidence for the ordering, not the question the ordering turns on.

The question that orders this plan is stated in §5:

> **Can a world be built here whose application really executes, whose observations are really
taken, and whose substitutions are all declared?**

What survives from the probe is narrower and still decisive: it lists which *execution substrates*
are present. `node` is present, so anything that runs as a Node process runs for real here. `sqlite3`
is absent as a command-line tool, but `node:sqlite` ships inside Node 22 and was verified at runtime,
so a database world needs no install at all - the row above names the CLI and was read as if it named
the module. Absent are the substrates that would make a *non-simulated* VM or cluster world real, and
§5 names what that does and does not block.

So the rule that orders this plan is: **a phase is built when it can be proven, not when it can be
written.** The rule forbids a stub - a file implementing `EnvironmentAdapter` that asserts nothing
and passes no test - and it does *not* forbid a simulated world, because a simulated world is not a
stub: it runs the application's real code and reads the real result. §5 states the three conditions
that keep those two apart.

---

## 3. The self-prompting protocol, applied to this program

The ambiguity protocol from `core/clarification/` applies to planning as much as to a contract, so
the questions that gated this plan are recorded with their resolution and the rung they resolved on.

| Question | Rung | Resolution |
|----------|------|------------|
| Does "implement everything" mean breadth of stubs or depth of working adapters? | **deferred to a rule, not a guess** | Depth. The repository's own standard is that an unverifiable artifact is a false claim. A stub adapter is unverifiable by construction. |
| Is Kubernetes in scope at all? | **derived** | In scope as an adapter, out of scope as a management platform - `PLAN.md` §3 draws the line and it is not ambiguous. |
| Can npm packaging be done without reversing a recorded decision? | **derived** | No. `IMPLEMENTATION-PLAN.md` §8 records the registry path as *declined*. The request reverses it, so the document must be corrected in the same pass (`AGENTS.md` requires it). |
| Does adding a build step contradict "there is no build step"? | **answered, narrowly** | It changes the sentence rather than breaking it. Development still runs `.ts` directly; only the *distributed* artifact is compiled. Both facts are now stated, in the places that state them. |
| Is a VS Code extension a "sandbox environment"? | **inferred** | No - it is a UI. `PLAN.md` §30 and §47 put it in the UI column, and "VS Code != Veridian". Treated as Phase B, a client, not an adapter. A *separate* idea - an adapter for validating VS Code extensions - is recorded in §5 as a real, unblocked future adapter rather than silently merged into this one. |
| How many rounds may Phase A take before stopping? | **defaulted** | Two fix rounds per gate failure, then record and stop. Same bounded-exit rule the run loop uses. |

No question required the user, because each one resolved on a rung below `answered`: either a rule
already written down settled it, or the class of question was answered once by a decision that
outlives it. That is the ladder working as designed - `ASK` is for gaps no rule reaches.

---

## 4. Phases

### Phase A1 - npm install route (built here)

The design is not new; `AGENTS.md` `## Distribution` already specified it while declining it, which
makes this the lowest-uncertainty phase in the list.

- Compile `cli/`, `core/`, `adapters/`, `validators/` to `dist/` with `tsc -p tsconfig.build.json`,
  `rewriteRelativeImportExtensions` turning the `.ts` import specifiers into `.js`.
- Copy the non-code assets (`schemas/`) into `dist/`, because `SCHEMA_URIS` are package-relative.
- Resolve those assets from the *module's* location, not the process's, so `veridian` works from any
  working directory. This was the second, independent reason the registry path was declined: today
  `loadSchemaSet(nodeIo())` roots at `process.cwd()`, so an installed CLI looks for its own schemas
  in the caller's directory.
- `files` allowlist, `bin`, `publishConfig`, and `prepublishOnly` as the gate that keeps a package
  which cannot work from being published by accident - replacing the blunter `private: true` guard.

**Acceptance:** `npm run build` succeeds; the built CLI answers `help` with exit 0 **from a working
directory that is not the package**; the schemas load under `dist/`; `npm pack` produces a tarball
that installs into a clean directory and runs. Verified in CI, because the failure mode this phase
exists to prevent is a `dist/*.js` that no test touches.

**Exit:** two fix rounds, then record.

### Phase A2 - Docker install route (built here)

A `Dockerfile` plus a CI job that builds the image and runs the CLI inside it. Docker is unavailable
on the development machine and available on `ubuntu-latest`, so the verification happens where the
runtime exists. A Dockerfile added without that job would be exactly the claim-without-a-check this
document is arguing against.

**Acceptance:** `docker build` succeeds in CI and `docker run --rm <image> help` exits 0.

**Exit:** if the image cannot be built in CI within two rounds, the Dockerfile is reverted rather than
shipped unrun.

### Phase B - the VS Code Cockpit

`PLAN.md` §30: sidebar, goal and acceptance editors, environment status, run and reset, history, a
PASS/FAIL dashboard, an evidence viewer. It stays thin - `VS Code != Veridian` - and drives Core
through the same interface the CLI does.

Ordering note: this is deliberately *after* A, not because A is more valuable but because B needs a
stable way to locate and start Core, and A1 is what makes Core locatable from outside its own
directory tree.

**Acceptance:** the extension compiles; a Core-facing session test runs headless; the activation path
is exercised under a VS Code test host, and whatever cannot be exercised that way is named in the
document rather than described as working.

### Phase C - the second adapter: `local-db`

This is the phase that tests the architecture rather than adding a feature.

`PLAN.md` §35 claims new environments can be added *without modifying the core*. That claim currently
rests on a sample size of one adapter, which is not evidence. A SQLite adapter - `node:sqlite` ships
inside Node 22, so it needs no server, no install and no container - makes it falsifiable offline:

- `core/` must not change beyond registering the adapter name.
- A new validator family (`db.schema`, `db.rowCount`, `db.value`) must be addable without touching
  `core/validation`.
- M1, M4 and M5 must hold for a database world exactly as they hold for a web one.

If that forces changes in `core/`, the claim in §35 is wrong and §35 gets corrected. Either outcome
is a result; only silence is not.

**Acceptance:** a contract against a seeded SQLite database passes and fails for the right reasons;
`core/` diff is limited to registration; the M-metrics report the same shape as the web run.

### Phase D - the rest of Tier 1

`local-api` and `local-process` (`PLAN.md` §36 Tier 1). Both need only a child process and an HTTP
client, so both are verifiable here. Each is a repeat of Phase C's procedure, which is the point:
after the second one, the third is mechanical, and *that* is what confirms the architecture.

---

## 5. Simulated worlds, and what "blocked" actually means

The table that stood here is replaced, because it answered the wrong question. It asked whether the
*real* infrastructure was installed - `qemu`, `kubectl`, an Android SDK, cloud credentials, a macOS
guest licence - and recorded each absence as a blocker. That treats a **simulation** as a workaround
for a missing runtime. In a sandbox validation layer it is the opposite: the world is the product, and
simulating it is the mechanism.

### What may be simulated, and what may never be

| Simulated | Never simulated |
|-----------|-----------------|
| the cluster control plane | the application's execution |
| the cloud service endpoints | the observation of the application |
| the OS surface (registry, plists, path and ACL semantics) | the evidence recorded from that observation |
| the device, its sensors and its input | the criterion's authority to pass or fail |
| the message broker and the data platform | the reset, and the fact that it happened |
| the container runtime and image semantics | - |

"Simulated" is a statement about the *infrastructure*, never about the *application*. Substituting the
application's behaviour is not a simulation; it is a false `PASS` with a longer name.

### The three conditions a simulated world must satisfy

1. **The application executes for real.** Its own code runs - a real child process, a real
   interpreter, a real query - rather than a description of what it would have done.
2. **The interfaces are real.** A simulated control plane is really an HTTP server the application
   really connects to and really speaks to; a simulated broker really accepts the wire protocol. The
   application cannot tell the difference, which is the point - and is also why nothing may be faked
   at the observation boundary, where that indifference stops being a feature.
3. **The substitution is declared.** The composition of the world is recorded in the run bundle, so a
   `PASS` is traceable to a *named substitute* rather than to unexamined reality. A reader can answer
   "what was real in this run, and what was standing in for something else?" without reading the
   adapter's source.

Condition 3 is what keeps the cardinal invariant intact. *A validator observes; it does not imagine.*
Without it, "simulated" is an unbranded label on a run that proved nothing - and a licence for the
exact failure mode (a false `PASS`) this product exists to make impossible.

### The worlds, and what is real in each

A status of *planned* is a claim about this repository, and §7 is where claims are kept honest with
run ids rather than adjectives.

| World | Application executes | Simulated | Status |
|-------|---------------------|-----------|--------|
| `local-web` | real child process + real browser | - | **built** (`v0.1.0`) |
| `local-db` | real SQLite via `node:sqlite`; the app's own schema and seed code runs | - | **built** |
| `local-api` / `local-process` | real child process, real HTTP | - | planned (Phase D) |
| `sim-k8s` | real app process against a real HTTP control plane | scheduler, kubelet, etcd, CNI, admission | planned |
| `sim-cloud` | real app process against real HTTP endpoints | the AWS / Azure / GCP services | planned |
| `sim-container` | real app process | the runtime, the image store, cgroup semantics | planned |
| `sim-posix` (linux, kali) | real process runner + real sandboxed filesystem | the kernel, the distro, the package manager; Kali's attack network | planned |
| `sim-os` (windows, macos) | real process runner | registry / plist, path and ACL semantics, the OS API surface | planned |
| `sim-data` | real app process against real protocol endpoints | the Kafka / Spark / Hadoop / Airflow runtimes | planned |
| `sim-mobile` | real app code against a real device API surface | the device, the emulator, the touch OS | planned |
| `vscode-host` | a real VS Code extension host process | - | planned (Phase B-adjacent) |

And the rows that are genuinely blocked, which are now a much shorter list and a different kind of
statement - each names the world it blocks, and the simulated row that answers it:

| Blocked | Why | Answered by |
|---------|-----|-------------|
| a real Linux / Windows / macOS / Kali guest | No VM substrate on this machine. Booting a guest nobody can boot is the unverifiable claim this document refuses. | `sim-posix`, `sim-os` |
| a real Kubernetes cluster | Same, plus no `kubectl`. | `sim-k8s` |
| a real container runtime as a *world* | No runtime here. Phase A2's Dockerfile is a *distribution* route and needs none; an adapter that starts and resets containers does. | `sim-container` |
| a real cloud account | Not a runtime question: an unattended run against a metered, credentialed account is a cost model rather than a test. | `sim-cloud` |

**This table used to be an inventory of what is not installed here, and that was the wrong question.**
It listed "no container runtime", "no `qemu`/`vagrant`/Hyper-V", "no macOS guest licence", "no
`kubectl`", "no cloud credentials", "no Android SDK" as blockers - as if the deliverable were a real
cluster and a real guest OS. It is not. Veridian builds worlds, and **a world may be simulated**:
simulating an environment is not pretending an environment exists. So the question is never *is the
real thing installed here*, it is *what can be simulated here, and what would a verdict from that
simulation be worth* - which is what the three conditions above answer, and why the list is now short,
and why each remaining row names the `sim-*` world that answers it. The prohibition that survives the
correction is the one that matters: **never let a simulated world be recorded as a real one, and never
report a verdict a simulation cannot justify.**

**A `sim-*` row is not a stub, and the difference is mechanical rather than rhetorical.** A stub
returns an empty observation, so every criterion over it resolves to `INCONCLUSIVE` and the run
proves nothing while looking complete. A `sim-*` adapter starts a real interface, runs the
application against it for real, and reads the result; its criteria pass and fail for reasons an
external agent can act on.

**The §3 line still holds inside a simulated world.** `sim-k8s` deploys the application *into* a
namespace and judges it; it does not manage clusters. `sim-cloud` provisions nothing; it answers the
application's API calls. The simulation boundary and the integration boundary are the same line.

---

## 6. What this plan deliberately does not do

- **No stub adapters.** A file implementing `EnvironmentAdapter` whose methods return empty
  observations is worse than no file: it makes the adapter list look complete while every criterion
  against it is `INCONCLUSIVE`. The `unsupported` value in `BoundaryEnforcement` exists so a world
  can report what it *cannot* hold - it is not a licence to report nothing at all.
- **No speculative abstraction while adding Phase C.** The adapter interface already admits a second
  implementation; if it does not, that is the finding, and the fix is a change to the interface with
  a second caller to justify it - not a framework.
- **No publishing.** This document makes the package publishable. Running `npm publish` is the
  maintainer's decision, not an agent's, and the name is theirs to claim.

---

## 7. What was built, and what was measured rather than assumed

Phase A1 and Phase A2 are both implemented and both verified. The Docker route was verified in CI
rather than locally, and the run id is cited below rather than the word "works".

| Step | Status | Evidence |
|------|--------|----------|
| `tsconfig.build.json` emits `dist/` | **done** | 62 files; first line of `dist/cli/veridian.js` is `#!/usr/bin/env node` |
| `.ts` import specifiers rewritten to `.js` | **done** | `dist/cli/veridian.js` holds `import { assetsRoot } from "../core/assets.js";` |
| `schemas/` carried into `dist/` | **done** | `copy-assets: schemas/ -> dist/schemas/`; all 6 present |
| Asset root resolved from the module | **done** | `core/assets.ts`; `tests/assets.test.ts` holds both halves |
| `package.json` packaging | **done** | `files: ["dist"]`, `bin.veridian`, `prepublishOnly`, `prepare` |
| Gate stays green | **done** | `427 tests / 85 suites / 0 fail`, exit 0 |
| Smoke test exists **and discriminates** | **done** | falsified by reverting the asset root in the built `.js`: `FAIL ... exits 2, not 3`, exit 1 |
| `npm pack` -> clean install -> run | **done** | 65 files, 124.5 kB; `npx veridian help` exit 0; a browserless validate exit 2 with schemas resolved from `node_modules` |
| `Dockerfile` + `image` CI job | **done, in CI** | This machine has no container runtime, so the verification is where the runtime is. Run 34845548864 on `41d16f8`: job `container image` succeeded - the image builds, the container runs the CLI, and a browserless validate inside it resolves the schemas the image carries. |
| `dist` CI job (`smoke:dist` + pack/install round trip) | **done, in CI** | Same run, job `distribution`: succeeded. `npm pack` -> install into a clean directory -> run, which is the only check that reads `files` and `bin` the way a consumer does. |

**The first CI run of a job is the only run that can find a defect a local check cannot.** These two
jobs existed for one commit before they executed, and during that window they were exactly the kind
of claim this document refuses - written and unverified. They now carry a real run id, a real commit
and a real conclusion, which is the difference between "the Dockerfile is correct" and "the
Dockerfile built".

**The falsification is the part worth keeping.** The smoke test asserts exit 2 rather than 0 because 0
would mean a browserless run passed, which it must never do, and rather than "not 3" because 3 is the
interesting failure: it is the define phase failing, which is exactly what a mis-rooted asset does.
Then the claim was checked by breaking it - the built `.js` was rewritten back to
`loadSchemaSet(nodeIo())` on purpose, and the check failed with
`schema "schemas/goal.schema.json" could not be read` and exit 3. A check that has only ever passed is
indistinguishable from a check that cannot fail.

That run also surfaced a real defect, which is the reason to keep doing this: the error message said
the contracts *"live in the repository"* - addressed to a user who has no repository. It now names the
directory it actually looked in. *An error message may only name a cause the reporter observed.*

### Phase C: the database world, and what the second adapter proved

`local-db` is implemented, and its demonstration is observed rather than argued: the canonical
database example runs the whole loop against a real SQLite file and reaches `PASS`.

| Step | Status | Evidence |
|------|--------|----------|
| A second `EnvironmentAdapter` exists | **done** | `adapters/local-db/`, registered in `cli/worlds.ts`; the interface admitted it with no change to `EnvironmentAdapter` itself |
| A second validator family exists | **done** | `validators/database/` - `db.query`, `db.value`, `db.count`, `db.table`, `db.column`, each declaring its own `targetNoun` |
| The world is a seam, not a browser | **done** | `examples/inventory-db/demo.ts` reaches exit 0 with no process, no socket, no page and no console |
| The loop can fail, be repaired and pass against a database | **done** | iteration 1 `FAIL AC-001/AC-002/AC-003` + `PASS AC-004`; iterations 2-4 each remove exactly one failure; `4/4 mandatory criteria passed, environment valid, no safety violation, evidence complete` |
| M1/M4/M5 hold for a non-web world | **done** | `core/metrics/history.ts` reads the bundle, not the adapter, so the same metrics run unchanged over a database bundle |
| The simulated engine is recorded | **done** | every reading carries `engine: "sqlite"`, and `environment.json` records the world that was actually used |
| The example is held by tests | **done** | `tests/inventory-db-demo.test.ts` (16) and `tests/local-db-environment.test.ts` (22) |

**Five real defects were found by building this, and every one of them was found by *running* or by
*measuring*, never by reasoning.** That is the whole argument for a second adapter, stated as a result
rather than as a hope.

1. **`db.rowCount` was unwritable in any contract.** `clarify` exited 3 with
   `$.criteria[2].expect[0].validator: "db.rowCount" does not match /^[a-z0-9]+(\.[a-z0-9]+)+$/`. The
   validator existed, was registered, was type-correct and was tested - and no valid `acceptance.yaml`
   could name it. Fixed by renaming to `db.count`. *A validator name is a document identifier, and
   only writing a document exercises the schema's pattern.* **Corollary: every new adapter family owes
   at least one written example contract, because the contract schema is a gate nothing in the type
   system reaches.**
2. **The ladder asked "which *element*" about a database.** `clarify` exited 2 with a deferred blocking
   gap: `Which element should db.count inspect for AC-003?` - a question with no correct answer. Fixed
   by making the noun a *declared* property of the validator (`targetNoun`), threaded through
   `Validator` -> `ValidatorDescriptor` -> `detect.ts`. *A question the ladder asks about an artifact
   must be answerable from the artifact; the core must not learn a family's private vocabulary, so the
   family declares the noun and the core asks the question.*
3. **`IoPort.resolve` doubled an absolute path.** The first real run aborted with
   `ENVIRONMENT_FAILURE` naming `.../app/D:/all_projects/Veridian/examples/inventory-db/app/data.db`.
   `resolve(appPath, absolutePath)` only checked `parts[0]` for absoluteness, so it joined two absolute
   paths. Fixed with `fromLastAbsolute`, which is what `node:path`'s own `resolve` does. **The fourth
   instance of "an absolute path must stay absolute" in this repository, and the first where the
   culprit was a join of two paths that were both already absolute.**
4. **`StatementSync.columns()` reports a computed column with `column: null`.** `AC-002` came back
   `INCONCLUSIVE`: *the criterion's query did not select a column `total_cents`; it selected none* -
   over a statement that plainly selected it, with `"columns": []` in the bundle's own artifact.
   Measured directly: `SUM(...) AS total_cents` arrives as `{column: null, name: "total_cents"}` while
   `all()` returns `[{"total_cents":12500}]`. `readStatement` read `column` alone and filtered the
   nulls out; fixed with `columnLabel`. *An API that reports its own shape may report it in a second
   field you have not looked at* - and the resulting message blamed a contract that was correct.
5. **`memoryIo.resolve` returned a path its own accessors could not find.** Found by the new adapter
   test, not by the demo: `resolve("/virtual/app", "data.db")` produced `virtual/app/data.db`, and
   `exists()` on that string looked for `virtual/virtual/app/data.db`. The real port never had the
   asymmetry, because `nodeIo` returns an absolute path and `at()` accepts one. *A test double that
   resolves paths differently from the port it stands in for makes the suite lie in one direction or
   the other* - and this one made it lie by failing a world that was fine.

**What the second adapter settled about the `PASS` rule.** `AGENTS.md`'s "Rules this build has paid
for" carries the finding that a vocabulary re-listed by a schema falls behind its engine. The register
that finding owed - replacing the hand-maintained `STEP_KINDS`/`ARTIFACT_KINDS` lists with a register
the engines contribute to - was conditional on *a second non-web adapter existing*. It now does, so
the register is owed rather than speculative, and the `db` family's vocabulary (`sql` steps, `json`
evidence) is the second entry it would carry.

**The honest limits, stated rather than implied.** The build command runs as an ordinary child process
with the operator's own privileges, so both boundary policies report `unsupported` - the `ATTACH`
refusal is a real refusal of a real escape, and it is not a filesystem sandbox, and the two facts are
reported separately because collapsing them into one number is the overclaim this path exists to
prevent. And a file-backed world simulates the *engine* (`node:sqlite`) while the database file itself
is real, which is why every reading records which engine produced it.
