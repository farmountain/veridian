# Veridian — Implementation Plan & Ambiguity Resolution Protocol

> **Scope of this document.** `docs/PLAN.md` is the *product* specification (what Veridian is).
> This document is the *build* specification (how Veridian gets implemented) plus the design of
> the one mechanism the spec does not yet contain: the **Ambiguity Resolution Protocol (ARP)** —
> the self-prompting / clarification layer that runs across the entire lifecycle.
>
> Where this document and `docs/PLAN.md` disagree on *product* intent, `PLAN.md` wins. Where this
> document adds structure the spec left open, this document wins and `PLAN.md` should be amended.

---

## 1. Scope decision

**Built now — the vertical slice that satisfies MVP step `AVF-MVP-E2E-001` end to end:**

```
schemas  →  core/{clarification,goal,acceptance,environment,validation,evidence,run,execution}
        →  adapters/local-web        (LocalWebEnvironment)
        →  validators/playwright     (web.ui.* validator family)
        →  cli                       (the driving surface)
        →  examples/shopping-cart    (the canonical demo, 3 defects + repair)
```

**Built now, additionally (requested, not in the original spec):**

```
core/clarification   the Ambiguity Resolution Protocol — see §3
```

**Deferred, with the reason — and, where a row has since landed, with the measurement that says so.**

The `Status` column was added in place rather than the rows being rewritten, because this table's value
is as an audit trail: what was decided at the time, and what the tree says now. It is the same pattern
the assumptions log below already uses (`A5`, `A11` and `A12` are reversals recorded **beside** what
they reversed rather than replacing it). Two rows were **split** rather than edited, because one row
naming several things whose statuses have since diverged hides the status of each — the defect this
repository records as *"a documentary guard's extension point can be a row that must be split, and the
row that hides two worlds is the row that hides both."* `tests/implementation-plan-status.test.ts`
reads this table and holds the `Status` vocabulary and the agreement between a named directory and
whether it exists.

