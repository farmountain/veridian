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
| 6 | Kubernetes, cloud, data platform | Roadmap Tier 4-5 | Kubernetes built as a **simulated** world, `sim-k8s`; cloud built as `sim-cloud` (Phase C5); the container runtime built as `sim-container` (Phase C6); the data platform built as a **simulated** broker, `sim-data` (Phase C8) |

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
What exists instead is the nearest thing that can be run here, and the two are not equivalent.
It is now two nearest things rather than one - a recording double, and the `sim-vscode` world that
really loads the compiled extension in a child process - and the difference between them is measured
rather than asserted, in the note after the gate table below:

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npx tsc --noEmit` | silent (exit 0) |
| Decisions, headless | `node --test` | 72 tests, 0 failing |
| Build | `npm run build` | `out/` - 6 files |
| **Compiled artifact** | `npm run smoke:out` | 15 checks, exit 0 |
| Package | `npm run package` | `veridian-cockpit-0.5.0.vsix` - 12 files, 119.98 KB |
| **Packaged archive** | `npm run smoke:vsix` | 35 checks, exit 0 |
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

**And the double was proved too weak, which is the strongest argument this document has for the
distinction it just drew.** `smoke:out` activates the compiled entry point twice and asserts the six
commands are registered; it never invokes a handler, so nothing in it reads the *answer* a handler
gives back. Putting the real compiled Cockpit inside `sim-vscode` - one of the twelve worlds, whose
subject is an extension host - and judging it with eleven acceptance criteria reported **two defects,
both real, both invisible to every check above**: `registerCommand` discarded the promise its handler
returned (`void handler().catch(...)`, so `registerCommand` answered `undefined` and any caller that
chained on it failed), and `openPath` called `.then` on the answer of `openTextDocument` with no
shape check at all. Patching each defect back into the staged *compiled* artifact moved exactly one
criterion each, and restoring it returned the run to `PASS 11/11` with complete evidence. The list
above is therefore still accurate about a **real VS Code test host** - neither defect would have been
invisible to one - and it is now also a list of what a **substitute** host cannot reach even when it
really loads and really activates the compiled file.

**Also built, and it is the third artifact of this tree:** the `.vsix`. This paragraph used to say the
opposite - that packaging needs `@vscode/vsce`, that the output had never been produced on this
machine, and that adding a package script nobody had run would be the same unverified claim this
document refuses for a Dockerfile. That reasoning was right, and the fix was to run it rather than to
keep declining: `@vscode/vsce` is now a dev dependency, `npm run package` produces
`veridian-cockpit-<version>.vsix` (12 files, 119.98 KB) and `npm run smoke:vsix` reads it back as a zip - by
hand, with `node:zlib`, because this tree has no runtime dependency and adding one to read an archive
would be the tail wagging the dog. The archive is a **fourth** artifact that nothing else here can
load, so the same discipline `smoke:dist` and `smoke:out` follow one runtime further out applies:
compare it against the build rather than trust the tool. Five facts were falsified rather than
trusted - `src` in the allowlist fails both negative checks; a byte appended to a compiled file after
packaging fails the byte-identity check; corrupting the licence copy fails *"the licence in the
archive is the repository's, byte for byte (1327 bytes)"*; editing `extension/vscode/README.md` after
packaging fails *"the readme in the archive is the source's, byte for byte"*, which is the comparison
added in this pass, because the readme is the marketplace's long description and had been the one file
in the archive checked for existence alone; and removing `LICENSE` from `files` is the instructive one,
because `vsce` prints `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`, packages **10** files
and **exits 0** - a warning is not a check, so `smoke:vsix` is what fails.

The installed floor moved with it. The manifest declares `"type": "module"`, so the compiled
`out/host/activate.js` is an ES module, and the Node.js extension host could not load one until VS
Code **1.100**. The manifest said `^1.94.0`, so on six releases the extension would have installed
cleanly and never started - nothing errors at install time. Read out of the 1.100 release notes
rather than recalled, fixed to `^1.100.0`, and held by `src/packaging.test.ts`, which derives the
module format from `tsconfig.json` and the floor from the manifest and asserts the second admits the
first.

**The two extension marketplaces are the fifth distribution route, and the archive was already the
whole of it.** A `.vsix` is what both `vsce publish` (the VS Code Marketplace) and `ovsx publish`
(Open VSX) upload, so the third artifact *is* the distribution and neither publisher adds a
second one to keep in step. What each publisher adds is **metadata read off the manifest it is
given**: the display name, the description, the version, the icon, the categories and the keywords
are all fields in `extension/vscode/package.json`, which is why that file is the single source for
both storefronts' descriptions rather than a copy kept beside each. Two things had to change for the
route to exist at all, and both were recorded before they were fixed rather than after:

- **`"private": true` was a hard blocker.** `vsce publish` and `ovsx publish` both refuse a private
  package, so the manifest could produce an installable archive and could never publish one. It is
  removed, and the guard that replaced it is narrower on purpose: `prepublishOnly` runs `npm run
