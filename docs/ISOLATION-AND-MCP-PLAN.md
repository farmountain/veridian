# Isolation and MCP: the plan for the last gap

**What this document is.** The implementation plan for the remaining work in the gap-closure
programme. Its predecessor, [`GAP-CLOSURE-DESIGN.md`](./GAP-CLOSURE-DESIGN.md), designed seven work
items (W1..W7) and ordered them; [`GAP-CLOSURE-PLAN.md`](./GAP-CLOSURE-PLAN.md) was the implementation
plan for **one** of them (W2) and said so in its own first paragraph. This document is the same kind of
plan for what is left, and it opens with the measurement that decides how little that is.

**The finding that shapes everything below.** Six of the seven W-items are **built and guarded**, and
the two obligations the request treats as open gaps - boundary enforcement, and clarification threaded
through the entire lifecycle - are **already closed**, measured rather than argued. What is left is
**W6**, whose half that could not be finished and verified in the same pass as W1 was designed and
recorded instead of stubbed. That half is two things, and they are not equally buildable here: an
**isolation substrate** (blocked on this machine, provable in CI) and an **MCP surface** (greenfield,
zero-dependency, and provable here today).

So this plan presents the W-list's true state first, specifies only what remains, and is explicit about
which half can be executed on this machine and which half cannot.

---

## 1. The W-list, measured against the tree

Every row is a reading of the code at `827f0d4`, not a restatement of the design that proposed it. The
figure that matters is in the last column: **seven items, six built, one designed.**

| # | Item | Spec | Evidence in the tree | Status |
|---|------|------|----------------------|--------|
| W1 | Confinement at the seam | `GAP-CLOSURE-DESIGN.md:244`, §9 | `ProcessRequest.confinement` (`core/process.ts:62`); `ProcessConfinement` (`:41`); `ConfinementResult` reported on both the handle and the result; all **twelve** adapters read it | **built** (`51ec23f`) |
| W2 | `sim-mobile`, the twelfth world | `:301` | `adapters/sim-mobile/mobile-port.ts` (49 tests / 14 suites); `validators/mobile/` (12 names); `examples/sim-mobile/` (4 defects, 25 criteria); `demo:mobile` | **built** (`238e8ec`) |
| W3 | Documentation currency | `:354` | `IMPLEMENTATION-PLAN.md` §1 now carries a `Status` column; two rows were **split** rather than edited; `tests/implementation-plan-status.test.ts` holds the vocabulary | **built** |
| W4 | Playwright as an optional peer | `:378`, §10 | `package.json` carries `peerDependencies` **and** `peerDependenciesMeta.playwright.optional`; `tests/package-manifest.test.ts` holds both spellings | **built** |
| W5 | The ladder as a measured claim | `:402`, §12 | A guard over the register **and** a run exercising all seven origins, run **twice** inside one invocation (`npm run acceptance:ladder`); §12.5's falsification ledger | **built** |
| W6 | The isolation seam and the MCP gate | `:459` | This document. `core/**` holds **zero** occurrences of `mcp` | **built** - both halves: `core/environment/isolation.ts` (E1) and `mcp/server.ts` (E2) |
| W7 | HipCortex: the refusal is the record | `:479`, §11 | `HttpMemory#post()` carries the substrate's own stated cause; `tests/memory-port.test.ts` holds both halves of the refusal/unreachability discrimination; `AGENTS.md`'s memory section carries the rule | **built** |

**Two things this table is not.** It is not a claim that the W-list was a poor plan - the opposite: six
of seven items were executable as specified, which is why they landed in the order §7 predicted
(`W1 (S) → W3 (S) → W4 (S) → W5 (M) → W2 (M) → W6 (-) → W7 (S)`), with W6 correctly last because it
was the one item the design expected to be unprovable here. And it is not a claim that nothing remains.
**What remains is not a work item but an obligation**, and W6 is where the difference is sharpest: the
design named it *"designed and recorded, not built"*, and that sentence went stale in **both** halves -
E1 landed as phase 07 and E2 as `mcp/` - so the row above records them as built while this paragraph
used to repeat the design's verdict. It is kept here as a correction rather than deleted, because the
failure is the one this program keeps meeting: a status is a reading of the tree, and the design's
sentence was a reading of the design. What is genuinely left for W6 is the same thing every `built` item
carries - keeping it true - and the phase index's open table names it, runs and all.

---

## 2. The eight obligations, restated against measurement

The programme was issued as eight statements. Each is reproduced, then answered with what was measured
rather than with what it sounds like.

| # | As stated | Measured | Answer |
|---|-----------|----------|--------|
| 1 | Real OS-level or VM sandboxing; local and simulated worlds still run on the host | `node --permission` confines **filesystem** and **child processes** for **all twelve** worlds - every adapter hands the runner a `confinement:` allowance (`local-api-environment.ts:668`, `local-db-environment.ts:548`, `local-process-environment.ts:936`, `local-web-environment.ts:806`, `sim-cloud-environment.ts:770`, `sim-container-environment.ts:615`, `sim-data-environment.ts:725`, `sim-k8s-environment.ts:682`, `sim-mobile-environment.ts:208`, `sim-os-environment.ts:643`, `sim-posix-environment.ts:608`, `sim-vscode-environment.ts:685`), and `--allow-child-process` is requested by none of them, so a confined child spawns nothing further. `network` is confined for **two** (`local-web`, `local-api`, each because it has a guarded front door), is `unenforceable` for **one** (`local-process`, because **Node has no `--allow-net`**) and is `unsupported` for the **nine** that remain | **E1**, and its substrate is absent here by measurement |
| 2 | Full boundary enforcement vs honest reporting; "active enforcement is still incomplete across every world" | The sentence is **true for `network`** and **false for `filesystemWrite`**: all twelve adapters derive that dimension from `this.#confinement?.applied === true` | **W1, landed.** The residue is the substrate, i.e. E1 |
| 3 | MCP Level-3 and a polished external-agent repair protocol | `PLAN.md` §23 **already defines the three levels**; Levels 1 and 2 are built; Level 3 names **fourteen rows across two sections** (§23's **six**, §45's **eight**) - **nine** spellings of **eight** capabilities - of which **zero** exist. The repair gate exists, is transcript-bearing and has four implementations | **E2** - and the gate's own condition is now met (§4.2) |
| 4 | Documentation currency | Two rows of `IMPLEMENTATION-PLAN.md` §1 were factually wrong; both are fixed and the vocabulary is guarded | **W3, landed** |
| 5 | Playwright as an optional peer | The manifest declared no peer at all, so the one dependency Veridian degrades around was stated in prose only | **W4, landed** |
| 6 | Worlds declaring limits they do not enforce | True for `network` (nine worlds) and for `sim-container` / `sim-data`'s stated limits; **false for `filesystemWrite`** | **W1, landed**; W2 writes its limits *into* the value its criteria compare |
| 7 | HipCortex operational continuity | A refusal arrives as `HTTP 403 precondition blocked: PII risk=...`, which is a content precondition and not an outage; the port reports the substrate's own cause | **W7, landed** |
| 8 | All sandbox environments planned, **fully implemented** | **All twelve worlds are `built`.** `DISTRIBUTION-AND-ENVIRONMENTS.md` §5's world table has no `planned` row left, and every phase A1..C9 exists | **answered: nothing remains `planned`** |