| Deferred | Status | Why, or what landed |
|---|---|---|
| `extension/vscode/` (Veridian Cockpit) | **landed** | The spec is explicit: *"VS Code ≠ Veridian."* The extension is a thin client over the Core interface. Building it before the CLI proved the same interface would have frozen the wrong shape — so it was deferred, correctly, and then built once the interface was proven. **Landed**: four shipping routes (a clone, an npm package, the Cockpit as a development install, the Cockpit as a `.vsix` published to the marketplaces), its own three-command gate (`npm run gate` = typecheck, test, build, `smoke:out`), and the twelfth demo (`examples/vscode-cockpit/`) which judges **the real compiled Cockpit** inside the `sim-vscode` world and found two defects the extension's own 72-test suite could not. |
| Level-3 MCP integration | **landed** | Spec §23 marks it out of MVP, and the gate it is kept behind is a **measurement** rather than a slogan: *"MCP is the door. Veridian is the building."* Level 1 is Veridian driven by a human through the CLI; Level 2 is Veridian driven by an external agent through the failure artifacts (`.veridian/latest-result.json`, `.veridian/latest-failure.md`) and the repair-gate command; Level 3 is Veridian *exposing itself* to an agent as an MCP server. **Level 3 landed as `mcp/`** - `server.ts`, `tools.ts` and `protocol.ts`, registering **eight** tools (`create_environment`, `start_environment`, `run_validation`, `get_result`, `get_failure`, `get_evidence`, `reset_environment`, `snapshot_environment`), with `npm run smoke:mcp` in CI's `MCP surface` job. The layering rule that made it safe is re-measured rather than recalled: **`core/**` still contains zero occurrences of `mcp`**, so the surface is a **fourth consumer** beside `cli/` and `extension/vscode/` and never the foundation. This row read `deferred` for three passes after the surface shipped - the same defect the Cockpit row above it had, and one this table's own guard could not catch, because the guard resolves backticked tokens ending in `/` and this row named files rather than a directory. Naming `mcp/` is part of the repair: it puts the row back inside the guard's reach. |
| Kubernetes adapter | **landed** (simulated) | Spec §9 excluded it from MVP. **Landed as `adapters/sim-k8s/`**: a real application process really deploying itself over a real HTTP control plane it really calls, into namespaces the control plane really holds — with scheduler, kubelet, etcd and admission standing in, and **no cluster software anywhere in the loop**. The substitution is declared in the plan and in `environment.json`. |
| Cloud provider adapter | **landed** (simulated) | Spec §9 excluded it from MVP. **Landed as `adapters/sim-cloud/`**: a real HTTP server speaking a provider's own routes over loopback, holding buckets, objects, queues, secrets and principals and deciding every permission question with the account's own evaluator — with **no cloud account, no session, no provider API and no outbound socket anywhere in the loop**. |
| Mobile device-farm adapter | **landed** (simulated) | Spec §9 excluded it from MVP, and it was the last unbuilt row. **Landed as `adapters/sim-mobile/`**: a real application process really provisions a substitute handset through commands it really issues, and is judged on what that substitute holds — a model, an OS and version, an orientation, a screen size and density, installed bundles, per-bundle permissions, deep links, notifications, logs and keychain entries. The application is a real child process, there is no new step kind, and both of its limits are stated **in the values its criteria compare** rather than in a footnote. Four defects, twenty-five criteria, `examples/sim-mobile/`; **no emulator, no image and no booted system anywhere in the loop**. The design is `docs/GAP-CLOSURE-DESIGN.md` W2. |
| VM / guest-kernel adapter | **deferred** | Spec §9 excluded it from MVP. **Still deferred on purpose**: `sim-posix` and `sim-os` are *simulated* systems — a real application process really provisioning a substitute Linux / Windows system through commands it really issues, **with no virtual machine and no guest kernel anywhere in the loop** — and a world whose subject is a booted kernel is a different claim that nothing here can prove. `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 records every remaining row beside the `sim-*` world that answers it. |
| Goal compiler, marketplace, plugin system | **deferred** | Spec §55 forbids them, and `AGENTS.md`'s hard scope boundary repeats the prohibition. Unchanged. |

**Dependencies — one runtime package, two dev packages, and no framework:**

| Kind | Package | Justification |
|---|---|---|
| runtime | `yaml` | Spec §48/§49 make YAML a first-class persistence format (`goal.yaml`, `acceptance.yaml`, `config.yaml`). Hand-rolling a YAML parser would be a far larger, riskier surface than a single well-known dependency. |
| dev | `typescript` | Typecheck gate (`tsc --noEmit`) **and** the build that produces the distributed copy. Node 22.18 strips types at runtime, so development has no build step and there is no bundler; `tsc -p tsconfig.build.json` exists only because `node_modules` refuses type-stripping, so an installed package must ship `.js`. |
| dev | ~~`prettier`~~ | **Not installed, and the `format` script that called it has been removed.** The intent was to install it last so the `PostToolUse` hook could not reformat files mid-build; what shipped instead is a hand-maintained, consistent tree and a hook that is a documented no-op. A first `prettier --write` would touch almost every file, so it is a deliberate decision to take rather than a gap to close. **The dependency list is two, not three.** |

Everything else is Node built-ins: `node:test`, `node:assert/strict`, `node:fs/promises`, `node:child_process`, `node:crypto`.
Playwright is declared as an **optional** adapter dependency: imported lazily, and its absence is a
classified environment failure, never a hard crash.

---

## 2. Self-prompt resolutions (the assumptions log)

Per the governing instruction — *self-prompting outranks asking the user; only critical questions
are surfaced* — every ambiguity below was resolved by **DERIVE** (answered by the spec or the
repository) or **DEFAULT** (answered by a conservative, fail-safe value). This table is the audit
trail. Any row may be overturned; none of them blocks the build.

| # | Ambiguity | Rung | Resolution |
|---|---|---|---|
| A1 | `-1` suffix in *"AVF is rename as Veridian -1"* | DERIVE | Paste noise. The rename is to `Veridian`; no versioned name exists. |
| A2 | Test runner | DERIVE | Spec names none. Node 22.18 ships `node:test` and runs `.ts` natively → zero-dependency runner. Verified by probe before adopting. |
| A3 | Build step | DERIVE | Node 22.18 type-stripping makes a compile step unnecessary. `tsc` is retained as a *typecheck gate only*. |
| A4 | Scope of "fully implemented" | DERIVE | The spec's own DoD (§56) and `AVF-MVP-E2E-001` (§32) require Core + web sandbox + demo. The VS Code extension is required by neither. |
| A5 | `git init` | DEFAULT → **REVERSED** | **Not** performed during the build: version control is a user decision about their machine and history, and a greenfield repo with no `.git` was left as found. Reversed at ship time, because the reproducibility invariant records `gitCommit` and `gitDirty` in every run bundle and both were `null` in a repository with no `.git` (observed in `.veridian/latest-result.json`). A run that cannot name the commit it tested is not reproducible from its own evidence, so `git init -b main` is now step one of "Getting started" and the field is populated. |
| A6 | Where the ARP lives | DEFAULT | `core/clarification/` — its own module. It is consumed by `goal`, `acceptance`, `environment`, `validation` and `execution`, so placing it inside any one of them would make that one a hub the others depend on. |
| A7 | Deferred-ambiguity failure taxonomy | DERIVE | §51 fixes the 9-value taxonomy; there is no `INSUFFICIENT_INFORMATION`. Inexhaustible ambiguity → criteria `INCONCLUSIVE` + run terminal state `ABORTED` (a §50 terminal) + `failure.kind = UNKNOWN` + `insufficientInformation: true`. No new taxonomy value is invented. |
| A8 | Can a `blocking` ambiguity be DEFAULTed? | DERIVE | Yes, but only when a value exists whose selection **cannot make the run report PASS more readily than the truth**. That is the precise statement of the fail-safe rule that protects metric **M3 (zero false PASS)**. Where no such value exists, DEFAULT is unavailable and the ladder escalates. |
| A9 | Offline demonstration | DERIVE | Playwright's browser download is ~150 MB and mutates the machine; it is not fetched unprompted. The full loop is therefore proven offline against **test doubles at the port boundary** (mandated by `.github/instructions/tests.instructions.md`: *"never launch a real browser in a unit test"*), and the Playwright path is shipped complete behind one documented command. See §6. |
| A10 | `rtk` prefix | DERIVE | `rtk` is **not on PATH** on this machine (observed `CommandNotFoundException`). AGENTS.md is corrected to stop recommending it. |
| A11 | Distribution model | DERIVE → **REVERSED** | **A clone, not an npm package**, on two verified causes: Node 22 type-stripping is unavailable under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, verified for the import path and for the `bin` path alike), and the schema set resolved through a port rooted at `process.cwd()`, so an installed CLI would report a missing goal schema sitting inside its own package. `PLAN.md` §56 asks for the weaker thing: *"a developer can clone the repository"*. `private: true` was therefore retained so the registry path could not be taken by accident. **Reversed:** the request is to *"ship Veridian as a tool others install and run"*, which a clone does not satisfy. Both causes are now fixed rather than avoided - `tsconfig.build.json` compiles `dist/` because a package *must* ship JavaScript, and `core/assets.ts` resolves Veridian's own files against `import.meta.url` while `io.ts` keeps resolving the operator's against the working directory. `private: true` is gone, replaced by guards that can actually be tripped: `prepublishOnly` (gate) and `prepare` (build), plus `npm run smoke:dist`, which drives the compiled CLI from a temporary directory. |
| A12 | Licence | DEFAULT → **REVERSED** | **MIT**, `Copyright (c) 2026 Liew Keong Han`, chosen at build time: the manifest said `UNLICENSED`, which denies the thing the request asks for - a tool others install and run - and the choice is the user's call in principle, so the least restrictive and most easily reversed option was taken. **Reversed at ship time by the user in favour of BSD 2-Clause**, `Copyright (c) 2026, Liew Keong Han`. The GitHub scaffolding the repository was created from had arrived with a BSD 2-Clause `LICENSE` naming `farmountain`; the user kept that licence text and their own name as holder. The identifier was written in three places - `LICENSE`, `package.json`, and the lockfile's root entry - and **two of the three had already drifted before the reversal**: the lockfile still said `UNLICENSED` while the manifest said `MIT`, and nothing caught it, because `npm ci` checks dependencies rather than that metadata. An identifier declared in several places is a claim that will disagree with itself if they are edited independently, so all three moved together. |

**The one item genuinely worth a user decision** is A9 — whether to install Playwright now. It is
the only row that spends the user's resources (bandwidth, disk) and touches the machine outside the
repository. Everything else is reversible by editing a file.

---

## 3. The Ambiguity Resolution Protocol (ARP)

### 3.1 Why it exists

The governing instruction: *"the mechanism of clarifying clarity in problem statement by prompting
users or/and self prompting (higher priority than clarifying, when self prompting can resolve then
self prompting, only those critical questions should clarify with users) should be included
throughout the entire hipcortex lifecycle for any goals definition / acceptance criteria /
validation and testing planning / unknown / uncertainty / planning / ReAct loop etc with exit
(avoid indefinite loop self prompting/clarifying)."*

Two forces must be reconciled, and they pull in opposite directions:

- Veridian's **invariant** is that *the agent does not decide whether it succeeded* and that
  **`INCONCLUSIVE` is not `PASS`**. So Veridian must never quietly invent a missing value.
- The same instruction demands that Veridian **prefer self-resolution over bothering the user**.

The reconciliation is the whole design: **ambiguity is a first-class, recorded artifact, and it is
resolved by a bounded ladder whose every rung is either derivable, conservative, or reported.**

### 3.2 The artifact

```ts
type AmbiguityOrigin =
  | "goal" | "acceptance" | "environment" | "validation" | "execution" | "evidence";

