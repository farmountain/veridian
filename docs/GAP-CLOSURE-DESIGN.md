# Closing the seven gaps: what is already held, what is left, and the order it is closed in

**Status:** design. **Date:** 2026-09-17. **Base commit:** `da4831e` (tag `v0.3.0`).

This document answers one request: close the seven gaps listed below, "all sandbox environments we
planned and all relevant implementation to be fully implemented", with the clarification /
self-prompting mechanism "included throughout the entire hipcortex lifecycle", implemented "with a
ReAct loop against the goals-driven acceptance criteria", and with an explicit exit everywhere so no
loop is indefinite.

It is a design, not a plan. The plan that executes it is a separate artefact.

---

## 1. How this design was reached, and what was substituted for an answer

The brainstorming protocol this work was executed under carries a hard gate: no implementation and no
scaffolding until a design has been presented and the operator has approved it, section by section,
and its clarifying questions are asked one at a time.

**The gate could not be honoured in the form it is written, for the second time in this
repository.** Every clarifying question put to the operator in this session returned, verbatim:

> The user is not available to respond and will review your work later. Work autonomously and make
> good decisions.

`docs/BOUNDARY-SPINE-DESIGN.md` §1 records the first occurrence and the substitute it adopted:
**every decision taken in lieu of an answer is recorded here with its reasoning, so the operator can
audit the substitution rather than only its result.** That substitute is adopted again, and extended
in one respect - the questions were first *resolved* rather than deferred wherever a rule this
repository already holds could settle them, so that only genuinely undecidable questions reached the
operator's desk at all.

### 1.1 Substitution log - decisions taken in lieu of an answer

| # | Question | Answer taken | Reasoning |
|---|----------|--------------|-----------|
| S1 | What does "fully implemented" mean for isolation (gaps 1 and 6)? | **Propagate the measured mechanism at the seam; design the real-isolation substrate; do not build it here.** | The substrate is *measured absent* on this machine (no container runtime; `Dockerfile` is a distribution route built in CI only). `BOUNDARY-ENFORCEMENT.md` §7 records real filesystem isolation as out of scope; `DISTRIBUTION-AND-ENVIRONMENTS.md` §6 forbids a stub. Building what cannot be run here would produce exactly the unverifiable claim this repository refuses - and the recorded instruction in `BOUNDARY-SPINE-DESIGN.md` §6 already names the narrower work as *"the immediate next step"*. |
| S2 | Should `sim-mobile` be built, or does its recorded deferral stand? | **Build it.** | It is the **only** world row left `planned`, the request names "all sandbox environments we planned", and it is **absent from the blocked table** in `DISTRIBUTION-AND-ENVIRONMENTS.md` §5 - which is the list of things this repository has decided cannot be answered here. A row that is unbuilt rather than blocked, in a request that names every planned world, is the one row with nothing standing behind its deferral. |
| S3 | How should the plan treat HipCortex, whose substrate refuses every write with `HTTP 403`? | **Report the refusal; keep writing; change no product code.** | The client side is already correct and already tested: `IMPLEMENTATION-PLAN.md` §3.7 specifies that a *refusal* is not an unreachability and that the log says so, and `tests/memory-port.test.ts` holds both halves. The gap is operational, not architectural, and the honest response to an operational refusal is a disclosure - the same discipline as `veridian info:` writing to stderr on purpose. |
| S4 | Where does this document live? | **`docs/GAP-CLOSURE-DESIGN.md`.** | Resolved by self-prompting, not deferred: the brainstorming skill says `docs/superpowers/specs/`, but `AGENTS.md`'s documentation index is flat and lists five files in `docs/`, and both existing design documents sit at `docs/*-DESIGN.md`. Creating the first subdirectory in `docs/` would make the index wrong in the same pass - which is gap 4 itself. |
| S5 | In what form is gap 4's correction made? | **In place, with a landed/reversed column.** | The plan's value is as an audit trail, and its assumptions log already establishes the pattern (A5, A11 and A12 are reversals recorded beside the assumptions they reversed rather than replaced). |
| S6 | Is gap 2 closed at the seam or at each adapter? | **At the seam.** | `BOUNDARY-ENFORCEMENT.md` §10 states the rule in this repository's own words: *"fix the seam the defect belongs to, not each of the call sites that trip over it; three mitigations at three call sites is the signature of a bug one layer down."* §2.2 measures that this is the same signature. |

