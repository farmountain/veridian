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

Three ways in: **clone it** if you want the source, the tests and the canonical demo; **install it**
if you want the `veridian` command and nothing else; or **open the Cockpit**, the thin VS Code client
in `extension/vscode/`, if you want the same engine with a UI.

### Clone

```bash
git clone <this-repository-url> veridian
cd veridian
npm ci                    # runtime dependency: yaml. dev: typescript, @types/node.
npm run gate              # tsc --noEmit, then the whole test suite. 1273 tests, about three seconds
                          # (this tree's own 1213 plus the Cockpit's 60, which the runner discovers
                          # because it walks the tree; the extension has its own gate as well).

npm run e2e:install       # one-time, ~150 MB: fetch the Playwright browser
npm run demo              # the canonical demo: 3 defects, FAIL -> repair -> PASS
npm run demo:db           # the second demo: the same loop against SQLite, no browser at all
npm run demo:k8s          # the third demo: the app deploys itself into a SIMULATED control plane
npm run demo:posix        # the fourth: the app provisions a SIMULATED Linux system it is judged on
npm run demo:os           # the fifth: the app provisions a SIMULATED Windows system, judged as an
                          # account that is deliberately not an administrator
npm run demo:cloud        # the sixth: the app provisions a SIMULATED provider account over HTTP,
                          # judged as a service account rather than as the account root
```

Run those eight in that order. `npm ci` removes `node_modules` and rebuilds it from the lockfile, and
Playwright is installed **outside** the lockfile on purpose, so installing the browser before `npm ci`
would discard it.

`demo`, `demo:db`, `demo:posix`, `demo:os` and `demo:cloud` need no extra setup. `demo:k8s` needs
neither a cluster nor `kubectl`, `demo:posix` needs neither a virtual machine nor a Linux host,
`demo:os` needs neither a Windows guest nor a hypervisor, and `demo:cloud` needs no cloud account, no
`aws`/`az`/`gcloud` session and no outbound socket - there is no cluster software, no guest kernel, no
image and no provider API anywhere in those runs - which is the point of them: Veridian builds worlds,
and a world may be simulated. What a simulated world may never do is pass itself off as a real one, so
each run records what it stood in for and a verdict a simulation cannot justify is reported
`INCONCLUSIVE`.

Requires **Node 22.18.0 or newer**.

### Install

```bash
npm install -g veridian
veridian help
```

The package ships compiled JavaScript in `dist/`, which is why there is a build step at all: Node
refuses to strip types for files under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the thing npm delivers cannot be the `.ts` files.
The source tree is still what runs during development - `npm test` executes `.ts` directly through
Node - and `npm run build` is what produces the artifact. The two facts do not contradict each other;
they describe two different trees.

**Playwright is deliberately not a dependency**, so a freshly installed Veridian is a validator that
cannot yet observe a page, and every criterion in a browser contract will honestly report
`INCONCLUSIVE` until one is present. Add it wherever Veridian can resolve it:

```bash
npm install playwright
npx playwright install chromium
```

