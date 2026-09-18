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
| S3 | How should the plan treat HipCortex, whose substrate refuses every write with `HTTP 403`? | **Report the refusal; keep writing; change no product code.** | The client side is already correct and already tested: `IMPLEMENTATION-PLAN.md` §3.7 specifies that a *refusal* is not an unreachability and that the log says so, and `tests/memory-port.test.ts` holds both halves. The gap is operational, not architectural, and the honest response to an operational refusal is a disclosure - the same discipline as `veridian info:` writing to stderr on purpose. **Corrected during execution: the substrate does *not* refuse every write.** The premise of this question was measured twice more and falsified; see the correction under §4 W7. The answer taken is unchanged - report the refusal, keep writing, change no product code - because that answer never depended on the refusal being universal. |
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

**This table is a reading at `da4831e` and is left as it was measured**, because it is the measurement
the design of W1 was taken against - and a measurement edited to agree with its own outcome is no
longer a measurement. Two of its rows have moved since, and §9 carries the figures that replaced them:
`confineChild(` callers went 3 -> **0 in `adapters/**`** (the runner applies it now), and the eight
worlds reporting `unsupported` became **11 of 11 reporting `enforced`**, each derived from the runner's
own answer rather than asserted. The `runToCompletion(` count and the `ProcessRunner` count are
unchanged.

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
| 7 | HipCortex operational continuity | Code side closed and tested; the substrate refused writes when the gap was measured, and accepts them now | **W7** - disclosure, no code | S |
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
`installed`, `permission`, `deeplink`, `notification`, `logs`, `call`, `probe`.

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

> **Correction, written after execution (§12).** There is no `clarifications.json`: the record lives in
> a run's `result.json`, under its `clarifications` field, because the bundle's layout names an
> artifact by what it is about and the clarification report is part of the result rather than a file
> beside it. Two further corrections from the same pass. The bound on `rungsAttempted` is **not** among
> the outer contract's criteria - it is held by `tests/schema-vocabulary.test.ts`, so three of the four
> claims are in the contract and one is in the guard. And every criterion in this contract reads the
> record of a **nested** run it starts itself, never the outer run's: `AC-001`'s `process.argv` needle
> quotes the `veridian validate --goal
> acceptance/ladder/fixtures/goal.yaml --state-dir sandbox/ladder/fixture/ac-001 ...` vector, and
> `AC-002`..`AC-004` each pin `process.contents` on `ac-00N/latest-result.json` - a path under the
> **world's** root, while the outer run's own state directory is the sibling `sandbox/ladder/outer`, so
> the file a criterion reads can only have been written by the run that criterion issued. The seven
> origins are therefore read off a run whose gaps the fixture author arranged, rather than off the
> outer run's own build-time four.

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

> **Correction, taken during execution of W7. The premise above was falsified, and the falsification is
> the finding.** The paragraph says the substrate refuses **every** write, and that is what was measured
> when it was written - but a measurement of a substrate is a reading of a running process, not a
> property of the code, and this one moved. Two consecutive writes succeeded while W4 was being
> executed, each answered with a record id rather than a status: `1a66e84b-66b7-42e4-bbb1-3fd342c327e3`
> and `63f6b838-2432-47a1-b167-4473e5399371`. So the honest statement is the weaker one: **the substrate
> *may* refuse a write, and a refusal is a content precondition rather than an outage.**
>
> **What the correction does not change, and this is the part worth keeping.** Every mechanism above was
> read out of the code and is still exactly right - a refusal is not an unreachability, `HttpMemory#post()`
> carries the substrate's own stated cause, and `tests/memory-port.test.ts` holds both halves of the
> discrimination. The answer taken in substitution S3 stands unchanged. What the correction removes is a
> claim about a **frequency** that nothing in the tree could have held: `refuses every write` was never
> checkable from `core/memory/**`, because the port cannot see how many writes have been attempted, only
> what the substrate said to the one in front of it.
>
> **The two sites that carried the same premise are corrected the same pass rather than left standing** -
> the substitution-log row S3 above and the §3 gap-table row 7 - because a premise recorded in three
> places is three claims, and the earlier failure in this repository was a premise invalidated by a change
> that never opened the file it lived in. They are corrected in the place they were written, and the
> original wording is kept above rather than replaced, so a reader can see what was believed, what was
> measured, and which of the two moved.

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