**Obligation 8's answer is the reason this plan is short.** The request anticipated an inventory of
unbuilt worlds. The inventory is empty: eight simulated worlds and four entirely real ones are
registered, each with a validator family, a demo and a bundle. That is a fact about the repository and
is held by `tests/demo-rosters.test.ts` (the manifest, both command blocks and the workflow name the
same fourteen scripts), `tests/simulated-surfaces.test.ts` (each simulated world's declared surfaces)
and `tests/boundary-roster.test.ts` (which world answers which enforcement value).

---

## 3. What is actually left, in two halves

W6's spec (`GAP-CLOSURE-DESIGN.md:459`) is one item covering two unrelated absences. Reading it as one
piece of work is what made it deferrable; reading it as two is what makes one of them executable now.

- **E1 - the isolation substrate.** A mechanism that can confine a world that `node --permission`
  cannot, so that `network` stops being `unsupported` for nine worlds and `unenforceable` stops being a
  permanent answer for `local-process`. **It was recorded here as "not buildable on this machine (no
  container runtime; the `Dockerfile` is CI-only by precedent, and Docker is installed nowhere here)",
  and that sentence was wrong in the way this repository keeps paying for: a name stood in for a
  capability.** `docker` is indeed absent; `podman` 5.7.1 is installed at
  `C:\Users\user\AppData\Local\Programs\Podman\podman.exe`, with a machine named
  `podman-machine-default` that existed and was **stopped**. Two readings made the absence look total
  and neither was a measurement of what the sentence claimed: `podman version --format
  '{{.Client.Version}}'` answers `5.7.1` on a stopped machine, because a *client* version is a fact
  about the installed program and only `{{.Server.Version}}` comes back from something that can run a
  container; and the check above looked for one runtime's name rather than asking whether *any*
  runtime answered. `podman machine start` succeeded and a real container ran. **E1 is built** --
  `core/environment/isolation.ts`, adopted by `local-process`, recorded in the bundle as
  `boundary.substrate`, and measured by `scripts/probe-isolation.ts` and an `isolation` CI job. See
  `docs/phases/07-the-isolation-substrate.md`.
- **E2 - the MCP surface.** The third declared integration level, greenfield, requiring **no new
  dependency**, and provable here today by starting a real child process and driving it over its own
  protocol. It was recorded here as *executable in this session*; **it is built**, and built the way the
  sentence above describes rather than the way it was sketched: `mcp/server.ts` (49,652 bytes),
  `mcp/tools.ts`, `mcp/protocol.ts`, with `mcp/server.test.ts` (43,112 bytes) holding its decisions and
  an `MCP surface` CI job that **spawns the real server as a child and drives it over a real pipe** -
  the half no fake can prove. The register is **eight** tools, which is §4.2's *nine spellings of eight
  capabilities* with the `get_result` / `get_validation_result` pair collapsed to one spelling, and
  `tests/mcp-demo.test.ts` pins it: a ninth tool fails, naming it.

  **The layering rule outlived the gate, which is the reading worth keeping.** §3.2 records the rule as
  *MCP is a surface over Core, and `core/**` must still contain no `mcp` when E2 lands*; it landed, and
  `core/**` still contains **zero** occurrences - re-measured with a search over `core/**/*.ts` rather
  than recalled from the plan. A gate whose condition is met is an authorization, and the rule it
  protected was restated as a guard before the work began, which is why the authorization did not spend
  it.

The two are independent. E2 does not need E1's substrate and E1 does not need E2's protocol. They were
deferred together only because both were "the part that could not be finished and verified in the same
pass as W1" - a statement about *that pass*, not about either item.

### 3.1 E1 - the isolation substrate

> **Discharged and built.** The plan below specified the contract and deferred the substrate to a
> CI-proven phase. It landed as **phase 07** - the port is `core/environment/isolation.ts`, the world
> that adopted it is `local-process`, and the job is `isolation` in the CI workflow - and it was
> built **and falsified on this machine**, not only in CI. The blocker paragraph is kept beneath this
> note in the form it took, because the way it was wrong is the point: it measured `docker` and
> `node --permission`, both truthfully, and **never measured `podman`**, which answers here. Read the
> block for the two readings it took and not for the conclusion it drew from them.

**The seam is not what is missing.** `EnvironmentAdapter` is the seam, and it has been proven twelve
times over: twelve worlds, four of them entirely real, and - per `core/environment/`'s layout row - a
validator family that needed no core change to exist, ten times running. `PLAN.md` §42 already assigns
the right mechanism per subject:

```
Web/API            -> process/container
Linux service      -> container
Untrusted OS exec  -> VM / MicroVM
Windows, macOS     -> VM / host strategy
Android, iOS       -> emulator / simulator
Kubernetes         -> isolated cluster/namespace
```

and closes with the rule this plan must respect: **"Do not prematurely force every environment into
containers. The adapter abstracts this complexity."** A substrate is therefore an *opt-in capability a
world declares it uses*, never a migration and never a default.

**What is missing is a substrate, and the blocker is a measurement rather than an opinion.** `docker`
is not on `PATH` here; `node --permission` accepts `--allow-fs-read`, `--allow-fs-write` and
`--allow-child-process` and rejects `--allow-net` with `bad option`, exit 9 - measured with a positive
control. A substrate that supplies network isolation therefore cannot be built *or falsified* on this
machine, and a substitution with no way to be refused is the one thing §6 of
`DISTRIBUTION-AND-ENVIRONMENTS.md` forbids:

> A file implementing `EnvironmentAdapter` whose methods return empty observations is worse than no
> file: it makes the adapter list look complete while every criterion against it is `INCONCLUSIVE`.

**Both of that paragraph's readings are still true, and the conclusion drawn from them was false -
which is the part worth keeping.** `docker` really is absent from `PATH` here, and
`node --permission --allow-net` really does answer `bad option: --allow-net` at exit 9. What the probe
never did was look for the runtime that answers *in place of* `docker`: `core/environment/isolation.ts`
tries `podman` **first**, and on this machine it answers a server version at `5.7.1` with the mechanism
`run --read-only --network --volume --workdir`. So the sentence *"cannot be built or falsified on this
machine"* was falsified by phase 07 doing exactly that - a real container ran, and a refusal happened
inside it that would not have happened without it. *A conclusion stated as a consequence of a probe's
readings can outlive the readings without any of them becoming false* - and the missing member was
invisible because the probe asked whether the tool it had in mind was installed, rather than which
runtime would answer. The same omission then appeared in the §5 blocked table of
`DISTRIBUTION-AND-ENVIRONMENTS.md`, which rested on this paragraph for its *no runtime here* reason.