type AmbiguityKind =
  | "missing_value"       // a required value is absent           (goal: "improve performance" — by how much?)
  | "underspecified"      // present but does not determine behaviour (criterion has no selector)
  | "ambiguous_reference" // two or more readings are possible   (criterion names "the button")
  | "conflicting"         // two criteria contradict             (AC-002 expects 2, AC-003 expects 3)
  | "unresolvable_entity";// names something that cannot be found (validator "web.foo.bar")

interface Ambiguity<T = unknown> {
  id: string;              // stable, deterministic — derived from origin+path+kind
  origin: AmbiguityOrigin;
  path: string;            // JSON pointer into the originating artifact
  kind: AmbiguityKind;
  question: string;        // the exact question that would resolve it
  blocking: boolean;       // see 3.4 — computed, not asserted
  candidates?: T[];        // discrete choices, when the space is enumerable
  defaultValue?: T;        // present ONLY when a fail-safe value exists
  context: Record<string, unknown>;
}
```

Every ambiguity carries the **question** it would take to resolve it. That is what makes the same
object usable by DERIVE, by INFER, by the run itself, and by a human — the resolution machinery is a
set of attempts to answer that one string.

### 3.3 The ladder

Rungs are attempted in strict order. The first rung that produces a value wins, and the win is
recorded with its provenance.

```
        ┌─ 1. DERIVE    deterministic — computed from the contract, the repo, the spec.
        │               cost 0, confidence 1.0, never asks.
        ├─ 2. INFER     sample the memory substrate (HipCortex reflect / search).
        │               accepted only at confidence ≥ policy.inferThreshold (default 0.7).
        ├─ 3. DEFAULT   apply `ambiguity.defaultValue`.
        │               permitted only when the value is fail-safe (see A8/A3.4).
        ├─ 4. SELF-PROMPT  put the question to the run itself, from material it already holds.
        │               accepted only at confidence ≥ policy.selfPromptThreshold (default 0.8,
        │               deliberately ABOVE inferThreshold), and bounded three ways (§3.5).
        ├─ 5. ASK       put the question to a human.
        │               permitted only when: blocking ∧ budget remaining ∧ batched.
        └─ 6. DEFER     no value. The affected criterion becomes INCONCLUSIVE.
                        The run cannot be PASS. This is the exit.