The section-by-section approval the protocol requires is likewise substituted: the design is presented
whole, in this document, with each section stating what would falsify it, so the operator's review is
of a falsifiable artefact rather than of a summary.

---

## 2. The measurements that reframe the request

Five claims were made in prose. Each was measured against the code. Two of them are already true, one
number has drifted, and two are wrong in a way that changes what the work is.

### 2.1 The clarification mechanism is already throughout the lifecycle

The request's headline requirement is that clarity be resolved by self-prompting first and by asking
the operator only where self-prompting cannot, at every stage of the lifecycle, with an exit.

**Measured: this is already implemented, in two registers.**

| Register | Site | Origins covered |
|----------|------|-----------------|
| Build time (DEFINE) | `allDetectors()` in `core/clarification/detect.ts:939`, called from `core/definition.ts:146,174,175,206` | `goal`, `acceptance`, `validation`, `environment` |
| Run time (EXECUTE and after) | `runtimeDetectors()` in `core/clarification/detect.ts:1205-1207`, called from `core/execution/loop.ts:476` | `execution`, `evidence`, `iteration` |

All seven members of `AMBIGUITY_ORIGINS` (`core/clarification/types.ts:10`) have a detector, and each
is in exactly one register. `IMPLEMENTATION-PLAN.md` §3.6's table is therefore **accurate**, not
aspirational - which was worth checking rather than assuming, because the same document's §1 carries
two rows that are not.

### 2.2 The rung order already encodes the request's priority, and the reason is a safety argument

`RUNGS` (`core/clarification/types.ts:42`) is:

```
derived -> inferred -> defaulted -> self_prompted -> answered -> deferred
```

`self_prompted` sits **after** `defaulted` and **before** `answered`, and the comment at the
declaration says why: the governing rule prefers self-prompting over interrupting a person, but a
detector that declared a fail-safe default has already argued that its answer *cannot make the run
report PASS more readily than the truth* - so a self-generated answer may not displace it. The rung
therefore fires exactly where the ladder previously had to ask a human or give up.

**That placement means adding the rung can only reduce human interruptions. It cannot resolve a gap
the run had already decided for itself.** This is the request's stated priority implemented as a
structural property rather than as a policy, and it is the single most important thing in this
section: the priority the request asks for already has a proof, and the proof is the rung order.

### 2.3 The exit condition is already doubly bounded

The request asks for an exit to avoid indefinite self-prompting and clarifying. Measured, the bound is
of two independent kinds and both are checked *before* an attempt is made:

| Kind | Bound | Site |
|------|-------|------|
| Structural | Rungs 1-3, 5 and 6 are attempted once each; only rung 4 repeats | `core/clarification/engine.ts` |
| Per-ambiguity | `maxSelfPromptRoundsPerAmbiguity: 2` | `DEFAULT_CLARIFICATION_POLICY` |
| Per-run | `maxSelfPromptRoundsPerRun: 10` | idem |
| Wall clock | `selfPromptBudgetMs: 60_000` | idem |
| Human interruptions | `maxQuestionsPerRun: 5`, `maxQuestionsPerRound: 3` | idem |
| Whole phase | `budgetMs: 120_000` | idem |

Exhaustion is not an error and not a silent stop: it resolves as `via: "deferred"` with a reason drawn
from `DEFER_REASONS`, which carries seven members including `question_budget_exhausted`,
`time_budget_exhausted`, `no_user_available` and `non_blocking`. The run then reports `ABORTED` with
`insufficientInformation: true` and its criteria `INCONCLUSIVE`.

**The wall-clock ceiling is the bound an attempt cap cannot replace**, and it is not merely
paraphrased from the plan: `core/clarification/engine.ts:264-270` says so in its own words -

> Every bound is checked *before* an attempt, so the worst case is a bound that was already reached
> rather than one that is one over. The three bounds are not redundant: the per-gap cap stops one hard
> question monopolising the effort, the per-run cap stops a contract with forty gaps spending forty
> rounds, and the clock survives a frozen or injected one - which is the only exit an attempt bound
> cannot provide, and an unbounded loop is the one failure mode this system may not have.

and the check order in `#selfPromptFor` matches it: the per-run cap at `:281`, the clock at `:288`,
both *above* the increment at `:294` and the `port.prompt()` call at `:296`. A cap on attempts bounds
work; it does not bound time, because one attempt can be arbitrarily slow. Both are present, and the
second one is the reason a frozen or injected clock cannot hang a run.