To point Veridian at your own application, write a goal, an acceptance contract and an environment
document (their shapes are under [Goal, contract and environment](#goal-contract-and-environment)),
then:

```bash
veridian clarify  --goal my-app/goal.yaml    # resolve every gap first; starts nothing
veridian validate --goal my-app/goal.yaml    # run it, validate it, write the bundle
```

From a clone, `node cli/veridian.ts` is the same program and needs no build.

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

### Why the package is built, and what it deliberately leaves out

This section replaces one that said there was no npm package. The reversal is recorded rather than
quietly dropped, because the reasons it was declined are still the reasons the build exists.

The blocker was always technical, and it is not negotiable:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for
files under node_modules
```

That applies to a package's `bin` as well as to an import, so a package that delivered `.ts` could
never have run. **A package must therefore deliver compiled JavaScript**, which is what
`npm run build` produces: `tsc -p tsconfig.build.json` emits `dist/`, and
`node scripts/copy-assets.mjs` carries `schemas/` alongside it, because the schema set is
package-relative and a distribution that shipped code without its contracts would install cleanly and
fail at the first command.

The second blocker was a genuine defect and is now fixed rather than worked around. The schema set was
read through a port rooted at the process working directory, so an installed CLI would have reported
a missing goal schema that was sitting inside its own package - the worst kind of error, because it
sends the reader to inspect the one thing that is not broken. The CLI now reads its own files through
`core/assets.ts`, which resolves against the module rather than the caller, and reads *your* files
through the working directory, because that is what `--goal my-app/goal.yaml` means.
`tests/assets.test.ts` holds both halves.

What the package does **not** include is Playwright, and that is still a real cost rather than a
detail. Veridian validates a browser application but is not shipped with a browser, so an installed
Veridian cannot observe anything until its user adds one. This is the peer-dependency story a future
version would have to settle; for now it degrades honestly - `INCONCLUSIVE`, never `PASS` - and says
which command fixes it.

Two guards keep a package that cannot work from being published by accident. `prepublishOnly` runs
`npm run gate`, so a build whose own tests are red cannot leave the machine, and `npm run smoke:dist`
is a separate check that drives the **compiled** CLI from a temporary directory - because otherwise
every test covers `.ts` files nobody ships, and the artifact that is shipped is covered by nothing.
That is the same defect this project has already paid for twice: *an inventory that only checks the
output you happen to look at is a claim, not a record.* CI runs it, along with a full
pack-install-and-run round trip through npm itself.

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

The bundle also holds `artifacts/repair-<iteration>.log`: the repair command's own stdout, stderr,
command line, exit code and working directory, written before the run acts on that answer. It is the
one file in the bundle that is evidence about the *actor* rather than about the application, and it is
keyed by iteration because a run can repair more than once - the fourth demo's passing run holds four
transcripts at 1391, 1678, 1618 and 1718 bytes, so a single name would have left a reader holding one
attempt while believing it was the only one. Nothing in the verdict reads it: a repair is believed only
once the criteria are re-observed from a clean world, which is why it is safe to store verbatim.

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
recorded as a crossing that fails the run with `SECURITY_VIOLATION` �?even if every criterion passed.
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

### Criteria that act, not only observe

A step is one of seven kinds, and each is the *only* way to act in the world it belongs to: `goto`,
`fill`, `click` and `waitFor` in a browser; `sql` in a database world, which has no page to click; 
`apply` in a cluster world, which has no form to fill; and `run` in a system world, which has neither.
They exist because some questions cannot be answered by looking: whether a service survives a restart,
whether a path outside the sandbox is really refused, whether a hardening change actually hardened
anything.

`run` is an argument vector rather than a shell string, and that is deliberate - a shell string would
need a shell, and the shell would be a second substitution with its own quoting rules to get wrong,
while the interesting question (can this account read that file?) is asked perfectly well by naming the
program and its arguments.

```yaml
# acceptance.yaml, against the sim-posix world
  - id: AC-013
    description: The world refuses a command that climbs out of the sandbox.
    mandatory: true
    steps:
      - run:
          - cat
          - ../../etc/passwd
    expect:
      - validator: posix.probe
        target: cat
        equals: refused
        message: The world did not refuse a command naming a path outside the sandbox.
```

The world's document says which system is being stood in for, and which account the criteria act as -
which is what makes a hardening verdict possible at all, since a world whose criteria run as `root`
reads every file and would report a pass for a system no ordinary account can use:

```yaml
# environment.yaml, against the sim-posix world
adapter: sim-posix
app: app
url: null                       # no HTTP surface to probe
dependencyInstall: null         # the app's own program needs no package manager to fetch it
posix:
  distribution: debian          # written into the sandbox as /etc/os-release, by the world's own seed
  user: cart-audit              # the account criteria act as; the loader refuses `root` by name
  root: sandbox                 # resolved against the application directory
start: { command: node, args: [provision.mjs], readyPattern: 'cart-web provisioned: \d+ files installed' }
health: { timeoutMs: 30000, intervalMs: 100 }
reset: { strategy: restart }
```

`npm run demo:posix` drives this: four deliberate defects, thirteen criteria, and a `FAIL` �?repair �?
`PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-003`, `AC-006`, `AC-008`,
`AC-010`, `AC-011`, `AC-012` and cannot judge `AC-007`; iteration 5 is `PASS` on all thirteen with the
reason `13/13 mandatory criteria passed, environment valid, no safety violation, evidence complete.`).

The `os` world is that same shape one family out, and it exists to answer a question `sim-posix`
cannot: the two families do not ask the same questions with the same answers. A POSIX permission is
three bits and an owner, so one `posix.permission` covers the whole story. A Windows file carries an
ACL, and there are **three** facts to judge rather than one, which is why this family splits them:
`os.owner` reads the owning account, `os.acl` reads the entries written on the file and whether each
grant was explicit or inherited, and `os.access` reads what one named account may actually do. An
owner that is wrong is a `chown`; an entry that should not be there is a different fix; and access
that is too broad while every entry looks correct is an *inheritance* defect - a different place in
the reading again. One validator judging all three would report one defect where there are three.

```yaml
# environment.yaml, against the sim-os world
adapter: sim-os
app: app
url: null                       # no HTTP surface to probe
dependencyInstall: null         # the app's own program needs no package manager to fetch it
os:
  family: windows               # the application refuses any other family by name, and exits 2
  system: Windows Server 2022   # the release to stand in for; there is no guest and no image
  user: svc-audit               # the account criteria act as; the loader refuses SYSTEM by name
  root: sandbox                 # resolved against the application directory
start: { command: node, args: [provision.mjs], readyPattern: 'cart-web provisioned: \d+ files installed' }
health: { timeoutMs: 30000, intervalMs: 100 }
reset: { strategy: restart }
```

`npm run demo:os` drives this: four deliberate defects, seventeen criteria, and a `FAIL` �?repair �?
`PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-001`, `AC-006`, `AC-007`,
`AC-009`, `AC-010`, `AC-013` and `AC-014` and cannot judge `AC-012`; iteration 5 is `PASS` on all
seventeen with the reason `17/17 mandatory criteria passed, environment valid, no safety violation,
evidence complete.`). One of its criteria expects the world to **refuse** a command that names a path
outside the sandbox, and judges the refusal rather than the exit code - a substitute that resolved the
escaping path would be reading the developer's own tree while calling it the sandbox's.

The `cloud` world is a third question again, and the one furthest from a directory. A cluster and a
system are both *containers for state you could in principle walk to*; a provider account is not.
Nothing interesting about it is a file: the state is a set of buckets, objects, queues, secrets and
principals an application created by making HTTP requests, and the questions a contract asks - is this
bucket closed to the world, may this principal delete it, what did the account charge for - are
questions about a *provider's own records*. So this world answers them with a real HTTP server bound
to a loopback port, holding those resources in memory and deciding every permission question with the
account's own evaluator: deny beats allow, an explicit deny beats everything, and each decision records
the statement that fired. The application is a real program making real requests over real loopback
sockets; what is stood in for is the account at the other end.

```yaml
# environment.yaml, against the sim-cloud world
adapter: sim-cloud
app: app
url: null                        # the app is not a server: it makes requests *to* one
dependencyInstall: null          # the substitute is built on node:http, the app on fetch
cloud:
  provider: sim-provider         # visibly a substitute rather than an unnamed one
  region: sim-region-1           # a request naming another region is refused, never silently moved
  account: cart-account
  principal: svc-cart            # criteria act as this account, never as the account root
start: { command: node, args: [provision.mjs], readyPattern: 'cart-cloud provisioned: \d+ resources to .+' }
health: { timeoutMs: 30000, intervalMs: 100 }
reset: { strategy: restart }
```

`npm run demo:cloud` drives this: four deliberate defects, twenty-seven criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-003`, `AC-005`,
`AC-009`, `AC-011`, `AC-013`, `AC-026` and `AC-027`; iteration 5 is `PASS` on all twenty-seven with the
reason `27/27 mandatory criteria passed, environment valid, no safety violation, evidence complete.`).
Three of the four defects are read by two criteria each: one that reads the state the defect edited and
one that reads a fact derived from it. The fourth changes the *reason* the account refuses a request
rather than the answer, so both of its criteria answer `FAIL` in the first pass and in the last, and it
is the one where a contract that only asked whether the answer was right would report a pass for a rule
that is wrong.

Two identities matter here and they are not the same one. `cloud.principal` is the account the
application runs as; the criteria ask as that account *and* as `svc-reader`, an account the program
creates for the front end, which may read the assets and nothing else. Neither is privileged, and the
loader refuses `root`, `account-root`, `owner`, `administrator` and `admin` by name: an account whose
caller is the administrator passes every permission criterion for a reason that has nothing to do with
the policy under test, so a hardening contract judged as one would be vacuous.

The reading carries a `simulated` field naming each surface that is not real - the object store, the
queue, key management, secret rotation, identity and policy evaluation, metering, and the one region -
so a `PASS` is traceable to a named substitute rather than to unexamined reality. This is also the one
world that performs a `call` step, which is how a criterion puts its *own* request to the account and
judges the answer: the application's traffic cannot tell you what the account does with a request
nobody made.

---

## How the code is arranged

```
cli/                    arguments, session, the `veridian` bin
core/assets.ts          where Veridian's own files live - the schema set, resolved by module
core/clarification/     the ambiguity protocol: ladder, detectors, pointer editing, the report
core/schema/            JSON Schema validation and the loader for schemas/
core/goal/              goal definition, loading, persistence, versioning
core/acceptance/        AcceptanceCriterion, and the engine that turns a contract into a sequence
core/execution/         the run controller: state machine, bounded exits, repair gate
core/validation/        ValidationResult, the validator registry, status semantics, verdict rollup
core/environment/       EnvironmentAdapter, the environment manager, the shared web, database, k8s,
                        posix, os and cloud vocabularies that keep validators from importing an
                        adapter
core/evidence/          the evidence engine and the run bundle
core/run/               run identity, history, iteration state
core/metrics/           M1..M5, measured over the bundles on disk
adapters/local-web/     starts, health-checks, resets a local app; drives Playwright lazily
adapters/local-db/      builds a SQLite file, reads it, resets by rebuilding; no dependency to add
adapters/sim-k8s/      starts the app against a substitute control plane it serves itself; no cluster
adapters/sim-posix/     provisions a real tree while a substitute holds accounts, modes, packages,
                        units and sockets; no virtual machine and no guest kernel
adapters/sim-os/        the same shape as `sim-posix` one family out: a substitute holds machine
                        accounts, file modes and ACEs, packages, services and ports, and answers
                        the query forms the `windows` family reads; no Windows guest and no image
adapters/sim-cloud/     a real HTTP server speaking a provider's own routes over loopback, holding
                        buckets, objects, queues, secrets and principals it decides permissions
                        for itself; no cloud account, no session and no outbound socket
validators/playwright/  web.element, web.visible, web.text, web.value, web.count, web.url,
                        web.console.clean, web.network.ok
validators/database/    db.table, db.column, db.count, db.value
validators/k8s/         k8s.applied, k8s.deployment, k8s.image, k8s.ready, k8s.pod, k8s.service,
                        k8s.event
validators/posix/       posix.file, posix.permission, posix.owner, posix.contents, posix.user,
                        posix.package, posix.installed, posix.service, posix.running, posix.port,
                        posix.ran, posix.probe
validators/os/          os.file, os.contents, os.owner, os.access, os.acl, os.account, os.setting,
                        os.service, os.running, os.principal, os.ran, os.probe
validators/cloud/       cloud.bucket, cloud.object, cloud.tag, cloud.policy, cloud.access,
                        cloud.queue, cloud.secret, cloud.call, cloud.setting, cloud.probe,
                        cloud.meter
validators/container/   container.runtime, container.image, container.tag, container.digest,
                        container.label, container.env, container.state, container.alive,
                        container.exitcode, container.command, container.user, container.mount,
                        container.port, container.limit, container.health, container.logs,
                        container.stderr, container.call, container.probe
schemas/                goal / acceptance / environment / run / result / ambiguity
scripts/                bootstrap and build steps that must run before anything is checked
examples/shopping-cart/ the canonical demo: correct app, defect overlay, goal, contract, world
examples/inventory-db/  the second demo: the same loop against a world with no process, no socket,
                        no page and no console
examples/sim-k8s/       the third demo, and the first simulated world: the app deploys itself into a
                        substitute control plane and is judged on what the substitute holds
examples/sim-posix/     the fourth demo: the app provisions a substitute Linux system through commands
                        it really issues, and is judged as a named account rather than as root
examples/sim-os/        the fifth demo: the app provisions a substitute Windows system the same way,
                        judged as `svc-audit` - an account the loader refuses to let be SYSTEM
examples/sim-cloud/     the sixth demo: the app provisions a substitute provider account over HTTP
                        and is judged on the resources that account holds
extension/vscode/       the VS Code Cockpit: a thin client, no validation logic. The one directory
                        with a build step, because the extension host is not Node's loader
tests/                  1273 tests in a root `node --test` run: this tree's own 1213 plus the
                        Cockpit's 60

dist/                   GENERATED by `npm run build`. Never edited, never committed.
extension/vscode/out/   GENERATED by `npm run build` inside extension/vscode. Same rule.
```

The tree above is the program. `dist/` is the artifact the package and the container ship, and it
exists for one reason: Node will not strip types for files under `node_modules`, so an installed
Veridian cannot be the `.ts` files above. `npm run build` compiles them and copies `schemas/` in;
`npm run smoke:dist` proves the result runs from a directory that is not the package.
`extension/vscode/out/` exists for the same kind of reason one runtime further out - the extension
host is not Node's loader either - and `npm run smoke:out` is its equivalent check.

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
`core/environment/web-observation.ts`, `db-observation.ts`, `k8s-observation.ts`,
`posix-observation.ts`, `os-observation.ts`, `cloud-observation.ts` and
`container-observation.ts` for exactly that reason);
`cli/*` is the only layer that may import all three.

