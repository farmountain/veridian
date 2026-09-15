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
npm run gate              # tsc --noEmit, then the whole test suite. 1704 tests, about five seconds
                          # (this tree's own 1640 plus the Cockpit's 64, which the runner discovers
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
npm run demo:container    # the seventh: the app provisions a SIMULATED container runtime, and is
                          # judged on the images, containers, mounts and logs that runtime holds
npm run demo:vscode       # the eighth: a real extension is loaded by a SIMULATED extension host,
                          # and judged on what that host recorded while it ran
npm run demo:api          # the ninth: a real service judged through its own HTTP interface, with
                          # nothing simulated and nothing rendered - the contract makes the requests
```

Run those eleven in that order. `npm ci` removes `node_modules` and rebuilds it from the lockfile, and
Playwright is installed **outside** the lockfile on purpose, so installing the browser before `npm ci`
would discard it.

`demo`, `demo:db`, `demo:api`, `demo:posix`, `demo:os`, `demo:cloud`, `demo:container` and
`demo:vscode` need no
extra setup. `demo:k8s` needs neither a cluster nor `kubectl`, `demo:posix` needs neither a virtual
machine nor a Linux host, `demo:os` needs neither a Windows guest nor a hypervisor, `demo:cloud` needs
no cloud account, no `aws`/`az`/`gcloud` session and no outbound socket, `demo:container` needs no
Docker, no container runtime and no daemon, and `demo:vscode` needs neither VS Code nor any extension
to be installed - there is no cluster software, no guest kernel, no image, no provider API and no
editor anywhere in those runs - which is the point of them: Veridian builds worlds,
and a world may be simulated. What a simulated world may never do is pass itself off as a real one, so
each run records what it stood in for and a verdict a simulation cannot justify is reported
`INCONCLUSIVE`.

`demo:api` is the one in that list that substitutes **nothing**: it starts a real service and puts
real requests to it over loopback, so its reading is the service's own status line, headers, bytes and
JSON - which is why it is also the only demo whose verdict rests on no substitute at all.

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
keyed by iteration because a run can repair more than once - the seventh demo's passing run holds four
transcripts at 2284, 2241, 2186 and 2179 bytes, so a single name would have left a reader holding one
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

A step is one of eleven kinds, and each is the *only* way to act in the world it belongs to: `goto`,
`click`, `reload`, `fill`, `select`, `press` and `waitFor` in a browser; `sql` in a database world,
which has no page to click; `apply` in a cluster world, which has no form to fill; `run` in a system
world, which has neither; and `call` in a provider-account world, which is the one kind that lets a
*criterion* make its own request rather than read one the application made.
These exist because some questions cannot be answered by looking: whether a service survives a restart,
whether a path outside the sandbox is really refused, whether a hardening change actually hardened
anything. A world that does not implement a kind **refuses it by name** rather than reporting a verdict
it cannot justify, which is how a browser contract that drifted onto a container world is caught instead
of being judged against nothing.

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

The `container` world asks about a *daemon*, and that makes it the furthest thing from a directory yet.
An application that containerises itself does not write files and declare itself finished: it issues
commands to a runtime and then reads the runtime back, and nearly everything a container contract cares
about is a fact the runtime holds rather than a fact on disk. An image is a record with tags, labels, a
digest and a layer list; a container is a record with a state, an exit code, mounts, published ports and
limits; a log is what the runtime captured from a process it started. So this world is a store of image
records, a store of container records and a small register of commands it answers in process, and the
application is a real program that really issues those commands and really reads the answers.

```yaml
# environment.yaml, against the sim-container world
adapter: sim-container
app: app
url: null                        # no HTTP surface to probe
dependencyInstall: null          # the substitute is in process, the app is a program
container:
  runtime: docker                # the spelling every reading carries, compared against the document
  platform: linux                # a WORKDIR carrying a backslash is refused, not quietly accepted
  root: sandbox                  # resolved against the application directory