```

**Rung 4 is the one rung that is not a straight line**, because it may put one gap to the self more
than once — which is why it is the one rung with bounds of its own. The whole safety argument for
letting a run answer itself is in the narrowness of the port: it may **eliminate** a candidate the
contract already offered, and it may never **invent** one. An answer must cite the material that
corroborated it (`grounds`), so the bundle distinguishes "the run read this off its own contract"
from "the run guessed". A prompt with no grounds is a guess in a costume.

```ts
type Resolution =
  | { via: "derived";  value: unknown; evidence: string }
  | { via: "inferred"; value: unknown; confidence: number; source: string }
  | { via: "defaulted"; value: unknown; assumption: string }
  | { via: "self_prompted"; value: unknown; confidence: number; grounds: string; rounds: number }
  | { via: "answered"; value: unknown; answer: string }
  | { via: "deferred"; reason: DeferReason };
```

`via` is the provenance that ends up in the evidence bundle. **A run whose result depends on a
`defaulted` or `answered` resolution is not reproducible unless the resolution is recorded** — this
is the reason the protocol writes to evidence rather than resolving silently (§19, §56).

### 3.4 The classifier — why ASK is rare

`blocking` is **computed**, never supplied by the caller:

```ts
blocking(a) :=
     a.path lies on a mandatory criterion's PASS/FAIL semantics
  ∨ a.path makes an action or criterion unexecutable
  ∨ a.path changes the meaning of the environment definition;