---

## Scope

**In, for the MVP:** VS Code + Veridian Core + a local application + a browser + Playwright +
deterministic acceptance criteria + evidence + reset/replay. Six adapters exist: `local-web` and
`local-db`, the second being the proof that `EnvironmentAdapter` is a seam rather than a browser
harness with an interface bolted on - and four *simulated* worlds. `sim-k8s`: a real application
process really deploys itself into a substitute control plane over a real HTTP surface it really
calls, with no cluster software anywhere in the loop. `sim-posix`: a real application process really
provisions a substitute Linux system through commands it really issues, with no virtual machine and
no guest kernel anywhere in the loop. `sim-os`: the same shape for a Windows or macOS machine, judged
as a named account rather than as `SYSTEM`, with no guest and no image anywhere in the loop.
`sim-cloud`: a real application process really provisions a substitute provider account over HTTP
routes it really calls, and is judged on the resources that account holds, with no cloud account, no
session and no outbound socket anywhere in the loop. In all four, the substitution is **declared**:
`environment.json` names what was stood in for and the reading carries a `simulated` field, so a
`PASS` is traceable to a named substitute rather than to unexamined reality - and a verdict a
substitute cannot justify is reported `INCONCLUSIVE`.

**Out, deliberately:** Kubernetes, cloud deployment, VM or mobile orchestration, distributed
execution, data lakes, multi-agent orchestration, LLM training, a plugin marketplace, a SaaS backend.
Veridian may *integrate with* all of these; it must not *compete with* them. It is not a test
framework, not an agent orchestrator, not a coding agent, and not a CI system. "Cloud deployment" is
listed out in that sense - Veridian does not deploy anything to a real provider - and the `cloud`
world above is not an exception to it: it is a substitute account on loopback, which is why its
readings say so.