---

## 9. Executing W1: what the migration decided, and what it found

W1's three moves landed, and all eleven worlds now declare an allowance at the request seam. **What
the section above could not have anticipated is the set of decisions the migration had to take on its
own**, because each one is a question about *which actor* a site belongs to, and the design above
describes the mechanism rather than the sites. They are recorded here in the same audit-trail register
as §1.1, because the operator's review is of the reasoning and not only of the result.

**The census moved, and the movement is the outcome rather than the change.** Measured before:
`confineChild(` callers **3**, worlds reporting `filesystemWrite: "unsupported"` **8**. Measured
after: direct `confineChild(` callers in `adapters/**` **0**, sites declaring `confinement: {` **11 -
exactly one per world** - and `filesystemWrite` **`enforced` in 11 of 11**, each value read from the
runner's own answer. So the three mitigations at three call sites are gone, and what replaced them is
eleven *declarations* of a value beside one *implementation* of a mechanism. That is the shape §10 of
`BOUNDARY-ENFORCEMENT.md` asked for, and the number that says so is a count of declarations rather than
of copies.

**F1 - A criterion's `run` step and an operator's `reset.command` are not the application's child, and
one word cannot describe two authors.**

`adapters/sim-data/sim-data-environment.ts:390` and `adapters/sim-cloud/sim-cloud-environment.ts:432`
are the two sites the migration deliberately leaves **unconfined**. Both are the same decision, taken
twice, and the reasoning is one sentence: the allowance is the *application's*, and a command a
criterion issued into the world - or a command the operator named in `reset.command` - is somebody
else's child. A world that widened its allowance to cover them would be reporting one
`filesystemWrite` value for two different authors, which is the class of overclaim the boundary path
exists to remove, one layer in.

The rule is held by a test whose title states it rather than by a comment:
*"keeps the operator's own custom reset command unconfined, because one word cannot describe two
authors"*, which asserts of the **same** world and the **same** `reset()` call that the provisioner's
request carried a `confinement` and the operator's did not, and that the world's `filesystemWrite`
reading is unchanged by the second. The last assertion is the one that matters: it says the decision
is a decision rather than a slip.

**F2 - An account has no path, so the allowance names `appPath`.**

`sim-k8s`, `sim-data` and `sim-cloud` name `this.#plan.appPath` for **both** halves of the request.
This is not a convenience. A cluster, a broker and a provider account each have **no `*_ROOT`
environment name and no sandbox directory** - the substitute's state lives in memory, and in
`sim-data`'s and `sim-cloud`'s case on the far side of a real socket - so a `writeRoots` naming a
sandbox would name a place that does not exist, and `confineChild` would hand the child an
`--allow-fs-write` for a path nothing can create. `appPath` is the one directory this world can
honestly name, which is why the comment sits at the field in each adapter rather than in this document:
the next author of a world reads the adapter, not the design.

**F3 - The absence of `--allow-net` does not break a socket-using world, and that is the finding W1
needed rather than the one it expected.**

§2.6 and `core/environment/confinement.ts:34-43` already record the flag's absence as a *permanent
property of the runtime* rather than a gap in a world - `--permission` is accepted while
`--allow-net=127.0.0.1` is answered `bad option` (exit 9). The open question the design left is the
consequence: **does confining a child also confine its socket?** It does not. A `--permission` child
opens a TCP connection to a loopback listener and completes the exchange, which is why the migration
was safe to apply to the two worlds whose entire subject is a socket - and the evidence is not the flag
list but the two demos: `sim-data` **20/20** and `sim-cloud` **27/27**, both with a confined
application child, both `PASS` with exit 0.

So no world needs an `--allow-net` that does not exist. `network` stays `unsupported` where the
mechanism cannot reach it and `not-requested` where the operator did not ask, **and that reading is now
independent of whether the application uses the network at all** - which is a stronger statement than
the design made, and the one a reader would actually want before confining a broker client.

**F4 - The six port-level spawns are the substitute acting, not the application provisioning, and they
are left alone on purpose.**