start: { command: node, args: [provision.mjs], readyPattern: 'cart-web provisioned: \d+ files, \d+ commands' }
health: { timeoutMs: 30000, intervalMs: 100 }
reset: { strategy: restart }
```

`npm run demo:container` drives this: four deliberate defects, twenty-seven criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-008`, `AC-010`,
`AC-011`, `AC-012`, `AC-015`, `AC-016`, `AC-017`, `AC-018`, `AC-022` and `AC-026`; iteration 5 is `PASS`
on all twenty-seven with the reason `27/27 mandatory criteria passed, environment valid, no safety
violation, evidence complete.`). Three of the four defects are read by exactly one criterion each - and
`D3`, the one that changes what the service's own stdout says about its catalogue role, is deliberately
read by one, because nothing in this world derives anything from a program's announcement about itself.
The fourth is read by **seven**. Its bind mount's source is misspelled by one character, so the world
refuses to start the container, so the container stays created and never running, so its health is
unknown, its two output streams are empty, its mount reading says `source absent`, and a criterion's own
`exec` never reached a process. **One character, seven readings that are each a separate true fact about
one world** - and `AC-008` says so in its own description, because a criterion that asked only whether
`cart-web` *exists* would pass for a container that was created and never brought up.

The reading carries a `simulated` field naming each surface that is not real - namespaces, cgroups,
image layers, the registry, published ports, volumes and user switching - so a `PASS` is traceable to a
named substitute rather than to unexamined reality. The world also states its own three limits in
`environment.yaml` rather than leaving them to be inferred, because each is a verdict a reader could
otherwise mistake for a stronger one: limits are *declared and not enforced*, so `container.limit`
renders `(declared, not enforced)`; a container's `user` is recorded and never applied, so the user
criterion judges what the image declares rather than a privilege boundary; and every port is a mapping
that claims no socket, so `container.port` renders `exposed` and never `reachable`.

The `vscode` world's subject is an **extension host**, and that makes it the first world whose state is
created by a program that is neither the application's own program nor a daemon: it is created by an
*extension the application ships*, loaded by a host the application never sees. An extension is not a
script that prints a result - it is a module that registers contributions, is activated by an event,
answers commands, reads configuration, writes status, logs to a channel and holds subscriptions it
disposes when it unloads. So this world is a real Node process that resolves a module in place of
`vscode`, loads the extension through it, and records every one of those facts as the extension runs.

```yaml
# environment.yaml, against the sim-vscode world
adapter: sim-vscode
app: app
url: null                        # the app is an extension, not a server
dependencyInstall: null          # the substitute is generated, the extension is a file that exists
vscode:
  host: veridian-vscode-sim      # the identity the substitute answers as
  apiVersion: "1.100.0"          # a *record*, not an installation: no editor is fetched or booted
  activationEvent: onCommand:cart.add
  root: sandbox                  # resolved against the application directory
  settings: {}                   # operator overrides; the manifest's own defaults are the other source
start: { command: node, args: [provision.mjs], readyPattern: 'cart-web provisioned: \d+ commands' }
health: { timeoutMs: 30000, intervalMs: 100 }
reset: { strategy: restart }
```

There is no editor process to keep an extension resident in, so **every action that needs the extension
running - `install`, `activate` and every `invoke` - starts a fresh host process, and every host process
activates the extension.** That is not a shortcut, it is the honest shape of the substitution, and it is
why `vscode.activation`'s reading reports `runs`, a count of host processes: a criterion about whether
the extension activates on the right event is a criterion about how many times it was activated.
Durable state (`globalState`, `workspaceState`) is the one surface genuinely shared between those
processes, exactly as it is on a real machine, and it is what a criterion reads to see that a value
survived a reload.