```

and DEFAULT is gated by `failSafe`:

```ts
failSafe(v) := selecting v cannot make the run report PASS more readily than the truth.
```

These two predicates do the load-bearing work. Everything that is cosmetic, optional, or
non-semantic is `non_blocking` → it can never reach ASK, by construction rather than by budget.
And every `blocking` ambiguity that *does* have a fail-safe default is DEFAULTed, so it never
reaches ASK either. ASK is reserved for **semantic ambiguity with no safe value** — which in
practice is a small, genuinely human-answerable set.

### 3.5 The exit — every loop has a bound

An indefinite self-prompting loop is prevented structurally, not by convention:

| Stop | Default | Effect |
|---|---|---|
| *(structural)* | — | Rungs 1-3 and 5-6 are attempted **at most once each**, so the ladder is a straight line through six steps. Only rung 4 may repeat. |
| *(structural)* | — | A `non_blocking` ambiguity can never reach ASK, and rung 4 may close one without spending a question. |
| `maxSelfPromptRoundsPerAmbiguity` | 2 | How many times **one gap** is put to the self. One refinement is worth affording; a third attempt is a loop wearing a budget's clothes. |
| `maxSelfPromptRoundsPerRun` | 10 | Hard cap on self-prompt rounds for an entire run, so rung 4 cannot become the slow path. |
| `selfPromptBudgetMs` | 60 000 | Wall-clock ceiling on the self-prompting rung **alone** - the bound an attempt cap cannot replace, because a port that never resolves would sit inside one round forever. |
| `maxQuestionsPerRun` | 5 | Hard cap on human interruptions for an entire run. |
| `maxQuestionsPerRound` | 3 | Questions are batched into rounds, not asked one at a time. |
| `budgetMs` | 120 000 | Wall-clock ceiling on the whole clarification phase. |

**Every bound is checked *before* an attempt**, so the worst case is a bound that was already
reached rather than one that is one over. The three rung-4 bounds are not redundant: the per-gap cap
stops a stubborn question, the per-run cap stops a contract full of gaps, and the clock stops a
single round that never returns. Each is exercised by its own test, and each test was falsified by
deleting its bound.

Exhaustion is **not** an error to paper over. It sets `via: "deferred"`, marks the affected criteria
`INCONCLUSIVE`, and the run terminates `ABORTED` with `insufficientInformation: true`. That is the
mechanism by which "I could not find out" stays distinguishable from "it passed" — the same
principle as `INCONCLUSIVE ≠ PASS`, applied to the input side rather than the output side.

### 3.6 Where it attaches (the "throughout the lifecycle" requirement)

The ARP is not a step; it is a **phase that every stage can enter**. Each stage declares its
ambiguity detectors as pure functions, and the engine runs them over the artifact before the stage
proceeds:

| Stage | Detector | Example ambiguity |
|---|---|---|
| Goal definition | `detectGoalAmbiguities` | goal names no observable success condition |
| Acceptance criteria | `detectAcceptanceAmbiguities` | criterion has no `expected`; two criteria conflict |
| Environment definition | `detectEnvironmentAmbiguities` | no start command; no port; no health path |
| Validation planning | `detectValidationAmbiguities` | expectation names no registered validator |
| Execution | `detectExecutionAmbiguities` | an action's target cannot be resolved at runtime |
| Evidence | `detectEvidenceAmbiguities` | required artifact absent |
| **ReAct loop** | `detectIterationAmbiguities` | the failure artifact does not identify a repair |

Each detector is a pure function `(artifact, ctx) => Ambiguity[]`. Any stage with an unresolved
`blocking` ambiguity **does not proceed** — it either resolves or defers. That is what makes the
protocol cohesive rather than bolted on: the stages have no other way to proceed past a gap.

### 3.7 Surfaces

- **Self-prompt port** — `SelfPromptPort` for rung 4. Implementations: `createSelfPromptPort`
  (the CLI's real port: a candidate is accepted only if the contract's own material, or the gap's own
  `context`, corroborates it), `scriptedSelfPromptPort` (tests), `NullSelfPromptPort`
  (headless/CI, and the behaviour that predates the rung - the ladder degrades to a straight line).
  `available: false` is what the null port reports, so the run's `selfPromptRounds` stays a count of
  work *done* rather than of capability *present*; a capability count beside a work count is how a
  bundle comes to describe a run that did not happen.
- **User prompt port** — `UserPromptPort`. Implementations: `createCliPromptPort` (interactive),
  `scriptedPromptPort` (tests, and the deterministic answer key for repeat runs), `NullPromptPort`
  (headless/CI → forces DEFER rather than a hang). *A headless run returns `INCONCLUSIVE`, it does
  not block forever.* That is the anti-hang guarantee at the human boundary.
- **Memory port** — `MemoryPort` for rung 2. `NullMemory` (no-op) and `HttpMemory`
  (the real substrate). Rung 2 degrades to a skip when memory is unavailable; it never fails a run.
  A *refusal* (a non-2xx whose body names a precondition, e.g. a content gate) is not an
  unreachability, and the log says so — the client carries the status **and** the substrate's own
  stated reason into the warning instead of asserting a cause it did not observe.
- **Recording** — `<run>/clarifications.json` in the evidence bundle, and a
  `ClarificationReport` for the run summary.

---

## 4. The validation loop (the ReAct loop, correctly scoped)

Spec §22 calls this a ReAct/CodeAct loop; §21 draws the boundary that decides what Veridian may
own. Veridian's loop is therefore **not** an agent loop. It is a **validation loop that pauses for
an external actor to think**.

```
        ┌──────────────────────────── PREPARE ────────────────────────────┐
        │  environment.create() → start() → deploy() → health check       │
        │  (health check failure ⇒ ENVIRONMENT_FAILURE, never a test fail)│
        └────────────────────────────────┬────────────────────────────────┘
                                         ▼
   EXECUTE  deterministic action sequence planned from the acceptance contract
                                         ▼
   OBSERVE  adapter.observe() → typed Observation[]  (screenshots, traces, DOM, process)
                                         ▼
   VALIDATE Validator.validate(criterion, observation) → ValidationResult
                                         ▼
   ROLLUP   results → criterion statuses → run verdict   ◄── the M3 false-PASS guard
                                         ▼
   EVIDENCE write the bundle: goal, acceptance, environment, log, result,
            screenshots, trace, clarifications
                                         ▼
   DECIDE   PASS  → COMPLETED
            else  → failure artifact (.veridian/latest-result.json,
                    .veridian/latest-failure.md) → RESETTING → READY
                                         ▼
   REPAIR   RepairGate.awaitRepair()   ◄── THE BOUNDARY. Veridian does not repair.
                                         ▼
            iterate, until PASS or maxIterations(10) or maxRuntime