`adapters/sim-container/container-port.ts` (`:738`, `:1167`), `adapters/sim-vscode/vscode-port.ts`
(`:118`, `:781`, `:1012`) and `adapters/sim-os/os-port.ts` (`:302`) start children **inside the
substitute**, and the migration gives them no allowance. The reason is visible in the code rather than
inferred: `container-port.ts`'s `runInside` is the shared implementation behind both a container's own
start and a `container exec`, and it is *the runtime doing what the application asked it to do* - a
real container runtime runs that command itself, from outside the application's process, after the
application's request has already been answered. Handing it the application's allowance would describe
the world's own behaviour as the application's, which is exactly the conflation F1 refuses, applied to
a different pair of actors. **These are substitutes standing in for a runtime's exec, so the question
"is the application confined" does not have them as an answer.**

**F5 - The guard was broken on purpose, and both halves moved.**

`tests/boundary-roster.test.ts` was re-derived, because W1 moved the mechanism off the call site the
old derivation searched for: it now reads the worlds that **ask** for an allowance
(`confinement:\s*\{` in `adapters/**/*-environment.ts`) and the worlds that **derive** their answer
from one (`#confinement`), and asserts the two sets agree with the register. Two probes were run
against `sim-cloud`, with each file's own line ending detected and printed, each anchor asserted
present before the edit and the edit asserted to have changed the file, and each file restored byte for
byte afterwards:

| Probe | What it broke | World suite | Roster |
|-------|---------------|-------------|--------|
| baseline | nothing | 53 pass / 0 fail | 14 pass / 0 fail |
| P1 | removed the `confinement` declaration from the application's request | 47 / 6 - naming the allowance test and every derived reading | 11 / 3 - naming *"asks the runner for an allowance in every world"* and *"never lets a world name `enforced` for the write boundary without having asked for one"* |
| P2 | kept the declaration and asserted the old literal instead of the runner's answer | 49 / 4 - naming the enforcement readings only | 12 / 2 - naming *"derives the filesystem answer from the confinement instead of declaring it"* |

The two probes failing on *different* assertions is the point: P1 moves the worlds that ask, P2 moves
the worlds that derive, and a single guard that could not tell the two apart would have reported one
fact where there are two. Restored, the suites read 53/0 and 14/0 again.

**F6 - W1 falsified the premise of the boundary vocabulary's own explanation of its split, and that is
the one thing in this section that was a defect rather than a decision.**

`core/environment/types.ts`'s doc block for `BOUNDARY_ENFORCEMENTS` ended with a bolded invariant:

> **The three worlds that confine a child are exactly the three that answer this question with a
> measurement**

That sentence was true when it was written, because only three worlds confined a child at all - the
other eight actions of that era had no allowance to hand over, so *"confines a child"* happened to
coincide with *"can measure a network answer"*. **W1 gave every world an allowance**, so the phrase now
denotes **all eleven rows** while the predicate still holds of three, and an equality whose left side
grew and whose right side did not is simply false. The same premise was repeated in
`tests/boundary-roster.test.ts`: its top doc comment explained the other eight as worlds that *"act in
process and hold no boundary to measure"*, and the fifth assertion was titled *"the worlds which answer
the network question with a measurement are the three that confine a child"* with the message *"a world
that starts a host child is one that answers the network question with a measurement"* - a sentence
that is now false about eight worlds that all start host children.

Nothing failed. The assertion's **set** - `["local-api", "local-process", "local-web"]` - is still
correct, because W1 deliberately left the network arm alone, and it still fails when disturbed. What
went stale is the **reason**, which is the same shape this repository has recorded five times over: *a
name, a count or an explanation in a document is read by nothing that could disagree with it.* The
distinction that survived is narrower and is now what all three places say: the separation is **a front
door**, not a child - `local-web` and `local-api` hold a route guard every request of theirs passes and
so answer `enforced`; `local-process` holds no door, has only the child's own socket to reason about,
and answers `unenforceable` because `node --allow-net` does not exist on this runtime; the other eight
answer `unsupported`.