The substitute implements a real slice of the API - command registration, the status bar, information
and warning messages, configuration reads, the workspace file system, and subscription disposal - and
**refuses by name** what it does not implement, which is what makes `vscode.refusal` a criterion about
the world rather than a criterion about a crash: a contract can assert that an unimplemented call is
reported as unimplemented instead of silently returning `undefined`. Two further refusals are the
world's own boundaries rather than the API's: a manifest whose `main` escapes the extension's own
directory is refused, and `engines.vscode` is evaluated against the `apiVersion` the document declares,
so a manifest written for a newer host is refused here for the reason it would be refused there.

`npm run demo:vscode` drives this: four deliberate defects, twenty-three criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-014` through
`AC-017`; iteration 5 is `PASS` on all twenty-three with the reason `23/23 mandatory criteria passed,
environment valid, no safety violation, evidence complete.`). Each defect is filed against one criterion
and the defects are repaired in criterion order, so the failing count falls `4 -> 3 -> 2 -> 1 -> 0` -
and the four criteria that move are the four that read what the extension *did*: the state it kept, the
line it logged, the message it showed and the status item it wrote. A criterion that asked only whether
the command was registered would pass for all four.

The reading carries a `simulated` field naming each surface that is not real - the extension host, module
resolution, activation events, the command registry, the window, configuration and the workspace - so a
`PASS` is traceable to a named substitute rather than to unexamined reality. This world's only evidence
kind is `json`, because there is no page to screenshot and no console to capture: the substitute's
transcript *is* the artifact.

---

## The ninth world: a real service, judged through its own interface

`local-api` is the first world in this list that is **not** simulated, and it exists to hold the
seam from the other side. `local-db` proved the adapter is not a browser harness by judging a
SQLite file; `sim-*` proved a world may stand something in and say so; `local-api` proves that a
world can be entirely real, have no browser at all, and still be judged by the same loop, the same
verdict rules, the same bundle and the same repair protocol - with nothing rendered and nothing
substituted.

It starts the application as a real child process, waits for the readiness line the service prints
on stdout, and then **puts its own requests to the service over loopback**. That is the same
`EnvironmentAdapter` and the same `call` step the sixth world introduced, but here the step is the
whole interface rather than a probe: every criterion in the contract makes between one and two
requests and reads the answer.

```yaml
- id: AC-005
  description: an absent sku is reported absent, not returned empty
  steps:
    - kind: call
      method: GET
      path: /items/NOPE
  expect:
    - validator: api.status
      target: "1"
      equals: 404
    - validator: api.body
      target: "1"
      contains: "no item with sku NOPE"
    - validator: api.bytes
      target: "1"
      equals: 34
  evidence: [json]