gate`, so a package whose own tests are red cannot leave the machine, where `private: true` would
  also have blocked a local `vsce package` for no reason.
- **A version is written in four files and reconciled by nothing.** The extension's `package.json`,
  this repository's root `package.json`, and each of their `package-lock.json` root entries carry the
  same figure by convention and no mechanism, so the marketplace's version and the CLI's reported
  `veridianVersion` can drift apart silently. They are all `0.5.0` as this is written. **This entry
  used to claim the check was `npm run package`, and that was wrong about its own subject** - what
  `package` proves is narrower: the archive is named `veridian-cockpit-<manifest version>.vsix`
  because the `package` script passes no `--out`, so the *filename and the manifest it packaged*
  cannot disagree. It says nothing about the root manifest, and the root manifest is exactly what
  drifted when the extension's two `package-lock.json` entries were left at `0.2.1` after the bump to
  `0.2.2` - the same shape as the licence drift this repository already paid for, where the lockfile
  said `UNLICENSED` while the manifest said `MIT`. `npm install --package-lock-only --ignore-scripts`
  reconciles a lockfile to its manifest; reconciling the two manifests to each other is still done by
  hand, and that is the gap this entry now names rather than papering over.
- **A named route that nothing in the tree can execute is not a route.** This section named
  `vsce publish` and `ovsx publish` while `ovsx` was installed nowhere and declared nowhere, so the
  route existed only as prose a maintainer had to reproduce from memory - the same defect class as a
  README describing a command that no longer behaves that way. `ovsx` is now a dev dependency and
  both publishers are one script behind two declared commands.

**Publishing is still the maintainer's step, not an agent's - but it is now a command in this tree
rather than a sentence in a document.** `vsce publish` and `ovsx publish` need a token and a claimed
name, and both are the maintainer's to hold, so `npm run publish:vsce` and `npm run publish:ovsx` are
declared scripts and are deliberately **not** in `gate`: the source tree's gate must not require a
credential or a third party to be reachable. `scripts/publish-vsix.mjs` is both of them, and
`--packagePath` is the whole argument - the flag is what makes *"neither publisher adds a second
artifact to keep in step"* true rather than merely intended. Bare `vsce publish` and bare `ovsx
publish` each *package* the directory themselves, so a maintainer running one would upload a second
build rather than the archive `smoke:vsix` had just read back; and `vsce publish <version>` runs `npm
version`, which edits one of the several files that carry the version number. The archive's name is
resolved by `scripts/vsix-archive.mjs` rather than spelled out a second time, because the smoke test
needs that same answer and two copies of one rule is how a publisher ends up uploading an archive
nobody produces. What this repository owes is still an archive whose manifest describes it
correctly, which `npm run smoke:vsix` reads back.

**What is still not reached:** no VS Code test host, and no `.vscodeignore`. The second is
deliberate: with `files` in the manifest, `vsce` includes only what the allowlist names plus the
manifest and the README, so a `.vscodeignore` would *replace* that rule with a permissive one rather
than refine it.

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

### Phase C7 - the eighth adapter: `sim-vscode`, the extension-host world

C6 proved a world can be the thing that *produces* an application's filesystem view. This one attacks
a subject no other world has: an **editor's extension API**. Here the application does not provision
anything into the world and is not judged as an account inside it - it ships an *extension*, and the
world is the host that loads and runs it. Every fact a criterion reads is something that host recorded
while the extension was running, which is a stronger form of the same claim the other simulations
make: the reading is not a record of what the application said, it is a record of what the application
did to a host it never sees.

The world resolves a module in place of `vscode`, and every action that needs the extension running
starts a **fresh host process** - so an activation count is a count of host processes, and output
channels, messages and command invocations are a cumulative transcript across them, while durable
state is the one surface genuinely shared.

- `core/` gains `core/environment/vscode-observation.ts` and one more plan field (`VSCodePlan`), and
  nothing else a validator could have reached through an adapter. That file carries the reference
  grammar (`command/...`, `setting/...`, `contribution/...`), the renderings the validators compare,
  the seven simulated surfaces, and the vocabulary for a call the world **refuses** - which is what
  lets a criterion judge a refusal rather than an error.
- An eighth validator family - `vscode.host`, `vscode.identity`, `vscode.engine`, `vscode.activation`,
  `vscode.contribution`, `vscode.command`, `vscode.invocation`, `vscode.setting`, `vscode.status`,
  `vscode.output`, `vscode.message`, `vscode.state`, `vscode.subscription`, `vscode.file`,
  `vscode.refusal`, `vscode.call`, `vscode.probe` - needs no change to `core/validation` or
  `core/execution`. That is the sixth demonstration.
- **This world adds no step kind, and no new evidence kind either.** It is acted on with `run`, so the
  provisioner's vectors are the interface; the criterion reaches *into* the host through the `activate`
  and `invoke` vectors rather than through a step of its own. Its only evidence kind is `json` -
  there is no page to screenshot - and `snapshot-restore` is refused by name rather than silently
  downgraded to a restart.
- **Two of the seventeen validators are what keep the substitution honest.** `vscode.contribution`
  refuses a manifest whose `main` escapes the extension's own directory, and `vscode.engine`
  evaluates `engines.vscode` against the `apiVersion` the document declares - so a world that admits
  an extension it could not have loaded is a world that fails rather than one that passes for the
  wrong reason.

**Acceptance:** four deliberate defects, twenty-three criteria, the same `FAIL` -> repair -> `PASS`
descent, and a bundle whose reading names the seven surfaces standing in for something. Measured in
§7.

### Phase D - the ninth adapter: `local-api`, the world that is not simulated

Every world so far except `local-web` and `local-db` has been a substitute. This one is Tier 1's other
item (`PLAN.md` §36) and it is the first in the series that substitutes **nothing at all**: a real
service is started as a real child process, and it is judged through its own HTTP interface over
loopback. There is no `*_SIMULATED_SURFACES` constant and there should not be one - the reading
carries no `simulated` field, because no surface is stood in for.

It is worth stating why this is not a contradiction of §2's ordering. `sim-k8s` was built before it
because a *slower, larger* substitute is the stronger proof that `EnvironmentAdapter` is a seam. But
`local-api` proves the **other** direction, and that direction is the one that decides what the product
can be used for: a world whose subject is entirely real still needs no core change. A framework that
can simulate a cluster but cannot judge a real server is a framework with a simulation-shaped hole in
it, and the hole would only be discovered by the first user who pointed Veridian at their own service.

**What makes it different from `local-web`, which is also real.** Three things, and each one is a
capability rather than a detail.

1. **The contract makes the requests, not the application.** This is the only world that performs a
   `call` step. In every other world a criterion infers the service's answer from traffic the
   application generated; here the criterion puts its own `GET /health` to the service and reads the
   status line, the headers, the byte count and a pointer into the body. So a criterion can ask a
   question the application never asks - a request the application would never make, against a route
   it never uses - which is what makes an HTTP contract about an interface rather than about a session.
   `call` is the sixth world's step kind, reused rather than reinvented, and `local-api` adds no kind of
   its own.
2. **No page, so no browser.** `browser.enabled` is `false` in the environment document and there is no
   Playwright anywhere in the loop. The reading is `api.http` and the only evidence kind is `json`.
3. **Three target grammars in one family.** A bare 1-based position addresses one exchange
   (`api.status`, `api.body`, `api.bytes`, `api.exchange`); `<position>:<header-name>` addresses one
   header of one exchange, split at the first colon (`api.header`); `<position>/<json-pointer>`
   addresses one value inside one body (`api.json`). Three grammars rather than one, because an
   exchange, a header and a JSON value are three different kinds of thing - and the split is what lets
   a contract pin `1/WIDGET/unitPriceCents` without deep-comparing a whole document.

- `core/` gains `core/environment/api-observation.ts` and one more plan field (`ApiPlan`), and nothing
  else a validator could have reached through an adapter. That file carries the exchange record, the
  pointer reader and the renderings a non-browser reading needs.
- A ninth validator family - `api.service`, `api.exchange`, `api.status`, `api.header`, `api.body`,
  `api.bytes`, `api.json`, `api.log` - needs no change to `core/validation` or `core/execution`. That
  is the **seventh** demonstration of the claim this series exists to make, and the first made by a
  world that is entirely real.
- **No new step kind and no new evidence kind.** Every criterion acts with `call`; the only evidence
  kind is `json`; `snapshot-restore` is unsupported and `reset.strategy` is `restart`.
- **`api-port.ts` never throws.** The client uses the global `fetch` with an `AbortController` and
  `redirect: "manual"`, and a timeout comes back as an exchange whose `error` is set - because a
  timeout is an *observation about the service*, and a client that threw would turn it into a crash in
  the harness, which is a different fact about a different thing.

**Acceptance:** four deliberate defects, eight criteria, the same `FAIL` -> repair -> `PASS` descent,
and a reading that names no substitute because there is none. Measured in §7.

### Phase D2 - the tenth adapter: `local-process`, the world with no socket in it

The other Tier 1 item, and the second world in the series that substitutes **nothing at all**: a real
program is started as a real child process and judged on the text it printed on stdout and stderr, the
code it exited with, a probe of whether it is still up, and the files it really wrote under a real
directory. It adds no new step kind - a contract that provisions a tree does so with the `run` steps
the second world introduced - and no new evidence kind beyond `json` and `log`, so it is the same
eight-part procedure rather than a new capability.

**Why it was still worth building despite adding no capability.** Every world in the series before it
was *large* - a cluster, an operating system, a runtime, a provider account - and every one of them
made its point by being hard. `local-process` is the small case, and the small case is where an
architecture built for the large one is most likely to have acquired a dependency it did not notice.
`local-api` played that role for HTTP; `local-process` plays it for the process boundary itself,
where the observable facts are an exit code, a stream, and a file on disk rather than a record in a
table.

**What makes it different from `local-api`, which is also real.** Two things, and the first is the
sharpest distinction in the series.

1. **There is no socket, so there is no `call`.** `local-api` is the only world whose contract can put
   its own request to its subject. This world has nowhere to put one, so a criterion acts in it with
   `run` and reads the result - which is why the world that adds the least capability is the one that
   shows the step register was never the frame around the worlds; the worlds are the frame around the
   step register.
2. **Two target grammars in one family, chosen by the *validator* rather than by the spelling.** `app`
   or a bare 1-based position names a *command* (`process.probe`, `process.argv`, `process.state`,
   `process.exitcode`, `process.run`, `process.stdout`, `process.stderr`); a world-relative path names
   a *file* (`process.file`, `process.kind`, `process.contents`, `process.size`). `commandAt` is
   deliberately index-free for `app` and index-based for a position, because the program is the same
   program in every criterion while "the second command" is a fact about *this* criterion. The
   `process.file` and `process.contents` targets are read as places and the `process.exitcode` target
   as a selector, so neither can misread the other's spelling.

- `core/` gains `core/environment/process-observation.ts` and one more plan field (`ProcessPlan`), and
  nothing else a validator could have reached through an adapter. That file carries the two target
  grammars beside the refusal that decides which spellings of a path leave the world.
- A tenth validator family - `process.host`, `process.probe`, `process.argv`, `process.state`,
  `process.exitcode`, `process.run`, `process.stdout`, `process.stderr`, `process.file`,
  `process.kind`, `process.contents`, `process.size` - needs no change to `core/validation` or
  `core/execution`. That is the **eighth** demonstration of the claim this series exists to make, and
  the second made by a world that is entirely real.
- **A path that leaves the root is refused, and the refusal is recorded as a boundary crossing**
  rather than reported as a missing file. A resource that is absent and a place that is out of bounds
  are two different observations, and the adapter must not answer the second with the first.
- **The world records its own declaration, not the host path that declaration resolved to.** The
  reading carries `"root": "sandbox"`, which is what the environment document says and what a reader
  can check against it. An earlier version recorded the absolute spelling, and whether a criterion
  passed then depended on how the operator spelled their `--goal` - the same tree, run twice, gave
  exit 0 with a relative path and exit 1 with an absolute one.
- `PROCESS_ENV` declares the three names the application reads - `VERIDIAN_PROCESS_HOST`,
  `VERIDIAN_PROCESS_ROOT`, `VERIDIAN_PROCESS_APP` - which is also how the host name a `process.host`
  criterion compares stays a *declared* fact rather than something the world inferred from a pid.

**Acceptance:** four deliberate defects, nine criteria, the same `FAIL` -> repair -> `PASS` descent,
and a reading that names no substitute because there is none. Measured in §7.

### Phase C8 - the eleventh adapter: `sim-data`, the message-broker world

The last of the data-infrastructure Tier, and the first world whose subject is a **wire protocol**
rather than a document shape: the application is a real child process, it is handed an address through
its environment, and it speaks a real length-prefixed request/response protocol over a real TCP socket
on loopback. What is substituted is the **broker** - topics, partitions, records, groups, committed
offsets, a coordinator and a meter - and there is no Kafka, no ZooKeeper, no on-disk commit log and no
second machine anywhere in the loop.

**Three things are deliberately not on that list, because they are not substituted at all:** the
socket, the bytes, and the record the client sent. That is the line this world is drawn along, and it
is the same line `sim-cloud` drew: a broker's interface *is* a socket, so a provisioning program that
printed command vectors would be *describing* requests rather than making them, and a world that
accepted the description would be judging the description. The application negotiates versions,
sends batches, and reads offsets back - and everything the world answers is computed from bytes it
actually received.

**Why it was still worth building despite adding no capability.** Three arguments, and the first is
the one that matters most.

1. **It is the first world that is no-HTTP and socket-bearing at once.** Every world before it
   divided cleanly: a browser world has a `url`, and every world with no `url` had no socket either -
   a database file, a command surface, a resolved module. `sim-data` has a listening TCP port and
   **no HTTP route and no health path**, so the detector's `hasNoHttp` predicate needed a `data`
   clause: the question that predicate asks is about the *surface*, not about the *transport*.
   Without that clause the ladder would have asked this world for a `url` and handed it
   `expectStatus: 200`, derived `browser.enabled: true`, and the loader would then have refused the
   pair it had just been handed - before the run ever reached the broker.
2. **It is the second adapter in the tree that performs a real `snapshot-restore`,** and it does so
   for a reason that is a *property of the substitute*: an account's state is **pure** - topics,
   records, groups and committed offsets, all in this process's memory, with no live child behind any
   of them - so copying it and putting it back really is a restore. `sim-container` refuses the same
   strategy by name, because it holds a live child and half a world is not a world. The two worlds
   disagree about the same reset strategy and both are right, which is the clearest statement the
   series has made that a reset strategy is a fact about a world rather than a setting on a framework.
3. **It settles what a substitute does when it can only hold part of what it was asked for.** The
   contract asks for `replication 3`; one substitute node cannot hold three copies of anything. So the
   reading prints `replication 3 recorded, isr [1]` - the factor is what the application *asked for*,
   reported as recorded, and the isr is what the world actually has. That is the same class of
   question `sim-container` settles with `(exposed)` and `(declared, not enforced)`: the honest
   rendering carries the limit into the value the criterion compares, because a value that omitted it
   would say a factor *held* when it was only *declared*.

**What makes it different from `sim-cloud`, its closest sibling.** Both are socket worlds; both have a
`call` step; both are judged partly through the application's own traffic. Three differences, each of
which the design turned on.

- **A binary protocol rather than HTTP.** The requests are length-prefixed frames on a TCP stream, not
  method/route/body triples, so the world needs a frame codec (`wire.ts`) and an API table
  (`protocol.ts`) beside its request log rather than a router. The API table is what makes version
  negotiation a *reading* rather than a hope: `dataApiSpelling(api)` renders `ApiVersions(18) v0`, and
  a criterion comparing an api name is comparing the world's own spelling of it.
- **No HTTP at all, which is a fact the clarification ladder reads.** See argument 1 above. `sim-cloud`
  is asked for nothing HTTP-shaped either, but it answers over real routes; `sim-data` answers over
  neither, and the two are encoded as one `hasNoHttp` clause rather than as a special case in the
  adapter.
- **It answers `snapshot-restore` where the nearest substitute refuses it.** See argument 2 above.

- `core/` gains `core/environment/data-observation.ts` and one more plan field (`DataPlan`), and
  nothing else a validator could have reached through an adapter. That file carries the reference
  grammar, the renderings the validators compare, the request/result vocabulary the substitute and the
  validators share, and the seven-member `DATA_SIMULATED_SURFACES` constant.
- An eleventh validator family - `data.node`, `data.topic`, `data.layout`, `data.partition`,
  `data.record`, `data.key`, `data.value`, `data.group`, `data.member`, `data.commit`, `data.call`,
  `data.probe`, `data.meter` - needs no change to `core/validation` or `core/execution`. That is the
  **ninth** demonstration of the claim this series exists to make, and the first made by a world whose
  subject is a protocol rather than a resource.
- **Seven results rather than a boolean, because each is a different repair.** `ok` is the pass;
  `unknown-api` sends the reader to version negotiation, `unsupported-version` to the version,
  `unreadable` to the framing, `invalid-request` to the fields, `corrupt-message` to the bytes inside
  the batch, and `refused` is the world saying no on purpose with a reason. Collapsing any two of them
  produces a report naming a cause the world did not observe.
- `DATA_ENV` declares the **five** names this world publishes to the application it starts -
  `VERIDIAN_DATA_CLUSTER`, `VERIDIAN_DATA_NODE_ID`, `VERIDIAN_DATA_HOST`, `VERIDIAN_DATA_PORT`,
  `VERIDIAN_DATA_BROKER` - three of which are one address in three spellings, all read off the same
  `listen()` call, and of which the shipped application reads **`HOST` and `PORT` and nothing else**.
- **A repairable defect may not sit on the readiness line.** This is the first demo whose defect table
  needed that rule enforced by a guard rather than by a comment, and the guard is the shape the
  tenth world's test already used: apply each defect to the source, assert the edited program differs
  from the shipped one (the positive control that stops a stale anchor passing vacuously), and only
  then assert the readiness literal survives.

**Acceptance:** four deliberate defects, twenty criteria, thirteen validators, three criteria acting
in the world through a `run` step and **one of those expecting the world to refuse it**, and the same
`FAIL` -> repair -> `PASS` descent. Measured in §7.

### Phase C9 - the twelfth adapter: `sim-mobile`, the handset world

The last of the Tier 2-3 device family, and the first world whose subject is a **handset**. The
application is a real child process and it provisions the substitution the way `sim-posix`, `sim-os`
and `sim-container` are provisioned: by printing **command vectors on its stdout**, one JSON argument
vector per line, with every human-readable line on stderr. What is substituted is the **device** -
boot state, installed bundles with their versions, permissions and grants, deep links, notifications,
keychain entries and per-bundle log lines - and there is no emulator, no image, no booted system and
no hardware anywhere in the loop.

**The one part of it that is not a substitution is the launch.** A bundle launch starts a **real
child process** through `core/process.ts`, and the launch deadline is applied by the world rather than
described by it - so a criterion about an activation is a reading of a process that really ran. That
is where the substitution deliberately stops, and it is the same line `sim-container` draws around a
container's own captured output.

**What it declines to do, by name.** A path outside both the application's own tree and the world's
sandbox is **refused and recorded** rather than resolved, because opening the developer's own
filesystem while calling it the device's is the one thing this world must not do. The vocabulary
split matters: a command the world does not implement is `refused` while a resource it does not hold
is `absent`, and the two are different words because they are different observations. `rebuild()`
deliberately keeps `calls` and `escapes` across a reset, because the boundary record describes the
*run* rather than the *world* - the rule the boundary work landed generally: a reset restores the
world, not the record.

- `core/` gains `core/environment/mobile-observation.ts` and one more plan field (`MobilePlan`), and
  nothing else a validator could have reached through an adapter. That file carries the reading
  (`mobile.device`), the reference grammar, the renderings the validators compare and the
  **nine**-member `MOBILE_SIMULATED_SURFACES` constant.
- A twelfth validator family - `mobile.device`, `mobile.os`, `mobile.screen`, `mobile.orientation`,
  `mobile.bundle`, `mobile.installed`, `mobile.permission`, `mobile.deeplink`, `mobile.notification`,
  `mobile.logs`, `mobile.call`, `mobile.probe` - needs no change to `core/validation` or
  `core/execution`. That is the **tenth** demonstration of the claim this series exists to make, and
  five of the twelve are targetless because the world itself is their subject.
- `MOBILE_ENV` declares the **four** names this world publishes to the application it starts, and the
  split between two of them is the one `sim-container` draws: `sandbox` is a host path this machine
  can open, `workspace` is a path inside the device that no `run` step may name.
- **A secret is redacted rather than omitted.** A recorded command keeps the request's shape and
  replaces the value: a keychain value is never written into a bundle while the **digest** of it is,
  so a criterion asking whether the value was written is answerable without the value being in the
  evidence.
- `snapshot-restore` is not offered by this substitute, so the reset register answers `restart` and the
  adapter installs no strategy it cannot perform.

**Acceptance:** four deliberate defects, twenty-five criteria, twelve validators, three criteria
acting in the world through a `run` step and **one of those expecting the world to refuse it**, and
the same `FAIL` -> repair -> `PASS` descent. Measured in §7.

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
| `local-api` | real child process, real HTTP service, and the criterion puts its own request | - | **built**, see §7 |
| `local-process` | real child process, and the program's own two streams, exit code and files | - | **built**, see §7 |
| `sim-k8s` | real app process against a real HTTP control plane | `scheduler`, `kubelet`, `cri`, `etcd`, `cni`, `admission`, `ingress` | **built** |
| `sim-cloud` | real app process against real HTTP endpoints | `regions`, `object-store`, `queue`, `key-management`, `secret-rotation`, `identity`, `metering` | **built**, see §7 |
| `sim-container` | real app process provisioning images and containers over a real command surface | `namespaces`, `cgroups`, `image-layers`, `registry`, `published-ports`, `volumes`, `user-switching` | **built**, see §7 |
| `sim-posix` (linux, kali) | real process runner + real sandboxed filesystem | `kernel`, `distribution`, `package-manager`, `package-index`, `permissions`, `egress`, `provisioning` | **built** (Linux/Debian; Kali is the same world with a different declared distribution) |
| `sim-os` (windows, macos) | real process runner | `kernel`, `os-identity`, `path-semantics`, `acl`, `registry`, `preferences`, `service-manager`, `egress`, `provisioning` | **built** (Windows, judged as `svc-audit`; macOS is the same world with a different declared family) |
| `sim-vscode` | a real extension loaded by a real Node process through a resolved module | `extension-host`, `module-resolution`, `activation-events`, `command-registry`, `window`, `configuration`, `workspace` | **built**, see §7 |
| `sim-data` | real app process issuing real broker-protocol requests over a real TCP socket | `broker`, `replication`, `group-coordination`, `log-storage`, `retention`, `transactions`, `partitioning` | **built**, see §7 |
| `sim-mobile` | real app process provisioning a substitute device over a real command surface | `device`, `emulator`, `touch-os`, `display`, `input`, `sandbox`, `keychain-service`, `app-store`, `push-service` | **built**, see §7 |

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
| a real VS Code extension host as a *world* | Installed VS Code is not a sandbox substrate, and the extension host is a fourth runtime with its own loader - so a check that needs one cannot be a check in this tree. | `sim-vscode` - **built**, see §7 |

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

**`BoundaryEnforcement` has four values, and only one of them is about an adapter's reach.** Quoting
one of them is how the first bullet above becomes a claim that is true and incomplete, so the whole
vocabulary is printed here:

```
BoundaryEnforcement  "enforced" | "unsupported" | "unenforceable" | "not-requested"
```

`enforced` - the world has a mechanism, holds it, and the record says so. `unsupported` - this
adapter has no mechanism for this boundary and never claimed one. `not-requested` - the document did
not ask, so there was nothing to hold or to miss. `unenforceable` - a mechanism *should* exist for
this boundary and demonstrably does not, so the absence is a finding about the platform rather than
about the adapter. Exactly one world answers that last way: `local-process` reports
`network: unenforceable` because **Node has no `--allow-net`** - measured with a positive control,
`--permission` is accepted on this runtime (exit 0) while `--allow-net=127.0.0.1` is rejected as a
`bad option` (exit 9). `local-web` and `local-api` report `network: enforced` for the same boundary
because each has a guarded front door every request must pass, and can therefore really refuse one.
That divergence is the vocabulary working, not a disagreement:
`tests/boundary-roster.test.ts` derives which world answers which way from the adapters themselves,
so a twelfth world cannot join either side in silence.

---

## 7. What was built, and what was measured rather than assumed

Phase A1 and Phase A2 are both implemented and both verified. The Docker route was verified in CI
rather than locally, and the run id is cited below rather than the word "works".

| Step | Status | Evidence |
|------|--------|----------|
| `tsconfig.build.json` emits `dist/` | **done** | 128 files; first line of `dist/cli/veridian.js` is `#!/usr/bin/env node` |
| `.ts` import specifiers rewritten to `.js` | **done** | `dist/cli/veridian.js` holds `import { assetsRoot } from "../core/assets.js";` |
| `schemas/` carried into `dist/` | **done** | `copy-assets: schemas/ -> dist/schemas/`; all 6 present |
| Asset root resolved from the module | **done** | `core/assets.ts`; `tests/assets.test.ts` holds both halves |
| `package.json` packaging | **done** | `files: ["dist"]`, `bin.veridian`, `prepublishOnly`, `prepare` |
| Gate stays green | **done** | `2202 tests / 358 suites / 0 fail`, exit 0 |
| Smoke test exists **and discriminates** | **done** | falsified by reverting the asset root in the built `.js`: `FAIL ... exits 2, not 3`, exit 1 |
| `npm pack` -> clean install -> run | **done** | 131 files, 554.1 kB; `npx veridian help` exit 0; a browserless validate exit 2 with schemas resolved from `node_modules` |
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