Also built, and named here rather than left for the reader to discover: the **VS Code Cockpit**
(`extension/vscode/`) - a thin client over the same local Core interface the CLI drives, so CLI, CI
and MCP can drive one engine. *"MCP is the door. Veridian is the building."* It is the third runtime
in this repository: the extension host loads JavaScript and is not Node's loader, so the Cockpit is
compiled to `out/`, and `npm run smoke:out` is the check that loads that compiled artifact (no test in
this tree can). Two things are **not** built and are not claimed: there is no `.vsix` packaging route
yet, and the activation path has not been exercised under a real VS Code test host - it runs against a
recording double of the `vscode` module instead, which is necessary and not sufficient.
[`extension/vscode/README.md`](./extension/vscode/README.md) names exactly what that leaves
uncovered.

[`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) is the plan for
what comes after the MVP: the remaining sandbox worlds and what each one simulates. Its ordering rule
is this project's own - *a phase is built when it can be proven, not when it can be written* - so a
world ships only once its demonstration runs end to end, not as a placeholder that reports
`INCONCLUSIVE` for every criterion.

---

## Documentation

| Document | Contents |
|----------|----------|
| [`AGENTS.md`](./AGENTS.md) | How to work in this repository: the rules, the layout, the commands, and the defects each of those rules was paid for with. |
| [`docs/PLAN.md`](./docs/PLAN.md) | The authoritative product and architecture specification: scope boundary, lifecycle, acceptance model, MVP scope, roadmap. |
| [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md) | What was actually built against that plan: module inventory, decisions taken and reversed, open items. |
| [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md) | Why the goal's safety limits are applied rather than only recorded: the audit that found the third clause of the PASS rule unfalsifiable, and the design that fixed it. |
| [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) | What comes after the MVP: the npm, Docker and VS Code routes, the next adapters in the order they can be proven, and the environments that are blocked with their blocker named. |
| [`extension/vscode/README.md`](./extension/vscode/README.md) | The Cockpit's front door: what the extension is not, how to install it for development, and what only a real VS Code test host could exercise. |

## License

**BSD 2-Clause** - see [`LICENSE`](./LICENSE). It is recorded as a reversal of the build-time MIT
default in [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md), assumption A12.

*Veridian was formerly named AVF ("Agent Validation Fabric"); `docs/PLAN.md` predates the rename, so
read "AVF" as Veridian and the plan's `.avf/` as `.veridian/`.*