**And the bounds are held by tests, not only implemented.** `IMPLEMENTATION-PLAN.md` §6.1 claims of
the clarification layer that "each budget stop fires, including rung 4's three". That claim was
checked against the suite rather than taken from the table, and it holds: rung 4's three bounds each
have a named test - `rung 4 stops retrying one gap at the per-ambiguity cap and defers it`
(`engine.test.ts:448`), `the per-run cap bounds the rounds a contract full of gaps can spend`
(`:469`), and `the wall-clock ceiling is the bound an attempt cap cannot replace` (`:494`) - beside
`stop 4 - with no self-prompt port every rung is attempted once, so the ladder terminates itself`
(`:269`) for the structural bound. So §6.1 is accurate, which was worth checking in the same pass
that found §1 of the same document carrying two rows that are not.

### 2.4 The ReAct loop's exit is itself a ladder resolution

The request asks for the ReAct loop to be implemented against goals-driven acceptance criteria.

**Measured: the loop's continuation decision is a clarification resolution**, and that is the
strongest available evidence that the two mechanisms are one mechanism rather than two features
standing beside each other:

```
resolveIteration(facts)                        core/execution/loop.ts:463
  document  = { iteration, maxIterations, elapsedMs, maxRuntimeMs, verdict, ... }
  gaps      = detectIterationAmbiguities(document, ctx)
  resolved  = await clarifier.resolve(document, gaps)
  decision  = resolved.artifact.decision        -> "continue" | "stop"
```

`CriterionOutcomeLike` (`core/clarification/detect.ts:969`), which `detectIterationAmbiguities`
consumes, carries the criterion outcomes - so the loop asks the ladder whether to take another step,
and the ladder answers from the criterion results. The comment at the declaration states the design
commitment: *"There is one source for the decision and it is the ladder."*

The stop condition is the acceptance contract; `NoRepairGate` makes a run that cannot loop by
construction; and `maxIterations`, `maxRuntimeMs` and the gate's own answer are three independent
bounds.

### 2.5 The number "nine worlds" had drifted; the instruction had not

`BOUNDARY-SPINE-DESIGN.md` §6 records the immediate next step as:

> **Propagating the mechanism to the other nine worlds that start a child.** [...] **It is the
> immediate next step and it is smaller than this one.**

Ten worlds existed when that was written and one of them (`local-process`) confined at the time of
the count, so nine was correct then. Today: **eleven worlds exist, three confine, eight remain.**
The instruction is live; only the figure drifted - the same defect this repository records about a
number in prose, and the reason this document prints a measurement rather than a recollection
everywhere a count appears.

### 2.6 All eleven worlds start a real child, through one seam

This is the measurement that decides gap 2's shape.

| Measure | Result |
|---------|--------|
| `runToCompletion(` across `adapters/**` | **23 call sites in 11 files** - every adapter |
| Adapters that `import type { ProcessRunner }` | **11 of 11** |
| `confineChild(` callers | **3** - `local-api`, `local-process`, `local-web` |
| Adapters reporting `filesystemWrite: "unsupported"` | **8** - `local-db`, `sim-cloud`, `sim-container`, `sim-data`, `sim-k8s`, `sim-os`, `sim-posix`, `sim-vscode` |
| Sites importing `node:child_process` directly | **3 files**, each with a private `#spawn()` - the same three |

And the seam is a single function pair:

```
core/process.ts:18   export interface ProcessRequest { command, args, cwd, env?, onStdout?, onStderr? }
core/process.ts:273  export async function runToCompletion(runner, request, timeoutMs)
core/process.ts:87   export const nodeProcessRunner: ProcessRunner
```

**`ProcessRequest` carries no confinement.** So each of the three confining worlds composes its own
allowance and calls `confineChild` before building a request, and the other eight cannot - not because
their world refuses, but because the request they build has nowhere to put an allowance.

**That is the same signature §10 named**: three mitigations at three call sites where one seam serves
eleven. The correction belongs at the seam.

---

## 3. The gaps, restated against measurement

