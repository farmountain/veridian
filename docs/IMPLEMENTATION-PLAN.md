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

**Deferred, with the reason:**

| Deferred | Why |
|---|---|
| `extension/vscode/` (Veridian Cockpit) | The spec is explicit: *"VS Code ≠ Veridian."* The extension is a thin client over the Core interface. Building it before the CLI proves the same interface would freeze the wrong shape. The Core is designed so the CLI, the extension, CI and MCP can all drive it — but only the CLI is built. |
| Level-3 MCP integration | Spec §23 marks it out of MVP. *"MCP is the door. Veridian is the building."* |
| Kubernetes / cloud / mobile / VM adapters | Spec §9 excludes them from MVP. |
| Goal compiler, marketplace, plugin system | Spec §55 forbids them. |

**Dependencies — one runtime package, two dev packages, and no framework:**

| Kind | Package | Justification |
|---|---|---|
| runtime | `yaml` | Spec §48/§49 make YAML a first-class persistence format (`goal.yaml`, `acceptance.yaml`, `config.yaml`). Hand-rolling a YAML parser would be a far larger, riskier surface than a single well-known dependency. |
| dev | `typescript` | Typecheck-only gate (`tsc --noEmit`). Node 22.18 strips types at runtime, so there is **no build step** and no bundler. |
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
| A11 | Distribution model | DERIVE | **A clone, not an npm package.** Node 22 type-stripping is unavailable under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, verified for the import path and for the `bin` path alike), and the schema set resolves through a port rooted at `process.cwd()`, so an installed CLI would report a missing goal schema sitting inside its own package. `PLAN.md` §56 asks for the weaker thing: *"a developer can clone the repository"*. `private: true` is therefore retained so the registry path cannot be taken by accident. |
| A12 | Licence | DEFAULT | **MIT**, `Copyright (c) 2026 Liew Keong Han`. The manifest said `UNLICENSED`, which denies the thing the request asks for: a tool others install and run. Choosing a licence is the user's call in principle; MIT was chosen because it is the least restrictive, the most easily reversed, and it leaves `private: true` meaningless as a publish trigger. |

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
object usable by DERIVE, by INFER, and by a human — the resolution machinery is a set of attempts
to answer that one string.

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
        ├─ 4. ASK       put the question to a human.
        │               permitted only when: blocking ∧ budget remaining ∧ batched.
        └─ 5. DEFER     no value. The affected criterion becomes INCONCLUSIVE.
                        The run cannot be PASS. This is the exit.
```

```ts
type Resolution =
  | { via: "derived";  value: unknown; evidence: string }
  | { via: "inferred"; value: unknown; confidence: number; source: string }
  | { via: "defaulted"; value: unknown; assumption: string }
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

### 3.5 The exit — four independent stops

An indefinite self-prompting loop is prevented structurally, not by convention:

| Stop | Default | Effect |
|---|---|---|
| `maxRungsPerAmbiguity` | 3 | An ambiguity cannot be retried forever; rungs are attempted at most once each. |
| `maxQuestionsPerRun` | 5 | Hard cap on human interruptions for an entire run. |
| `maxQuestionsPerRound` | 3 | Questions are batched into rounds, not asked one at a time. |
| `budgetMs` | 120 000 | Wall-clock ceiling on the whole clarification phase. |
| *(structural)* | — | A `non_blocking` ambiguity can never reach ASK. No budget is consumed by them. |
| *(structural)* | — | No rung is retried. The ladder is a straight line, so it terminates in ≤ 5 steps by construction. |

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

- **User prompt port** — `UserPromptPort`. Implementations: `CliPromptPort` (interactive),
  `ScriptedPromptPort` (tests, and the deterministic answer key for repeat runs), `NullPromptPort`
  (headless/CI → forces DEFER rather than a hang). *A headless run returns `INCONCLUSIVE`, it does
  not block forever.* That is the anti-hang guarantee at the human boundary.
- **Memory port** — `MemoryPort` for rung 2. `NullMemory` (no-op) and `HttpHipCortexMemory`
  (the real substrate). Rung 2 degrades to a skip when memory is unreachable; it never fails a run.
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
core/environment/     adapter(interface) · types · load · manager(lifecycle, health, reset) · web-observation
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

**Layering rule, enforced by imports:** `core/*` may not import `adapters/*`, `validators/*`, or
`cli/*`. The Core defines the interfaces; adapters and validators implement them; the CLI wires
them. This is the mechanical guarantee of *"VS Code ≠ Veridian"* extended to every surface: **the
Core cannot depend on any particular client, so any client can be added later.**

---

## 6. Verification strategy

Two distinct things are proven, and they are proven differently. (AGENTS.md's tests instruction
already separates them; this is the concrete application.)

### 6.1 Veridian's own tests — offline, deterministic, no browser, no network

| Layer | What is proven |
|---|---|
| `clarification` | The ladder order is respected; the classifier marks exactly the semantic cases blocking; every rung is recorded with the right `via`; **each of the four budget stops fires**; `non_blocking` never reaches ASK; exhaustion produces `deferred` and never a value. |
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
9  cli                                       (drive it; the self-validation contract is deferred - see §5)
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
- **No npm package, and no build step.** Veridian is installed by cloning it. Publishing to a
  registry needs a compile step (`tsc` to `dist/*.js` with `rewriteRelativeImportExtensions`), a
  published-files allowlist, a location-independent resolver for `schemas/` and the demo's
  HTML/CSS, and a smoke test that drives the *built* CLI — because a shipped `dist/*.js` that no
  test touches is precisely the unverified claim this project refuses to make. See AGENTS.md
  `## Distribution` and assumption A11.