```

**`RepairGate` is the agent boundary made executable.** Veridian hands the world back and waits:

| Implementation | Used by | Behaviour |
|---|---|---|
| `ScriptedRepairGate` | tests | applies a known patch per iteration — makes the loop deterministically provable |
| `CommandRepairGate` | CLI | runs an external command (an agent CLI, a script) |
| `ManualRepairGate` | CLI | writes the failure artifact and waits for a human |
| `NoRepairGate` | CI / headless | **stops after iteration 1 with FAIL** — no infinite loop by construction |

The loop's stop condition is the acceptance contract itself: *all mandatory criteria `PASS`, the
environment valid, no safety violation, all required evidence present*. Anything else is not a stop.

---

## 5. Module map

Each entry is a bounded unit with one responsibility. `*.test.ts` files sit beside their source.

```
core/clarification/   types · detect · derive · pointer · engine · index        (the ARP)
core/schema/          validate · registry                (the JSON-Schema subset Veridian needs)
core/run/             types · id · state-machine        (transitions, terminals, guards)
core/validation/      types(ValidationResult, FAILURE_TAXONOMY) · registry · rollup
core/acceptance/      types · load · plan                (contract → executable step sequence)
core/goal/            types · load · index               (parse + ARP pass + persist)
core/environment/     adapter(interface) · types(incl. boundary vocabulary) · load · manager(lifecycle, health, reset) · web-observation
core/evidence/        types · writer                     (the run bundle)
core/execution/       types(ports, repair gate) · repair · loop   (the ReAct loop)
core/memory/          types · memory · index             (optional; never required to run)
core/metrics/         metrics(M1..M5) · history          (measurements over run bundles)
core/definition.ts    DEFINE: goal + acceptance + environment → a resolved plan
core/io.ts · core/process.ts · core/failure.ts          (ports, and the failure taxonomy)
validators/playwright/ web-ui-validators   (element · visible · text · value · count · url · console · network)
adapters/local-web/   browser-port(seam) · playwright-browser(lazy) · local-web-environment
cli/                  arguments · support · veridian.ts  (validate · clarify · init · metrics · help)
examples/shopping-cart/  app/(index.html · cart.js · serve.mjs) · defects.ts · repair.ts · demo.ts
                         goal.yaml · acceptance.yaml · environment.yaml