| # | As stated | Measured | This design's answer | Size |
|---|-----------|----------|---------------------|------|
| 1 | True isolation for untrusted code | Filesystem confinement available and measured. Network confinement `unenforceable` - **proved with a positive control**. Container/microVM substrate absent from this machine | W1 (seam) + W6 (design-only, with its blocker and falsification plan recorded) | M design, L substrate |
| 2 | Full boundary enforcement vs honest reporting | 11 worlds confine 3/11; all 11 spawn through one seam with nowhere to declare an allowance | **W1** | S |
| 3 | MCP Level-3 and polished external repair protocol | **Zero `mcp` in `core/**`** - greenfield. The repair gate exists, is transcript-bearing, and has four implementations | W6 records the gate: its own spec, with a Level-1/2/3 definition so "Level-3" is a measurement. **Not built in this pass** | L, correctly deferred |
| 4 | Documentation currency | `IMPLEMENTATION-PLAN.md` §1 is **factually wrong in two rows**: the Cockpit (built) and Kubernetes/cloud/mobile/VM (six `sim-*` worlds exist). The Level-3 MCP row is correctly still deferred | **W3** | S |
| 5 | Optional Playwright peer | `package.json` has **no `peerDependencies` key**. The honest degradation is built and tested | **W4** | S |
| 6 | Worlds declaring limits they do not enforce | True for `network` (a platform limit, `unenforceable`) and for the declared-not-enforced limits inside `sim-container` and `sim-data` (stated in the compared value). **False for `filesystemWrite` on eight worlds** | **W1** turns the false case into a held one; W2's new world is written with its limits in the compared value from its first line | S / M |
| 7 | HipCortex operational continuity | Code side closed and tested; the substrate refuses writes | **W7** - disclosure, no code | S |
| - | `sim-mobile` | Only `planned` row; **absent from the blocked table** | **W2** | M |

### 3.1 Reconciling "seven gaps" with the "eight-gap request"

`BOUNDARY-SPINE-DESIGN.md` §1 describes its work as W1 of an **eight**-gap request; this request lists
**seven**.

**Reading taken:** the eighth gap is the boundary-enforcement gap that W1 itself closed - the subject
of that document - so these seven are the residual set after that closure. This is stated as a reading
rather than as an established fact, because nothing in the tree records the original eight as a list,
and a reconstruction presented as a measurement would be the defect this document exists to remove.
The correction that follows is that `BOUNDARY-SPINE-DESIGN.md` §6's count is now stale, and W3
corrects it in place.

---

## 4. The work, in the order it can be proven

Every item below is provable **on this machine**. The two items that cannot be proven here - real
isolation and an MCP surface - are designed and recorded rather than stubbed, because
`DISTRIBUTION-AND-ENVIRONMENTS.md` §6's first prohibition is *"no stub adapters"* and its second is
*"a phase is built when it can be proven, not when it can be written."*

### W1 - Confinement at the seam

**Closes:** gap 2's substance, and the false half of gap 6. **Also closes:** `BOUNDARY-SPINE-DESIGN.md`
§6's recorded immediate next step.

**The change, in three moves.**

1. `ProcessRequest` gains one optional field:

   ```ts
   readonly confinement?: {
     readonly readRoots: readonly string[];
     readonly writeRoots: readonly string[];
     readonly allowChildProcess?: boolean;
   };
   ```

   Optional, so every existing caller is unchanged, and `confinement === undefined` means *this world
   did not ask for an allowance* - which is an honest thing for a request to say.

2. The **runner** applies the mechanism, in one place. `nodeProcessRunner` - or the shared step both
   it and `runToCompletion` pass through - calls `confineChild` when the field is present and starts
   the resulting vector. `core/process.ts` may not import `adapters/*`, but `confineChild` lives in
   `core/environment/confinement.ts`, so the import direction is legal and already used.

3. The runner **reports what it did**, so an adapter derives its `boundaries()` answer from a reading
   rather than by recomputing the decision. The existing three worlds already read
   `#confinement?.applied`; the new shape is the same question asked of the runner's answer, and the
   three are migrated onto it in the same pass so that one rule has one implementation.

**Then each of the eight worlds supplies its allowance** - a few lines each, and each genuinely its
own: a `sim-*` world writes into its sandbox and reads its application directory; `local-db` writes
the database it rebuilds and reads the code that builds it.

**Measurable outcome:** `filesystemWrite` moves from `enforced` in 3 worlds to **`enforced` in 11**,
each value derived from a measurement rather than asserted. `network` is unchanged and stays
`unenforceable` where it is a platform limit - W1 does not pretend otherwise.

**Guards.**
- `tests/boundary-roster.test.ts`'s `confines` derivation currently walks `adapters/**/*-environment.ts`
  for a call to `confineChild`. After W1 the mechanism is in the runner, so that derivation would
  report `false` for a world that confines. **It must be re-derived from the world's own answer**
  (`boundaries().filesystemWrite`), because that is the claim the roster is about - the same
  correction `AGENTS.md` records for a capability report that was read off a literal list instead of
  off the writes.