### Phase C7: the extension-host world, and what the eighth adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Substitute host | built | `adapters/sim-vscode/vscode-port.ts` resolves a module in place of `vscode` and holds contributions, commands, invocations, settings, status items, output channels, messages, subscriptions and durable state beside the calls it refuses by name. Every host process activates the extension, so an activation count is a count of **host processes**. `vscode-port.test.ts` is 18 tests over it, falsified rather than trusted (removing the disposal bookkeeping from one fold branch leaves the registration readable as live and fails 1 of the 18). |
| Adapter lifecycle | built | `adapters/sim-vscode/sim-vscode-environment.ts` implements all ten `EnvironmentAdapter` methods and declares the four `VSCODE_ENV` names the application reads. **No editor, no window, no installed VS Code, no extension gallery, no extension host binary and no `require('vscode')` that a real editor supplied**: what answers the extension's calls is a generated module plus tables maintained in process. |
| Observation vocabulary | built | `core/environment/vscode-observation.ts`, so no validator imports an adapter. The eighth family needed **no core change** beyond this and the name registration - the sixth sample of that claim, and the one that carries seven declared surfaces beside its refusal vocabulary. |
| Validator family | built | `validators/vscode/` - seventeen validators, 55 tests, falsified at 50/55 and 52/55. It adds **no new step kind**: the extension is provisioned over `run` exactly as `sim-posix`, `sim-os` and `sim-container` are driven, and the two `activate`/`invoke` vectors are how a criterion reaches into the host. Five of the seventeen are targetless, because `host`, `identity`, `engine`, `activation` and `message` are questions about the world itself. |
| Evidence, honestly bounded | built | The only evidence kind this world produces is `json` - there is no page and no trace archive - and `snapshot-restore` is refused by name rather than downgraded to a restart. The capability warning is derived from the artifacts actually written, so it cannot print "produces `json` and cannot produce `json`". |
| Demo | built | `examples/sim-vscode/` - four deliberate defects, twenty-three criteria, `npm run demo:vscode`, exit 0. Measured on run `run-20260915-040826-1bb0f2`: iteration 1 `FAIL`s exactly `AC-014`, `AC-015`, `AC-016`, `AC-017` - the four filed criteria - and each subsequent iteration removes one, so the failing count descends `4 -> 3 -> 2 -> 1 -> 0`; iteration 5 is `PASS` on all twenty-three with `23/23 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| Regression tests | built | `tests/sim-vscode-demo.test.ts` (30), `tests/sim-vscode-environment.test.ts` (45), `adapters/sim-vscode/vscode-port.test.ts` (18), `validators/vscode/vscode-validators.test.ts` (55), plus a `vscode` case in `tests/environment-gaps.test.ts` and the `vscode` roster entry in `tests/readme-rosters.test.ts`. |

**What the eighth world settled.** `core/` changed by an observation vocabulary and a name, for the
sixth time. The claim this world was built to make is the sharpest of the series: the subject can be
an *API* rather than a machine, and the reading can be a record of what the application **did to a
host** rather than what it provisioned or what it said. No criterion in this world reads the
application's own narration of itself - they read the extension's registered contributions, its
invocations, the value it wrote to `globalState`, the line it logged, the message it showed and the
status item it created.

**One host process per action, and why that is a fact rather than an implementation detail.** There
is no long-lived host to poke; each `activate`, `invoke` and `reload` starts a fresh process, and
every one of them activates the extension. So `vscode.activation` reporting `2` is a statement about
processes, not about a counter the world kept, and a criterion that expects the extension to have
been activated once must be a criterion whose world was touched once. The cumulative transcript is
the same fact from the other side: `output`, `messages` and `invocations` carry across a reload while
durable state is shared, so a criterion reads a *history* and the test suite asserts that history is
unchanged by two independent readings.

**What the four defects are, and why they are all in one file.** Each defect edits the extension the
application ships - the value it keeps in `globalState`, the line it logs, the message it shows, the
status item it writes - and each is filed against exactly **one** criterion. Nothing here is a
control the way `sim-container`'s D3 is, because nothing here is a consequence chain: the four
readings are four independent surfaces of one host, so the progression `4 -> 3 -> 2 -> 1 -> 0` is the
loop's own iteration order made visible. A defect table that moved many criteria per entry would be
unreadable in a world whose whole subject is that four surfaces are recorded separately.


### Phase D: the HTTP-service world, and what the ninth adapter proved

| Step | Status | Evidence |
|------|--------|----------|
| Client | built | `adapters/local-api/api-port.ts` - the global `fetch` with an `AbortController`, `redirect: "manual"`, and a client that **never throws**: a timeout or a transport failure comes back as an `ApiAnswer` whose `error` is set, because that is an observation about the service rather than a crash in the harness. Falsified rather than assumed: forcing `fetch` to reject reports an exchange with a stated error instead of propagating. |
| Adapter lifecycle | built | `adapters/local-api/local-api-environment.ts` implements all ten `EnvironmentAdapter` methods, declares `STEP_KINDS_PERFORMED` with **`call: true` and every other kind `false`**, and refuses a request whose path leaves the service's own origin by name. It starts a real child process and waits for the readiness line the service prints on stdout - `cart-api listening on http://127.0.0.1:4327` - so readiness absence fails in `probe()` rather than in the provisioner. **Nothing is stood in**: no substitute, no generated module, no table maintained in process. |
| Observation vocabulary | built | `core/environment/api-observation.ts`, so no validator imports an adapter. The ninth family needed **no core change** beyond this and the name registration - the seventh sample of that claim, and the first made by a world with no `simulated` field, which is what makes it the strongest one: a family whose world is entirely real still fits the seam. |
| Validator family | built | `validators/api/` - eight validators (`service`, `exchange`, `status`, `header`, `body`, `bytes`, `json`, `log`), 69 tests, falsified seven ways. It adds **no new step kind**: every criterion acts with `call`, the kind the sixth world introduced. Three target grammars live in one family on purpose - a bare position, `<position>:<header>`, `<position>/<pointer>` - because an exchange, a header and a JSON value are three kinds of thing. |
| Evidence, honestly bounded | built | The only evidence kind is `json` - there is no page to screenshot and no trace archive - and `snapshot-restore` is unsupported with `reset.strategy: restart`. The capability report is derived from the artifacts actually written. |
| Demo | built | `examples/local-api/` - four deliberate defects, eight criteria, `npm run demo:api`, exit 0. Measured: iteration 1 `FAIL`s exactly six criteria and passes `AC-001` and `AC-008`; each subsequent iteration removes defects in criterion order, so the failing count descends **`6 -> 4 -> 3 -> 2 -> 0`**; the final run is `PASS (COMPLETED, 5 iteration(s))` with `8/8 mandatory criteria passed, environment valid, no safety violation, evidence complete.` The bundle holds **23 files**. |
| Regression tests | built | `tests/local-api-demo.test.ts` (17, falsified to 15/2 by moving a JSON pointer off its response and swapping a header target), `validators/api/api-validators.test.ts` (69), plus an `api` case in `tests/environment-gaps.test.ts` and the `api` roster entry in `tests/readme-rosters.test.ts`. |