Three corrections were made in the same pass as the change that falsified them: the vocabulary's
sentence, the roster's explanation of the split, and the roster's assertion title and message. The
guard over the document was then **measured rather than assumed** to be useless here, by patching the
false sentence back into `core/environment/types.ts` and running the roster against it: exit 0, **14
pass / 0 fail**, with the file's own line ending detected first (`types.ts="\r\n"`), the anchor asserted
present, the edit asserted to have changed the file, and the file restored byte for byte afterwards
(14/0 again on the restored tree). The reason the false sentence passes is structural rather than a
miss: that block reads the doc block and asserts only that it **names** all four enforcement values and
all three worlds - *a guard that holds a vocabulary's membership cannot hold its meaning.* That is
stated rather than papered over, because the next author of the next sentence in that block should know
which of the two they are protected by.

**What this section is not claiming.** `network` is still not enforced anywhere, and F3 does not change
that - it says the absence is harmless rather than that it is filled. Real isolation is still W6's
subject and is still unbuilt. And the eleven `enforced` readings are all `enforced` **for a child the
mechanism could reach**: a world whose application is not a Node process is answered `unsupported` with
the runner's stated reason, by the same four refusal branches `confinement.ts` already documents, which
is why the roster's assertion is about derivation rather than about a constant.

---

## 10. Executing W4: the route is declared, and a prose defect the guard caught

W4 landed, and it is falsified rather than trusted. Measured on this machine, `git diff --stat` over the
three files it touches reads `README.md | 23 ++++++++++++++---------`,
`package-lock.json | 8 ++++++++`, `package.json | 8 ++++++++` - so the lockfile's root entry moved in
the same pass, which is the half of the item §4 records as having been paid for once already, when the
lockfile said `UNLICENSED` while the manifest said `MIT` and when `bin` still named `cli/veridian.ts`
after the manifest had moved.

**The guard.** `tests/package-manifest.test.ts` - eight tests - reads `package.json`,
`package-lock.json` and `README.md` rather than restating the range, and every derivation is **lazy**:
`peersOf()`, `peerMetaOf()` and `lockedRootOf()` are called inside the `it` that needs them. That is not
style. The interesting failure is a block *removed* from the manifest, and a guard that read it at import
time would report that as a file that could not be loaded - one unhelpful message standing in for three
named properties. A missing block is instead refused by name, at the pointer, by the `it` that wanted it.

**Four probes, each reverted byte for byte**, on a harness that detected and printed every file's ending
first (`package.json="\r\n" package-lock.json="\r\n" README.md="\r\n"`), asserted each anchor present
before editing, asserted each edit to have changed the file, and re-measured the baseline after restoring:

| Probe | What it broke | Failures | Which |
|-------|---------------|----------|-------|
| baseline | nothing | 0 | - |
| P1 | removed `peerDependencies` from `package.json` | 3 | the declaration, the lower bound, the lockfile pin |
| P2 | flipped `optional` to `false` in both files | 1 | the optional marking |
| P3 | dropped the range from the lockfile's root entry alone | 1 | the lockfile pin |
| P4 | restored the README's two older claims | 2 | both README subtests |

P1's reach is the finding rather than an inconvenience: **a missing block is not an isolated property**,
so the three assertions that read it cannot fail independently, and a table claiming one failure per
probe would have been a claim about the guard's shape rather than a reading of it. P4 is the pair that
proves the README half is load-bearing in both directions - the positive subtest (the new vocabulary is
present) and the negative one (the old wording is gone) each fail on its own.

**F7 - The probe's first anchor was wrong about the file, and the harness said so instead of passing.**

P4 did not fire on its first run, and the cause was a **wording defect in `README.md`** rather than a weak
probe: the paragraph read *"That route is now declared rather documented: Playwright is an **optional peer
dependency**"* - the word `than` absent. Nothing in the tree could have caught it, because the sentence is
prose a reader reads and no guard compares it to anything. What caught it was the harness's own
`patch refused: ... anchor absent from README.md` line, which is the rule this repository has now paid for
at probes three times, and which is the reason a harness that cannot fire must say why. The sentence is
corrected, and the harness's anchor with it - and the *second* attempt at that anchor was wrong too,
because it assumed a line break the file does not have. The real wrap is `declared rather than` ending one
line and `documented:` starting the next; the anchor diagnostic printing `head at -1` is what said so.
*An anchor is a reading of a file, so it has to be read out of the file.*