- A real child really refuses a write outside its allowance: the existing `tests/process.test.ts` and
  each world's own suite cover the request shape; one test per new world covers the reading.

**Falsification.** Remove the `confinement` field from one world's request and watch that world's
`filesystemWrite` return to `unsupported` while exactly one named test fails. A guard that has never
been broken is a guard nobody has watched work.

**Why the seam and not eight adapters.** `BOUNDARY-ENFORCEMENT.md` §10. An allowance is a *value*, and
different worlds have different ones - so the field must be per-request. But *applying* it is one
mechanism, and eight copies of the application would be eight places for the claim
`applied: true` to be made without the mechanism having run.

### W2 - `sim-mobile`, the last unbuilt world

**Closes:** the request's "all sandbox environments we planned", and the only `planned` row.

**Shape: the proven one, a fourth time.** `sim-posix` -> `sim-os` -> `sim-container` established it, and
`sim-mobile` is the same shape one family out:

- the application is a **real child process**, started through `runToCompletion`, printing command
  vectors on its stdout;
- the substitute executes them and holds **device records**: a model, an OS name and version, an
  orientation, a screen size and pixel density, installed bundles with their bundle id and version,
  granted and denied permissions per bundle, registered deep links, posted notifications, captured
  application logs, and keychain entries;
- the adapter declares the `MOBILE_ENV` names the application reads;
- **no new step kind** - provisioning is `run`, and a criterion that acts in the world is `call`;
- evidence kind `json`, and `snapshot-restore` refused by name rather than downgraded to a restart,
  exactly as `sim-posix` and `sim-vscode` do.

**`MOBILE_SIMULATED_SURFACES`** is written from the row's own three names (`device`, `emulator`,
`touch-os`) and extended honestly, and the §5 table's status cell moves to **built**. Then
`tests/simulated-surfaces.test.ts` holds the agreement between the constant and the table, which it
already does for the other seven.

**The family's limits are stated in the values its criteria compare, not in a footnote.** The
`container.limit` precedent is explicit about this: it compares `(declared, not enforced)` because a
value that omitted the parenthetical would claim a limit held. So:

- a touch event is `recorded and never dispatched`;
- a screen is `rendered and never drawn`;
- a permission is `declared by the bundle and never prompted for`.

Each of those is part of the string a criterion compares, so a `PASS` cannot be earned by a world that
silently did less than the criterion read.

**`validators/mobile/`** judges `core/environment/mobile-observation.ts` and follows the family
conventions rather than inventing any: lower-case names, the family prefix, a `targetNoun` per
validator so the clarification ladder asks "which bundle" rather than "which element", and renderings
that print what an operator reads. First members: `device`, `os`, `screen`, `orientation`, `bundle`,
`installed`, `permission`, `deep-link`, `notification`, `logs`, `call`, `probe`.

**`examples/sim-mobile/`** carries four defects and a **control structure before a headline**: D2, D3
and D4 each read by exactly one criterion, so a reader watches one edit move one reading; then D1
moves several at once because it is a single true fact with several true consequences. That is the
`sim-container` lesson - *a defect table whose entries all move many criteria has no control in it, and
a demo with no control cannot show that its readings are caused by the edit rather than by the world
being flaky.* The repair counts are read off the run, and the demo's narration asserts them.

**Registered in all four places a world is named:** `cli/worlds.ts`'s `WORLDS` table (with the
requirements it asks as clarification gaps), `cli/validators.ts`'s family list, `package.json`'s
`demo:mobile`, and the rosters in `README.md` + `AGENTS.md` + `.github/workflows/ci.yml` - which
`tests/demo-rosters.test.ts` reads across all four, and which is the fourth occurrence of a roster
that drifted because a list of names in a document is read by nothing.

### W3 - Documentation currency

**Closes:** gap 4.

- `IMPLEMENTATION-PLAN.md` §1's deferred table gains a **landed / reversed** column, in place. The
  Cockpit row reads **landed** (three routes ship, and the extension has its own gate); the
  Kubernetes/cloud/mobile/VM row reads **landed** (seven `sim-*` worlds, with the entry that
  distinguishes a simulated world from a real one, because that distinction is the row's whole
  content); the Level-3 MCP row stays **deferred** with its gate restated.