**What the ninth world settled.** `core/` changed by an observation vocabulary and a name, for the
seventh time - and this time the world it was changed for is not a simulation. That is the claim the
series had not yet made: the seam is not "how we bolt on substitutes", it is "how a world is described
to a validator", and a real world uses the same description. The eighth world could still have been
read as evidence about simulating things; this one cannot.

**Why the contract makes the requests, and why that is the whole point.** Every earlier world judged a
service by watching the application talk to it. Here a criterion issues its own request, so the
reading is about the **interface** rather than about one session with it - a criterion can ask for a
route the application never touches, and can read the status line, the headers and the byte count of a
response the application never received. It also means the world can be judged for things no
application would ever ask about itself: `api.header` on the version header, `api.bytes` on a
body length, `api.log` on the line the service printed to stdout, which is the one part of a service's
behaviour no response carries.

**Why two of the four defects had to be controls before there could be a headline.** `D2` (a creation
answered `200` instead of `201`) and `D3` (an absent sku answered `200` instead of `404`) are each read
by exactly **one** criterion. `D1` (dollars read as whole units, so `$10.00` becomes 10 cents) moves
**two** - `AC-002` and `AC-003`, because every price and the cart total are computed from the same
function. `D4` (the version header stated as `3` where the service declares `2`) moves **two** more -
`AC-006` and `AC-007`, because AC-007 reads the header on two positions of a response chain. Two
criteria never move at all: `AC-001` and `AC-008` pass on every iteration. So the reader watches one
edit move one reading twice before watching one edit move two, and watches two readings sit still
throughout - which is what makes the movements attributable to the edits rather than to a flaky world.

