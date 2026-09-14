# Veridian

**The sandbox testing and validation layer for AI coding agents.**

Coding agents are good at producing code and have an *environmental* problem: they cannot tell
whether their code actually works. An agent saying "I believe this is fixed" is not a result.

Veridian gives a purely external agent a real, isolated, reproducible world in which its generated
software can be deployed, executed, interacted with, observed, validated against explicit acceptance
criteria, reset, rerun - and accompanied by machine-verifiable evidence.

```
Agent = Actor        Environment = World        Validator = Judge        Evidence = Proof
```

Two rules govern every design decision here. A proposal that violates either is wrong.

1. **The environment is the product. The agent is a client of the product.**
2. **Do not build the intelligence that creates the software. Build the world that determines
   whether the software actually works.**

So the boundary is explicit. Veridian owns the environment, execution, observation, validation,
evidence, reset and iteration state. The external agent owns reasoning, code modification and repair
strategy. Veridian never decides *how* to write the code; it decides *whether the code works*.

---

## Getting started

Veridian is installed by cloning it. There is no npm package (see
[Why there is no npm package](#why-there-is-no-npm-package)) and **no build step**: the source is
TypeScript and Node runs it directly. Requires **Node 22.18.0 or newer**.

```bash
git clone <this-repository-url> veridian
cd veridian
npm ci                    # runtime dependency: yaml. dev: typescript, @types/node.
npm run gate              # tsc --noEmit, then the whole test suite. 373 tests, under a second.

npm run e2e:install       # one-time, ~150 MB: fetch the Playwright browser
npm run demo              # the canonical demo: 3 defects, FAIL -> repair -> PASS
```

Run those four in that order. `npm ci` removes `node_modules` and rebuilds it from the lockfile, and
Playwright is installed **outside** the lockfile on purpose, so installing the browser before `npm ci`
would discard it.

To point Veridian at your own application, write a goal, an acceptance contract and an environment
document (their shapes are under [Goal, contract and environment](#goal-contract-and-environment)),
then:

```bash
node cli/veridian.ts clarify --goal my-app/goal.yaml    # resolve every gap first; starts nothing
node cli/veridian.ts validate --goal my-app/goal.yaml   # run it, validate it, write the bundle
```

`npm run demo` asks the environment document for its browser, so the progression actually runs. If
Playwright is not installed it says so and tells you the one command that fixes it.

`npm run demo:no-browser` runs the same demo with `--browser none`. Every criterion in the contract is
a browser observation, so that run **must** end `INCONCLUSIVE` with exit 2. It is a deliberate
demonstration of the refusal - not the demo, and not a pass. It also prints the warning that a run
planned without a browser has nothing that can refuse a request on the application's behalf, so the
`networkPolicy: deny` the goal declares was recorded as `unsupported` for that world:

```
veridian warning: boundary (declared=networkPolicy: deny enforcement=unsupported reason=the run was
planned without a browser, so nothing can refuse a request on its behalf)
```

### Why there is no npm package

This is a decision with evidence behind it, not an oversight. Node refuses to strip types for files
under `node_modules`:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for
files under node_modules
```

That applies to a package's `bin` as well as to an import, so `npm install -g veridian` could not run
the TypeScript source it would deliver. Two independent facts point the same way: the schema set is
loaded through a port whose root is the process working directory, so an installed CLI would not find
its own `schemas/`; and Playwright is deliberately **not** a dependency, so an installed Veridian
would be a tool that cannot observe anything until its user adds one.

Shipping to a registry therefore needs a build step, a packaging design and a peer-dependency story -
and the MVP Definition of Done asks for something else: *"a developer can clone the repository"*. So
the shipped model is a clone, `bin` is what `npm link` and `node_modules/.bin` use from that clone,
and **the registry path is declined**, with its cost recorded in
[`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md), rather than left open. `package.json`
stays `private: true`, which is the guard that keeps a package that cannot work from being published
by accident.

---

## The canonical demo, verbatim

`examples/shopping-cart` is a static page with client-side cart logic and three defects injected at
run time (`D1-quantity-ignored`, `D2-wrong-tax-rate`, `D3-removal-no-render`). Four acceptance
criteria judge it. `npm run demo` produces (elided: one block per criterion per iteration, with the
run id and paths abbreviated):

```
demo: injected 3 defect(s): D1-quantity-ignored, D2-wrong-tax-rate, D3-removal-no-render
veridian info: running (run=... criteria=4 repair=--repair node .../repair.ts browser=chromium ...)

PASS  (COMPLETED, 4 iteration(s))
  environment valid
  FAIL         AC-001
               Expected the text of `#subtotal` to equal "$20.00", but it is "$10.00".
  FAIL         AC-002
               Expected the text of `#tax` to equal "$1.60", but it is "$1.00".
  FAIL         AC-003
               Expected the number of elements matching `#cart-body tr` to equal 0, but it is 1.
  PASS         AC-004
  PASS         AC-001
  ...
  PASS         AC-001
  PASS         AC-002
  PASS         AC-003
  PASS         AC-004
  reason     4/4 mandatory criteria passed, environment valid, no safety violation, evidence complete.
demo: the run exited 0
```

That is the point of the project: **the agent generated code, and the code was proven to work in a
real sandbox.** Each iteration repaired one defect, so the failure set shrank
`{AC-001, AC-002, AC-003}` -> `{AC-002, AC-003}` -> `{AC-003}` -> `{}`.

The bundle for that run lands in `.veridian/runs/<run-id>/`: the definition it was given, the
environment record, the execution log, the result, a screenshot and a Playwright trace per criterion,
and `failure.md`. `.veridian/latest-result.json` and `.veridian/latest-failure.md` are the artifacts
an external agent reads to learn what failed **without Veridian having to drive it**.

---

## What a run does

Every environment, however exotic, exposes the same lifecycle:

```
DEFINE -> CREATE -> START -> DEPLOY -> EXECUTE -> OBSERVE -> VALIDATE
       -> COLLECT EVIDENCE -> PASS/FAIL -> RESET -> REPEAT
```

```
CREATED -> PREPARING -> READY -> EXECUTING -> OBSERVING -> VALIDATING
                            PASS -> COMPLETED
                            FAIL -> FAILED -> RESETTING -> READY   (next iteration)
```

Terminal states: `COMPLETED, ABORTED, ERROR, MAX_ITERATIONS`. There are no ambiguous paths, and every
loop has a bounded exit: `maxIterations` (10 in the MVP), `maxRuntimeMs`, `maxCriterionMs`.

### Invariants

- **The agent does not decide whether it succeeded.** A verdict is computed from criteria, not
  asserted.
- **`INCONCLUSIVE` is not `PASS`.** Nothing collapses a non-decisive status into success. A run is
  `PASS` only if every mandatory criterion passed **and** the environment was valid **and** there was
  no safety violation **and** all required evidence exists.
- **A declared boundary is an enforced one, or it is reported.** The third of those four clauses is
  evaluated, not assumed: the adapter refuses what it can and reports what it refused, a crossing
  fails the run with `SECURITY_VIOLATION`, and a boundary the adapter cannot hold is recorded as
  `unsupported` in `environment.json` instead of being left to read as `enforced`. A guard nobody can
  trip is not a guard.
- **Failures are classified, never flattened into "test failed":** `TEST_FAILURE`,
  `ENVIRONMENT_FAILURE`, `VALIDATOR_ERROR`, `APPLICATION_ERROR`, `TIMEOUT`, `SECURITY_VIOLATION`,
  `INFRASTRUCTURE_FAILURE`, `RESET_FAILURE`, `UNKNOWN`.
- **Reset is first-class.** A criterion never inherits the process, DOM or browser state of an earlier
  one. Reset is part of the product, not test cleanup.
- **Reproducibility is recorded, not assumed:** git commit and dirty state, app version, runtime,
  browser and Playwright versions, OS, env config, seed, network policy, dependency versions, timestamp.
- **Evidence is not decoration.** It is part of the result.

### Criterion statuses

`PASS | FAIL | ERROR | SKIPPED | INCONCLUSIVE`

`INCONCLUSIVE` is what a validator reports when it could not observe - no browser was planned, a page
failed to load, a dependency is missing. It is the honest answer, and the loop treats it as one: a
repair cannot change a criterion nobody observed, so the run stops rather than iterating in the dark.

---

## The command line

```bash
node cli/veridian.ts <command> [flags]      # or: npm run veridian -- <command> [flags]
```

| Command | What it does |
|---------|--------------|
| `validate` | Define the goal, then run it and validate the result. |
| `clarify` | Resolve the goal's ambiguities and print the transcript. Starts nothing. |
| `init` | Create the state directory and a starter configuration. |
| `metrics` | Report M1..M5 over the runs on disk. Reads bundles; runs nothing. |
| `help` | Usage. |

The flags that matter most:

```
--goal <path>         goal document to run                (default goal.yaml)
--state-dir <path>    where run bundles are written       (default .veridian)
--repair <cmd> [args] repair the app between iterations   (must be last)
--no-repair           observe exactly once
--browser <choice>    auto | playwright | none            (default auto)
--defects <ids>       metrics: criteria a known defect was expected to break
```

Exit codes:

```
0  PASS - every mandatory criterion passed with its required evidence present.
1  FAIL - at least one mandatory criterion failed.
2  INCONCLUSIVE, or a definition that could not be resolved. Neither is success.
3  The command line itself was unusable, or this build cannot run the requested goal.
```

A definition that will not load - a missing file, a schema violation, a truncated document - is a
*caller* problem rather than a verdict, so it exits 3 and never 1. Exit 1 is the one code a caller
acts on, and "the application under test failed" is not what happened. The commands that ask a
different question answer with the same codes for their own question: `metrics` exits 0 when the
history is clean, 1 when a metric was violated, and 2 when there is no run to measure, because an
empty history is `INCONCLUSIVE` rather than success.

`--browser` is a statement about *this run's world*, so it is applied to the environment plan before
anything is built from it. That is why `--browser none` reports "the environment was planned with
`browser.enabled: false`" rather than blaming a missing dependency it never checked.

---

## The success metrics

Not LOC, not adapter count. These five decide whether the MVP works, and `veridian metrics` measures
them over the bundles on disk:

```
M1 result consistency:     the same code produces the same per-criterion result twice
M2 defect detection:       100% of the canonical demo's known defects are caught
M3 false PASS:             zero - a run that passes while a known defect is present is a failure
M4 reset reproducibility:  every iteration after the first was preceded by a real reset
M5 evidence completeness:  every required piece of evidence arrived
```

They live in `core/metrics/` as pure functions over a reading of the bundles, **not** as acceptance
criteria - no browser can observe "the same code gave the same result twice", so a web contract for
them would be a lie. `--defects` is the ground truth M2 and M3 need; without it they report
`INCONCLUSIVE` rather than a comfortable pass, because Veridian cannot derive what a defect was
*intended* to break from what a run happened to observe.

A real output, over a history that mixes browser and browserless runs (elided: one line per differing
criterion, per compared run):

```
runs measured: 5 (+6 unreadable)
  unreadable: run-...-071737-8b28df: result.json does not carry the per-iteration criteria M1 compares
M1 result consistency: no (5 runs, baseline run-...-072554-d0b295)
  run-...-073547-3e0c91 vs run-...-072554-d0b295: iteration 1 AC-001: INCONCLUSIVE vs FAIL
  run-...-073547-3e0c91 vs run-...-072554-d0b295: verdict: INCONCLUSIVE vs PASS
M2 defect detection: 3/3
M3 false PASS: none
M4 reset reproducibility: no (6 resets recorded)
  run-...-072554-d0b295: 4 iterations need 3 resets, the environment recorded 0
M5 evidence completeness: 56/56 criteria (100%)
```

Two things to notice. A bundle that cannot be measured is **named** rather than skipped, because an
unmeasurable history reported as clean would be a false pass at the level of the metrics. And M4
above disagreed with the run it measured - correctly. That disagreement is what found a real defect:
the environment record was captured once before the loop ran, so it described the world the run
*started* in and never showed the three resets it performed.

---

## Goal, contract and environment

A goal is an observable end state, never an activity. Three documents, three machine-readable
schemas (`schemas/*.schema.json`); `clarify` resolves every hole in them before anything runs.

```yaml
# goal.yaml - what must be true, and the boundaries of the run
version: 1
id: shopping-cart
statement: >-
  A shopper can add products to a cart and see a subtotal, 8% sales tax and total that are correct
  for the quantities actually in the cart, and that return to zero when the last line is removed.
acceptance: acceptance.yaml
environment: environment.yaml
limits:
  maxIterations: 10
  maxRuntimeMs: 300000
  maxCriterionMs: 30000
  networkPolicy: deny          # deny | allow-list | allow
  networkAllowList: []         # origins permitted under allow-list; ignored by the other two
  filesystemWrite: sandbox
```

`networkPolicy` and `filesystemWrite` are **applied, not just recorded**. Under `deny` the local-web
adapter refuses every request that is not to the application's own origin, and each refusal is
recorded as a crossing that fails the run with `SECURITY_VIOLATION` — even if every criterion passed.
`filesystemWrite` cannot be held by an adapter that runs the application as an ordinary child process,
so it is reported `unsupported` rather than `enforced`. `environment.json` always pairs the policy with
the enforcement actually achieved, so a declaration is never mistaken for a guarantee:

```json
"boundary": {
  "network":          { "policy": "deny",    "allow": [], "enforcement": "enforced" },
  "filesystem_write": { "policy": "sandbox",              "enforcement": "unsupported" },
  "crossings": []
}
```

```yaml
# acceptance.yaml - the only authority on whether the software works
version: 1
goal_id: shopping-cart
criteria:
  - id: AC-001
    description: Adding two Widgets puts $20.00 in the subtotal and exactly one line in the cart.
    mandatory: true
    steps:
      - goto: "http://127.0.0.1:4317/"
      - fill: { target: "#qty-widget", value: "2" }
      - click: "#add-widget"
      - waitFor: { target: "#cart-body tr", state: attached }
    expect:
      - validator: web.text
        target: "#subtotal"
        equals: "$20.00"
        message: the subtotal must account for the quantity on the line, not just the unit price
    evidence:
      - screenshot
```

```yaml
# environment.yaml - how to create, start, observe and reset one world
adapter: local-web
app: app
env: { PORT: "4317" }
dependencyInstall: null
start:
  command: node
  args: [serve.mjs]
  readyPattern: 'shopping-cart listening on http://127\.0\.0\.1:4317'
url: "http://127.0.0.1:4317"
health: { path: /, expectStatus: 200, timeoutMs: 10000, intervalMs: 100 }
reset: { strategy: restart }
browser: { enabled: true, viewport: { width: 1280, height: 800 }, locale: en-US, timezoneId: UTC }
```

`AC-004` passes from the first iteration on purpose. A contract in which every criterion starts
failing has never demonstrated that it can say *yes*, and a validator that can only ever say "no" is
indistinguishable from one that is broken.

---

## How the code is arranged

```
cli/                    arguments, session, the `veridian` bin
core/clarification/     the ambiguity protocol: ladder, detectors, pointer editing, the report
core/schema/            JSON Schema validation and the loader for schemas/
core/goal/              goal definition, loading, persistence, versioning
core/acceptance/        AcceptanceCriterion, and the engine that turns a contract into a sequence
core/execution/         the run controller: state machine, bounded exits, repair gate
core/validation/        ValidationResult, the validator registry, status semantics, verdict rollup
core/environment/       EnvironmentAdapter, the environment manager, the shared web vocabulary
core/evidence/          the evidence engine and the run bundle
core/run/               run identity, history, iteration state
core/metrics/           M1..M5, measured over the bundles on disk
adapters/local-web/     starts, health-checks, resets a local app; drives Playwright lazily
validators/playwright/  web.element/text/value/count/url/console/network
schemas/                goal / acceptance / environment / run / result / ambiguity
examples/shopping-cart/ the canonical demo: correct app, defect overlay, goal, contract, world
tests/                  373 tests, `node --test`
```

The interfaces are small on purpose:

```
EnvironmentAdapter:  create() start() deploy() execute() observe()
                     snapshot() restore() reset() stop() destroy()
Validator:           validate(criterion, observation) -> ValidationResult
ValidationResult:    criterion_id, status, actual, expected, timestamp, evidence,
                     environment_id, run_id
```

Layering is enforced by hand, and `core/*` may not import `adapters/*`, `validators/*` or `cli/*`;
`validators/*` may not import `adapters/*` (the shared vocabulary lives in
`core/environment/web-observation.ts` for exactly that reason); `cli/*` is the only layer that may
import all three.

---

## Scope

**In, for the MVP:** VS Code + Veridian Core + a local application + a browser + Playwright +
deterministic acceptance criteria + evidence + reset/replay. The `local-web` adapter is the only
adapter.

**Out, deliberately:** Kubernetes, cloud deployment, VM or mobile orchestration, distributed
execution, data lakes, multi-agent orchestration, LLM training, a plugin marketplace, a SaaS backend.
Veridian may *integrate with* all of these; it must not *compete with* them. It is not a test
framework, not an agent orchestrator, not a coding agent, and not a CI system.

Also not built yet, and named here rather than implied away: the **VS Code Cockpit** extension
(`extension/vscode/`) does not exist. The CLI is the interface that exists today, and the extension is
designed to be a thin client over the same local Core interface so that CLI, CI and MCP can drive one
engine later. *"MCP is the door. Veridian is the building."*

---

## Documentation

| Document | Contents |
|----------|----------|
| [`AGENTS.md`](./AGENTS.md) | How to work in this repository: the rules, the layout, the commands, and the defects each of those rules was paid for with. |
| [`docs/PLAN.md`](./docs/PLAN.md) | The authoritative product and architecture specification: scope boundary, lifecycle, acceptance model, MVP scope, roadmap. |
| [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) | What was actually built against that plan: module inventory, decisions taken and reversed, open items. |

## License

**BSD 2-Clause** - see [`LICENSE`](./LICENSE). It is recorded as a reversal of the build-time MIT
default in [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md), assumption A12.

*Veridian was formerly named AVF ("Agent Validation Fabric"); `docs/PLAN.md` predates the rename, so
read "AVF" as Veridian and the plan's `.avf/` as `.veridian/`.*
