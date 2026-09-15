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
| 3 | VS Code extension | **Built** (Phase B) | `PLAN.md` §30, this doc, Phase B |
| 4 | Database environment | Roadmap "Later" | `PLAN.md` §38, this doc, Phase C |
| 5 | Linux / Kali / Windows / macOS | Roadmap Tier 2-3 | Linux/Kali built as a **simulated** world, `sim-posix` (Phase C3); Windows **and macOS** built as `sim-os` (Phase C4), one world with two declared families, §7 |
| 6 | Kubernetes, cloud, data platform | Roadmap Tier 4-5 | Kubernetes built as a **simulated** world, `sim-k8s`; cloud built as `sim-cloud` (Phase C5); the container runtime built as `sim-container` (Phase C6); data planned (§5) |

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

### Phase B - the VS Code Cockpit (built here)

`PLAN.md` §30: sidebar, goal and acceptance editors, environment status, run and reset, history, a
PASS/FAIL dashboard, an evidence viewer. It stays thin - `VS Code != Veridian` - and drives Core
through the same interface the CLI does.

Ordering note: this is deliberately *after* A, not because A is more valuable but because B needs a
stable way to locate and start Core, and A1 is what makes Core locatable from outside its own
directory tree.

**Built:** `extension/vscode/` - six commands, four settings, a status-bar dashboard, and a hand-written
`src/port.ts` that declares the slice of the editor API the Cockpit uses so that every *decision* is
testable without an editor. The extension has no runtime dependency; `@types/vscode` is types only.