So E1's plan specifies the contract and deferred the substrate **to a CI-proven phase**, which is the
`Dockerfile` precedent exactly: *"Docker cannot be exercised on this machine at all, which is precisely
why the job has to exist."* **The deferral was honoured rather than dropped:** phase 07 landed the port,
adopted it in one world, made the bundle record which substrate held it, and added the `isolation` CI
job - so the CI-proven half exists, and the substrate was additionally falsified locally once `podman`
was found. What remains of E1 is the standing obligation every `built` item carries - keeping it true -
and it is named as such in the phase index's open table.

**The design, stated once.** An `IsolationPort` is a port in the same shape as `ProcessRunner`: a
request naming what to confine and how, a result reporting whether it was applied and by what, and a
capability probe answered once and memoised - because `confinement.ts` already established that shape
and a second shape for the same question is a second thing to keep in agreement. What it must **not**
be is a second implementation of the confinement rule: `core/process.ts`'s runner is *the one place a
child is confined*, and its own doc block says why (twelve worlds have twelve allowances, but
*applying* one is one mechanism). An isolating substrate differs from `confineChild` in **what** it can
hold, not in where the decision is taken, so it slots in behind the same request.

**What each `BoundaryEnforcement` value means for a substrate that really isolates.** The four-value
vocabulary does not change, and that is the point - it was designed so a substrate would not need a new
one:

| Value | Meaning today | Meaning under a real substrate |
|-------|---------------|-------------------------------|
| `enforced` | A mechanism exists, ran, and the record says so | The ordinary case. This is the value E1 exists to grow |
| `unsupported` | No mechanism, and none claimed | The honest answer for a subject the substrate cannot hold. It stays, but it stops being the default |
| `not-requested` | The document did not ask | Unchanged |
| `unenforceable` | A mechanism *should* exist and demonstrably does not, so the absence is a finding about the platform | Stops being permanent for anything the platform **can** do. `local-process`'s `--allow-net` finding is a fact about Node; under a container substrate that world's answer would change, and the vocabulary has a word for the transition |

**The falsification plan, quoted rather than re-invented** (`GAP-CLOSURE-DESIGN.md:467`):

> a container adapter is proven the moment a run inside it refuses a write the host would have allowed
> **and** the bundle records which substrate held it.

Both halves are load-bearing. The first says a refusal happened that would not have happened without
the substrate - the same positive-control discipline `--allow-net`'s absence was measured with. The
second says the *bundle* says so, which is what stops the claim from being a property of the adapter's
code rather than of the run.

**Two documents already deferred this, and a third already bounded it - and the deferral carries a
question the substrate drags back into scope.** E1 must not read as a new proposal.
`GAP-CLOSURE-DESIGN.md:466` (W6) records the built half as *blocked*, states the blocker as a
measurement - no container runtime here - and names the CI-proven phase that would build it; and
`BOUNDARY-ENFORCEMENT.md:208` lists it in §7 *Considered and deferred* as

> | Real filesystem isolation (containers, jobs, a VM) | Out of MVP scope; the adapter interface leaves room for it. |

That row is `AGENTS.md`'s own posture - the MVP runs in a local trusted development mode and the
adapter architecture leaves room for stronger isolation later - written into a design document and left
standing. The third source does not defer a substrate: `BOUNDARY-SPINE-DESIGN.md:19` decides *"Enforce
for real where a child process is started"* and reasons ***"Nothing is promised that was not
measured."*** That is a **bound**, and it is the same rule §42 states from the environment side - which
is why E1 is an opt-in capability a world declares rather than a migration and never a default. So this
plan is not asking whether to defer E1. It is recording a deferral two documents already hold and a
bound a third already sets, and naming the one question a substrate makes askable again:

> A goal whose whole point is isolation, where "no violation observed" is insufficient without
> capability disclosure gating the verdict. That would need a **fourth `rollup` guard**, and the
> decision would be made there rather than here. (`BOUNDARY-ENFORCEMENT.md:218`)

**This plan answers that question by not opening the guard, and records that it did not.** §4 of the
same document settled the non-isolating case: a world with no mechanism records `unsupported`, discloses
it in `environment.json`, and never lets a declaration read as an enforcement. §8 says the isolating
case **would revisit** it. It is revisited here, and the answer is the narrow one - the substrate lands
with disclosure, and whether a *declared but unapplied* boundary should gate the verdict is a change to
the `PASS` rule taken at `rollup` on the evidence of a substrate that exists. A substrate that does not
exist cannot supply that evidence, so opening the guard now would be a rule paid for by nothing. Framed
as **R11**, held as **P-AC-012**, and listed in §9 - because an unanswered question recorded is a
finding, and the same question left unrecorded is a surprise for whoever builds the substrate.

**And the substrate inherits a defect shape from the mechanism it extends** (`BOUNDARY-ENFORCEMENT.md:271`).
The two worlds that confine their child passed `writeRoots: []` when the policy was `sandbox` - *"an
allowance list that permitted nothing"* - while `environment.json` said `enforced` for **every recorded
run**. The mechanism worked and the declaration was right; the boundary the operator asked for was never
held, and nothing in the tree was checking. A substrate whose allowance is empty reproduces that defect
one runtime out, which is why E1's probe must show the **permitted** half works before the refused half
measures anything - exactly the two-stage probe `confinementCapability()` already runs, and the reason
§4.7 requires it of any new mechanism rather than trusting the shape of the call. *An allowance is
falsified by what it permits, not by whether it was passed.*

**Why no port is written this pass.** Because a port with no substrate behind it is unfalsifiable, and
the repository's rule is that an unfalsifiable claim is not a weaker claim but a false one. The same
document reaches the generalisable form of this rule from the opposite direction
(`BOUNDARY-ENFORCEMENT.md:291`): *"fix the seam the defect belongs to, not each of the call sites that
trip over it; three mitigations at three call sites is the signature of a bug one layer down."* An
`IsolationPort` written ahead of a substrate is that shape inverted - a seam introduced with no defect
beneath it and no way to run it, which three call sites would then be adapted to. The plan records the
contract, and the substrate lands in the pass that can run it. **R2.**

### 3.2 E2 - the MCP surface

**The levels are already defined, and two of the three are already built.** `PLAN.md` §23 states them:

| Level | `PLAN.md` §23 says | Measured today |
|-------|--------------------|----------------|
| 1 - Manual | An agent modifies code; a human clicks Validate | **built**: `node cli/veridian.ts validate`, and the Cockpit's commands |
| 2 - File-based feedback | `.veridian/latest-result.json`, `.veridian/latest-failure.md` | **built**: both are written per run and named in `AGENTS.md` as the Level-2 agent feedback artifacts |
| 3 - MCP | Six tools, and §45 names eight more | **built**: `mcp/server.ts` and `mcp/tools.ts` register **eight** tools - the fourteen rows across §23 and §45 collapsed to nine spellings of eight capabilities, and then the duplicated pair collapsed to one spelling |