The defect's origin is visible in this document: §4 W4 phrases the route as *"declared (a package manager
can now say so at install time) rather than documented (a reader has to find the paragraph)"*, and the
README sentence was written from that phrasing. A paraphrase that drops the pivot word still reads
fluently, which is why it survived a pass that touched the paragraph's neighbours.

**Two claims re-judged rather than left standing.**

- `README.md`'s note on `npm ci` said Playwright is *"installed outside the lockfile on purpose"*. True
  before W4 and true after it, but no longer **sufficient**: the lockfile now names playwright twice, in
  the root entry's `peerDependencies` and `peerDependenciesMeta`, so a reader who greps for the name finds
  it and may read the old sentence as a contradiction. It now says the measured thing - no Playwright
  *package* is in the lockfile's installed set, because the peer declaration names a range and installs
  nothing - which is both the reason `npm ci` would discard a fetched browser and the fact a reader can
  check in one command.
- `tests/playwright-guard.test.ts` was read, because its name suggested it might be the home of an
  assertion W4 had falsified - that Playwright is absent from `dependencies`. **It is not.** The file is
  about `refusalSubject`, the network guard's per-request decision, and holds seven tests over the
  boundary's edges, none of which mentions a dependency block. W4 falsified nothing in it. Recorded
  because a name that reads like a subject is not the subject, and the check cost one read.

**What this section is not claiming.** The degradation is unchanged: a world with no browser is
`INCONCLUSIVE`, never `PASS`, and names the command that fixes it. W4 made the route *declared* - a
package manager states the requirement at install time - and declared is not installed, which is the
whole reason `peerDependenciesMeta.playwright.optional` has to be `true` for the honest `INCONCLUSIVE`
to stay reachable.

**The count corrections were probed rather than trusted, and the probe is what says they are
corrections rather than guards.** W4's guard moved the root run, so every figure quoted in prose had to
be re-measured; four live sites and the historical entry's fourth-movement paragraph were corrected in
the same pass. Then one of them was reverted **on purpose** - `README.md`'s quickstart fence put back to
`2305 tests` while the line beneath it still read `2241`, which is exactly the mismatch a reader would
call an inconsistency - and the suite was run against it. Measured: `# pass 2313`, `# fail 0`, exit 0,
with the wrong figure sitting in the file. **Nothing holds a number in prose, and nothing can**: a test
that pins a count changes the count it pins. That is why this repository's rule is that a count is
re-measured at the moment the document is touched rather than promised by a check - and the probe is the
measurement behind that sentence rather than the sentence itself. The file was restored in the same
pass.

---

## 11. Executing W7: the premise moved, and the mechanism did not

W7 landed as §4 describes it - a disclosure and one rule, **no product code** - and it is the item
whose own premise was wrong. The section could not have anticipated that, and the way it went wrong is
worth more than the line the item delivers.

**The premise, as written.** §4 W7, §1.1's substitution row S3 and §3's gap-table row 7 all stated that
the substrate **refuses every write**, quoting the refusal this session had actually seen:

```
HTTP 403  precondition blocked: PII risk=0.90 patterns=["PII:..."]
```

That was a real reading of a real response - not an assumption - which is why it was written down
rather than hedged.

**What happened.** Two consecutive writes were accepted during W4, each answered with a record id
rather than a status: `1a66e84b-66b7-42e4-bbb1-3fd342c327e3` and
`63f6b838-2432-47a1-b167-4473e5399371`. So the substrate does not refuse every write; it *may* refuse
one, and a refusal is a content precondition rather than an outage.

**Why the correction is narrower than it looks, and this is the half worth keeping.** Every mechanism
the paragraph states was read out of the code and is still exactly right: a refusal is not an
unreachability, `HttpMemory#post()` carries the status *and* the substrate's own stated `error`, and
`tests/memory-port.test.ts` holds both halves of the discrimination - a refused write reports
`precondition blocked` and does **not** contain "unreachable", while a genuine `ECONNREFUSED` still
does. The answer taken in S3 - report the refusal, keep writing, change no product code - **stands
unchanged**, because it never depended on the refusal being universal; it depends on the port reporting
the substrate's own cause, which it does.