```

Three target grammars live in one family and they are deliberately different, because the subjects
are different kinds of thing. A bare 1-based position addresses **one request** (`api.status`,
`api.body`, `api.bytes`, `api.exchange`); `<position>:<header-name>` addresses **one header of one
request**, split at the first colon (`api.header`); and `<position>/<json-pointer>` addresses **one
value inside one body** (`api.json`), so a contract can assert `1/WIDGET/unitPriceCents` equals
`1000` without a deep comparison of the whole document. `api.log` reads what the service printed on
`stdout` or `stderr`, which is the one part of a service's behaviour no HTTP response carries.

The four defects are all one file, `app/server.mjs`, and they are chosen so the progression is
readable rather than merely descending. `D2` answers a creation `200` where it should answer `201`,
and `D3` answers an absent sku `200` where it should answer `404`: each is read by exactly one
criterion, and each is therefore a **control** - a reader can watch one edit move one reading before
watching one edit move two. `D1` drops a factor of a hundred from every money value, so `AC-002` and
`AC-003` fail together and recover together; `D4` states the wrong version in the one header every
response carries, so `AC-006` and `AC-007` fail together and recover together. `AC-001` and `AC-008`
are never moved at all, and that is the measurement that says the other six moved *because of the
edits* rather than because the world is flaky.

`npm run demo:api` drives this: four deliberate defects, eight criteria, and a `FAIL` -> repair ->
`PASS` descent in five iterations - measured, verbatim: the failing count is `6, 4, 3, 2, 0`, and
iteration 5 is `PASS` with `8/8 mandatory criteria passed, environment valid, no safety violation,
evidence complete.` The repair agent walks the defect table in criterion order, so the descent is
exactly the shape the table predicts, and the run is the evidence for that prediction rather than
the prediction being the evidence for the run.

Because it is a real world, its reading carries **no** `simulated` field and `environment.json`
names no substitute. What it does carry is the same boundary report every world carries: the
service is started under a process runner with no stdin, and a criterion that staked a verdict on
the process reading from a terminal would be staking it on something no criterion can observe.

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
                        posix, os, cloud, container and extension-host vocabularies that keep
                        validators from importing an adapter
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
adapters/sim-container/ a store of image and container records beside a register of runtime commands
                        it answers in process, holding tags, labels, digests, mounts, ports,
                        limits, health and captured output; no Docker, no daemon, no image and
                        no namespace or cgroup that ever existed
adapters/sim-vscode/    a real extension loaded by a real Node process through a module resolved in
                        place of `vscode`, recording contributions, commands, invocations,
                        settings, status items, output, messages, subscriptions and refusals as
                        it runs; no editor, no window and no installed VS Code anywhere
adapters/local-api/     starts a real service and talks to it over loopback through the same fetch
                        the application serves; every criterion puts its own request and reads the
                        status, the headers, the bytes and a pointer into the body. Nothing is
                        substituted and nothing is rendered: the application IS the interface
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
validators/vscode/      vscode.host, vscode.identity, vscode.engine, vscode.activation,
                        vscode.contribution, vscode.command, vscode.invocation, vscode.setting,
                        vscode.status, vscode.output, vscode.message, vscode.state,
                        vscode.subscription, vscode.file, vscode.refusal, vscode.call, vscode.probe
validators/api/         api.service, api.exchange, api.status, api.header, api.body, api.bytes,
                        api.json, api.log
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
examples/sim-container/ the seventh demo: the app provisions a substitute container runtime and is
                        judged on the images, containers, mounts, ports and logs it holds
examples/sim-vscode/    the eighth demo: a real extension is loaded by a substitute extension host
                        and judged on what that host recorded while it ran
examples/local-api/     the ninth demo: a real service judged through its own HTTP interface, with no
                        page, no substitute and nothing rendered - four defects, eight criteria, and
                        the same FAIL -> repair -> PASS loop
extension/vscode/       the VS Code Cockpit: a thin client, no validation logic. The one directory
                        with a build step, because the extension host is not Node's loader
                        (`npm run package` produces the `.vsix` you can hand to somebody else)
tests/                  1704 tests in a root `node --test` run: this tree's own 1640 plus the
                        Cockpit's 64

dist/                   GENERATED by `npm run build`. Never edited, never committed.
extension/vscode/out/   GENERATED by `npm run build` inside extension/vscode. Same rule.
extension/vscode/veridian-cockpit.vsix  GENERATED by `npm run package`. Same rule.
```

The tree above is the program. `dist/` is the artifact the package and the container ship, and it
exists for one reason: Node will not strip types for files under `node_modules`, so an installed
Veridian cannot be the `.ts` files above. `npm run build` compiles them and copies `schemas/` in;
`npm run smoke:dist` proves the result runs from a directory that is not the package.
`extension/vscode/out/` exists for the same kind of reason one runtime further out - the extension
host is not Node's loader either - and `npm run smoke:out` is its equivalent check. The Cockpit's
archive is a third artifact, produced by a third-party tool from an allowlist in the manifest, and
`npm run smoke:vsix` reads it back rather than trusting the tool that built it.

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
`posix-observation.ts`, `os-observation.ts`, `cloud-observation.ts`,
`container-observation.ts`, `vscode-observation.ts` and `api-observation.ts` for exactly that
reason);
`cli/*` is the only layer that may import all three.

---

## Scope