**That is the measurement the design asked for.** "Level-3" is not a slogan: it is *two levels built and
one level not started*, and the third level's membership is a list of names in a document - the same
shape as a validator roster, and it gets the same treatment (§4.4). **That sentence was true when it was
written and is now one level out of date: all three levels are built.** The table's last row was taken
before E2 landed, and it is corrected in place rather than left as the moment the measurement was taken,
because unlike the counts this repository deliberately keeps at their own date, this row states the
*tree's* status rather than the pass's, and a status is measured.

**The gate's own condition has been met, and this is the plan's most consequential reading.** Both
decisions deferring MCP give the same reason - *"a thin surface after further Core stability, never as
the foundation"* (`GAP-CLOSURE-DESIGN.md:473`) and *"greenfield ... cannot be finished and verified in
the same pass as W1"* (`BOUNDARY-SPINE-DESIGN.md:21`). The second reason is spent: that pass is
finished, and every item it shared a pass with is guarded. The first reason is a condition, and it is
now measurable in the affirmative - twelve worlds, four entirely real; a validator register of twelve
families; an acceptance contract Veridian runs against itself; a Cockpit shipped by three routes. **A
gate whose condition is met is an authorization, not a prohibition.** The rule it protects is
unchanged and is restated as a guard rather than as prose: MCP is a surface *over* Core, and `core/**`
must still contain no `mcp` when E2 lands.