**A frequency is the one thing the port cannot hold.** `HttpMemory#post()` sees one response at a time;
it cannot count attempts, so *"refuses every write"* was never checkable from `core/memory/**`. It was a
claim about a running process, and the process moved. That is the same rule this repository states for
error messages, applied to a document: **an error message may only name a cause the reporter observed**,
and a sentence describing how often a dependency fails is making the same kind of claim. The corrected
rule is the weaker and the honest one - the substrate *may* refuse a write - and it is now the sentence
`AGENTS.md` carries.

**The three sites were corrected where they were written, and the original wording is kept above the
correction rather than replaced.** §3's row 7, §1.1's row S3 and §4 W7's own paragraph, the last
carrying a marked correction directly beneath the paragraph it corrects. A premise recorded in three
places is three claims, and this repository has already paid once for a premise invalidated by a change
that never opened the file it lived in - so the way to hold one is to search for it, not to trust that
the file being edited is the only one that says it.

**And the rule landed where the rule is read.** `AGENTS.md`'s memory section now carries it: the
substrate may refuse a write, a refusal is not an unreachability, the honest response is to report the
reason it gave and keep writing on the next decision, and the mechanism that keeps the two apart is held
by the port's own tests. That is the one line W7 promised, and with the premise corrected it is the
item's whole deliverable.

---

## 12. Executing W5: the ladder is observed, and building the measurement found a defect

W5 delivered both artefacts §4 named, and the second one cost a product fix - which is the outcome the
item was designed to produce rather than a surprise. §4 W5 stated the distinction exactly: the question
was never "is the ladder tested" (it is) but "has the ladder ever been **observed**, in a run, doing the
work the request asks of it". Once that artefact existed, the answer was no - and it agreed with the
unit tests, which is the part worth recording.

### 12.1 What landed

| Artefact | Where | Held by |
|---|---|---|
| The register guard | `tests/schema-vocabulary.test.ts`, `describe("the ladder answers every word it owns")` (three `it` blocks) | the register itself - each of the three loops iterates `AMBIGUITY_ORIGINS`, `RUNGS`, `DEFER_REASONS` rather than a hand-kept list |
| The outer contract | `acceptance/ladder/{goal,environment,acceptance}.yaml` + `fixtures/` | four criteria, `local-process`, 24 pinned needles |
| The runner | `scripts/ladder.mjs`, declared as `"acceptance:ladder"` | two invocations in one process; exit 1 if either disagrees |
| The CI route | `.github/workflows/ci.yml`, ordered **above** the demo loop | `tests/demo-rosters.test.ts`'s fourth roster |
| The product fix | `core/execution/loop.ts`'s `restrictTo` | `tests/runtime-report-slices.test.ts` (4 tests, no `describe`) |
| Two harnesses | `sandbox/ladder/falsify-ladder.mjs`, `sandbox/ladder/falsify-rosters.mjs` | git-ignored, hence harnesses and not tests |

**The two artefacts answer the four claims §4 W5 listed, and the mapping is worth writing down because
it is not one-to-one.** "A resolution is present" and "its rung is recorded" are both read out of the
outer contract (`AC-002`'s `contains` assertions on `"records"`, `"derived"`, `"self_prompted"`,
`"defaulted"`, `"deferred"`); "a deferred resolution carries its reason" is `AC-003`; "all seven
origins" is `AC-004`; and **"`rungsAttempted` is bounded" is *not* in the outer contract at all** - it
is `tests/schema-vocabulary.test.ts`'s `record.rungsAttempted.length <= RUNGS.length`. Three claims in
the contract, one in the guard, and a reader who assumed all four were in the contract would have been
wrong about which artefact to open.

### 12.2 The defect the measurement found, and why no unit test could have

The first measurement of the ladder's record reported **19 rungs counted against 17 records held**, with
a `defaulted: 5` beside three records that reached that rung. The invariant a reader would state is
"`byVia` sums to `records.length`"; the unit suite did not state it, and could not have - the ladder's
own tests build a report in one piece, so they never cross the seam where the two are narrowed
separately.