**Why all four defects are in one file.** `server.mjs` is the single file every defect is an overlay
on, which is RULE 24 in `AGENTS.md`: a defect table's blocks must all live in one file, so a defect in
another file has to be moved into the defective file rather than given its own table. `toCents` was
authored in `catalog.mjs` and moved into `server.mjs` for exactly this reason - a table whose entries
live in two files is a table whose `correct`-form assertions need two reads and two line-ending
conversions, and the second one is the one that gets forgotten.

### Phase D2: the program world, and what the tenth adapter proved

The second world in the series that substitutes **nothing at all**, and the first whose subject is a
program rather than a page, a file of rows, a service or a substitute. A real program is started as a
real child process, and it is judged on the text it printed on stdout and on stderr, the code it exited
with, a probe of whether it is still up, and the files it really wrote under a real directory.

| Area | Status | Detail |
|------|--------|--------|
| File probe | built | `adapters/local-process/process-port.ts` - reads a world-relative path under a root, bounded at `MAX_TEXT_BYTES`, and never throws for a condition the reading has a field for. Its seam takes the **accession** (the host path this machine can open), never the declaration, because the declaration is what the reading records. |
| Adapter lifecycle | built | `local-process-environment.ts` implements all ten lifecycle methods. It starts the program named by `start`, waits for the readiness line `cart-build audit daemon ready`, and performs `run` steps only - it declares no step kind of its own. `PROCESS_ENV` names the three variables the application reads (`VERIDIAN_PROCESS_HOST`, `VERIDIAN_PROCESS_ROOT`, `VERIDIAN_PROCESS_APP`). **Nothing is stood in.** |
| Observation vocabulary | built | `core/environment/process-observation.ts` - the tenth family's reading, carrying a command record (argv, state, exit code, both streams, duration), a file record, and the renderings the validators compare. The tenth family needed **no core change** beyond this file and a name registration: the **eighth** sample of that claim, and the **second** made by a world with no `simulated` field. |
| Validator family | built | `validators/process/` - twelve validators, all of them exercised by the demo: `host`, `probe`, `argv`, `state`, `exitcode`, `run`, `stdout`, `stderr`, `file`, `kind`, `contents`, `size`. 77 tests, falsified three ways rather than trusted. It has no new step kind. It is the only family asked two different kinds of question, so it carries **two target grammars** and the validator - not the spelling - chooses between them: `app` or a bare 1-based position names a command, a world-relative path names a file. |
| Evidence, honestly bounded | built | The evidence kinds are `json` and `log`, and there is no `simulated` field at all, because nothing is stood in. A path that leaves the root is refused by the adapter and recorded as a **boundary crossing** rather than reported as a missing file. |
| Demo | built | `examples/local-process/` - four deliberate defects, nine criteria, `npm run demo:local-process`, exit 0. Measured: iteration 1 `FAIL`s exactly six criteria and passes `AC-002`, `AC-007` and `AC-009`; the defects are repaired in criterion order, so the failing count descends **`6 -> 3 -> 2 -> 1 -> 0`** over five iterations and four repairs; the final run is `PASS (COMPLETED, 5 iteration(s))` with `9/9 mandatory criteria passed, environment valid, no safety violation, evidence complete.` The bundle holds **37 files**. |
| Regression tests | built | `tests/local-process-demo.test.ts` (19, falsified 3/3), `validators/process/process-validators.test.ts` (77, falsified 3/3), a `process` case in `tests/environment-gaps.test.ts`, the `process` roster entry in `tests/readme-rosters.test.ts`, and a `**built**` row in this document's own world table that `tests/simulated-surfaces.test.ts` reads both ways. |