- `§8`'s "No npm package, and no build step - reversed" entry is already correct and is left alone;
  it is the precedent the new column follows.
- `BOUNDARY-SPINE-DESIGN.md` §6's "nine worlds" is corrected in place with the measurement, and
  marked as a correction rather than silently edited - the same treatment `AGENTS.md` gives a number
  that moved.
- `docs/PLAN.md` is the **product** specification, so its "future" sections stay as they are where
  they describe intent. Only claims *about this repository* are corrected. The distinction is the
  point: a product spec describes what the product is for, and a repository document describes what
  the repository does.

**Guard.** The existing roster guards already read the documents that carry vocabularies. What is
added is one test over the §1 table: every row's `Status` cell is one of the declared values, and every
row naming a directory that exists in the tree does not say `deferred` - because that is precisely the
defect being corrected, and a table is a claim about the tree.

### W4 - Playwright declared as an optional peer

**Closes:** gap 5.

```json
"peerDependencies": { "playwright": ">=1.40.0" },
"peerDependenciesMeta": { "playwright": { "optional": true } }
```

`dependencies`, `devDependencies`, `engines` and `files` are untouched. `package-lock.json`'s root
entry must move in the same pass, because `name`, `version`, `license`, `bin`, `dependencies`,
`devDependencies` and `engines` are each written in two places and reconciled by nothing - the defect
this repository already paid for once, when the lockfile said `UNLICENSED` while the manifest said
`MIT`.

**The degradation itself does not change.** It is already honest and already tested: a world with no
browser is `INCONCLUSIVE`, never `PASS`, and it names the command that fixes it. W4 makes the *route*
declared (a package manager can now say so at install time) rather than documented (a reader has to
find the paragraph).

**Guard.** A test reads the manifest and asserts the peer is declared **and optional**, and that
`README.md` names playwright as an optional peer rather than as a dependency. `AGENTS.md` already
requires the README to be corrected in the same pass as the change that falsifies it.

### W5 - The ladder as a measured claim

**Closes:** the request's headline demand - by *proving* it rather than by adding to it.

The mechanism is already implemented (§2.1-§2.4), and at unit level it is already comprehensively
proven. `core/clarification/engine.test.ts` is 35 tests over the ladder, including all four stops, all
three of rung 4's bounds by name, and - decisively - a **register-driven loop** at `:622` that walks
the origins and asserts of each that "the question a run raises mid-run can be closed without
interrupting anyone". That is the correct shape for a coverage claim (the coverage comes from the
register, not from a hand-kept list) and it is the reason this item is prose-measured rather than
assumed.

**What does not exist is any artefact that demonstrates it as a run.** The build-time four are
exercised by every demo's DEFINE stage and the run-time three by every demo's loop, but **no contract
or criterion names an origin**, so no run has ever reported *which* origin a gap came from, that the
ladder resolved one raised from `evidence`, or that an exhaustion produced a `deferred` resolution
with its reason intact. This is the repository's own `db.query` shape one layer out: the mechanism is
real, the register is right, and the evidence a reader would consult to confirm either is a unit test
rather than a bundle. The distinction W5 exists to close is therefore not "is the ladder tested" (it
is) but "has the ladder ever been *observed*, in a run, doing the work the request asks of it".

**Two artefacts.**

1. **A guard over the register.** Every `AMBIGUITY_ORIGINS` member has a detector, in exactly one of
   the two registers; every `RUNGS` member is reachable; every `DEFER_REASONS` member is producible by
   some path. `tests/schema-vocabulary.test.ts` already holds the ladder against
   `schemas/ambiguity.schema.json` - this is the same idea applied to the origins, and it is the
   extension that keeps gap 4 from recurring in a new vocabulary.

2. **A run that exercises all seven origins**, in the shape `acceptance/` already established: a goal,
   a contract and a world, run **twice** inside one invocation, because *a world a run inherits is not
   a world that run built*. Its criteria are about the ladder's own record - that a resolution is
   present, that its rung is recorded, that a deferred resolution carries its reason, that
   `rungsAttempted` is bounded - so the claim is measured over the run's own `clarifications.json`
   rather than asserted in a document.

**Why this is a work item and not a test.** Because the request's central requirement has been
implemented for several versions and has never been *demonstrated*, and this repository's recorded
rule is that a capability report must be derived from what the code did rather than from a literal
list beside it. A mechanism nobody can watch work is, from a reviewer's chair, indistinguishable from
one that is not there.