**Root cause.** `restrictTo(report, origin)` narrows `report.records` to one origin and returned
`{ ...report, records }`. The spread carries `byVia` from the **parent** - the count of rungs over
*every* record the run produced - beside a `records` list holding only the subset. A shallow copy
narrows one field and claims the other's history, and the claim is the one the reading is built from.

**Fix.** Recompute the count from the narrowed list, and export the function so a test can hold it:

```ts
const records = report.records.filter((record) => record.ambiguity.origin === origin);
const byVia: Record<Rung, number> = {
  derived: 0, inferred: 0, defaulted: 0, self_prompted: 0, answered: 0, deferred: 0,
};
for (const record of records) byVia[record.resolution.via] += 1;
return { ...report, records, byVia };
```

**Verified as a measurement rather than as a diff.** The gate was green afterwards (2316/2316 at the
time) and the record was re-read: **17 = 17**, `defaulted: 3`. **Falsified 3/3** - restoring the
parent-copy fails the subtest that names the sum, dropping the loop fails the one that names the
per-rung count, and widening the filter fails the one that names the subset.

The generalisation, which is this repository's own older rule arriving at a new seam: **an invariant
that holds "by construction of the writer" is an invariant about the writer's input, not about the
system.** Every unit test constructed the report through one path, so the path where two fields are
narrowed by different code was held by nothing.

### 12.3 The cost, and where the bundle's size goes

Measured on this machine: **`wall_ms = 21194`** for both passes (~21 s), each `PASS (COMPLETED, 1
iteration(s))`, 4/4 criteria.

A passing run's bundle is **831,480 bytes**, and any reader who opens it will ask why. Attributed by
field, measured rather than reasoned about:

```
   815754  criteria        <-- 98% of the bundle
     4749  clarifications     343  iterations       1482  environment
      873  evidence           274  reproducibility   191  guards
       91  reasons              58  limits            0  failure
```