**What the tenth world settled.** `core/` changed by an observation vocabulary and a name, for the
eighth time. The ninth world made that claim about a real world; this one makes it about a real world
whose subject has no socket in it at all - and the sharpest form of the claim is that a criterion here
acts with `run` because there is nowhere to put a `call`. The step register is not the frame around
the worlds; the worlds are the frame around the step register, and this is the one that proves it by
adding no vocabulary to it.

**Why the reading carries `sandbox` rather than the path that resolved to it.** Whether a criterion
passed originally depended on how the operator spelled their `--goal`: the same tree, run twice with a
relative path and with an absolute one, gave exit 0 and exit 1, with a single criterion the only mover.
The reading now records the world's **own** spelling of the declaration, and the host path is produced
by a separately named reader of the same field - so the two cannot be conflated by a future edit. A
field that is both an input to the world and an output of the recording is two fields in one slot.

**Why a defect table needs controls before it can have a headline.** `D2` (a stray-file list emptied,
so `verify` reports nothing wrong), `D3` (a banner misspelled) and `D4` (a narration line written to
stderr instead of stdout) are each read by exactly **one** criterion - `AC-005`, `AC-001` and `AC-006`.
`D1` (a release version constant) moves **three** at once, and each is a separate true consequence of
one edited constant: the version appears in the build summary, again in the verifier's summary, and
again inside the manifest the program writes. So the failing count falls by three the first time -
`6 -> 3` - and by one each time afterwards. Three criteria never move at all: `AC-002`, `AC-007` and
`AC-009`. That is what makes the movements attributable to the edits rather than to the world.

**Why `D4` had to be retargeted, and why the retarget is now a guard.** `D4` was first filed against
`AC-006` while its block edited the **stderr** branch inside `verify()` - a line `AC-006`'s code path
never executes - so the criterion it named could never have moved however many iterations the loop ran.
Nothing failed, because the demo still descended to zero: the defect had *some* effect somewhere else,
and a table written from the defects' own names agreed with the names. It now edits `add()`'s own
narration, and the guard that holds it is a row probe: apply the block, run the program, read what the
world answers. A defect's `criterionId` is a claim that its block sits on that criterion's code path,
and the only way to hold that claim is to compile, inject, run and watch.

### Phase C8: the message-broker world, and what the eleventh adapter proved

The first world whose subject is a **wire protocol** rather than a document shape, and the first that
is no-HTTP and socket-bearing at once. A real application process is started as a real child process,
it is handed an address through its environment, and it speaks a real length-prefixed request/response
protocol over a real TCP socket on loopback. What is substituted is the **broker** - topics,
partitions, records, groups, committed offsets, a coordinator and a meter. **Three things are
deliberately not on that list, because they are not substituted at all: the socket, the bytes, and the
record the client sent.** That is the line `sim-cloud` drew, drawn again for the same reason: a
broker's interface *is* a socket, so a provisioning program that printed command vectors would be
*describing* requests rather than making them.

| Step | Status | Evidence |
|------|--------|----------|
| Frame layer | built | `adapters/sim-data/wire.ts` codes and decodes the length-prefixed frames the client really writes, so a malformed frame is rejected as **bytes** rather than as a JSON field. Every read is bounds-checked and every failure is a `WireError` naming the byte offset it stopped at, because reading past the end and producing `undefined` arithmetic is how a truncated frame becomes a criterion that passes for the wrong reason. 30 tests. |
| Protocol table | built | `adapters/sim-data/protocol.ts` holds `DATA_APIS` - twelve APIs by key and version: `Produce 0 v0,v2`, `Fetch 1 v0,v2`, `ListOffsets 2 v0,v1`, `Metadata 3 v0`, `OffsetCommit 8 v2`, `OffsetFetch 9 v1`, `FindCoordinator 10 v0`, `JoinGroup 11 v0`, `Heartbeat 12 v0`, `SyncGroup 14 v0`, `ApiVersions 18 v0`, `CreateTopics 19 v0`. `dataApiSpelling(api)` renders one as `${name}(${key}) v${versions}`, which is the spelling the reading carries - so a criterion's expectation reads `ApiVersions(18) v0` and never the bare `ApiVersions`. **A member of a vocabulary has to be looked up through the world's own spelling.** 43 tests. |
| The substitute | built | `adapters/sim-data/data-port.ts` - a real TCP listener, a register of five command words (`create-topic`, `produce`, `fetch`, `metadata`, `commit`), and **seven results rather than a boolean**: `ok`, `unknown-api`, `unsupported-version`, `unreadable`, `invalid-request`, `corrupt-message`, `refused`. Each is a different repair and each names a different place to look, and collapsing any two produces a report naming a cause the world did not observe. 48 tests. |
| Adapter lifecycle | built | `adapters/sim-data/sim-data-environment.ts` implements all ten `EnvironmentAdapter` methods, performs `run` steps, and waits for the readiness line the application prints - `cart-broker provisioned: N requests, N topics, N records`. `DATA_ENV` names **five** variables (`VERIDIAN_DATA_CLUSTER`, `VERIDIAN_DATA_NODE_ID`, `VERIDIAN_DATA_HOST`, `VERIDIAN_DATA_PORT`, `VERIDIAN_DATA_BROKER`), three of which are one address in three spellings taken from one `listen()` call. The shipped application reads exactly two of the five - `VERIDIAN_DATA_HOST` and `VERIDIAN_DATA_PORT`, both with defaults - and never reads stdin, which it could not: `nodeProcessRunner` spawns with `stdio: ["ignore", "pipe", "pipe"]`, so a program that prompted would get an immediate EOF rather than a hang. **`snapshot-restore` is really performed** here, and refused by name in `sim-container` for the opposite reason: an account's state is *pure* - topics, records, groups and offsets, all in this process's memory, with no live child behind any of them - so copying it and putting it back really is a restore. |
| Observation vocabulary | built | `core/environment/data-observation.ts` carries the request record (api, result, source), the topic and partition readings with the renderings the validators compare, and `DATA_SIMULATED_SURFACES` - seven declared surfaces (`broker`, `replication`, `group-coordination`, `log-storage`, `retention`, `transactions`, `partitioning`). The eleventh family needed **no core change** beyond this file, a `DataPlan` and a name registration: the **ninth** sample of that claim, and the first whose reading begins with bytes the world had to decode before it could name anything at all. |
| Validator family | built | `validators/data/` - thirteen validators: `node`, `topic`, `layout`, `partition`, `record`, `key`, `value`, `group`, `member`, `commit`, `call`, `probe`, `meter`. 121 tests, falsified rather than trusted: changing one character of `renderPartition` (`record(s)` to `records`) fails **3** subtests there and **1** in the demo suite. It adds no new step kind - the three criteria that act in the world do so with `run`, the kind the second world introduced - and one of those expects the world to **refuse** it. |
| Evidence, honestly bounded | built | Its only evidence kind is `json`, written twice per criterion: `<id>.observation.json` for the reading, and `<id>.requests.json` for the traffic the application really sent - written only when there is one, because a world nothing has spoken to has no traffic and an empty file would be an artifact that says nothing while counting as one. The reading **does** carry `simulated`, naming the seven declared surfaces, because this world stands seven things in. A substitute that states its own limits in a constant and carries them into the reading is the same discipline as `replication 3 recorded, isr [1]` and `(declared, not enforced)`: a value that omitted the parenthetical would say a factor *held* when this world has one node. |
| Demo | built | `examples/sim-data/` - four deliberate defects, twenty criteria, `npm run demo:data`, exit 0. Measured: iteration 1 `FAIL`s exactly five criteria (`AC-004`, `AC-005`, `AC-011`, `AC-014`, `AC-015`) and passes fifteen; the defects are repaired in criterion order, so the failing count descends **`5 -> 4 -> 3 -> 1 -> 0`** over five iterations and four repairs, while the passed count ascends `15 -> 16 -> 17 -> 19 -> 20`; the final run is `PASS (COMPLETED, 5 iteration(s))` with `20/20 mandatory criteria passed, environment valid, no safety violation, evidence complete.` The bundle holds **51 files**, including `artifacts/repair-1.log` through `repair-4.log`. |
| Regression tests | built | Seven suites under and beside the world: `adapters/sim-data/wire.test.ts` (30), `adapters/sim-data/protocol.test.ts` (43), `adapters/sim-data/data-port.test.ts` (48), `tests/sim-data-environment.test.ts` (65), `tests/sim-data-demo.test.ts` (27), `tests/data-plan.test.ts` (9) and `validators/data/data-validators.test.ts` (121) - **343 tests**. Plus a `data` clause in `tests/environment-gaps.test.ts`, the `data` roster entry in `tests/readme-rosters.test.ts` and the world-table row in this document, which `tests/simulated-surfaces.test.ts` reads on both sides. |