**The one clause of the acceptance test that is not met, and why it is written here rather than
quietly dropped:** *"the activation path is exercised under a VS Code test host"* - **it is not.** There
is no VS Code test host in this repository, and building one is a separate phase rather than a step.
What exists instead is the nearest thing that can be run here, and the two are not equivalent:

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npx tsc --noEmit` | silent (exit 0) |
| Decisions, headless | `node --test` | 60 tests, 0 failing |
| Build | `npm run build` | `out/` - 6 files |
| **Compiled artifact** | `npm run smoke:out` | 15 checks, exit 0 |
| All of the above | `npm run gate` | exit 0 |

The third row is the reason this phase could be built at all: the extension host is not Node's
loader, so this one directory *must* be compiled, and the decisions had to be moved out of the host
files for anything to be testable. `src/host-boundary.test.ts` holds that boundary as an executable
rule - only `src/host/vscode-port.ts` and `src/host/activate.ts` may import `vscode`, and no test may
import them - and it was falsified rather than trusted: prepending an import of the host binding to
another test file fails it, naming the cause and the remedy.

The fourth row is the same move `npm run smoke:dist` makes for the npm package. `node --test` runs
`.ts` and the extension host runs `out/*.js`, so the six files that actually ship were covered by
nothing. `scripts/smoke-out.mjs` resolves the manifest's `main`, aliases `vscode` to a recording
double (`scripts/vscode-stub.mjs`), loads the compiled entry point, calls `activate`, and asserts the
registered commands equal the six the manifest declares. It was falsified too: pointing `main` at a
path the build does not produce makes it fail with that sentence and exit 1.

**Named as unexercised** - the list a VS Code test host would have to cover, stated here so that
nothing above is read as claiming it was observed:

- `src/host/vscode-port.ts` and `src/host/activate.ts` against the real API rather than the double;
- the command palette, keybindings and menus, which are the editor's contribution;
- the status bar's real rendering, its prioritisation against other items, and its tooltip;
- workspace trust, multi-root workspaces, and a workspace whose folder is a UNC path;
- `openTextDocument` on a file deleted between the read and the reveal.

A green `smoke:out` is a **necessary** condition for this extension to work and not a sufficient one,
and `scripts/vscode-stub.mjs` is a recording double rather than a simulation of VS Code - the same
distinction §5 draws about worlds, applied one layer up to a tool.

**Also not built, and not claimed:** no `.vsix`. Packaging needs `@vscode/vsce`, which is not a
dependency of this repository and whose output has never been produced on this machine, so the
install route that ships is the development install (F5 against a checkout) and it is documented as
such in `extension/vscode/README.md`. Adding a package script nobody has run would be the same
unverified claim this document refuses for a Dockerfile.

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

### Phase C2 - the third adapter: `sim-k8s`, the first *simulated* world

Phase C proved the seam admits a second world. It did not test the case this document's §5 was
rewritten for: a world whose **substitution is the point** rather than a convenience. A cluster world
is that case, and it is the first one where the difference between "local" and "simulated" has to be
recorded rather than assumed.

The application (a small build-and-deploy program) really runs, really builds an image directory,
really reads manifests, and really submits them over HTTP to a control plane it really connects to.
There is no cluster software, no scheduler, no kubelet, no etcd and no container runtime anywhere in
the loop: the adapter serves the API surface itself, holds the objects in memory, and derives pods,
replica sets, events and readiness from what was submitted. The other half of that sentence is the
point - the substitution is declared in the plan and in `environment.json`, so a `PASS` is traceable
to a named substitute rather than to unexamined reality.

- `core/` gains an *observation vocabulary* (`core/environment/k8s-observation.ts`) and nothing else
  that a validator could have reached through an adapter.
- A third validator family (`k8s.applied`, `k8s.deployment`, `k8s.image`, `k8s.ready`, `k8s.pod`,
  `k8s.service`, `k8s.event`) is addable without touching `core/validation` or `core/execution`.
- The same `EnvironmentPlan` carries a `cluster` next to its `browser` and its `databasePath`, so a
  bundle can say which world produced a verdict in all three cases.
- A refusal by the substitute is judged as a result: `k8s.applied` reads `rejected` for an object the
  API server would not accept, which is a *pass* when the contract expects a rejection.

**Acceptance:** the demo runs the whole loop - `FAIL` on the first iteration, an external repair agent
rewrites the manifests, `PASS` on the last - with no cluster anywhere on the machine, and
`environment.json` names what was simulated.

### Phase C3 - the fourth adapter: `sim-posix`, the operating-system world

Phases C and C2 proved the seam admits a second and a third world. This one attacks the axis neither
of them touched: a world whose subject is the *operating system itself* - accounts, file modes,
ownership, service state, a listening socket and the refusal of a path that escapes the sandbox.

There is no virtual machine, no image, no `qemu` and no guest kernel anywhere in the loop. A real
Node process provisions a real tree under the application's own directory, issuing the commands a
real provisioning script issues (`apt-get`, `adduser`, `install`, `chmod`, `systemctl`, `nmap`) as
JSON vectors on its own stdout; the substitute executes them and holds the resulting system - users,
groups, packages, files with modes and owners, units and their state, sockets - in a small state
file. Permissions are decided **as a named account** the environment declares, which is what makes a
hardening contract judgeable: a world whose criteria act as `root` cannot produce a hardening verdict
at all.

- `core/` gains `core/environment/posix-observation.ts` and one more plan field (`PosixPlan`), and
  nothing else a validator could have reached through an adapter.
- A fourth validator family - `posix.ran`, `posix.package`, `posix.installed`, `posix.user`,
  `posix.file`, `posix.contents`, `posix.permission`, `posix.owner`, `posix.service`, `posix.running`,
  `posix.port`, `posix.probe` - is addable without touching `core/validation` or `core/execution`.
- A criterion can **act** in this world through a `run` step: two of the demo's criteria execute a
  command as the acting account and judge what the world did. That is the step kind `sim-k8s` needed,
  and the register that owns step kinds is where it is declared once.
- The sandbox refuses an escaping path, and the difference between a crossing by the *application* and
  a crossing by a *criterion* is a boundary fact rather than a verdict: the first makes the `PASS`
  rule's third clause false, the second is a reading.

**Acceptance:** the demo runs the whole loop against a tree with four deliberate defects, an external
repair agent rewrites the provisioning program one defect per iteration, and `environment.json` names
which system was stood in for.

### Phase C4 - the fifth adapter: `sim-os`, the machine world

Phase C3 proved a world can be an operating system. This one proves the family seam admits a *second*
operating system whose questions are not the same questions, which is a stronger claim than another
POSIX-shaped world would have been.

A Windows file does not have a mode; it has an ACL. So the POSIX family's single `permission`
question becomes three, and the split is the point rather than a detail:

- `os.owner` - the owning account. A fact about who holds the object.
- `os.acl` - the entries written on it, each explicit or inherited. A fact about what was granted.
- `os.access` - what one named account may **actually do**, which is the answer to the ordering rules
  (explicit beats inherited, deny beats allow, groups consulted, `Everyone` last) and not a sum of the
  entries.

Three validators because they are three facts with three different repairs - a `chown`, an `icacls
/remove`, and an inheritance defect nobody's entry explains. One validator judging all three would
report a single defect where there are three, and on Windows would report a `chown` for a system that
expresses the same intent as an ACL.

`os.access` judges the world's recorded decision and the entry that fired, never a re-derivation of
them: the ordering rules are exactly the part of a real system that is easy to model *almost*
correctly, and a model that is almost correct produces a confident wrong answer.

- `core/` gains `core/environment/os-observation.ts` and one more plan field (`OsPlan`), and again
  nothing a validator could have reached through an adapter.
- A fifth validator family - `os.ran`, `os.account`, `os.setting`, `os.file`, `os.contents`,
  `os.owner`, `os.access`, `os.acl`, `os.service`, `os.running`, `os.principal`, `os.probe` - needs no
  change to `core/validation` or `core/execution`. That is the third demonstration and the reason the
  rule is now stated as a rule.
- The run is judged **as `svc-audit`**, an account the loader refuses to let be `SYSTEM`: an
  administrator reads every file, so a hardening contract judged as one is vacuous.
- The application declares the `windows` family and **refuses any other by name** rather than adapting,
  and one criterion expects the world to refuse a command naming a path outside the sandbox.

**Acceptance:** four deliberate defects, seventeen criteria, the same `FAIL` -> repair -> `PASS`
descent, and a bundle that names the substitute. Measured in §7.

### Phase C5 - the sixth adapter: `sim-cloud`, the provider-account world

Phase C4 proved the family seam admits a second operating system. This one attacks a different axis:
its subject is not a container for files at all but a **remote account**. A provider account is the
question furthest from "is there a directory", so if the adapter seam holds here it holds anywhere.

The world is a real HTTP server on loopback that speaks a provider's own routes and holds buckets,
objects, queues, secrets and principals. Every permission question is decided by the account's own
evaluator - deny beats allow, an explicit deny beats everything - and each decision is recorded
*alongside the statement that fired*, so `cloud.policy` judges what was granted and `cloud.access`
judges what one named account may actually do, from the world's own record rather than from a
re-derivation of the ordering rules. That split is the same one `sim-os` makes between `acl` and
`access`, arrived at independently: three facts with three different repairs.

- `core/` gains `core/environment/cloud-observation.ts` and one more plan field (`CloudPlan`) - and
  that file carries more than a vocabulary, because the sixth world is the first whose *actions*, not
  just its readings, need a shared grammar: the action vocabulary, the reference grammar
  (`bucket/...`, `object/<bucket>/<key>`, `queue/...`, `secret/...`, `principal/...`, and
  `principal:action:resource` for an access question) and the refusal vocabulary all live there, so the
  substitute and the validators agree by construction.
- A sixth validator family - `cloud.bucket`, `cloud.object`, `cloud.tag`, `cloud.policy`,
  `cloud.access`, `cloud.queue`, `cloud.secret`, `cloud.call`, `cloud.setting`, `cloud.probe`,
  `cloud.meter` - needs no change to `core/validation` or `core/execution`. That is the fourth
  demonstration, and the family prints what an *operator* reads rather than raw JSON: a bucket, an
  object, a policy and a decision each render to a spelling a failure report can quote.
- The run is judged **as `svc-cart`**, and the loader refuses `root`, `account-root`, `owner`,
  `administrator` and `admin` by name - every policy in an account yields to an account root, so a
  hardening contract judged as one would report a pass for permissions no ordinary workload gets.
  `svc-reader` is a second identity and a different question: an account the *program itself* creates,
  which criteria ask about without the run having to run as it.
- **This is the only world that performs a `call` step**, the sixth step kind and the only one that
  puts the criterion's own request to the world rather than reading a request the application made. The
  other four adapters refuse it by name, and the cloud plan - and only the cloud plan - admits it, so a
  contract whose meaning depends on asking the world directly cannot drift onto a world where that
  question has no answer.

**Acceptance:** four deliberate defects, twenty-seven criteria, the same `FAIL` -> repair -> `PASS`
descent, and a bundle whose reading names each surface standing in for something. Measured in §7.

### Phase C6 - the seventh adapter: `sim-container`, the runtime world

Phase C5 proved the subject can be an account. This one attacks the axis the two simulated operating
systems left standing: a **container runtime**, which is where the application's own filesystem view
is *produced* rather than merely held. A mount is what decides whether the container has a filesystem
at all, so a defect in a mount is not a wrong path - it is a container that never runs.

The world is a store of image records and container records beside a register of runtime commands
answered in process. The application really provisions: it prints one command vector per line on its
own stdout and the substitute really executes them, exactly as `sim-posix` and `sim-os` are driven.

- `core/` gains `core/environment/container-observation.ts` and one more plan field (`ContainerPlan`),
  and nothing else a validator could have reached through an adapter. That file carries the reference
  grammar (`image/...`, `container/...`), the renderings the validators compare, and the vocabulary for
  a command the world **refuses** - which is what lets a criterion judge a refusal rather than an exit
  code.
- A seventh validator family - `container.runtime`, `container.image`, `container.tag`,
  `container.digest`, `container.label`, `container.env`, `container.state`, `container.alive`,
  `container.exitcode`, `container.command`, `container.user`, `container.mount`, `container.port`,
  `container.limit`, `container.health`, `container.logs`, `container.stderr`, `container.call`,
  `container.probe` - needs no change to `core/validation` or `core/execution`. That is the fifth
  demonstration, and the family prints what an *operator* reads rather than raw JSON.
- **This world adds no step kind.** It is acted on with `run`, so the provisioner's vectors are the
  interface and the register of step kinds does not grow for a seventh time. `container.call` and
  `container.probe` read the world's own record of a command; they are not another way to issue one.
- **The world states its own limits rather than hiding them**, and the renderings carry those limits
  into the value the criterion compares: a limit reads `(declared, not enforced)`, because it is a
  record of a request and not a cgroup; an account is recorded and never switched to; and a published
  port is `exposed` and never `reachable`. A substitute that is honest about its boundary has to be
  honest inside the compared value, not only in its documentation.

**Acceptance:** four deliberate defects, twenty-seven criteria, the same `FAIL` -> repair -> `PASS`
descent, and a bundle whose reading names the seven surfaces standing in for something. Measured in
§7.

### Phase D - the rest of Tier 1

`local-api` and `local-process` (`PLAN.md` §36 Tier 1). Both need only a child process and an HTTP
client, so both are verifiable here. Each is a repeat of Phase C's procedure, which is the point:
after the second one, the third is mechanical, and *that* is what confirms the architecture - and
`sim-k8s` has now supplied the third, with a simulated world rather than a third local one, which is
the stronger case.

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
| `sim-k8s` | real app process against a real HTTP control plane | `scheduler`, `kubelet`, `cri`, `etcd`, `cni`, `admission`, `ingress` | **built** |
| `sim-cloud` | real app process against real HTTP endpoints | `regions`, `object-store`, `queue`, `key-management`, `secret-rotation`, `identity`, `metering` | **built**, see §7 |
| `sim-container` | real app process provisioning images and containers over a real command surface | `namespaces`, `cgroups`, `image-layers`, `registry`, `published-ports`, `volumes`, `user-switching` | **built**, see §7 |
| `sim-posix` (linux, kali) | real process runner + real sandboxed filesystem | `kernel`, `distribution`, `package-manager`, `package-index`, `permissions`, `egress`, `provisioning` | **built** (Linux/Debian; Kali is the same world with a different declared distribution) |
| `sim-os` (windows, macos) | real process runner | `kernel`, `os-identity`, `path-semantics`, `acl`, `registry`, `preferences`, `service-manager`, `egress`, `provisioning` | **built** (Windows, judged as `svc-audit`; macOS is the same world with a different declared family) |
| `sim-data` | real app process against real protocol endpoints | the Kafka / Spark / Hadoop / Airflow runtimes | planned |
| `sim-mobile` | real app code against a real device API surface | the device, the emulator, the touch OS | planned |
| `vscode-host` | a real VS Code extension host process | - | planned (Phase B-adjacent) |

**The Simulated column prints the world's own declared surface names, and a test holds the
agreement.** Each cell is the members of that world's `<X>_SIMULATED_SURFACES` constant, spelled the
way the constant spells them, so the column is a roster rather than a summary of one -
`tests/simulated-surfaces.test.ts` reads this table and each constant and fails if either moves
alone. That guard is not decoration. This cell said `sim-posix` substitutes *"Kali's attack
network"*, and `POSIX_SIMULATED_SURFACES` says the opposite: its `egress` entry reads *"the sandbox
has no network beyond its own loopback listeners; egress is refused, not routed"*, and
`posix-port.ts` refuses the command that would need one - `this world has no egress; nothing outside
127.0.0.1 can be reached from the sandbox`. **A Kali world with no egress has no attack network.**
The cell named a surface the world refuses as though it were a feature, and omitted four that it
does declare (`package-index`, `permissions`, `egress`, `provisioning`). It was found by comparing
the two lists, not by reading the sentence - which read as complete, because three of its four
tokens were right. *A document that names a world's surfaces is a claim about a constant, and a list
of names in a document is read by nothing that could disagree with it.*

And the rows that are genuinely blocked, which are now a much shorter list and a different kind of
statement - each names the world it blocks, and the simulated row that answers it:

| Blocked | Why | Answered by |
|---------|-----|-------------|
| a real Linux / Windows / macOS / Kali guest | No VM substrate on this machine. Booting a guest nobody can boot is the unverifiable claim this document refuses. | `sim-posix`, `sim-os` - both **built**, see §7 |
| a real Kubernetes cluster | Same, plus no `kubectl`. | `sim-k8s` - **built**, see §7 |
| a real container runtime as a *world* | No runtime here. Phase A2's Dockerfile is a *distribution* route and needs none; an adapter that starts and resets containers does. | `sim-container` - **built**, see §7 |
| a real cloud account | Not a runtime question: an unattended run against a metered, credentialed account is a cost model rather than a test. | `sim-cloud` - **built**, see §7 |

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
| Gate stays green | **done** | `1273 tests / 216 suites / 0 fail`, exit 0 |
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
| A second validator family exists | **done** | `validators/database/` - `db.table`, `db.column`, `db.count`, `db.value`, each declaring its own `targetNoun` |
| The world is a seam, not a browser | **done** | `examples/inventory-db/demo.ts` reaches exit 0 with no process, no socket, no page and no console |
| The loop can fail, be repaired and pass against a database | **done** | iteration 1 `FAIL AC-001/AC-002/AC-003` + `PASS AC-004`; iterations 2-4 each remove exactly one failure; `4/4 mandatory criteria passed, environment valid, no safety violation, evidence complete` |
| M1/M4/M5 hold for a non-web world | **done** | `core/metrics/history.ts` reads the bundle, not the adapter, so the same metrics run unchanged over a database bundle |
| The simulated engine is recorded | **done** | every reading carries `engine: "sqlite"`, and `environment.json` records the world that was actually used |
| The example is held by tests | **done** | `tests/inventory-db-demo.test.ts` (16) and `tests/local-db-environment.test.ts` (22) |

**Six real defects were found by building this, and every one of them was found by *running* or by
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

6. **Three documents named a validator that does not exist.** `db.query` appeared as a member of this
   family in `README.md`, **in this document's own table one section above**, and in `AGENTS.md`'s
   layout roster - while `DB_VALIDATORS` held four entries and no source file mentioned the name at
   all. Nothing failed, because a roster in prose is read by nothing that could disagree with it.
   Found by writing `validators/database/db-validators.test.ts` and pinning `registry.names()` to the
   four names the code actually exports - a measurement of the code, against which the prose was wrong
   three times. *A list of names in a document is a claim about the code, and the cheapest way to hold
   it is a test that reads the code.* It is the same shape as a count that does not match the run, and
   as an identifier written in both `package.json` and its lockfile.

**And the family had no unit coverage at all, which is the finding behind the finding.**
`validators/playwright/` carried a 26 kB suite; `validators/database/` carried none, so the four
validators that decide *every* database criterion's status were exercised only end to end, by one demo,
through one contract. `validators/database/db-validators.test.ts` is 68 tests over the family's own
documents: the roster, the malformed-observation path, every comparison, the status semantics, and the
M3 rule that nothing unobserved may be reported as a pass. It was falsified rather than trusted -
with the number branch in `compareCell` replaced by a single text comparison, four subtests fail, each
naming a different property. *A suite that has only ever passed is indistinguishable from a suite that
cannot fail.*

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

### Phase C2: the cluster world, and what the simulation proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute control plane | built | `adapters/sim-k8s/cluster-port.ts` serves the API surface itself - apply, read, events, readiness, an implicit scheduler - over a real HTTP listener the application connects to. `cluster-port.test.ts` is 42 tests over it. |
| Adapter lifecycle | built | `adapters/sim-k8s/index.ts` implements all ten `EnvironmentAdapter` methods; `reset` restarts the world by rebuilding the substitute's state, and the crossings it observed are **not** cleared (a reset restores the world, not the record). |
| Observation vocabulary | built | `core/environment/k8s-observation.ts`, so no validator imports an adapter. The third family needed **no core change** beyond this and the name registration. |
| Validator family | built | `validators/k8s/` - seven validators, 63 tests, falsified by replacing a comparison rather than trusted. Each declares its own `targetNoun`. |
| Schema and plan | built | `EnvironmentPlan.cluster` + `readCluster`, so a bundle's `environment.json` says which world produced the verdict. `schemas/environment.schema.json` gained the `cluster` object; `STEP_KINDS` gained `apply`. |
| Demo | built | `examples/sim-k8s/` - two deliberate defects, ten criteria, `npm run demo:k8s`. Measured, verbatim: iteration 1 `FAIL`s `AC-003`..`AC-005`, `AC-007`, `AC-008` and cannot judge `AC-006`; iteration 2 fails only `AC-007`, the one the first repair did not touch - and the two defects are repaired in *criterion* order (`AC-003` before `AC-007`), so the first iteration's remaining failure is the second defect, not a fragile one; iteration 3 is `PASS` on all ten with the reason `10/10 mandatory criteria passed, environment valid, no safety violation, evidence complete.` - **exit 0**, with no cluster software anywhere on this machine. |
| Refusal as a result | built | The contract's last two criteria expect the API server to *reject* a submission, and it does - in its own words, with the conflict recorded by the substitute rather than by the criterion. `AC-010` reads the refusal's result and states in its own description that it does not read the stated *reason*. |
| Regression tests | built | `tests/sim-k8s-demo.test.ts` (17 tests, over the defect table's discrimination claim and the line-ending rule) plus `tests/environment-gaps.test.ts` (8 tests, driven off the real descriptor table rather than a fixture). Both falsified: forcing `newlineOf` to a constant fails 4 subtests here and 0 in `inventory-db`, because this table's first defect block is multi-line and that one's are not. |

**What the third world settled.** `core/` changed by an observation vocabulary and a name - the same
claim Phase C made, now made against a world that is neither local nor web, which is the harder case.
The plan's own §35 claim survives a third sample.

**Five defects this world's build produced, which is the argument for building one.**

1. **A read that mutates what it reads.** The substitute recorded a pod's events inside the derivation
   of its snapshot, so the first read of a namespace wrote `count: 1` and the second wrote `count: 2`.
   M1 compares exactly these documents, so it would have called one cluster two different worlds. A
   real cluster records events when its controller acts, not when a client looks, and the substitute
   now does too.
2. **A `404` and a `405` collapsed into one answer.** Every unmatched route returned `405`, so a
   request for a resource the cluster does not hold came back as *"GET is not supported for
   /apis/apps/v1/.../configmaps"* - naming a cause the server had not observed, since `GET` was
   served and the *resource* was what was missing. HTTP has a word for each, and a criterion over the
   merged status could only be `INCONCLUSIVE` about a question whose answer was known.
3. **A capability report derived from a literal list instead of from the writes.** Both the `sim-k8s`
   and `local-db` adapters warned for every evidence kind a criterion requested - including the `json`
   artifact the same function had written two statements earlier - so the demo printed *"produces
   `json` artifacts and cannot produce `json`"*. A second list is free to drift from the writes; the
   set is now read off the artifacts actually written.
4. **A requirement naming a *place* read as a literal key.** The worlds register declares each
   adapter's requirements as dot-paths (`cluster.name`, `database.path`), and the clarification
   detector read each with `Object.hasOwn(environment, "cluster.name")` - so it was absent from every
   correct document, three *blocking* questions were raised for values sitting in the file, and the
   operator's answer would have been written to the literal key, making the gap reappear on the next
   run. Fixed by routing every requirement through `getPointer`/`joinPointer`.

5. **The same world could not be described by two layers.** "This world has no HTTP" was decided in two
   places - the detector's `hasNoHttp`, which knew only about a *database file*, and the environment
   loader's `readBrowser`, which inferred a browser from the presence of a `url`. `sim-k8s` has
   neither, so the detector asked it for a URL, handed it `expectStatus: 200`, the ladder derived
   `browser.enabled: true`, and the loader then refused the pair it had just been handed - `this
   definition cannot be run`, before the run reached the cluster. The predicate now lives once, on the
   shape of the world. This is also the defect that shows why a *simulated* world is the harder test:
   `local-db` differed from `local-web` in a way both layers could already see, while `sim-k8s` differs
   in a way neither had a word for - no page, no socket, no file. A property a world can have, that no
   predicate in the codebase names, is a world the codebase mis-describes the first time it meets one.
   *An environment predicate duplicated across two layers is a claim about agreement that nothing
   checks - and its divergence is `INCONCLUSIVE` on every criterion at best and a false promise at
   worst.*

### Phase C3: the POSIX world, and what the fourth adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute system | built | `adapters/sim-posix/posix-port.ts` holds the accounts, groups, packages, files with modes and owners, units and their state, and sockets; it executes the command vectors the provisioning program prints and answers a reading derived from that state. `posix-port.test.ts` is 20 tests over it. |
| Adapter lifecycle | built | `adapters/sim-posix/sim-posix-environment.ts` implements all ten `EnvironmentAdapter` methods. `reset` rebuilds the tree and re-provisions it, `stop` keeps the tree so the paths a bundle quotes stay readable, and a `snapshot-restore` reset it cannot perform is **refused by name** rather than silently downgraded to a restart. |
| Observation vocabulary | built | `core/environment/posix-observation.ts`, so no validator imports an adapter. The fourth family needed **no core change** beyond this and the name registration - the same claim Phases C and C2 made, now against a world whose subject is an operating system. |
| Validator family | built | `validators/posix/` - twelve validators, 89 tests, falsified by breaking a comparison rather than trusted. Each declares its own `targetNoun`, so the clarification ladder asks "which account" rather than "which element". |
| Acting criteria | built | The `run` step kind: a criterion executes a command as the account the world declared and judges the result. That is the step kind `sim-k8s` first needed; the register in `core/acceptance/` owns it once, so the schema and the engine cannot fall behind one another. |
| Schema and plan | built | `EnvironmentPlan.posix` + `readPosix`, so a bundle's `environment.json` says which system stood in. `readPosix` resolves the declared root against the **application's own directory**, and refuses `user: "root"` by name. |
| Demo | built | `examples/sim-posix/` - four deliberate defects, thirteen criteria, `npm run demo:posix`. Measured, verbatim: iteration 1 `FAIL`s `AC-003`, `AC-006`, `AC-008`, `AC-010`, `AC-011`, `AC-012` and cannot judge `AC-007`; iterations 2-4 each repair one defect in criterion order and lose exactly the criteria that defect controls, including the two pairs that move **together** - `AC-008` and `AC-012` from the one mode change, `AC-010` and `AC-011` from the unit never being started; iteration 5 is `PASS` on all thirteen with the reason `13/13 mandatory criteria passed, environment valid, no safety violation, evidence complete.` Each configuration was run twice from a tree the previous run had left behind, and the two progressions were identical iteration for iteration. |
| Refusal as a result | built | `AC-013` runs `cat ../../etc/passwd` as the acting account and expects the world to **refuse** it. The substitute answers with the containment reason naming that path, and the criterion judges the refusal rather than the exit code alone. |
| Regression tests | built | `tests/sim-posix-demo.test.ts` (15 tests, over the table's criterion order and discrimination claim, the one multi-line block and the line-ending rule, and the real file's round trip) plus `tests/sim-posix-environment.test.ts` (37 tests over the adapter's refusals and lifecycle). |

**What the fourth world settled.** `core/` changed by an observation vocabulary and a name - the same
claim, made now against a world with no process boundary it owns, no socket it serves and no page at
all, but a filesystem and a permission model. The plan's §35 claim survives a fourth sample.

**Three defects this world's build produced.**

1. **A flag's value read as an operand.** The substitute's `adduser` took "the words that do not start
   with `-`" as its operands, so `adduser --system --home /var/lib/cart-web cart` made an account
   named `/var/lib/cart-web` and treated the real name as a group to join - and it exited 0, so the
   world reported success for a command it had not performed. A criterion asking whether `cart` exists
   could then never pass, however many times the loop re-observed it. The demo's progression, which
   had been a clean descent through the other three defects, showed `AC-003` as the one criterion that
   did not move - which is exactly the signature this file's own rule describes: *a criterion that
   stays `FAIL` after its defect has been repaired is a defect in the criterion, the target spelling,
   the substitute, or the reading - not in the repair.* Found by reading the bundle's own transcript
   for that criterion, where an account name beginning with `/` was sitting in plain sight. Held now
   by two tests, each falsified by deleting one `index += 1`.

2. **A world a run inherits is not a world that run built.** `stop()` keeps the sandbox on purpose - a
   bundle quotes paths inside it - so the *next* run's first observation can read the previous run's
   files. `prepare()` made directories without clearing, so the first iteration of the second run read
   a `/etc/veridian/policy.conf` that run had never installed - its own application had written
   `policy.cfg`, which is the defect under test - and two criteria passed on someone else's artifact.
   The following iteration's `reset()` wiped it, so the symptom was a progression one iteration out of
   step rather than an error, and the run still ended in `PASS`. It is a **false `PASS`**, the class
   this product exists to make impossible, and it was found by running the demo twice in a row and
   comparing the two progressions rather than by reading the port. `prepare()` and `reset()` are now
   one implementation - *two implementations of one rule disagree the first time a world arrives that
   only one of them was written for* - and `posix-port.test.ts` holds it by writing a file into the
   tree by hand and requiring it to be gone after a fresh `prepare()`.

3. **A repair the world never observed.** The first measured run's second iteration was identical to
   its first: the repair agent had written a change the running world had not yet re-read, so the
   criterion it repaired was still reading the state from before the fix. On this world the repair is
   a file write against a tree the *next* iteration rebuilds, so the fix is the reset rather than a
   reload - but the rule generalises: *a repair the world never observed is not a repair, and a loop
   that reports progress from its own intentions is reporting the wrong run.*

**And one gap that was recorded and has since been closed.** The repair agent's own stdout was **not**
in the run bundle. Diagnosing defect 1 required reading the injected program, the exec record and the
reading to reconstruct what the agent had done, because the bundle held the criteria's evidence and not
the actor's transcript - *an evidence bundle that omits the actor's own transcript is a bundle a reader
cannot audit.* **Built.** `RepairOutcome.transcript` now carries the gate's own output on every answer,
and the loop writes it to `artifacts/repair-<iteration>.log` before it acts on that answer, registered
in the bundle ledger with `kind: "log"` and `criterion_id: null` and named from the same
`iteration.repair` log line as the decision it belongs to. The demo's repair agent writes to stderr;
that stderr is now in the bundle it produced. Held by `tests/command-repair-gate.test.ts` (11 tests)
and five tests in `tests/execution-loop.test.ts`, both falsified rather than trusted - see the rule in
[`AGENTS.md`](../AGENTS.md).

### Phase C4: the machine world, and what the fifth adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute machine | built | `adapters/sim-os/os-port.ts` holds the machine accounts, the file tree with modes and ACLs (each entry explicit or inherited, with the decision that follows recorded alongside the entry that fired), package records, registry store entries, service definitions and ports; it executes the command vectors the provisioning program prints. `os-port.test.ts` is 27 tests over it, falsified four times. |
| Adapter lifecycle | built | `adapters/sim-os/sim-os-environment.ts` implements all ten `EnvironmentAdapter` methods. It declares the five `VERIDIAN_OS_*` names the application reads - the host path this machine can open *and* the world's own spelling of the same directory, because a program that handed the host path to a `run` step would be refused. `reset` rebuilds the world, and the reset is what makes a repair observable. |
| Observation vocabulary | built | `core/environment/os-observation.ts`, so no validator imports an adapter. The fifth family needed **no core change** beyond this and the name registration - the third sample of that claim, and the point at which it is stated as a rule rather than a coincidence. |
| Validator family | built | `validators/os/` - twelve validators, 45 tests, falsified by breaking a comparison rather than trusted. The three state questions about one file are split on purpose (`owner` / `acl` / `access`), and the family's file header records what it deliberately does **not** judge. |
| Judged as a named account | built | The loader refuses `user: "SYSTEM"` by name. An administrator reads every file, so a hardening contract judged as one is vacuous - which is the same reason `sim-posix` refuses `root`. |
| Family refusal | built | The application declares `windows` and **refuses any other family by name** rather than adapting to it, so the world cannot silently answer a macOS question with Windows semantics. |
| Demo | built | `examples/sim-os/` - four deliberate defects, seventeen criteria, `npm run demo:os`. Measured, verbatim, on run `run-20260914-161553-7d003e`: iteration 1 `FAIL`s `AC-001`, `AC-006`, `AC-007`, `AC-009`, `AC-010`, `AC-013`, `AC-014` and cannot judge `AC-012`; iterations 2-4 each repair one defect in criterion order (`AC-006`+`AC-007` and `AC-009` are the two pairs that move **together**); iteration 5 is `PASS` on all seventeen with the reason `17/17 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| Refusal as a result | built | `AC-013` runs a command naming a path outside the sandbox and expects the world to **refuse** it, judging the refusal rather than the exit code. The criterion's own description carries the limitation it knows about: the validator reads the world's *result* and not its stated *reason*, so it cannot distinguish a path that escapes from a command the world does not implement. |
| Regression tests | built | `tests/sim-os-demo.test.ts` (22 tests), `tests/sim-os-environment.test.ts` (44), `validators/os/os-validators.test.ts` (45), `adapters/sim-os/os-port.test.ts` (27), plus one `os` case in `tests/environment-gaps.test.ts` and the new `tests/readme-rosters.test.ts` (2) - each falsified rather than trusted. |

**What the fifth world settled.** `core/` changed by an observation vocabulary and a name, for the
third time. The stronger claim is the one this world was built to make: a *second* operating system
does not mean a second copy of the first family's questions. A POSIX permission is three bits and an
owner, so one `posix.permission` covers it; a Windows ACL is an owner, a set of entries with
inheritance, and a decision that follows from ordering rules, and the three have three different
repairs. One family judged both worlds by analogy and would have reported one defect where there are
three - and a `chown` for a system that expresses the same intent as an ACL.

**Four defects this world's build produced.**

1. **A substitute that resolves a token as a path cannot tell a grant from an escape.** The escape
   predicate recognised a drive with `^[A-Za-z]:`, so `icacls <path> /grant x:(R)` - an account named
   `x` - was refused as a boundary crossing, and so was any registry value whose data began `a:b`. The
   world reported "this names a place outside the sandbox" about a *permission grant*, sending the
   reader to inspect the path. A drive **path** has a separator after the colon; a grant token does
   not. Tightened to `^([A-Za-z]):[\\/]`, and the tightening loses nothing: a drive-relative spelling
   (`D:secrets.txt`) still reaches the command, whose own resolution refuses it by name. *An error
   message may only name a cause the reporter observed - and here the reporter named a path it had not
   looked at.*

2. **A command that skips the world's own path grammar gives one world two answers for one question.**
   Every path-taking command (`where`, `icacls`, `chmod`, `reg`) resolved through the family's grammar
   and refused what it cannot express; `type`/`cat` went straight to the host mapping, and `path.join`
   accepts a separator the grammar does not have. So in a Windows world `type /etc/os-release` looked
   *inside the sandbox* for `etc/os-release` and answered "cannot find the path because it does not
   exist" - a missing-file answer for a spelling the world would have **refused to resolve**, and a
   second grammar for one world's paths. Resolved first, the two commands agree. *Two implementations
   of one rule disagree the first time a world arrives that only one of them was written for.*

3. **A guard whose null branch is reachable by omitting a field is a guard no document reaches.**
   `linkAcceptance` refuses a contract naming a different goal, but `finalizeAcceptance` sets `goalId`
   to `null` when `goal_id` is absent, the schema does not require it, and
   `examples/sim-os/acceptance.yaml` did not carry one - so the newest world's cross-goal
   contradiction guard was **dormant** while every other demo exercised it. Nothing failed, because a
   guard's unreached branch is silent by construction; it was found by asking why this run's
   `latest-result.json` had no `goal_id` where the other demos' did. *The third occurrence in this
   repository of "a guard no code path can trip is not a guard".*

4. **A roster written as a shared prefix plus suffixes reads as complete while hiding an omitted
   name.** `README.md` printed the browser family as `element, value, text, count, url, console,
   network`, which folded `console.clean` and `network.ok` into shorthand and **omitted `web.visible`
   entirely** - implemented, exported, registered, and named by no document at all. Found by
   `tests/readme-rosters.test.ts` on its first run, which parses the README's layout block and compares
   each family's printed roster against the constant the code exports - not by reading the README,
   which looked complete. *A document that prints a vocabulary must print every member in full, and the
   cheapest way to hold it is a test that reads both.*

### Phase C5: the provider-account world, and what the sixth adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute account | built | `adapters/sim-cloud/cloud-port.ts` is a real HTTP server on loopback speaking a provider's own routes and holding buckets, objects (with versions, tags, checksums and encryption), queues, secrets and principals; it decides every permission question with the account's own evaluator - deny beats allow, an explicit deny beats everything - and records each decision beside the statement that fired. `cloud-port.test.ts` is 103 tests over it, falsified rather than trusted. |
| Adapter lifecycle | built | `adapters/sim-cloud/sim-cloud-environment.ts` implements all ten `EnvironmentAdapter` methods and declares the five `CLOUD_ENV` names the application reads. **No cloud account, no session, no provider API and no outbound socket**: the server is on loopback, and the application's only route out of the process is the one it is given. `reset` rebuilds the account, including its meter. |
| Observation vocabulary | built | `core/environment/cloud-observation.ts`, so no validator imports an adapter. The sixth family needed **no core change** beyond this and the name registration - the fourth sample of that claim. It is also the first observation vocabulary that carries an *action* grammar, because a `call` step needs one the substitute and the validators share. |
| Validator family | built | `validators/cloud/` - eleven validators, 59 tests, including a contract-coverage case that reads `examples/sim-cloud/acceptance.yaml` and asserts every registered name is reachable from the demo. Falsified by replacing a comparison rather than trusted. |
| Judged as a named account | built | The loader refuses `root`, `account-root`, `owner`, `administrator` and `admin`. Every policy in an account yields to an account root, so a hardening contract judged as one would report a pass for permissions no ordinary workload gets. |
| The `call` step | built | The sixth step kind, and the only one that puts the criterion's *own* request to the world rather than reading a request the application made - so a criterion can ask the account a question the application never asked. The other four adapters refuse it by name; the cloud plan, and only the cloud plan, admits it. |
| Demo | built | `examples/sim-cloud/` - four deliberate defects, twenty-seven criteria, `npm run demo:cloud`, exit 0. Iteration 1 `FAIL`s seven criteria (`AC-003`, `AC-005`, `AC-009`, `AC-011`, `AC-013`, `AC-026`, `AC-027`); iterations 2-4 remove six, four and two; iteration 5 is `PASS` on all twenty-seven with `27/27 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| Regression tests | built | `tests/sim-cloud-demo.test.ts` (19), `tests/cloud-observation.test.ts` (32), `validators/cloud/cloud-validators.test.ts` (59), `adapters/sim-cloud/cloud-port.test.ts` (103), plus a `cloud` case in `tests/environment-gaps.test.ts` and the `cloud` roster entry in `tests/readme-rosters.test.ts`. |

**What the sixth world settled.** `core/` changed by an observation vocabulary and a name, for the
fourth time - and this time the vocabulary had to carry more than names, because the world has verbs.
The stronger claim is the one this world was built to make: the subject can be an *account* rather
than a filesystem, so the adapter seam does not depend on there being a tree underneath it. And the
sixth world is the first that can be *asked* rather than only *watched*: `cloud.call` makes its own
request, which is what makes a criterion about a permission decision a criterion about the decision
rather than about whatever the application happened to attempt.

**Four defects this world's build produced.**

1. **A sub-resource is a query parameter, and a router that matches only the path cannot tell two
   requests apart.** The world's defect D2 is one word: a tagging request aimed at an object instead of
   at the bucket that owns it. The route table keyed on the path alone, so
   `.../objects/cart.js?tagging` and `.../buckets/cart-assets?tagging` both landed on the same handler
   and the criterion read `PASS` for both - a defect that was *invisible to the world under test*
   rather than missed by it. The sub-resource is now part of the route, a sub-resource asked of the
   wrong resource is answered with a stated reason naming both, and the log line carries
   `routeAddress` - the request as it was actually made, including its query. *A route is a request,
   not a path.*

2. **A refusal with an empty body is an observation nobody can read.** The substitute answered every
   refusal with a status code and nothing else, so the `call` reading recorded *that* a request was
   refused and never *why* - and a criterion about a permission decision is a criterion about the
   reason. `refusalBody` now renders `{ kind, reason, status, message }` at every refusal site, and the
   adapter carries it into the reading. *A status code is a verdict; the body is the evidence, and a
   validator may only quote what it was given.*

3. **A meter is a count of events, so it is part of the world and has to be reset with it.** The
   account's meter describes its *current life*: a reset begins a new one, because a bill that carries
   a previous world's writes into a fresh one describes two worlds with one number. The rule
   generalises past cost - any reading that is a function of the run's own history is state, and a
   reset that restores the resources and not the history leaves a bundle whose evidence belongs to an
   iteration the reader is not looking at.

4. **A rendering pin must be measured against the source, not recalled.** The action vocabulary admits
   `s3` as a service segment and camel-case verbs, so the pattern that guards it is
   `/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/` - which the first attempt, a tidy pattern recalled from
   the *validator* naming rule next door, rejected outright. `statementSpelling` had the same shape of
   error in its own doc comment: it described four fields and renders three, because a statement is
   read for what it *grants* rather than for whom it happens to name. *An assertion about a message is
   an assertion about the code's wording - read the wording from the source.*

**And two of this world's defects were in its tests rather than in its code**, which is the more
instructive half. `tests/sim-cloud-demo.test.ts` asserted `program.includes(defect.correct)` against a
CRLF checkout while the only multi-line defect block is authored with `\n` - so that assertion could
never match on this machine, and the *negative* half beside it (`!includes(defective)`) is true for
every file and was passing vacuously. It now goes through the shared implementation in
`examples/defect-text.ts` and asserts an exact count of 1 for the correct form and 0 for the defective
one. The same file asserted that every identity named in the contract equalled `cloud.principal`, and
failed on a **correct** contract that names two identities: the account the application runs as, and
`svc-reader`, a reader the program itself creates. Both failures were diagnosed by reading the
failure message rather than by guessing, and both fixes were falsified - one by filing a defect
against a criterion no defect claims, the other by putting a typo into a `correct` block.

### Phase C6: the runtime world, and what the seventh adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute runtime | built | `adapters/sim-container/container-port.ts` is a store of image records (tags, labels, an image id derived from `sha256` over the layer list) and container records (state, exit code, mounts, published ports, limits, healthchecks, captured output) beside a register of runtime commands answered in process. The bind mount is a **real directory** and a container's command is a **real child process** whose working directory is really resolved through the mount table - longest destination wins, matched on whole segments, as a real runtime resolves it. `container-port.test.ts` is 41 tests over it, falsified rather than trusted. |
| Adapter lifecycle | built | `adapters/sim-container/sim-container-environment.ts` implements all ten `EnvironmentAdapter` methods and declares the four `CONTAINER_ENV` names the application reads. **No Docker, no daemon, no Podman, no containerd, no runc, no OCI image, no layer, no namespace, no cgroup and no registry**: what answers the commands is a directory this machine can open plus tables maintained in process. |
| Observation vocabulary | built | `core/environment/container-observation.ts`, so no validator imports an adapter. The seventh family needed **no core change** beyond this and the name registration - the fifth sample of that claim, and the one that carries a *refusal* vocabulary beside its reference grammar. |
| Validator family | built | `validators/container/` - nineteen validators, 58 tests. It adds **no new step kind**: the application provisions over `run` exactly as `sim-posix` and `sim-os` do, and `container.call` / `container.probe` read the world's record of a command rather than issuing one. |
| Limits carried into the compared value | built | `container.limit` compares `memory 268435456 bytes, cpus 1, pids 64 (declared, not enforced)` and `container.port` compares `18080:8080/tcp (exposed)`. Without the parenthetical both comparisons would assert something the world does not do - that a limit *held* and that a port was *reachable*. |
| Demo | built | `examples/sim-container/` - four deliberate defects, twenty-seven criteria, `npm run demo:container`, exit 0. Iteration 1 `FAIL`s ten criteria (`AC-008`, `AC-010`, `AC-011`, `AC-012`, `AC-015`, `AC-016`, `AC-017`, `AC-018`, `AC-022`, `AC-026`); iteration 2 removes one, iteration 3 removes one, iteration 4 removes none, iteration 5 is `PASS` on all twenty-seven with `27/27 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| Regression tests | built | `tests/sim-container-demo.test.ts` (29), `tests/sim-container-environment.test.ts` (55), `adapters/sim-container/container-port.test.ts` (41), `validators/container/container-validators.test.ts` (58), plus a `container` case in `tests/environment-gaps.test.ts` and the `container` roster entry in `tests/readme-rosters.test.ts`. |

**What the seventh world settled.** `core/` changed by an observation vocabulary and a name, for the
fifth time. The claim this world was built to make is narrower and harder than C5's: a world can be a
*runtime* - the thing that produces a filesystem view rather than holding one - and still need no step
kind of its own. It is also the first world whose stated limits are part of the value a criterion
compares. `(declared, not enforced)` and `(exposed)` are not caveats in a document, they are what the
comparison asserts, because a rendering that dropped them would report a limit that held and a port
that was reachable.

**One edit, seven criteria - and the three controls that make it a measurement.** D4 is a
one-character misspelling of a bind mount's source (`./contxt` for `./context`). Ten criteria fail on
iteration 1: two are the filed criteria of D1 and D2, and **seven of the remaining eight are
consequences of that single character** - the container's state (`container.state`: `created`, never
`running`), the mount itself (`container.mount`: source absent), the healthcheck that never ran
(`container.health`), both captured streams (`container.logs` and `container.stderr`: empty), the
criterion's own call (`container.call`, which is D4's filed criterion), and the probe that never
reached a process (`container.probe`). The eighth is D3's criterion, which D4 had masked as well.
Every one of those is a *separate true consequence* of a mount the world could not resolve - and the
finding is only readable because the other three defects are controls: `D1` (`container.label`,
AC-010), `D2` (`container.port`, AC-011) and `D3` (`container.logs`, AC-018) are each read by exactly
**one** criterion. `D3` is the purest control, because it moves a line the program printed about
itself and **no reading in this world is computed from that line** - so its consequence is only the
criterion that names it.

The measured progression shows a control doing its job rather than merely being asserted. Iteration 3
`FAIL`s eight criteria and `D3` is repaired after it; **iteration 4's failure set is iteration 3's,
unchanged**; iteration 5 is `PASS`. So D3's criterion moved only once D4's mount resolved - a
criterion reading a container's captured output cannot report a repair to a line the container never
had the chance to print. A loop that reported progress from its own intentions would have shown that
criterion move on iteration 4, from the repair rather than from the world.