The cause is not a defect: **the `local-process` family re-records the entire value it compared, once
per expectation.** `AC-004` has seven `process.contents` assertions, so the bundle holds seven `actual`
strings of ~21 KB each - the whole `latest-result.json` of a nested run, quoted back as the evidence for
each comparison. That is the correct shape for a `contains` assertion (the evidence for "this document
contains this substring" is the document) and it is the reason the criteria field is 98% of the file.

**A record that is large because it is complete is worth keeping, and a document that does not say so
invites an attempt to "fix" it.** So the figure is recorded here.

The figure is not a constant, and the reason is the same one. **The six passing runs on disk measure
831480, 831480, 831480, 831480, 831526 and 831508 bytes** - a spread of 46, and the two ends of it are
one difference in how long an inner run took. Attributed rather than guessed on the pair 831480 and
831508: the whole 28-byte difference is in `criteria` (815754 against 815782), all of it inside
`AC-004`, and within that criterion it is **2 bytes in each of the seven `process.contents`
assertions**. Two bytes, because the document each one quotes carries the nested run's own identity
and clock - `"elapsedMs": 828` against `1023` and the sentence quoting it as `after 825ms` against
`after 1020ms`, one byte each. *So the outer bundle's size is a function of how long the inner runs
took*, which is the same rule this repository already paid for when a contract pinned the byte count of
a stream composed from the operator's own directory name: **the question is never whether a byte count
is too strict, it is whether the length depends on something outside the world.** Nothing here pins a
length, so nothing broke - but a future contract over this route should not start.

### 12.4 Four lessons from building the guard, each paid for

1. **A harness that names criteria must read the record's own keys first.** The first falsification run
   of the outer contract reported *"the needle's criterion is missing from the result"* for a run whose
   bundle held all four. The harness read `criterion.id`; the bundle spells the field
   **`criterion_id`**. One word, and the harness's verdict was about its own spelling rather than about
   the contract. *An assertion against a field that does not exist passes vacuously on one side and
   fails falsely on the other* - and the only way to tell which is to read the writer.
2. **A roster that holds one constant rather than deriving a set goes blind one member at a time.** The
   fourth roster in `tests/demo-rosters.test.ts` began as `const ACCEPTANCE = "acceptance"` - one
   subject, hard-coded - so with two self-acceptance routes declared, one of them was outside every
   question the block asked and no subtest could say so. It is now `acceptanceRoutes(manifest)`, derived
   from `package.json`, and **the generalisation was proved to do work by going red**: run before the
   four places were wired, it failed with four *named* subtests. This is the same shape as the `db.query`
   roster and the `web.visible` roster, arriving at the *guard* rather than at the document.
3. **A number in prose is falsified by the very edit that adds a line beside it.** Wiring the route in
   added a line to `README.md`'s quickstart fence, and the sentence beneath it still read *"Run those
   fifteen in that order"* - against sixteen fenced commands. Corrected by counting the fence, not by
   adding one. Then the same rule ran again one layer out: the new route moved the root test count, and
   **2313 became 2321 / 2241 became 2249** in five places across `AGENTS.md` and `README.md`. Re-measured
   (`node --test` then the Cockpit's own `node --test`), never computed.
4. **A probe harness must scrape failing subtests with `^\s*`, not at column zero.** A subtest's TAP line
   is *indented* under its suite's, so a column-zero `/^not ok \d+ - /` scrape matches nothing, prints the
   *suite* name instead, and declares a fired probe unfired. The roster harness carries the fixed pattern
   and printed all six fires by name - **a badly scraped probe silently reports the reverse of what
   happened**, which is worse than one that did not run.

### 12.5 The falsification ledger

Every guard this item added was broken on purpose, and each probe named the subtest it was supposed to.

| Guard | Probes | Result |
|---|---|---|
| the outer contract's needles | 2 (a confidence figure, an origin path) | **2/2 fired**, each naming its criterion |
| `restrictTo` | 3 (parent copy, no loop, widened filter) | **3/3 fired**, each naming a different property |
| the fourth roster | 6 (declaration removed, driver missing, README, AGENTS, CI step removed, CI step moved) | **6/6 fired**, each naming its own subtest, each `restored byte for byte: true` |

The sixth roster probe is the one that needed two edits rather than one. Removing the CI step makes
both the membership question and the ordering question answer `no` - a command that is not run cannot
be run before the loop - so the ordering claim can only be isolated by **deleting the step and
re-inserting it below the loop**, after which exactly the ordering subtest fails and the membership
subtest passes. *A probe that answers two of its guard's questions at once has not isolated the
property it claims to test; the isolation is a second probe, not a narrower expectation.*

Each harness computes its target file's line ending from that file and prints what it detected
(`line endings: package.json="\r\n" README.md="\r\n" ...`), because this repository has now paid for the
CRLF rule at a demo, at a test **and** at a probe, and the printing is what makes a future mismatch
visible in the transcript rather than in a wrong verdict.

### 12.6 What W5 leaves open

Three items were recorded here when the work landed. The first has since been asked and answered, and
is kept in the form the question took rather than rewritten, because the way it was wrong is the point.
The other two are still open.

- **`assertions[i].verifier` reads empty, because the field is not called `verifier`.** Asked and
  answered rather than left open, and the answer is one grep wide: `core/evidence/writer.ts`'s
  `serializeAssertion` writes `validator: assertion.validator` as the first key of every assertion
  record, and the in-memory shape is `CriterionResult["assertions"][number].validator`. There is no
  `verifier` in `core/evidence/**` and no `verifier` in any schema, so the name this note searched under
  exists nowhere in the bundle - which is why the reading was empty and why an assertion searching for
  a *value* there could only ever have passed by finding nothing. **The wrong name was reachable**: the
  witness is a real thing in this tree, and it lives in `examples/local-process`, whose domain
  vocabulary is a build program and the second program that verifies its manifest - so "*the verifier*"
  is a legitimate word about that demo and not a word about the bundle. That is the same collision the
  `call` step-kind has with `cloud.call` and `data.call`: one spelling, two vocabularies, and the
  borrowed meaning reads as the member's name. The note is kept rather than deleted, because the way it
  was wrong - a field name recalled from a neighbouring subject - is the failure mode this section
  exists to record.
- **`sandbox/ladder/*` is scratch.** Four generated trees, two harnesses, three transcripts - all
  git-ignored, none needed by a run.
- **The bundle's 98% criteria field is a property of the family, not of this contract.** Any future
  contract over `local-process` will meet it, and §12.3 is the answer to the question it raises.