**What the eleventh world settled.** `core/` changed by an observation vocabulary and a name, for the
ninth time, and this time what has to be described to a validator is not a document a world holds but a
**request an application made** - an api spelling, a result word and the record that came back. The
ninth and tenth worlds made the claim about worlds that are real; this one makes it about a world that is
simulated *and* whose substitution is not a document store, which is the combination the first eight had
not covered. The seam is still "how a world is described to a validator", and the description a
broker-shaped world needs is a decoded frame and a result vocabulary rather than a page, a table or a
byte range.

**Why it is a world at all, given that it adds no capability.** It adds one clause to the detector and
one strategy to the reset register, and nothing to the step register. The clause was necessary: `hasNoHttp`
now carries `data`, because **the question that predicate asks is about the surface, not about the
transport** - without it the ladder would have asked a socket world for a `url`, handed it
`expectStatus: 200`, derived `browser.enabled: true`, and the loader would have refused the pair it had
just been handed. And the strategy was the interesting half: the second adapter in the tree that can
really `snapshot-restore`, and the one that proves the register is a decision rather than a default.

**Why `replication 3 recorded, isr [1]` prints both halves.** This world has one node. A replication
factor of three cannot be honoured, so what the application *asked for* is reported as recorded and the
isr is what the world actually holds. Printing only the factor would claim a redundancy that does not
exist; printing only the isr would hide what the application requested and make the topic look
misconfigured. The pair is the honest reading, and it is carried into the comparison rather than into a
comment - a value that dropped the parenthetical would assert a guarantee.

**Why the defect table needs three controls before it can have a headline.** `D1` (`AC-004`, a topic's
`cleanup` policy read as `compact` where it was created `delete`), `D2` (`AC-005`, the same one
character in a second topic) and `D4` (`AC-014`, a committed offset written one short) are each read by
exactly **one** criterion. `D3` (`AC-011`, a release constant) moves **two** - `AC-011` and `AC-015` -
because the version the provisioner prints and the version it writes into the topics it creates come
from the same constant. So the failing count falls by one, one, two, one - `5 -> 4 -> 3 -> 1 -> 0` - and
the reader watches three single-cause movements before watching one edit move two readings. Fifteen of
the twenty criteria never move at all, which is what makes the five that do attributable to the edits
rather than to a flaky world: a descent that is one edit one reading, three times over, is the control
the fourth defect is read against.

**Why a repairable defect may not sit on the readiness line.** The line this world waits for is
`cart-broker provisioned: N requests, N topics, N records`, and a defect aimed at it would time out
`probe()` and report `INCONCLUSIVE` for a defect whose intent was to be observable - the world would
never come up, so the criterion it was filed against would never get the chance to move. The guard is a
test that applies each defect in turn, asserts the edited program **differs** from the shipped one (the
positive control that stops a stale anchor passing vacuously), and only then asserts the readiness
literal survives. A comment saying "do not aim a defect here" is not a guard; the guard is a test that
applies the defect and re-reads the line.

**Why every roster in this pass was falsified rather than trusted.** Three vocabularies name members of
this world, and each is held by a test that reads both sides - so each was **broken on purpose** before
being believed:

- `tests/readme-rosters.test.ts` reads `README.md`'s layout block and compares every family's printed
  roster against the constant the code exports. It covers `data` **by discovery** - it derives the
  family list from `validators/` through `tests/helpers/validator-families.ts` rather than holding it -
  so the eleventh family needed no entry, which is the fix made one family earlier after a hand-written
  list had gone stale. Deleting `data.meter` from the README failed the comparison naming the missing
  name and exited 1; restoring it returned `2/2/0`.
- `tests/simulated-surfaces.test.ts` reads `DATA_SIMULATED_SURFACES`, this document's world table and
  the row's `Status` cell, and requires all three to agree. Dropping `retention` and inventing a surface
  failed it twice, each with both sides printed.
- The family's own rendering was falsified at its source: changing one character of `renderPartition`
  (`record(s)` to `records`) failed **3** subtests in `validators/data/data-validators.test.ts` and
  **1** in `tests/sim-data-demo.test.ts`, and reverting returned `148/148/0`.

**A list of names in a document is a claim about the code, and a number in prose is one too.** That is
why the counts in this section are the run's own figures rather than figures remembered from the
plan, and why the two falsifications above are recorded beside the numbers they license rather than
stated as intentions.

### The twelfth demo: Veridian's own client, and the claim no adapter can make

The first demo in this tree whose application is **Veridian itself** - the compiled VS Code Cockpit -
and the first that adds no adapter, no validator family and no step kind. It runs the `sim-vscode` world
unchanged, so the world table above is still the whole of what that world substitutes. What is different
is *what gets installed into it*: `examples/vscode-cockpit/` stages the real build product -
`extension/vscode/out/` plus the manifest, the icon and the licence, **read out of the manifest's own
`files` allowlist rather than restated** - inside the world's own app tree, because `resolveHostPath`
refuses anything outside it. It is a *copy of another generated tree*, and both trees are ignored
(`examples/vscode-cockpit/app/extension/`, `examples/vscode-cockpit/app/sandbox/`).