### W6 - The isolation seam, and the MCP gate: designed and recorded, not built

**Closes:** the design half of gaps 1, 3 and 6; records the built half as blocked with its reason.

- **Real isolation.** What an `IsolationPort` would be, what each of the four `BoundaryEnforcement`
  values means for a substrate that really isolates (`enforced` becomes the ordinary case, and
  `unenforceable` stops being a permanent answer for anything the platform *can* do), and the
  CI-proven phase that would build it. The blocker is stated as a measurement - no container runtime
  here - and the falsification plan is stated as well: a container adapter is proven the moment a run
  inside it refuses a write the host would have allowed **and** the bundle records which substrate held
  it.
- **MCP.** The gate is restated in the terms this repository holds: its own spec, with a **Level-1/2/3
  definition so that "Level-3" is a measurement rather than a slogan**. What is measured today is that
  `core/**` contains no MCP whatsoever, so the surface is greenfield and the ordering is preserved -
  a thin surface after further Core stability, never as the foundation.

**Explicitly not done: no stub adapter, and no MCP server.** `DISTRIBUTION-AND-ENVIRONMENTS.md` §6
names the first as worse than no file, and `AGENTS.md` states the second as *"MCP is the door. Veridian
is the building."*

### W7 - HipCortex: the refusal is the record

**Closes:** gap 7, as a disclosure rather than as code.

`AGENTS.md` requires a memory write after every decision, architectural choice, fix, reversal or dead
end, through `/memory/ingest`. Measured in this session, the substrate **refuses every write**:

```
HTTP 403  precondition blocked: PII risk=0.90 patterns=["PII:..."]
```

**That is a refusal, not an outage**, and the product already knows the difference - `HttpMemory#post()`
carries the status *and* the substrate's own stated `error`, and `tests/memory-port.test.ts` asserts
that a refused write reports `precondition blocked` and does **not** contain "unreachable", while a
genuine `ECONNREFUSED` still does. So:

- the write is attempted after every decision, and the refusal is reported with the substrate's own
  reason in this document and in the transcript;
- **no product code changes.** Adding a substrate-shaped command to the CLI would grow the surface of
  the thing whose scope boundary says the substrate is a dependency and not the product;
- one line is added to `AGENTS.md`'s memory section recording that the substrate may refuse a write,
  that a refusal is not an unreachability, and that the honest response is to report the reason it
  gave - because a rule that says "write after every decision" and a substrate that refuses every
  write are two facts a reader has to be able to hold at once.

---

## 5. What this design deliberately does not do

- **No stub adapter, and no simulated world that pretends to be real.** The prohibition that survives
  every correction in `DISTRIBUTION-AND-ENVIRONMENTS.md` §5 is the one that matters: never record a
  simulated world as a real one, and never report a verdict a simulation cannot justify.
- **No MCP server.** Designed, gated, and ordered after further Core stability.
- **No real isolation substrate.** Blocked by a measurement, recorded with its blocker and its
  falsification plan.
- **No new step kind.** `sim-mobile` is provisioned with `run` and acts with `call`, both of which
  exist, and neither of which it introduces.
- **No second implementation of the confinement rule.** W1 exists precisely because there would
  otherwise be eleven.
- **No new specification for the clarification mechanism.** It is implemented and it is correct; W5
  proves it rather than redesigning it. Designing what already works would be the overbuilding this
  request's own governing principles forbid.
- **No version bump or release in this design.** What ships and when is the plan's business and the
  maintainer's decision.

---

## 6. What would falsify each claim

A design whose claims cannot fail is a description. Each of the following, if observed, means the
corresponding section is wrong.

| Claim | Falsified by |
|-------|--------------|
| §2.1 every origin has a detector | An `AMBIGUITY_ORIGINS` member with no detector, or one with two |
| §2.2 the rung order encodes the priority | A gap resolvable by `self_prompted` that a fail-safe default had already answered |
| §2.3 the bound is real | A self-prompting round that exceeds `selfPromptBudgetMs`, or a rung 4 attempt that is not counted |
| §2.3 the bounds are held by tests | One of the four named tests (`engine.test.ts:269,448,469,494`) passing with its bound removed - which is the probe, not the reading |
| §2.4 the loop's exit is a ladder resolution | A continuation decision taken without `detectIterationAmbiguities` |
| §2.6 the seam serves all eleven | An adapter that starts a child without going through `ProcessRunner` |
| §4 W1 | A world reporting `filesystemWrite: "enforced"` while its request carried no allowance - which is the live defect `BOUNDARY-ENFORCEMENT.md` §10 already found once, where `writeRoots: []` permitted nothing while the bundle said `enforced` |
| §4 W2 | A defect table whose every entry moves many criteria - no controls |
| §4 W5 | A run that reports a resolution whose rung is not in `RUNGS` |