schemas/              goal · acceptance · environment · run · result · ambiguity
scripts/              e2e-install.mjs                    (the Playwright bootstrap, `.mjs` on purpose)
.veridian/            runtime state (gitignored)
```

**`acceptance/veridian-mvp.yaml` — Veridian judged by its own tool — is not built, and the MVP
cannot express it.** This section and step 9 of §7 both call for it, and the intent behind them is
right: dogfooding is the only honest proof that the product works on a target nobody designed it
for. But the MVP has exactly one adapter (`REGISTERED_ADAPTERS` is `["local-web"]`) and all eight
registered validators are *browser* observations, so a contract about a CLI has no validator able to
judge a single criterion. Every one of them would be `INCONCLUSIVE` and the run would exit 2 — the
same defect as `--browser none` on the canonical demo, where a contract that cannot be observed is
reported as a contract that was not observed. *A demo that cannot demonstrate is not a demo.*

Expressing it needs a **non-web** adapter or validator (`process`, `file`, `command`), which §8 and
the hard scope boundary forbid building speculatively. So the gap is recorded rather than papered
over, and it is the one place the plan is internally inconsistent: its own scope boundary forbids
the step that proves the scope was met. Veridian's self-validation today is its own `node --test`
suite, which `npm run gate` actually runs — real, but not the same claim as validating itself.

**Status: landed — and the argument above is kept as the record of why it could not be written
inside the MVP.** That argument was correct about the MVP and is wrong about the tree that followed
it, which is why it is preserved rather than rewritten. Twelve adapters are registered and eleven of
them need no browser, so `acceptance/veridian-mvp.yaml` exists, its criteria are judged by the
`local-process` family, and `npm run acceptance` runs the contract **twice** and requires both passes
to agree — because a single run on a fresh checkout would pass over a world that never rebuilt.
`acceptance/ladder/` is the second self-acceptance route and judges a different claim: not the
command line as a product but a *run* as a witness, reading each nested run's own `latest-result.json`
for the rung a gap reached. **A reader who wants the current answer should read the directory rather
than this paragraph**, which is the same rule §1's table follows with its Status column: the decision
recorded in place, and the tree beside it.

**Layering rule, enforced by imports:** `core/*` may not import `adapters/*`, `validators/*`,
`cli/*` or `mcp/*`. The Core defines the interfaces; adapters and validators implement them; the CLI
and the MCP surface wire them. This is the mechanical guarantee of *"VS Code ≠ Veridian"* extended to
every surface: **the Core cannot depend on any particular client, so any client can be added later.**
That sentence was written when `cli/` was the only consumer and it was vindicated by the fourth one
landing without a `core/` change - which is the reason the list above is a list of *prohibitions*
rather than of clients, and the reason `mcp/*` belongs in it.

---

## 6. Verification strategy

Two distinct things are proven, and they are proven differently. (AGENTS.md's tests instruction
already separates them; this is the concrete application.)

### 6.1 Veridian's own tests — offline, deterministic, no browser, no network

| Layer | What is proven |
|---|---|
| `clarification` | The ladder order is respected; the classifier marks exactly the semantic cases blocking; every rung is recorded with the right `via`; **each budget stop fires, including rung 4's three**; `non_blocking` never reaches ASK; exhaustion produces `deferred` and never a value. |
| `run/state-machine` | Every legal transition; every illegal transition rejected; all four terminal states absorbing; `MAX_ITERATIONS` reachable and absorbing. |
| `validation/rollup` | **The false-PASS guard, adversarially:** all-PASS + invalid env ⇒ not PASS; all-PASS + safety violation ⇒ not PASS; all-PASS + missing required evidence ⇒ not PASS; one `INCONCLUSIVE` ⇒ not PASS; optional criteria excluded from the roll-up. |
| `validation/types` | A throwing validator classifies `VALIDATOR_ERROR`, never `TEST_FAILURE`. |
| `acceptance/plan` | Contract → step sequence; a missing selector is caught by the ARP before execution. |
| `environment/manager` | A failed health check is `ENVIRONMENT_FAILURE`; `reset()` is asserted by **observable clean state**, not by call count (M4). |
| `execution/loop` | The full `FAIL → PARTIAL → PASS` sequence with `ScriptedRepairGate`; `NoRepairGate` stops at iteration 1; `maxIterations` yields `MAX_ITERATIONS`. |
| `local-web` | Against a fake `ProcessRunner`: start, health, stop, and a reset that kills and respawns. |
| `validators/playwright` | Against a fake `BrowserPort` — the seam tests.instructions.md mandates. |
| `evidence/writer` | Bundle completeness (M5): every required artifact is written for every terminal state. |

### 6.2 The product demo — needs Playwright, shipped complete, opt-in

`examples/shopping-cart` runs against a real browser via two commands the user chooses to run:

```
npm run e2e:install     # npm i -D playwright ; npx playwright install chromium   (~150 MB)
npm run e2e             # the canonical demo: FAIL → repair → PARTIAL → repair → PASS
```

**Verified without Playwright, today:** that its absence produces a correctly classified
`ENVIRONMENT_FAILURE` and *not* a PASS and *not* a crash. That is the negative path, and it is the
one that must not be wrong.

---

## 7. Execution order

```
1  manifest + tsconfig + .gitignore + .nvmrc            (engines: node >=22.18)
2  schemas/*.schema.json                                (the machine-readable contracts)
3  core/clarification                                   (ARP — the requested mechanism)
4  core/run, core/validation                            (state machine, verdicts, taxonomy)
5  core/goal, core/acceptance                           (contracts + ARP detectors)
6  core/environment, core/evidence                      (adapter iface, bundle writer)
7  core/execution                                       (ports, repair gate, controller, loop)
8  adapters/local-web, validators/playwright            (the two MVP adapters)
9  cli                                       (drive it; the self-validation contract landed later - see §5)
10 examples/shopping-cart                               (the canonical demo)
11 integration test: full loop, offline                 (the proof)
12 gate: tsc --noEmit  +  node --test                  (no prettier - see §1, row 3)
13 AGENTS.md updated with real commands and layout; decisions recorded in HipCortex
14 published model settled: clone (`LICENSE` + `.github/workflows/ci.yml` + `README` install path)
```

Steps 3–7 are the Core and are ordered by dependency, not preference: the ARP is first because
every later stage's detectors are written against its types, and because it is the mechanism the
request centred on.

---

## 8. What this design deliberately does not do

- **No goal compiler.** The ARP answers questions; it does not translate intent into a goal
  language or infer objectives. It resolves *gaps in a contract a human already wrote*.
- **No agent orchestration.** `RepairGate` hands control back. Veridian never prompts a model,
  never chooses a repair, never ranks repair strategies.
- **No browser automation of our own.** `BrowserPort` is a seam; Playwright implements it.
- **No MCP server.** The CLI is the MVP surface. The Core interface is MCP-shaped in the sense that
  it is transport-agnostic — which is all this step requires.
- **No speculative abstraction.** One adapter, one validator family, one client. The layering rule
  keeps the *door* open for more; nothing is built for a case that does not yet exist.
- **No npm package, and no build step — reversed.** This item originally read *"Veridian is installed
  by cloning it"* and listed what publishing would need: a compile step (`tsc` to `dist/*.js` with
  `rewriteRelativeImportExtensions`), a published-files allowlist, a location-independent resolver
  for `schemas/`, and a smoke test that drives the *built* CLI — because a shipped `dist/*.js` that no
  test touches is precisely the unverified claim this project refuses to make. That list was correct,
  and it is now the specification the build was measured against: all four exist. See AGENTS.md
  `## Distribution`, assumption A11, and
  [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./DISTRIBUTION-AND-ENVIRONMENTS.md).
  **The registry path was declined rather than pending, and is now taken** — the request is to ship a
  tool others install and run, which a clone alone does not satisfy. `private: true` is gone, replaced
  by `prepublishOnly` (must pass the gate) and `prepare` (must build), which are guards a broken
  package can actually trip, unlike a flag that only says "do not publish this by accident".
  **The build step is still not the way the code runs.** The source tree is the program; `dist/` is a
  second copy for people who install it, and `npm run smoke:dist` is the check that the second copy
  works, because no test in `tests/` can reach it.

---

## 9. Built after this plan: boundary enforcement

One thing the MVP shipped without, found by auditing the tree rather than by running a demo: the
`PASS` rule's third clause — *"there was no safety violation"* — could not be false. `networkPolicy`
and `filesystemWrite` were declared, defaulted, parsed and recorded, and read by nothing that could
act on them; `rollup`'s `noSafetyViolation` guard was implemented and tested against a value the CLI
never set; and `core/evidence/writer.ts` wrote `safetyViolation: null` as a literal, so even a
detected violation could not have reached a bundle.

The structural cause is the `--browser none` lesson one layer down: `EnvironmentPlan` carried no
boundary, so an adapter — which sees only the plan — could not enforce one even in principle. So the
fix starts where the plan is built and runs forward through the adapter, the loop and the bundle, and
it changes no verdict rule: `SECURITY_VIOLATION → FAIL` already existed and was merely starved.

```
core/goal/types.ts          GoalLimits.networkAllowList          (F5: allow-list had no parameter)
core/environment/types.ts   BoundaryPolicy/BoundaryReport        (shared vocabulary)
core/environment/load.ts    plan.boundary                        (the fact reaches the plan)
adapters/local-web/         a route guard it can hold, and an honest report for the rest
core/execution/loop.ts      the verdict reads the world's crossings, live
core/evidence/writer.ts     the violation is written, and the policy is paired with its enforcement
```

The audit, the six self-prompted questions that scoped it, the four-move design and what the
implementation changed about the design are in
[`BOUNDARY-ENFORCEMENT.md`](./BOUNDARY-ENFORCEMENT.md). Two rules were paid for and are recorded in
AGENTS.md: *a guard no code path can trip is not a guard*, and *a reset restores the world, not the
record*.