| Step | Status | Evidence |
|------|--------|----------|
| The world | reused, unchanged | `sim-vscode`, and this demo is the reason "the tests passed" and "the thing works" are separable claims: the application here is a build product, not a committed sample. |
| The application | staged, never committed | `npm run demo:cockpit`, eleven criteria, exit 0. Measured: `PASS (COMPLETED, 1 iteration(s))`, `11/11 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| `D1` - `registerCommand` discarded the promise its handler made | found | `void handler().catch(...)` handed `undefined` to every caller that chained on the registration. The Cockpit's 72-test suite and its 15-check compiled-artifact smoke test were green **before and after** it. |
| `D2` - `openPath` used an answer it never checked the shape of | found | `workspace.openTextDocument` was `.then`-ed with no guard, so a host that refused became `Cannot read properties of undefined (reading 'then')` shown to the user - also green through both suites. |
| Falsification, not trust | measured | Patching each defect back into the **staged compiled artifact** moved **exactly one** criterion each: `D1` -> `AC-008` `FAIL` / `ABORTED` (10 passed, 1 not passed), `D2` -> `AC-010` likewise; restoring the artifact returned the run to `PASS 11/11` with complete evidence. |
| Refusal rather than a skip | built | With no `extension/vscode/out` the demo **refuses by name** and names `npm run build`, because a skipped check reports a green suite. |

**The falsification had to reach past the registry.** `vscode-port.ts` is not a member of the world's
`MODULE_REGISTER`, so no registry edit could have exercised it - the probe patches the bytes of the
staged compiled file, and its golden copy is taken from a **known-good** state, because a snapshot taken
after the artifact was already patched turns the control into a second copy of the defect.

**And the artifact a reader would download was the pre-repair one.** The `.vsix` attached to `v0.2.1`
was built before the repair (`121,551 bytes`, SHA-256 `0F4DC415...`), and expanding it and reading
`extension/out/host/vscode-port.js` found the discard present and the shape guard absent - and the
**VS Code Marketplace was serving that same `0.2.1`**. A version a marketplace already serves cannot be
replaced, so the version moved to `0.2.2` and both repairs are in its compiled bytes. The rule this
repository now holds is the one `smoke:dist`, `smoke:out` and `smoke:vsix` already applied one runtime
out, applied to the artifact that leaves this machine: **after every repackage, read the attached asset
back and hash it.** `v0.2.2` was read four ways - downloaded back byte for byte (`122,078 bytes`,
SHA-256 `45B8196F...`), its `vscode-port.js` read for both repairs, its manifest read for `0.2.2`, and
the release API queried for its asset list. The same read was performed for the `0.3.0` build before
it left this machine, with the one difference that the archive was measured where `npm run package`
wrote it rather than downloaded back, because the upload is the maintainer's step (below): `122,183
bytes`, SHA-256 `A352EB79...`, 12 entries, and `npm run smoke:vsix` 34 checks, exit 0. **That figure
did not reproduce, and the release carries no asset at all.** Re-measured at HEAD the `0.3.0` archive
is `122,304 bytes`, SHA-256 `FB089839...`, 12 entries - so the note quoted a build this tree does not
produce - and `gh release view v0.3.0 --json assets` answers `assets: []`. The four-way read was never
owed to that release because it was never performed on it; `0.4.0` is the first release whose archive
is attached, and the read is discharged there. *An upload's success line is not the evidence - and
neither is a figure recalled in a note about one.*

**Regression tests.** `tests/vscode-cockpit-demo.test.ts` (8 tests) holds what a test can hold about a
demo whose artifact the root gate does not build: the identity it pins, the validators and evidence
kinds it names, the pointer set the adapter requires, the environment names the adapter declares, a
readiness count assembled from the array the program wrote, and both ignore rules - each **falsified**
rather than trusted, since a bumped identity and a renamed ignore rule each failed exactly one subtest
and were reverted. `vscode.identity` pins the version the staged manifest declares, so a version bump
moves that expectation in the same pass. And `tests/demo-rosters.test.ts` (4 tests) holds the `demo:*`
roster a reader is offered against the scripts the manifest declares, after `demo:vscode` and
`demo:data` were found declared, shipped and documented - and named in neither command block of
`AGENTS.md`.

### Phase C9: the handset world, and what the twelfth adapter proved

The first world whose subject is a **handset**, and the third whose provisioning surface is a command
stream rather than an API. A real application process is started as a real child process, it is handed
a device store through its environment, and it provisions the substitution by printing **command
vectors on its stdout**. What is substituted is the **device**: boot state, installed bundles with
their versions, permissions and grants, deep links, notifications, keychain entries and per-bundle log
lines. There is no emulator, no image, no booted system and no hardware anywhere in the loop.

| Step | Status | Evidence |
|------|--------|----------|
| The substitute | built | `adapters/sim-mobile/mobile-port.ts` holds the boot state, the installed bundles with their versions, the permissions and grants, the deep links, the notifications, the keychain entries and the per-bundle log lines, and answers its register of commands in process. **Four results rather than a boolean, because each is a different repair**: `MOBILE_ACTION_RESULTS` names `answered`, `absent`, `refused` and `failed`, so a command the world does not implement is `refused` while a resource it does not hold is `absent` - two different words for two different observations. 49 tests. |
| The one real spawn | built | a launch really starts a child through `core/process.ts`, and the world applies the launch deadline itself - so an activation count is a count of processes rather than of intentions. This is where the substitution stops, and it stops there on purpose. |
| What it refuses by name | built | a path outside both the application's own tree and the world's sandbox is **refused and recorded** rather than resolved, and the refusal is recorded as a **boundary crossing**, because opening the developer's own filesystem while calling it the device's is the one thing this world must not do. |
| `rebuild()` keeps the record | built | `calls` and `escapes` deliberately survive a reset, because the boundary record describes the **run** and not the world. Clearing them would destroy the evidence of an early crossing and leave a later iteration free to report a clean run - the shape of false pass M3 exists to refuse. |
| Redaction rather than omission | built | a recorded command keeps its shape and replaces its value: a keychain value is never written into a bundle while the **digest** of it is, so a criterion asking whether the value was written is answerable without the value being in the evidence. |
| Adapter lifecycle | built | `adapters/sim-mobile/sim-mobile-environment.ts` implements all ten `EnvironmentAdapter` methods, performs `run` steps, and waits for the readiness line the application prints - `com.veridian.cart provisioned: N files, N commands`. `MOBILE_ENV` names **four** variables (`VERIDIAN_MOBILE_SANDBOX`, `VERIDIAN_MOBILE_WORKSPACE`, `VERIDIAN_MOBILE_DEVICE`, `VERIDIAN_MOBILE_PLATFORM`), and the split between the first two is the same one `sim-container` draws: `sandbox` is a host path this machine can open, `workspace` is a path inside the device that no `run` step may name. |
| Observation vocabulary | built | `core/environment/mobile-observation.ts` carries the reading (`mobile.device`), the reference grammar, the renderings the validators compare and `MOBILE_SIMULATED_SURFACES` - nine declared surfaces (`device`, `emulator`, `touch-os`, `display`, `input`, `sandbox`, `keychain-service`, `app-store`, `push-service`). The twelfth family needed **no core change** beyond this file, a `MobilePlan` and a name registration: the **tenth** sample of that claim. |
| Validator family | built | `validators/mobile/` - twelve validators: `device`, `os`, `screen`, `orientation`, `bundle`, `installed`, `permission`, `deeplink`, `notification`, `logs`, `call`, `probe`. Five are targetless because the world itself is their subject, and the two distinguished by *who asked* carry the inversion two earlier families established: `mobile.call` reads the request the **application** put to the device, `mobile.probe` the one the **criterion** issued. 48 tests. |
| Evidence, honestly bounded | built | its only evidence kind is `json`, and the reading carries `simulated` naming the nine surfaces, because this world stands nine things in. A substitute that states its own limits in a constant and carries them into the reading is the same discipline as `(exposed)` and `(declared, not enforced)` one world earlier. |
| Demo | built | `examples/sim-mobile/` - four deliberate defects, twenty-five criteria, `npm run demo:mobile`, exit 0. Measured: iteration 1 `FAIL`s exactly five criteria (`AC-005`, `AC-007`, `AC-013`, `AC-015`, `AC-016`), and the defects are repaired in criterion order, so the failing count descends **`5 -> 4 -> 2 -> 1 -> 0`** over five iterations and four repairs. The final run is `PASS (COMPLETED, 5 iteration(s))` with `25/25 mandatory criteria passed, environment valid, no safety violation, evidence complete.` |
| Regression tests | built | `adapters/sim-mobile/mobile-port.test.ts` (49), `validators/mobile/mobile-validators.test.ts` (48) and `tests/sim-mobile-demo.test.ts` (34), beside `tests/sim-mobile-environment.test.ts`. Plus a `mobile` clause in `tests/environment-gaps.test.ts`, the `mobile` roster entry in `tests/readme-rosters.test.ts`, the `demo:mobile` entry in `tests/demo-rosters.test.ts` and the world-table row in this document, which `tests/simulated-surfaces.test.ts` reads on both sides. |

**Why the defect table needs three controls before it can have a headline.** `D1` (`AC-005`, the
orientation the application asks the device for), `D3` (`AC-013`, the permission key a grant names) and
`D4` (`AC-015`, the notification title) are each read by exactly **one** criterion. `D2` (`AC-007`, a
release constant) moves **two** - `AC-007` and `AC-016` - because the version the bundle carries and
the version the notification body carries come from the same constant. So the failing count falls by
one, then two, then one, then one: `5 -> 4 -> 2 -> 1 -> 0`, and the reader watches three single-cause
movements before watching one edit move two readings. The criteria that compare a **length** rather
than a value do not move with it, because `1.5.0` is the same length as `1.4.0` - which is why the
reach is four criteria and not six, and why a descent that is one edit one reading, three times over,
is what makes the fourth reading attributable to the edit rather than to a flaky world.

**Why two worlds' file allowances had to be widened in the same pass.** The allowance a world hands
the process runner named the world's own sandbox tree and not the tree beside it, so an application
whose provisioning writes in both was refused a write the world had itself told it to make. It was
found by **running** the demos rather than by reading the adapters, and it was found twice: the
container world and the handset world carried the same shape, the second of them because the rule had
been paid for at the first and not restated at the next. Both allowances now name the world's context
root **and** the sandbox tree, and both demos were re-measured afterwards: `npm run demo:container`
`27/27`, `npm run demo:mobile` `25/25`, both exit 0. *A rule paid for at one world and not restated at
the next is a rule that has not been learned; the second occurrence is the one that proves it.*

**Why the readiness line is guarded rather than commented.** The line this world waits for is
`com.veridian.cart provisioned: N files, N commands`, and a defect aimed at it would time out
`probe()` and report `INCONCLUSIVE` for a defect whose intent was to be observable - the world would
never come up, so the criterion it was filed against would never get the chance to move. The guard is
a test that applies each defect in turn, asserts the edited program **differs** from the shipped one
(the positive control that stops a stale anchor passing vacuously), and only then asserts the
readiness literal survives. A comment saying "do not aim a defect here" is not a guard; the guard is a
test that applies the defect and re-reads the line.

**And every claim in this section that a guard can hold is held by one.** The world-table row is read
on both sides by `tests/simulated-surfaces.test.ts`, and that guard was **falsified four ways** rather
than trusted - a surface the constant does not declare, a surface the document omits, a surface the
constant renames, and a duplicate - each firing by name and each restored byte for byte. The demo's own
34 tests were falsified three ways in the same pass. *A green suite is evidence that nothing has broken
yet; the evidence that a rule is held is what happens when it is broken on purpose.*