---

## 7. The order, and why it is this order

```
W1  confinement at the seam          S   all seven later items measure a world's boundaries
W3  documentation currency           S   corrects the counts W1 and W2 are about to move
W4  Playwright optional peer         S   independent, and small
W5  the ladder as a measured claim   M   proves the request's headline requirement
W2  sim-mobile                       M   the one world left, and it lands with W1's seam in place
W6  isolation seam + MCP gate        -   designed and recorded, not built
W7  HipCortex disclosure             S   a paragraph, and a rule that can now be held
```

W1 precedes W2 because a world built before the seam would ship reporting `filesystemWrite:
"unsupported"` and need a second pass to become honest - and this repository's own recorded rule is
that *the second occurrence is the one that proves the rule was not learned*. W3 precedes W2 because
the counts W3 corrects are about to move again. W5 follows W1-W3 because it is a measurement over runs,
and a run exercises the worlds.

The two items that cannot be proven here are last, and they are last on purpose: they are the ones this
design refuses to claim.

---

## 8. What was checked, and how

Every measurement in §2 and §3 is a reading of this tree at commit `da4831e`:

- `AMBIGUITY_ORIGINS`, `AMBIGUITY_KINDS`, `RUNGS`, `DEFER_REASONS`, `DEFAULT_CLARIFICATION_POLICY` -
  read from `core/clarification/types.ts`.
- The two detector registers and all seven detector functions - read from
  `core/clarification/detect.ts`, with their call sites confirmed in `core/definition.ts` and
  `core/execution/loop.ts`, and the full export list read from `core/clarification/index.ts`.
- `resolveIteration` and `attemptRepair` - read from `core/execution/loop.ts`.
- `ProcessRequest`, `ProcessResult`, `ProcessHandle`, `ProcessRunner`, `nodeProcessRunner`,
  `withDeadline`, `runToCompletion` - read from the export list of `core/process.ts`.
- `ConfinementCapability`, `ConfinementRequest`, `ConfinementResult`, `confinementCapability()`,
  `confineChild()` and the measured absence of `--allow-net` - read from
  `core/environment/confinement.ts`.
- The eleven-adapter spawn census and the three confining worlds - measured by search over
  `adapters/**`, counting `runToCompletion(`, `confineChild`, `child_process`, and `ProcessRunner`.
- The world table, the blocked table and `sim-mobile`'s status - read from
  `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5.
- `MobileEnvironment` and the mobile lifecycle - read from `docs/PLAN.md` §40.
- `description`, `engines`, `bin`, `files`, the absence of `peerDependencies` and the twelve `demo:*`
  scripts - read from `package.json`.
- The working tree - `git status --short`, clean, after a single-line indentation corruption of the H1
  in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` was reverted.

**Also read since the sections above were drafted, and what each one changed:**

- `docs/IMPLEMENTATION-PLAN.md` §6 (Verification strategy) and §7 (Execution order). §6.1's
  clarification row is the claim now checked and confirmed in §2.3; §6.2 settles W4's shape by naming
  the negative path in the plan's own words - *"that its absence produces a correctly classified
  `ENVIRONMENT_FAILURE` and not a PASS and not a crash. That is the negative path, and it is the one
  that must not be wrong"* - which is why W4 declares a peer and changes no degradation behaviour
  rather than reopening a settled design. §7's step 9 shows the self-validation contract was deferred
  from the beginning and step 12 fixes the gate as `tsc --noEmit` plus `node --test` with no prettier,
  so **`acceptance/` closes a deferral the plan itself recorded** and this design's W5 inherits that
  shape rather than inventing one.
- `core/clarification/engine.ts`, `#selfPromptFor` in full (`:262-315`). This is what promoted §2.3
  from a paraphrase of the plan to a reading of the code, and what produced the measured test roster
  in W5.

**Not yet read, and therefore not yet claimed:** `docs/PLAN.md` §23, §45 and §55 in full (the MCP and
scope-boundary source material W6 will need) and `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` beyond §7.
W6 depends on the first, and the plan that executes this design must read them before it starts rather
than assume them.