**Why zero dependencies, and why that is not a shortcut.** MCP over stdio is JSON-RPC 2.0 with a small
handshake: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`. That is a
bounded amount of code against three Node built-ins, and this repository's rule is the one `--allow-net`
already demonstrated - *do not add a dependency to solve a local problem*. A dependency here would also
put the protocol version out of the tree's hands, which is exactly what
`tests/package-manifest.test.ts` exists to prevent one layer over.

**Where it sits.** `mcp/` is a **fourth consumer** beside `cli/` and `extension/vscode/`. The layering
rule already provides for it and needs no amendment: `cli/*` may import all of them, and so may
`mcp/*` - the second such layer beside the CLI. This paragraph is corrected in the same pass as §4.5
rather than cited as evidence for it, because **this document carried both statements and only one of
them was right**: the first sentence of this paragraph used to read *"`cli/*` is the only layer allowed
to import all three"* while §4.5, written by the change that landed `mcp/`, already named the second.
`core/**` gains nothing.

**The repair protocol is already built, and E2 exposes it rather than rebuilding it.** The request asks
for "polished external-agent repair protocol". Measured, that exists: `RepairOutcome.transcript`,
`CommandRepairGate`, and `artifacts/repair-<iteration>.log` written **before** the run acts on its
answer, registered with `kind: "log"` and `criterion_id: null` (a transcript backs no criterion and
naming the nearest one would be a claim the file cannot support). What was missing is a *door*: an
agent reaches those files by knowing a path. E2's `get_failure` is that door.

### 3.3 `PLAN.md` says not to build an MCP server, and this plan's answer is a measurement

This has to be answered rather than stepped around, because `PLAN.md:2281` reads `❌ MCP server` under
a heading that says *"What NOT to Build During These Four Weeks"*. A plan that proposes exactly that
file, citing only §23 and §45, would be reading the sections that authorize it and skipping the one
that forbids it - which is the failure mode this repository records as *a guard has to read every
spelling of the thing it is looking for*.

**There are three prohibition lists in `PLAN.md`, and they are not the same list.**

| List | Where | Scope | Names MCP? |
|------|-------|-------|------------|
| What Veridian must not **become** | §3 (`:105`-`:132`), incl. `❌ Kubernetes management platform` (`:121`), `❌ cloud deployment platform` (`:122`) | **Permanent.** It is the scope boundary, and it answers "what is this product" | **No - nowhere in it** |
| Future adapters, **do not start** | §9 (`:365`), incl. `❌ Kubernetes` (`:398`), `❌ cloud` (`:399`), `❌ mobile farm` (`:400`) | **Schedule.** "Out (future adapters - do not start on these)" | No |
| What NOT to build **during these four weeks** | §55 (`:2276`), incl. `❌ MCP server` (`:2281`), `❌ Kubernetes` (`:2282`), `❌ mobile` (`:2283`), `❌ cloud` (`:2285`) | **Temporal.** The four-week MVP window | **Yes** |

**The three lists have already been crossed three times, deliberately, and the crossings are shipped.**
§9 and §55 both say `❌ Kubernetes`, and `sim-k8s` is built (`demo:k8s`, `package.json:44`); both say
`❌ cloud`, and `sim-cloud` is built (`:47`); §55 says `❌ mobile` and §9 says `❌ mobile farm`, and
`sim-mobile` is built (`:54`). So the repository has already read these two lists as **schedule**
prohibitions and crossed three of their entries, each with its reasoning recorded in `AGENTS.md` and
`DISTRIBUTION-AND-ENVIRONMENTS.md`. Whatever those two lists mean, they are not permanent bans - that
question has been decided three times, in shipped code, before this plan.

**What makes each crossing legitimate is the distinction §3 draws, and it is the distinction E2 must
keep.** §3 forbids the *product*: a "Kubernetes management platform", a "cloud deployment platform", a
"mobile farm". What shipped is a **sandbox world whose subject is** a cluster, an account or a handset,
running against a substitute and judged by acceptance criteria. Veridian did not become those products;
it added worlds that can hold them as subjects. §5 of `DISTRIBUTION-AND-ENVIRONMENTS.md` is that
distinction written out as a table - what may be substituted and what never may be.

**Applied to MCP, the same reading gives a narrow authorization and a sharp guard.**

- **The authorization** is §23 and §45: Level 3 is a declared level with a named tool list, and §45's
  own hierarchy is `AVF Core → {VS Code, CLI, MCP} → Environment Adapters`. MCP is a *named consumer of
  Core*, sitting exactly where `cli/` sits.
- **The guard is that MCP appears nowhere in §3** - the one permanent list. So the prohibition that
  survives this plan is not "do not build MCP"; it is **"do not let MCP become an agent orchestration
  framework, an autonomous development platform, or a replacement for Claude Code"**, which §3 does
  name. That is precisely what §45's two sentences exist to prevent: *"Do not make MCP the foundation"*
  (`:1895`) and *"MCP is the door. AVF is the building"* (`:1929`); and §23 says the same thing one
  level up, *"MCP is an interface to AVF, not AVF itself"* (`:1024`).
- **Therefore §55's `❌ MCP server` is spent by the same reading that spent `❌ Kubernetes` and
  `❌ cloud`** - it is a statement about the four-week window, and §23 itself places Level 3 at
  *"Later:"* (`:1006`, under the `## Level 3 - MCP` heading at `:1004`). The four weeks are complete; the MVP is green; twelve worlds have landed. What
  §55 was protecting - an MVP that proves the architecture instead of accumulating surfaces - is
  exactly what the intervening work produced.

**The one thing this reading does not license, stated so it cannot be read as permission.** E2 builds a
surface and nothing else. It adds no orchestration, no scheduling, no loop, no model call, and no
decision about *how* to fix code - the second governing rule in `AGENTS.md` says Veridian *"does not
build the intelligence that creates the software"*. An MCP tool that reasoned about a repair would be
§3's forbidden product wearing a protocol, and §4.2's door rule is what makes that structurally
impossible: **an MCP tool may not be the first implementation of anything.**

**Expected failure if this reading is wrong.** If §55 were permanent rather than temporal, then
`demo:k8s`, `demo:cloud` and `demo:mobile` would each be a violation already shipped, and the plan's
first obligation would be to explain three repositories' worth of prior work rather than to add a
fourth. That is the falsification, and it is checkable in two commands. Both were **run** rather
than reasoned about, and the second returned more than the six entries this section names - which is
the reading, not an error in it:

```powershell
(Select-String -Path package.json -Pattern 'demo:(k8s|cloud|mobile)').Count          # 3
(Select-String -Path docs/PLAN.md -Pattern '\u274c (Kubernetes|cloud|mobile)').Count # 8, not 6
```

**The two extra matches are the whole argument.** They are `❌ Kubernetes management platform`
(`:121`) and `❌ cloud deployment platform` (`:122`) - §3, the permanent list - and they match a
pattern written for §9 and §55 because **§3 and §55 name the same noun and prohibit different
things**. §3 prohibits the *product*; §55 prohibits the *four-week scope*. A match over the whole
document therefore cannot decide which list a line belongs to, which is the repository's own recorded
rule arriving one document out: *`tests/observation-vocabulary.test.ts` asked its question of the whole
document and would have passed with the enumeration two families short.* The list a line sits in is a
fact about its **heading**, and §3.3's table is scoped by heading for exactly that reason. Read the
eight and file each one: two are permanent product prohibitions, six are temporal scope prohibitions,
and not one of them is about MCP except the single line in the temporal list.

---

## 4. E2 in executable detail

The format follows `GAP-CLOSURE-PLAN.md`: every claim is measured at a file and an anchor rather than
recalled, every guard is named with the failure it is expected to produce, and every claim carries the
probe that would falsify it.

### 4.1 The files that land

| File | What it is |
|------|-----------|
| `mcp/protocol.ts` | The register of methods and the JSON-RPC error codes this server can answer. **The authority on how each method is spelled**, in the same role `adapters/sim-data/protocol.ts` plays for its twelve APIs |
| `mcp/tools.ts` | The eight-tool register: name, description, input schema, and the Core capability each projects |
| `mcp/server.ts` | The transcript loop: read a frame, dispatch, write a frame. Never throws - a bad request is a JSON-RPC error, which is an answer |
| `mcp/server.test.ts` | The suite over the loop and the register |
| `tests/mcp-demo.test.ts` | The roster guard over the documents (§4.4) |
| `scripts/mcp-smoke.mjs` | The fourth artifact check: spawn the real server as a child and drive it, because a suite that imports the loop has not proven the *program* works |

### 4.2 The eight tools, and the capability each projects

The two documents name **fourteen** rows between them - §23's **six** and §45's **eight** - covering
**nine** distinct spellings of **eight** capabilities. **One capability is spelled twice**: §23's
`get_result` and §45's `get_validation_result` are the same question, and §45 alone adds
`start_environment` and `snapshot_environment`, which §23 does not name. So the plan fixes one spelling
and records the duplicate, rather than shipping two tools that answer the same thing. That is the
roster defect this repository records four times (`db.query`, `db.rowCount`, `web.visible`, and the
observation vocabulary) arriving at another vocabulary, and it is caught before it ships rather than
after.

| Tool | Core capability it projects | Exists today as |
|------|----------------------------|-----------------|
| `create_environment` | `EnvironmentManager` lifecycle + `cli/worlds.ts`'s register | `create()` |
| `start_environment` | the same | `start()` |
| `run_validation` | the execution loop | `veridian validate` |
| `get_result` | the reading the loop writes | `.veridian/latest-result.json` |
| `get_failure` | the Level-2 feedback artifact **and** `artifacts/repair-<iteration>.log` | `.veridian/latest-failure.md` |
| `get_evidence` | the bundle's artifact ledger | `artifacts/AC-00N.observation.json` |
| `reset_environment` | the first-class reset | `reset()` |
| `snapshot_environment` | snapshot/restore | `snapshot()` / `restore()` |

Two properties of this table are the plan's, not the design's:

- **Every capability already exists.** That is the door rule held as a measurement: an MCP tool may not
  be the *first* implementation of anything. If a capability is missing, the tool is missing, and the
  gap is a Core gap rather than a surface gap.
- **`get_failure` is the only tool that reads two files.** It reads the failure for the run and, when
  one exists for the run's last iteration, the actor's transcript - because a reader asking "why did
  this fail" wants the reasons *and* whoever repaired it, and two calls to learn one thing is the
  surface inventing a protocol Core does not have.

### 4.3 What the server must refuse, by name

Three refusals are part of the contract rather than edge cases, because each is a way a tool could
report something it did not observe:

- **No run to read.** `get_result` against an empty history answers a JSON-RPC result with
  `isError: true` and a stated reason naming the command that produces one. It does **not** answer with
  an empty object, because `{}` reads as "a run that passed nothing" rather than "no run".
- **A world this build does not register.** `create_environment` names the registered worlds it holds,
  read from the register and not restated, so a world added later cannot be absent from the refusal.
- **A tool that does not exist.** An unknown `tools/call` name answers `-32602`, and an unknown
  *method* answers `-32601`. The distinction is the same one `sim-k8s`'s control plane paid for when it
  merged `404` and `405`: *a resource that is absent and a request that is refused are two different
  observations.*

### 4.4 The guard the register trips

`PLAN.md` §23 and §45 are two lists of one vocabulary, and a list of names in a document is read by
nothing that could disagree with it. So the third vocabulary gets the treatment the first two got:

- **`tests/mcp-demo.test.ts`** parses §23's and §45's tool lists out of `PLAN.md` - fourteen rows,
  nine spellings - collapses the one capability the two lists spell twice (`get_result` /
  `get_validation_result`) to the single spelling R4 fixes, and pins `MCP_TOOLS` to the resulting
  **eight**, so a ninth tool invented by an implementer fails, and a tool dropped from the register
  fails as *missing* rather than passing silently. The guard collapses rather than asserting a bare
  union, because a bare union is nine names and the register is eight - and *a set comparison made
  against the wrong side of a spelling collision passes for the wrong reason.*
- The same file asserts **`core/**` still contains zero occurrences of `mcp`**, which is "MCP is the
  door" held as an executable rule rather than as a sentence. This is the mirror of
  `extension/vscode/src/host-boundary.test.ts`, which holds "only the two host files may import
  `vscode`" the same way.
- The same file asserts every tool's name matches the surface naming rule the register declares, so a
  camel-cased or hyphenated name fails at the register rather than at a client.

**Expected failures.** Adding a ninth tool fails the roster comparison, naming it. Deleting a tool from
the register fails it as missing. Putting a line containing `mcp` into any file under `core/` fails the
door check, naming the file and the line.

### 4.5 The layering rule, stated once

```
core/*        must NOT import adapters/*, validators/*, cli/* or mcp/*   # unchanged, and now larger
validators/*  must NOT import adapters/*
cli/*         may import all of them
mcp/*         may import all of them, and imports core/* only through its public entry points
```

The first line is the one E2 changes: `mcp/*` joins the list `core/*` may not import. It is written
here because the rule is enforced by hand and nothing else enforces it, and because a new layer is
exactly the change that makes a stale rule look current.

**The prediction was measured, and it came true in five places.** The rule is stated in full in six
places - here, `README.md`'s layering paragraph, `AGENTS.md`'s rules block, the layering block in
`.github/instructions/typescript.instructions.md`, the one in `docs/IMPLEMENTATION-PLAN.md`, and this
document's own §3 paragraph on where `mcp/` sits - and by the time `mcp/` had landed, **five of the
six** still named three prohibitions for a four-layer tree or else named `cli/*` as the only consumer
layer. This section is the one that was right, and it was right because it was written by the same
change that landed the layer. Nothing failed: a rule enforced by hand has no guard over its own
prose, and `tests/mcp-demo.test.ts` holds the *code* clause - `core/` must name the surface nowhere -
and not the documents. All five were corrected, and they were found by **grepping for the rule's
spelling** rather than by reading any of them, which is the only method that reaches a statement
sitting in a file the change never opened.

**Two of the five were reachable only by widening the search, and that is the part worth keeping.**
The first pass looked for the rule's *prohibition* wording - `must not import`, `must NOT import`,
`may not import` - and found four. Two copies state the same rule through an **exclusive marker**
instead: `README.md` and this document's §3 paragraph above both said `cli/*` was *"the only layer"*
allowed to import all three, and neither sentence contains the words "must not import" anywhere. A
grep whose pattern is the phrase the searcher already has in mind finds only the copies that use that
phrase, so the alternation has to carry the exclusivity words beside the prohibition ones - which is
the only reason either was found before the layer's own change was written up. *A rule stated in prose
can only be found by searching for it, and the search is only as wide as the spellings it names.*

A seventh site, `core/environment/web-observation.ts`, states two of the clauses as the reason that
file exists and names no consumer layer at all, so `mcp/` did not make it false and it is not counted
above. *A citation of a rule is not a statement of it, and a count that includes both is a count that
will be corrected again.*

### 4.6 The artifact check, and why the suite is not enough

`smoke:dist`, `smoke:out` and `smoke:vsix` exist because each of those artifacts is covered by
*nothing* in either test tree: the suite runs `.ts`, and what ships is `.js`, or `.js` under an
extension host, or a zip. **An MCP server is a fourth such artifact**, and the reason is sharper than
the others: its whole interface is a *child process reading stdin and writing stdout*. A suite that
imports the loop and calls `dispatch()` has proven the dispatcher and not the program. So
`scripts/mcp-smoke.mjs` spawns the real server, writes real frames, and asserts:

- the `initialize` result names a protocol version it supports;
- `tools/list` returns exactly the registered names;
- `tools/call` for `get_result` against a populated history returns a parsed reading;
- the same call against an empty history returns `isError: true` with a stated reason;
- an unknown method returns `-32601`, and an unknown tool name returns `-32602`;
- **the process exits 0 on stdin close**, because a server that outlives its client is the orphaned
  application `core/process.ts`'s doc block already warns about. What makes that true is the handler's
  own `process.exit(0)` rather than the event loop draining - measured, and the reason §4.7's fifth row
  is worded the way it now is.

**Where it is invoked from, because a check nothing runs is a check that cannot fail.** The script is
declared once, in `package.json`, as `"smoke:mcp": "node scripts/mcp-smoke.mjs"`, and executed by a
seventh CI job whose name is `MCP surface`. It is a **job of its own** rather than a step inside
`distribution` because everything that job does needs `npm run build` and this check does not - the
source tree is the program - and the workflow's own header frames its jobs as answering different
questions. It is deliberately **not** inside `gate`: measured, `"gate": "npm run typecheck && npm
test"` names two commands and no artifact check, which is the precedent `smoke:dist` set - an artifact
check is a command a caller runs on purpose, and a gate that spawned a server would make every local
run need a free pipe. Nor is it a `demo:*` script, so it does not enrol in the rosters
`tests/demo-rosters.test.ts` derives from the manifest; the obligation it owes is the other one, that
**a declared command is executed rather than only described**, and the seventh job is what discharges
it.

### 4.7 The falsification probes

Each is a probe to run *at the moment the claim is made*, in the register §12.5 established: patch,
run, read the failing subtest's **name**, restore byte for byte, and print what was detected.

| Claim | Probe | Expected |
|-------|-------|----------|
| The roster matches the documents | Add a ninth tool to `mcp/tools.ts` | Fails naming it |
| The door rule holds | Insert `mcp` into a `core/` file | Fails naming the file and line |
| An empty history is an error, not an empty result | Make `get_result` answer `{}` on no run | Fails the "no run" subtest |
| `-32601` and `-32602` are different | Merge the two branches | Fails the subtest that names each |
| The server **terminates** on stdin close | Replace the close handler's `process.exit(0)` with a `setInterval` | `mcp-smoke.mjs` fails on *the process exits 0 when its input closes*, not the suite - which is the point of it existing |
| The smoke test can fail | Point it at a path the build does not produce | Exits 1 naming the path |

The last two are the pair that matters: **a smoke test that cannot fail is a formality**, and
`smoke:out` was falsified exactly this way before it was trusted.

**Row 5's probe was wrong as first written, and only running it could say so.** It read *"remove the
close handler"*, and that probe **does not fire**: deleting `lines.on("close", ...)` from
`mcp/server.ts` leaves the answer still arriving - measured 6 of 6 spawns, one request written per
spawn with stdin ended immediately after - and leaves the process exiting 0, because Node keeps the
loop alive for a pending pipe write while the frame is still on its way out, and nothing in that
state had set an exit code. Both of the first two explanations for the handler were therefore wrong,
and each was eliminated by a measurement rather than by an argument: it is not what makes the process
exit, and it is not what guarantees the frame is delivered. What it *is* is the guarantee that
termination survives a handle the request does not own, and the probe that fires is the one above -
measured, `smoke: FAIL the process exits 0 when its input closes - the server had not left after
10000 ms`, exit 1, with the other seven checks still `ok`. `node --test mcp/server.test.ts` is green
in both states, which is the whole reason `scripts/mcp-smoke.mjs` exists as a second artifact check.

**An expected outcome written into a plan row is itself a claim, and this one was false.** A probe
that does not fire is not a claim that has been disproved and not a probe to be adjusted until it
does; it is a question about the mechanism, and the honest response is to go and read the mechanism.
Five of these six fired as written and the sixth was re-derived from what the patch actually moved.

**All six have now been run end to end, 6 of 6, and the re-run is what makes the table a table rather
than a plan.** The harness patches one file at a time, and every patch is composed through **that
file's own line ending** - the repository has paid for a hard-coded `\n` three times now - with the
anchor's presence and the edit's effect asserted *before* anything is written, so a stale anchor fails
loudly instead of silently reducing coverage. Restores happen in a `finally` and print
`restored: byte for byte`, and each patch is undone **before** the next one is composed. The verdict is
computed **only** from the declared `breaks` names appearing in the scraped failing-test names - never
from a substring of the run's output, which is a question about a document rather than about what
moved - and the failing-test scrape is `^\s*not ok`, because a subtest's line is indented under its
suite's and a column-zero anchor prints the suite's name and reports the reverse of what happened.
Row 5 carries a second, `also` control that runs `node --test mcp/server.test.ts` expecting exit 0 in
**both** states, because the entire reason this artifact check exists is that the suite is green either
way: without that control, "the probe fired" and "the suite is blind to this" are two claims resting on
one measurement. Measured after the last restore, sha256 first 16 upper: `mcp/server.ts`
`785AB1616CF0B495`, `mcp/tools.ts` `72CCDC6FDE2C16EC`, `core/io.ts` `198E321BDF95F84D`,
`scripts/mcp-smoke.mjs` `1E27D91C51DFB0FF`, and no probe text left behind in a touched file.

---

## 5. Self-prompted recommendations

Rung 4 of the clarification ladder is the rung where a run answers its own gap from material it already
holds, and its safety argument is a single sentence: *it may eliminate a candidate the contract offered,
and it may never invent one.* Each recommendation below is therefore written as an **elimination** -
what it removes from consideration and on what material - rather than as a suggestion. Each names the
material it was derived from, because a recommendation that cannot say what it read is an opinion.

| # | Recommendation | Material it was derived from | Candidate it eliminates |
|---|----------------|------------------------------|--------------------------|
| R1 | **Build E2 now; do not build E1 here.** | `PLAN.md` §23's three levels; `core/**` holding zero `mcp`; `docker` absent from `PATH` | **"W6 is one item, so it lands or it does not."** Its two halves have different blockers, and deferring the buildable half behind the unbuildable one is what left it unbuilt |
| R2 | **Do not write an `IsolationPort` with no substrate behind it.** | `DISTRIBUTION-AND-ENVIRONMENTS.md` §6's stub prohibition; the `Dockerfile` precedent | **"A port plus a test double is progress."** A port nothing implements is unfalsifiable, and §6 already names that file as worse than no file |
| R3 | **Reach Level 3 with zero new dependencies.** | `testFailure` of any kind is absent; `package.json`'s runtime dependency list; the `--allow-net` measurement, which is this repository's own demonstrated rule | **"An MCP server needs the MCP SDK."** The protocol is a bounded handshake over three built-ins, and a dependency would put the protocol version outside the tree |
| R4 | **Fix one spelling for the doubly-named tool rather than shipping both.** | `PLAN.md` §23's `get_result` and §45's `get_validation_result`; the four recorded occurrences of the roster defect | **"Eight rows means eight tools."** §45's eight rows really are eight distinct capabilities, so the collision is *between* the two lists rather than inside either one: fourteen rows, nine spellings, eight capabilities - and shipping both spellings would make two doors to one room |
| R5 | **Make `core/**` containing no `mcp` an executable rule, not a sentence.** | `extension/vscode/src/host-boundary.test.ts`, which holds the identical rule for `vscode` and was falsified before it was trusted | **"The rule is safe because it is written down."** Prose is read by nothing that could disagree with it, which this repository has now recorded four times |
| R6 | **Add a smoke check for the server rather than trusting the suite.** | `smoke:dist` / `smoke:out` / `smoke:vsix`, each of which exists because the suite runs `.ts` and the artifact does not | **"The unit tests cover it."** The program's interface is a child process's stdin and stdout, and no import reaches that |
| R7 | **Record E1's substrate as CI-proven with its falsification quoted.** | `Dockerfile`'s comment; `GAP-CLOSURE-DESIGN.md:467` | **"Unbuildable here means unplanned."** The falsification plan already exists and is two clauses long |
| R8 | **Leave the four `BoundaryEnforcement` values alone.** | `core/environment/types.ts`; §5 of `DISTRIBUTION-AND-ENVIRONMENTS.md` | **"A real substrate needs a stronger vocabulary."** The vocabulary was designed for exactly this transition - `unenforceable` says *the absence is a finding about the platform*, which is a statement that can become false |
| R9 | **Do not promise the request's AWS / Docker / Kubernetes asks as prerequisites.** | The whole corpus, which names no AWS dependency anywhere; `DISTRIBUTION-AND-ENVIRONMENTS.md` §5's three conditions a simulated world must satisfy | **"Testing needs cloud credentials."** Twelve worlds, four entirely real, were validated without one; a simulated world's honesty is a property of its declaration, not of a credit card |
| R10 | **Read `PLAN.md` §55's `❌ MCP server` as a schedule prohibition, not a permanent one - and keep §3's list as the one that is permanent.** | §55's own list, three of whose entries (`❌ Kubernetes` `:2282`, `❌ mobile` `:2283`, `❌ cloud` `:2285`) are built and shipped (`package.json:44,47,54`); §3's list, in which `mcp` does not appear at all; §23's `"Later:"` | **"The plan contradicts `PLAN.md` §55, so MCP is out of scope."** Three of §55's entries were crossed before this plan existed, so it is not a permanent list - and the list that *is* permanent never names MCP |
| R11 | **Do not open the fourth `rollup` guard, and record that the question is open rather than settled.** | `BOUNDARY-ENFORCEMENT.md:218`, which names the isolating goal as the case that would need one, and `:213`, where §8 states the decision is taken at `rollup` rather than in the document that raised it | **"A real substrate makes a declared-but-unapplied boundary gate the verdict."** The `PASS` rule has three clauses and auditing them cost a whole document; a fourth is extended on a bundle from a substrate that ran, and that bundle does not exist |

---

## 6. Acceptance criteria for this plan

Written the way the repository writes them: each is a reading, each has a falsification, and none is
"the code exists".

| ID | Criterion | How it is read | Falsified by |
|----|-----------|----------------|--------------|
| P-AC-001 | E2's register is exactly the tools the two `PLAN.md` sections name, with the once-duplicated capability collapsed to one spelling | `tests/mcp-demo.test.ts` parses both lists, collapses the `get_result` / `get_validation_result` pair, and pins the register | Adding a ninth tool fails, naming it; and a bare union that pins nine fails, naming the pair that was not collapsed |
| P-AC-002 | The door rule holds: `core/**` contains no `mcp` | The same file, reading the tree | Inserting one line fails, naming file and line |
| P-AC-003 | The server is driven as a program, not as a module | `scripts/mcp-smoke.mjs` spawns it and writes real frames | Pointing it at a missing entry fails, exit 1 |
| P-AC-004 | A request for a run that does not exist is an error naming the cause, not an empty result | The smoke check's empty-history case | Returning `{}` fails the case |
| P-AC-005 | An absent tool and an absent method are two different answers | `-32602` vs `-32601`, each asserted | Merging the branches fails |
| P-AC-006 | Every tool projects a capability that already exists | Each tool's handler resolves to a Core entry point named in §4.2 | A tool whose capability is absent fails |
| P-AC-007 | The isolation substrate is recorded as CI-proven, with its falsification quoted | A reading of this document | Deleting the falsification clause fails |
| P-AC-008 | No claim in this plan is made about a machine-dependent fact without its measurement | Every count in §1 and §2 carries its anchor | A count with no anchor fails |
| P-AC-009 | The root gate and the Cockpit gate are both green afterwards | `npm run gate`; `cd extension/vscode; npm run gate` | Any red |
| P-AC-010 | The thirteen demos and the two self-acceptance routes still pass | `npm run acceptance`; `npm run acceptance:ladder`; the demo sweep | Any red, or a run that passes on an inherited world |
| P-AC-011 | The authorization is a measurement: the list that forbids MCP is a **schedule** list and the permanent list does not name it | §3.3's two commands, read rather than recalled; plus `GAP-CLOSURE-DESIGN.md` §6's "no `mcp` under `core/`" reading, which stays true | A finding that `mcp` appears in §3's must-not-become list, or that `demo:k8s` / `demo:cloud` / `demo:mobile` were never shipped |
| P-AC-012 | The isolation deferral is recorded as a decision two documents already hold and a third already bounds, and the verdict-rule question it makes askable again is named rather than silently answered | `GAP-CLOSURE-DESIGN.md:466` and `BOUNDARY-ENFORCEMENT.md:208`, each read at its anchor, plus `BOUNDARY-SPINE-DESIGN.md:19` for the **bound** rather than a deferral; plus `:218`'s fourth-`rollup`-guard question, answered by not opening it | Rewriting a `rollup` guard into this plan's work, or citing `BOUNDARY-SPINE-DESIGN.md:21` as a substrate deferral - that row decides the external-agent contract, not the substrate - and dropping a real citation so a held deferral reads as a new proposal |

---

## 7. The exit condition

The request asks for an exit to avoid indefinite self-prompting and clarifying, and the mechanism
already exists - `IMPLEMENTATION-PLAN.md` §3.5's eight bounds, each checked **before** an attempt, so
the worst case is a bound already reached rather than one over. This plan reuses it rather than
inventing a second one, and states which bound ends which kind of work:

| Situation | Bound that ends it | Resolution |
|-----------|--------------------|-----------|
| A tool whose capability does not exist | **Structural**: this is not an ambiguity, it is a gap | Not built; the gap is recorded as a Core gap |
| Whether to build E1 here | **Structural**: the substrate is absent by measurement | Deferred with its falsification quoted, not circularly re-asked |
| A world the register does not hold | Named in the refusal, from the register | Refused, never adapted to |
| The workspace having no run to read | Stated reason, `isError: true` | Refused; no retry, because retrying reads the same empty directory |
| The whole programme | `maxRuntimeMs`, `maxIterations`, and the repair gate's own answer | Three independent bounds already; the plan adds none |

**The rule that keeps this from being a promise.** `INCONCLUSIVE` is never `PASS`, and a run's
`insufficientInformation: true` with `ABORTED` is an honest answer rather than a failure to be
suppressed. Where E1 cannot be proven here, the correct output is that statement and not a green tick.

---

## 8. What this plan deliberately does not do

- **No stub adapter.** An `EnvironmentAdapter` with no substrate behind it is named worse than no file
  by §6, and R2 is why no `IsolationPort` lands without one.
- **No second implementation of the confinement rule.** `core/process.ts`'s runner is the one place a
  child is confined; a substrate differs in what it can hold, not in where the decision is taken.
- **No new `BoundaryEnforcement` value**, and no widening of the four. R8.
- **No new dependency.** R3.
- **No MCP tool that is the first implementation of anything.** §4.2's door rule.
- **No change to `core/**`.** `mcp/` is a consumer; the core gains no protocol and no surface.
- **No version bump and no release.** A release is a separate decision with its own readback
  discipline, and this plan's work is a plan plus one surface.
- **No fourth `rollup` guard.** R11. The substrate lands with disclosure; whether a *declared but
  unapplied* boundary should gate the verdict is a change to the `PASS` rule, taken at `rollup` on a
  bundle from a world that really isolated - evidence a substrate that does not exist cannot supply.
- **No claim about E1's substrate that this machine cannot falsify.**
- **No AWS, Docker or Kubernetes credential requested**, because nothing in the corpus needs one. R9.

---

## 9. What would falsify each claim

Reusable probes, in the register `GAP-CLOSURE-DESIGN.md` §6 established:

- A tool in `mcp/tools.ts` that no `PLAN.md` section names.
- Any occurrence of `mcp` under `core/`.
- A `get_result` that answers an empty result for a workspace with no run.
- A merged `-32601` / `-32602` branch.
- A smoke check that passes with the entry point removed.
- A substrate claim with no bundle naming it.
- A world reporting an enforcement value its adapter does not derive.
- A demo whose progression does not descend, or that passes on a run it inherited rather than built.
- **An MCP tool that decides how to repair code**, which would cross §3's permanent list rather than a
  schedule one, and which no reading of §55 or §9 can authorize.
- A fourth `rollup` guard appearing in this plan's work before a substrate has run. R11: the guard is
  opened where its evidence is, and its evidence is a CI job that does not exist yet.
- An `IsolationPort` landing with no substrate behind it, which would be a seam with no defect beneath
  it and no way to be refused.
- A count in this document that does not reproduce when re-measured. The rule is `AGENTS.md`'s own,
  recorded as its own entry at `:2033` and restated at `:2709`, and its load-bearing half is the second
  one: a count is *not* held by a test, so it has to be re-measured whenever this document is touched.

---

## 10. The order, and why

```
E2 (M)  ->  E1 substrate (CI, L)  ->  release and readback (S)
```

**E2 first**, because it is the only remaining item that can be finished *and falsified* in one pass on
this machine, and because a plan whose first step cannot be verified is a plan whose first step will be
believed rather than checked. **E1 second**, in CI, because the `Dockerfile` established that a
container route is proven by a job or it is a correct-looking file. **The release last**, because the
archive readback discipline (`scripts/vsix-archive.mjs`, never a glob) applies whatever ships, and none
of the above ships an artifact whose bytes change today.

**One decision travels with E1 rather than sitting in it.** R11 - whether a declared-but-unapplied
boundary should gate the verdict - is not a step in the order, because it is a change to the `PASS` rule
and the evidence that would justify it is the **same job's own output**. The run that proves the
substrate also produces the first bundle able to report `enforced` for a genuinely isolating world, and
that bundle is what a fourth `rollup` guard would be argued from. Until it exists the disclosure in
`environment.json` is the answer, and `BOUNDARY-ENFORCEMENT.md:218` stays an open question rather than a
settled one - which is why R11 says so out loud instead of leaving the next reader to infer that the
silence was a decision.