**In, for the MVP:** VS Code + Veridian Core + a local application + a browser + Playwright +
deterministic acceptance criteria + evidence + reset/replay. Nine adapters exist: `local-web`,
`local-db` and `local-api`, the second being the proof that `EnvironmentAdapter` is a seam rather
than a browser
harness with an interface bolted on, and the third being that proof's mirror - a world that is
**real** and reached over a socket, where the contract puts its own request rather than observing one
the application made - and six *simulated* worlds. `sim-k8s`: a real application
process really deploys itself into a substitute control plane over a real HTTP surface it really
calls, with no cluster software anywhere in the loop. `sim-posix`: a real application process really
provisions a substitute Linux system through commands it really issues, with no virtual machine and
no guest kernel anywhere in the loop. `sim-os`: the same shape for a Windows or macOS machine, judged
as a named account rather than as `SYSTEM`, with no guest and no image anywhere in the loop.
`sim-cloud`: a real application process really provisions a substitute provider account over HTTP
routes it really calls, and is judged on the resources that account holds, with no cloud account, no
session and no outbound socket anywhere in the loop. `sim-container`: a real application process
really issues runtime commands and really reads the runtime back, and is judged on the images,
containers, mounts, ports, limits and captured output the substitute holds, with no Docker, no
daemon, no image and no namespace or cgroup anywhere in the loop. `sim-vscode`: a real extension is
loaded by a real Node process through a module resolved in place of `vscode`, and judged on the
contributions, commands, invocations, settings, status, output, messages, subscriptions and refusals
that process recorded, with no editor, no window and no installed VS Code anywhere in the loop.
`local-api`: no substitute at all - a real service, judged through its own HTTP interface on loopback,
with the contract's own requests as the observation. In all
six of the simulated ones, the substitution is
**declared**: `environment.json` names what was stood in for and the reading carries a `simulated`
field, so a `PASS` is traceable to a named substitute rather than to unexamined reality - and a
verdict a substitute cannot justify is reported `INCONCLUSIVE`.

**Out, deliberately:** Kubernetes, cloud deployment, VM or mobile orchestration, distributed
execution, data lakes, multi-agent orchestration, LLM training, a plugin marketplace, a SaaS backend.
Veridian may *integrate with* all of these; it must not *compete with* them. It is not a test
framework, not an agent orchestrator, not a coding agent, and not a CI system. "Cloud deployment" is
listed out in that sense - Veridian does not deploy anything to a real provider - and the `cloud`
world above is not an exception to it: it is a substitute account on loopback, which is why its
readings say so. The `container` world is the same argument one more time: Veridian does not build or
run real containers, and does not claim to - it holds records of images and containers beside a
register of runtime commands, and every reading says which surfaces are stood in for. And the
`vscode` world closes the argument: Veridian does not install, launch or drive an editor. It resolves a
module in place of the editor's API and records what a real extension did through it - which is also
why the `extension/vscode` Cockpit below and this world are two different things that happen to share a
name: one is a client *of* Veridian, the other is a world *for* it.

Also built, and named here rather than left for the reader to discover: the **VS Code Cockpit**
(`extension/vscode/`) - a thin client over the same local Core interface the CLI drives, so CLI, CI
and MCP can drive one engine. *"MCP is the door. Veridian is the building."* It is the third runtime
in this repository: the extension host loads JavaScript and is not Node's loader, so the Cockpit is
compiled to `out/`, and `npm run smoke:out` is the check that loads that compiled artifact (no test in
this tree can). It ships by two routes - a development install (a checkout plus F5) and a packaged
`.vsix` (`npm run package`, read back by `npm run smoke:vsix`, because an archive built by a
third-party tool is a fourth artifact nothing else here can load). One thing is **not** claimed: the
activation path has not been exercised under a real VS Code test host - it runs against a recording
double of the `vscode` module instead, which is necessary and not sufficient.
[`extension/vscode/README.md`](./extension/vscode/README.md) names exactly what that leaves
uncovered, and what `npm run smoke:vsix` still cannot reach.

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
