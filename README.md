# Veridian

![Veridian Cockpit](veridian-logo.png)

**The sandbox testing and validation layer for AI coding agents.**

**v0.6.1** - twelve reproducible sandbox worlds, five distribution routes, and four ways to drive them,
over a run history that is now a queryable digital twin.

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

Five ways in: **clone it** if you want the source, the tests and the canonical demo; **install it**
if you want the `veridian` command and nothing else; **open the Cockpit**, the thin VS Code client in
`extension/vscode/`, if you want the same engine with a UI; **install the packaged Cockpit** from
either marketplace, or from the `.vsix` attached to
[the latest release](https://github.com/farmountain/veridian/releases/latest), if you want the editor
client without a checkout; or **build the image**, if you want the CLI in a container:

```bash
docker build -t veridian .
docker run --rm veridian help
```

The image route is verified in CI rather than here, because this machine has no container runtime -
and a `Dockerfile` that has never been built is a claim.

### Clone

```bash
git clone <this-repository-url> veridian
cd veridian
npm ci                    # runtime dependency: yaml. dev: typescript, @types/node.
npm run gate              # tsc --noEmit, then the whole test suite. 2700 tests over 453 suites
                          # (this tree's own 2608 plus the Cockpit's 92, which
                          # the runner discovers because it walks the tree; the extension has its own
                          # gate as well). The suite itself reports ~11s and the whole gate ~16s.
npm run acceptance        # Veridian judged by Veridian: its own contract - goal, criteria, world -
                          # run TWICE, so the world the second run inherits is proved to be one it
                          # rebuilt rather than one the first left behind
npm run acceptance:ladder # the second self-acceptance route, and it judges what the first cannot:
                          # not the command line as a product but a RUN as a witness - each criterion
                          # issues its own `veridian validate` against the ladder fixtures and then
                          # reads that nested run's record of the rung each gap reached. Writes to
                          # `sandbox/ladder/outer`, never `.veridian/`. Measured: ~21 s for both
                          # passes.

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
npm run demo:local-process # the tenth: a real program run as a real child process and judged on what
                          # it printed, what it exited with and the files it wrote - nothing simulated
npm run demo:data         # the eleventh: the app provisions a SIMULATED message broker it reaches
                          # over a real TCP socket, judged on the topics, records and offsets it holds
npm run demo:cockpit      # the twelfth: Veridian's OWN client is the application, loaded by a
                          # SIMULATED extension host and judged on what it really did while loaded
npm run demo:mobile       # the thirteenth: the app provisions a SIMULATED handset through commands
                          # it really issues, judged on the bundles, permissions, deep links,
                          # notifications and logs that substitute device holds
npm run demo:twin         # the fourteenth, and the only goal whose subject is not an application
                          # but the MACHINE: it measures the environment's capabilities by exercising
                          # them and writes a twin, and it is judged on whether an absence is
                          # distinguishable from a broken probe rather than on what it found
```

Run the seventeen `npm run` commands below in that order, after `npm ci`. `npm ci` removes
`node_modules` and rebuilds it from the lockfile,
and no Playwright *package* is in that lockfile's installed set - the peer declaration names a range
and installs nothing - so fetching the browser before `npm ci` would discard it.

`demo`, `demo:db`, `demo:api`, `demo:local-process`, `demo:posix`, `demo:os`, `demo:cloud`,
`demo:container`, `demo:vscode`, `demo:data` and `demo:mobile` need no
extra setup - while `demo:cockpit` needs the Cockpit built first, because its application is a build
product. `demo:k8s` needs neither a cluster nor `kubectl`, `demo:posix` needs neither a virtual
machine nor a Linux host, `demo:os` needs neither a Windows guest nor a hypervisor, `demo:cloud` needs
no cloud account, no `aws`/`az`/`gcloud` session and no outbound socket, `demo:container` needs no
Docker, no container runtime and no daemon, `demo:vscode` needs neither VS Code nor any extension
to be installed, and `demo:data` needs no broker, no Kafka, no ZooKeeper and no message-broker software
of any kind - there is no cluster software, no guest kernel, no image, no provider API, no broker and no
editor anywhere in those runs - which is the point of them: Veridian builds worlds,
and a world may be simulated. What a simulated world may never do is pass itself off as a real one, so
each run records what it stood in for and a verdict a simulation cannot justify is reported
`INCONCLUSIVE`.

`demo:api` is the one in that list that substitutes **nothing**: it starts a real service and puts
real requests to it over loopback, so its reading is the service's own status line, headers, bytes and
JSON - which is why it is also the only demo whose verdict rests on no substitute at all.

`demo:local-process` is the second such demo, and it stands to `demo:api` the way a subtree stands to
a service: a real program is started as a real child process on this machine and judged on the text it
printed on stdout and stderr, the code it exited with, what a probe of it found still running, and the
files it really wrote. Nothing is stood in - the child process is a process, the file it wrote is on
the filesystem - so its readings carry no `simulated` field either.

`demo:data` is neither of those, and it is the run where the distinction is easiest to see: the socket
is real, the bytes are real and the frames are decoded for real, but the *broker* on the other end of
the connection is a substitute. Its substitute holds topics, partitions, records, offsets, replication
assignments and consumer-group state, and it answers the twelve APIs it declares - so the application
speaks a wire protocol to something that is not message-broker software, and the criteria are judged on
what that substitute holds. It carries a `simulated` field naming the seven surfaces it stands in for,
and `snapshot-restore` is really performed rather than downgraded to a restart.

`demo:cockpit` is the one demo in that list whose application is **Veridian itself**. Where
`demo:vscode` judges a sample extension written for the purpose, this one installs the real compiled
Cockpit - the artifact `npm run package` builds and the marketplaces serve - into the substitute
host, activates it in a real child process, invokes two of its commands and reads back what it wrote
to a channel and what it told a user. It exists because *"the tests passed"* and *"the thing works"*
are two different measurements, and only the second one is the product: the Cockpit's own 72-test
suite was green both before and after the two defects this world found. It is the one demo that needs
`out/` to exist, so **run `npm run build` inside `extension/vscode` first** - the demo refuses by name
and names that command rather than skipping, because a skipped check reports a green suite.

That list is the demos, and `npm run acceptance` is deliberately not one of them. A demo shows a
defect found and repaired; Veridian's own contract - `acceptance/veridian-mvp.yaml` with its seven
criteria and its world - is observed once with `--no-repair`, because the application under it is the
CLI itself and there is nothing to repair. It exists because a tool whose whole claim is *"I decide
whether software works"* should be answerable to its own verdict rather than only to its unit suite.
It runs the contract **twice inside one invocation** on purpose: run 1 leaves its own `config.yaml`
behind and run 2 inherits it, so a pass that came from a world the run inherited rather than rebuilt
is a failure rather than a pass. Measured: run 1 and run 2 both
`PASS (COMPLETED, 1 iteration(s))`, 7/7 criteria, exit 0.

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

**Playwright is declared as an optional peer dependency, and is never installed by us.** It is in
`peerDependencies` with `peerDependenciesMeta.playwright.optional: true`, so a package manager can
tell you at install time that a browser observation needs it, while `npm install veridian` still
installs cleanly without it. A freshly installed Veridian is therefore a validator that cannot yet
observe a page, and every criterion in a browser contract will honestly report `INCONCLUSIVE` until
one is present. Add it wherever Veridian can resolve it:

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
Veridian cannot observe anything until its user adds one. That route is now declared rather than
documented: Playwright is an **optional peer dependency**, so the package manager states the
requirement at install time while `npm install veridian` continues to succeed without it. The
degradation is unchanged and was already honest - `INCONCLUSIVE`, never `PASS` - and names the command
that fixes it. `tests/package-manifest.test.ts` holds the declaration in both places it is written.

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

## Resolving ambiguity: the run asks itself before it asks you

A goal, a contract and an environment document always leave gaps - a value the operator meant to fill
in, a selector nobody spelled, a target a criterion names and the plan does not carry. Veridian does
not guess and does not stop. Every gap goes down one ladder, in order, and stops at the first rung
that can answer it:

```
1. DERIVE        compute it from the documents in hand.                        (free, certain)
2. INFER         recall it from what earlier runs learned.       (blocking gaps only)
3. DEFAULT       a declared fail-safe default. A default is usable only when it
                 arrives with a rationale - a default without one is a guess
                 wearing a policy's clothes.
4. SELF-PROMPT   put the gap to the run itself, from material it already holds.
5. ASK           put the gap to you. The only rung that interrupts.
6. DEFER         record it as unresolved and carry on without it.
```

Rung 4 is the one the run performs on itself, and it outranks asking you. Its whole safety argument
is in how narrow it is: a self-answer may **only** choose a candidate the contract already offered,
and may **never** invent one. A candidate is accepted when material already in hand corroborates it -
the registered validator names and adapter names, or the gap's own `context` - and the answer has to
name the entry that corroborated it, because *a prompt with no grounds is a guess in a costume.* Two
corroborated candidates are a decline and not a coin toss. A second attempt on the same gap may widen
to a substring match, once, and the confidence it reports is the lower one that width earns.

A run answering itself is held to a stricter standard than a run consulting what earlier runs learned:
`selfPromptThreshold` is 0.8 by default, deliberately *above* `inferThreshold` at 0.7.

**Only critical questions reach you.** A non-blocking gap never reaches rung 5 at all - that is
structural and not budgeted - so it is closed by a self-answer, by a declared default, or it is
deferred with the run continuing around it. A *blocking* gap that no earlier rung can close reaches
you at most `maxQuestionsPerRun` times, batched into rounds of at most `maxQuestionsPerRound`.

**Every loop in this protocol has a bound, and every bound is checked *before* an attempt rather than
after one**, so the worst case is a bound that was already reached rather than one that is one over:

```
maxSelfPromptRoundsPerAmbiguity    2    one refinement is worth affording; a third
                                        attempt is a loop wearing a budget's clothes
maxSelfPromptRoundsPerRun         10    rung 4 cannot become a whole run's slow path
selfPromptBudgetMs            60 000    wall-clock ceiling on rung 4 alone
maxQuestionsPerRun                 5    hard cap on how often a run interrupts you
maxQuestionsPerRound               3    how many of those arrive in one round
budgetMs                     120 000    wall-clock ceiling on the whole clarification phase
```

`veridian clarify --goal my-app/goal.yaml` resolves every gap first and prints the transcript; it
starts nothing. `veridian validate` runs the same ladder and then runs the goal.

What the ladder decided is evidence, not trivia. Every run writes `clarifications.json` beside its
other artifacts, and the same block appears in `result.json` under `clarifications`: one record per
gap naming the rung that answered it and the rungs attempted before it, plus `byVia`, a count per
rung, and `selfPromptRounds`, how much self-prompt work the run actually did.

```json
{ "selfPromptRounds": 2,
  "byVia": { "derived": 4, "inferred": 0, "defaulted": 2,
             "self_prompted": 2, "answered": 1, "deferred": 0 } }
```

That count is work *done*, never capability *present*: a run planned with no self-prompt port reports
`0` rather than a `1` that describes a port it could have used. `--no-self-prompt` is how an operator
unplugs the rung, and it replaces the port rather than narrowing the material - a narrower port would
report itself `available: false` for a reason nobody chose. The distinction the replacement preserves
is the one an auditor needs: **a skipped rung is work the run never attempted; a declined round is work
it did and reported.** Off is for the operator who wants a transcript that provably contains no reading
the run made of itself, which is a claim about evidence rather than about speed. And when no question can be asked at
all - headless, or CI - the run does not hang: DEFER closes the gap, the criteria that depended on it
report `INCONCLUSIVE`, and the CLI exits 2. *A headless run returns `INCONCLUSIVE`; it does not block
forever.* That is the anti-hang guarantee at the human boundary.

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
--no-memory           do not consult or write memory at all
--no-self-prompt      skip rung 4: never put a gap to the run itself
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
them would be a lie.

`--defects` is the ground truth M2 and M3 need; without it they report `INCONCLUSIVE` rather than a
comfortable pass, because Veridian cannot derive what a defect was *intended* to break from what a run
happened to observe.

It is also **scoped**, and that is a repair rather than a refinement: M1, M2 and M3 name the
**subject** they answered about - the goal the run judged and the adapter that judged it - because a
criterion id is a name *inside one contract*. A run records a commit and whether the tree was dirty,
but not the difference, and two runs of one contract at two commits are precisely what M1 exists to
compare - so the revision cannot be the identity. What a criterion id belongs to is the contract and
the world, the bundle's own `goal_id` and `environment.adapter`; two contracts that both number their
criteria from `AC-001` and repair them in ascending order once produced identical signatures and were
certified as "the same code run twice". A history that cannot be scoped to one subject is refused
by name instead, and the report states the scope it could not establish - over the whole history on
this machine the plain command prints `M1 result consistency: INCONCLUSIVE (142 runs over 14 subjects:
...)`, and M2 and M3 say the same of their own three named defects. Before that repair the identical
command printed `M3 false PASS: 117`; the 117 spanned twelve subjects, none of them
`shopping-cart@local-web`, whose own reading was zero. The decomposition, and the experiment behind
it, are in [`docs/INSTRUMENT-AND-PROMPT-PLAN.md`](./docs/INSTRUMENT-AND-PROMPT-PLAN.md) §1.

A real output, over one subject. The population below is the cart demo's own seven runs, read through
`--state-dir` from a directory holding only those - which is what makes M1's `no` an answer here
rather than the refusal it prints over the whole history. The block keeps the two `verdict:` lines and
elides the other fourteen, each of which named one differing criterion or one iteration only one of
the two runs recorded:

```
runs measured: 7
M1 result consistency: no (7 runs, baseline run-20260915-225544-fdf9f8)
  run-20260918-134157-7439f1 vs run-20260915-225544-fdf9f8: verdict: INCONCLUSIVE vs PASS
  run-20260919-062259-f4fa97 vs run-20260915-225544-fdf9f8: verdict: INCONCLUSIVE vs PASS
M2 defect detection: 3/3 (scoped to shopping-cart@local-web)
M3 false PASS: none (scoped to shopping-cart@local-web)
M4 reset reproducibility: yes (15 resets recorded)
M5 evidence completeness: 88/88 criteria (100%)
```

Three things to notice. A bundle that cannot be measured is **named** rather than skipped, because an
unmeasurable history reported as clean would be a false pass at the level of the metrics. The two
`INCONCLUSIVE` runs above are the same contract observed with `--browser none`, so every criterion is
`INCONCLUSIVE` and the run stops after one iteration: they are not a reproducibility failure, and they
are the whole of M1's `no` - the other five ran four iterations each and recorded fifteen resets
between them, which is what makes M4's `yes` an answered reading rather than an absence of one. And
M4 once disagreed with the run it measured - correctly. That disagreement is what found a real defect:
the environment record was captured once before the loop ran, so it described the world the run
*started* in and never showed the three resets it performed.

Note also what is **not** printed. `M4 world validity at exit` appears only when there is something to
say - a run that stopped on an invalid world, or one that carried on over it - and a history holding
neither says nothing about it rather than printing a zero. Neither population above shows that line;
the repository's own whole history does, where it reads `1 run(s) stopped on an invalid world, 0
carried on`.

---

## The run history, as a twin

A run writes a bundle, and a bundle on its own answers only questions about itself. The **run history**
is those bundles read as one document: every run reached through a single join, keyed on the same
subject the metrics above already compute - `<goal-id>@<adapter>`. That key is not a new invention
here; it is the string M1 uses, and reusing it is what stops the join from answering a question the
metrics refuse.

The **ELI** is that join, in `core/metrics/eli.ts`: one row per run, grouped by subject, with the runs
that could not be read **named** rather than dropped - because a history that silently holds fewer runs
than the disk does is a reading that lies about its own coverage. It is reached from the Cockpit as
**Veridian: Show the twin - every run, joined by subject**. The client re-takes the join rather than
importing it, and that is a stated cost rather than an oversight: the extension ships `out/`,
`icon.png` and `LICENSE` and links nothing from `core/`, because it is installed into workspaces where
no source tree exists. The drift that admits is bounded by a guard - `extension/vscode/src/twin.test.ts`
pins all five field spellings to the files that own them (`schemas/result.schema.json`,
`core/metrics/metrics.ts`, `core/evidence/types.ts`), so a rename in any of them fails by name.

**World identity travels in the bundle**, which is what makes the join possible across worlds rather
than within one: the record carries the adapter, and for a simulated world the declaration
environment the world stood in for. Two further readings are built on it, and both are **export only**:

- **`dENV`** (`core/metrics/denv.ts`) is a *total* predicate over an environment record: every key is
  `kept`, `rendered` or **`refused`**, with the refusal naming the rule that refused it. Total rather
  than permissive, because a key that is neither kept nor refused is a key whose disclosure nobody
  decided.
- **`ESI`** (`core/metrics/esi.ts`, `ESI_VERSION`) is the interchange document for one subject -
  identity plus the environment's exported form, staged at `prepare()` or not at all, so an imported
  world cannot be observed without having been adopted first.

**And the boundary is enforced somewhere, which it was not before.** `core/environment/isolation.ts`
resolves a real substrate (`podman`, measured here at `5.7.1`) and the run applies it: the Cockpit
demo's own output carries `environment.provision.confinement (applied=true reason=confined ...)`. The
seam is a confinement one world adopts rather than a claim every world makes - an environment whose own
lifecycle *is* a container it starts and resets is a different deliverable, and
[`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) §5 keeps that row
open and names the world that answers it instead.

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
recorded as a crossing that fails the run with `SECURITY_VIOLATION` - even if every criterion passed.
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

`npm run demo:posix` drives this: four deliberate defects, thirteen criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-003`, `AC-006`, `AC-008`,
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

`npm run demo:os` drives this: four deliberate defects, seventeen criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations (measured, verbatim: iteration 1 fails `AC-001`, `AC-006`, `AC-007`,
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

## The tenth world: a program, judged on what it did

`local-process` is the fourth world in this list that substitutes **nothing**, and it is aimed at a
different subject from the first three. `local-web` judges a page, `local-db` judges a file of rows,
`local-api` judges an HTTP contract; `local-process` judges a **program** - the text it printed, the
code it exited with, whether it was still up when asked, and the files it left behind under a real
directory on this machine. There is no socket and no browser anywhere in the loop; the only thing
that is real is a child process, which is the thing being judged.

A world declares the program it runs:

```yaml
adapter: local-process
app: app
env:
  CART_BUILD_CHANNEL: nightly
process:
  host: cart-builder
  root: sandbox
  application:
    command: node
    args: [cart-build.mjs, daemon]
start:
  command: node
  args: [cart-build.mjs, daemon]
  readyPattern: "cart-build audit daemon ready"
```

`host` and `root` are both **required**, and each is required for a reason rather than for symmetry.
A host is required because a criterion asserting *which world answered* is asserting a declared fact,
and a world that inferred the name from a pid would make every such criterion unfalsifiable. A root
is required because a defaulted root would judge the contract against whichever directory the runner
happened to start in, which is exactly how a suite passes from the wrong folder. `application` is
deliberately **not** required: a contract that provisions a tree with its own `run` steps needs no
long-lived program at all, and a world that insisted on one would refuse the simpler contract.

The family is asked two different kinds of question, and it holds two target grammars because of it -
chosen by the **validator**, not by the spelling. A target naming a command is either `app` (the
program the world started) or a bare 1-based position (the criterion's own `run` steps, counted from
one, in the order it ran them). A target naming a file is a path relative to the world's root.
`process.file` reads its target as a place and `process.exitcode` reads its target as a selector, so
neither can misread the other's spelling, and the one collision a reader could construct - a file
called `1` - is resolved by rule rather than by guess: a bare positive integer is a selector, and
`./1` is a path.

A path that leaves the root is **refused rather than resolved**. `path.resolve` would happily turn
`/etc/passwd` into a path on this machine and `../..` into somewhere outside the sandbox, and a world
that opened either while calling it the sandbox's would read the developer's own filesystem under a
name saying it had not. So a leading separator, a drive letter and a `..` that pops past the root are
each refused, and the adapter records the refusal as a **boundary crossing** rather than reporting a
missing file - because a resource that is absent and a place that is out of bounds are two different
observations, and only one of them is the application's problem.

The twelve validators are `process.host`, `process.probe`, `process.argv`, `process.state`,
`process.exitcode`, `process.run`, `process.stdout`, `process.stderr`, `process.file`, `process.kind`,
`process.contents` and `process.size`. `process.host` is targetless and reads the declared name;
`process.state` and `process.probe` ask whether the program is still up; the rest read one command or
one file. A stream is compared as the text an operator would read, not as raw bytes - a name that
suggested otherwise would be a name a contract could be written against and never satisfy.

`npm run demo:local-process` drives this: four deliberate defects, nine criteria, and a `FAIL` ->
repair -> `PASS` descent in five iterations - measured, verbatim: the failing count is
`6, 3, 2, 1, 0`, and iteration 5 is `PASS` with `9/9 mandatory criteria passed, environment valid, no
safety violation, evidence complete.` The reach of each defect is what makes the table readable
rather than merely descending. `D2`, `D3` and `D4` are each read by **exactly one** criterion, so each
is a control: a reader can watch one edit move one reading. `D1` then moves **three** at once - a
release version constant the program prints in its build summary, again in its verifier's summary and
again inside the manifest it writes - because those are three separate true consequences of one
edited constant, not one fact counted three times. `AC-002`, `AC-007` and `AC-009` are never moved at
all, and that is the measurement that says the other six moved because of the edits rather than
because the world is flaky.

Because nothing is stood in, its reading carries **no** `simulated` field either, and this world is
the one the register answers a question about by name: there is no `*_SIMULATED_SURFACES` constant for
it and none is wanted, which is why it sits beside `local-web`, `local-db` and `local-api` rather than
beside the seven `sim-*` worlds.

## The eleventh world: a broker, judged on what it was told

`npm run demo:data` runs the same loop against `sim-data`, the seventh simulated world and the first
whose subject is not a document a world holds but a **request an application made**. The application
really opens a TCP socket to a real address on loopback and really writes a broker protocol into it:
length-prefixed frames, a CRC32C over each body, and a version negotiated through `ApiVersions` before
anything else is sent. Twelve APIs are declared in the register, and the register is the authority on
how each one is spelled; a condition the world reports is mapped to a fixed set of reading words rather
than to a sentence this world invented, so a criterion compares `refused` and knows what it is
comparing.

What is stood in for is the **broker process**. Behind that socket a substitute holds topics with
their partition counts and cleanup policies, partitions with their records at offsets beside their
high watermark and in-sync set, consumer groups with their generations and members, the position each
group has committed, and a meter over what it has been asked to do. No broker process, no replica
follower, no on-disk log, no group coordinator, no rebalancer and no outbound socket exist anywhere in
the loop, and `DATA_SIMULATED_SURFACES` names all seven of those surfaces (`broker`, `replication`,
`group-coordination`, `log-storage`, `retention`, `transactions`, `partitioning`) so a reading states
which parts of it were substituted instead of leaving a reader to infer it. **Sockets, bytes and the
record the client sent are deliberately not on that list, because they are real** - a list that named
everything would be exactly as uninformative as one that named nothing.

The family's reading is `data.broker` rather than `data.cluster`, and the name is the argument: what
is observed is **one endpoint that answers**, and `cluster` would name the thing this world does not
have. Three limits are recorded in the goal document and answered by the world rather than left to be
discovered. **One node**: replication is recorded and never performed - a topic created with a factor
of one has an in-sync set of one member, and a factor above one is refused rather than accepted and
ignored. **No rebalance**: a group is joined once and keeps the assignment that join negotiated, so a
criterion cannot observe a rebalance because there is none to observe. **No retention**: every record
ever produced is still there whatever policy its topic was created with, because this world deletes
nothing - a cleanup policy here is a value the broker *records and never applies*, and the criterion
that reads it is reading a declaration rather than a consequence.

Thirteen validators judge it: `data.node`, `data.topic`, `data.layout`, `data.partition`,
`data.record`, `data.key`, `data.value`, `data.group`, `data.member`, `data.commit`, `data.call`,
`data.probe` and `data.meter`. A reference into the broker's inventory is split on `/` and the segment
count is fixed by the noun, so `cart-events` names a topic, `cart-events/0` a partition,
`cart-events/0/2` one record at an offset, `cart-indexer` a group, `cart-indexer/member-1` one member
of it and `cart-indexer/cart-events/0` one committed position - and every other spelling is refused
with the count it wanted, rather than resolved to an empty reading that would look like an application
defect. A second grammar covers the world's own vocabularies: `data.call` and `data.probe` take an API
name as the register spells it (and, for a command the world does not perform at all, the whole
spelling the world recorded for it), while `data.meter` names one of the counters the world keeps. A
limit is carried in the value a criterion compares rather than beside it - `data.layout` compares
`topic 'cart-events' (3 partition(s), replication 1 recorded, isr [1], cleanup delete)`, because a
replication factor and the in-sync membership that could honour it are one sentence about one thing.
Three criteria act inside the world through a `run` step - the world is handed an argument vector and
executes it against its own broker, so this family needed no step kind of its own - and one of those
expects the world to **refuse** it. Its only evidence kind is `json`, written twice per criterion when
there was traffic: the criterion's own observation, and the request records beside it, which is the
artifact a reader wants when a criterion about *what the application asked for* fails, because "the
topic was never created" leaves them guessing whether it asked and was refused or never asked.

Two of the thirteen ask the same question through different doors, and keeping them apart is the
point. **`data.call` reads the requests the application put to the broker; `data.probe` reads the
requests the criterion itself issued** - so the application's `CreateTopics` for two fresh topics reads
`ok` while the criterion's own `CreateTopics` for a topic the world already holds reads `refused`, and
both readings are right. A criterion that judged one through the other's door would be reporting on
an actor it did not observe.

`npm run demo:data` drives this with four deliberate defects and twenty criteria, and it is measured
rather than asserted: the run reaches `PASS (COMPLETED, 5 iteration(s))` with `20/20 mandatory criteria
passed, environment valid, no safety violation, evidence complete.`, and the failing count descends
**`5 -> 4 -> 3 -> 1 -> 0`** (the passing count rising `15 -> 16 -> 17 -> 19 -> 20`). The reach of each
defect is what makes the table readable: `D1` (a topic created with a cleanup policy of `compact`),
`D2` (a second topic with the same error) and `D4` (a committed position one short of the records
delivered) are each read by **exactly one** criterion, so each is a control, and `D3` then moves
**two** at once - one release constant carried in the four record payloads `AC-011` compares and again
in the checkpoint payload `AC-015` compares, which are two separate true consequences of one edit
rather than one fact counted twice. So `5 -> 4 -> 3` is three controls each clearing one criterion,
`3 -> 1` is `D3` clearing two, and `1 -> 0` is `D4`.

`D4` is the defect this world exists to make observable, and the reason it keeps a committed position
at all. A pipeline that delivers three orders and commits `2` has written every record correctly: the
log is complete, every key and every payload reads exactly as it should, and the one thing wrong is
**where the group will resume** - which nothing in the data says. A criterion that read the
application's own summary would have to trust its arithmetic; asking the broker what position the
group committed asks a party that only records what it was told.

---

## The twelfth demo: Veridian's own client, judged in an extension host

This one adds no world. `npm run demo:cockpit` runs the same `sim-vscode` substitute the eighth demo
uses, unchanged, down to the readiness pattern - and it is a separate demo because the *application*
is different in the one way that matters most here: it is Veridian's own compiled Cockpit, not a
sample extension written to be judged.

It exists to separate two claims that are easy to conflate. **"The tests passed" and "the thing
works" are two different measurements, and only the second one is the product.** The Cockpit has its
own 72-test suite; that suite was green *before* the two defects this run found and green *after*
them, because both defects were in `extension/vscode/src/host/vscode-port.ts` - the one file whose
job is to adapt the real editor API, and therefore the one file whose mistakes a double of that API
cannot reproduce. So the demo installs the artifact instead: the manifest, the compiled `out/` tree,
the icon and the licence, exactly what `npm run package` puts in the archive, loaded by a real Node
process through a module this world resolves in place of `vscode`. Every action that needs the
extension running starts a fresh host process, and every host process activates the extension - which
is why an activation count here is a count of host processes and is recorded as one.

Eleven criteria judge it, and each is a reading the substitute host actually wrote down: the host it
believes it is (`vscode.host`), the identity of the thing installed (`vscode.identity`, pinned to the
`name` and `version` the manifest declares), whether the engine floor admits the module format the
build emits (`vscode.engine`), whether activation happened (`vscode.activation`), that both of its
viewer commands are contributed (`vscode.command` twice), that invoking each one was answered
(`vscode.invocation` twice), what it wrote to its output channel (`vscode.output` twice, once for the
verdict and once for the run id), that it told the user nothing (`vscode.message`) and that the one
call this world does not implement was refused by name (`vscode.refusal`). Its only evidence kind is
`json`, and `snapshot-restore` is refused by name rather than downgraded to a restart.

Two things about the demo itself are worth stating, because both are choices rather than accidents.

**It stages a build product, and it refuses by name when there is none.** `out/` is not committed, and
the world's `resolveHostPath` refuses any path outside the application's own directory - so the
artifact cannot be installed from `extension/vscode` and has to sit inside the world's app tree. The
demo copies the manifest's own `files` allowlist out of the manifest (it does not restate it) into
`examples/vscode-cockpit/app/extension/` before the run and removes it afterwards unless you pass
`--keep-staged`. That tree is generated and ignored. On a fresh clone there is nothing to stage, and
the demo says so and names `npm run build` rather than quietly judging a stale copy or skipping -
*a skipped check does not fail, it silently reduces coverage while reporting a green suite.*

**Its expectations move with the version, so a version bump moves them.** `vscode.identity` pins
`veridian-cockpit 0.6.1`, which is the version in the manifest the demo stages. Bumping the extension
means editing that expectation in the same pass; if you do not, the run will judge the artifact it
claims to judge only by accident, and `tests/vscode-cockpit-demo.test.ts` fails naming both versions
rather than letting it through.

What the demo found, measured against the published `0.2.1` build: **two defects, and each one moves
exactly one criterion.**

```
D1  `void handler().catch(...)` in registerCommand     FAIL / ABORTED   AC-008   (10 passed, 1 not passed)
D2  no shape check on the opened document in openPath  FAIL / ABORTED   AC-010   (10 passed, 1 not passed)
    both repaired                                      PASS / COMPLETED 11/11    evidence complete
```

The first is one word: a command handler that is asynchronous by contract had its promise discarded
rather than returned, so `vscode.commands.registerCommand` answered `undefined` and every caller that
chained on that answer failed. The second is the same class of mistake one layer down - an answer
whose shape is never checked is used as though it were a thenable. Read back out of the failing run's
own `result.json`, the two criteria say it plainly:

```
AC-008  Expected what the channel holds (Veridian (0 lines, never shown)) to contain "verdict  PASS",
        but it is "(nothing was written to it)".
AC-010  Expected what the extension told a user, as the host recorded it to equal
        "(no messages were shown)", but it is "error: Veridian veridian.showResult failed: Cannot read
        properties of undefined (reading 'then'); error: Veridian veridian.openFailure failed: ...".
```

Neither defect was plausible to fix by reading the suite, and neither is visible to it: the fixes were
confirmed by patching each one back into the *staged compiled* artifact and watching the run move
exactly one criterion, then restoring the golden copy and watching it return to `11/11`. The published
archive attached to `v0.2.1`, and the copy the VS Code Marketplace was serving, were both built
*before* those repairs - so `0.2.2` exists to supersede them, and the marketplace cannot be corrected
in place because it rejects a version it has already published. **A published artifact is not a
repaired artifact.**

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
                        posix, os, cloud, container, extension-host, process and broker vocabularies
                        that keep validators from importing an adapter
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
adapters/local-process/ starts a real program as a real child process and reads its exit code, its
                        two streams, a probe of whether it is still up and the files it wrote under
                        a real directory. Nothing is substituted here either - the process is a
                        process and the file is a file - so no reading carries a `simulated` field
adapters/sim-data/      the substitution and the transport are deliberately on opposite sides of the
                        line: a real TCP listener that decodes real bytes, and a substitute holding
                        the topics, partitions, records, offsets, replication assignments and
                        consumer-group state a broker would. No broker, no ZooKeeper, no Kafka
adapters/sim-mobile/    the twelfth world and the eighth SIMULATED one: a substitute handset a real
                        application process provisions through command vectors printed on its own
                        stdout. Boot state, bundles, permissions, deep links, notifications,
                        keychain entries and log lines, behind a 22-command register. It states
                        what it stands in for rather than hiding it, and nothing is emulated:
                        no emulator, no image and no booted system anywhere in the loop
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
validators/process/     process.host, process.probe, process.argv, process.state, process.exitcode,
                        process.run, process.stdout, process.stderr, process.file, process.kind,
                        process.contents, process.size
validators/data/        data.node, data.topic, data.layout, data.partition, data.record, data.key,
                        data.value, data.group, data.member, data.commit, data.call, data.probe,
                        data.meter
validators/mobile/      mobile.device, mobile.os, mobile.screen, mobile.orientation,
                        mobile.bundle, mobile.installed, mobile.permission, mobile.deeplink,
                        mobile.notification, mobile.logs, mobile.call, mobile.probe
schemas/                goal / acceptance / environment / run / result / ambiguity
scripts/                bootstrap and build steps that must run before anything is checked, beside
                        `acceptance.mjs` - the runner for the contract below
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
examples/local-process/ the tenth demo: a real program judged on its exit code, its streams and the
                        files it wrote under a real directory. Four defects, nine criteria, and the
                        failing count descending `6 -> 3 -> 2 -> 1 -> 0` - one version constant moves
                        three criteria at once, and the three controls after it move one each
examples/sim-data/      the eleventh demo: the app provisions a substitute message broker over a real
                        TCP socket it really writes to. Four defects, twenty criteria, and the failing
                        count descending `5 -> 4 -> 3 -> 1 -> 0` - three of the four defects are read
                        by exactly one criterion each, and the fourth moves two
examples/vscode-cockpit/ the twelfth demo, and the only one whose application is Veridian itself:
                        the compiled Cockpit is staged into a substitute extension host, activated
                        in a real child process, and judged on what it really did while loaded.
                        Eleven criteria. The staged tree is generated and ignored, never committed
examples/sim-mobile/    the thirteenth demo, and the eighth SIMULATED world: the app provisions a
                        substitute handset through commands it really issues, and is judged on the
                        bundles, permissions, deep links, notifications, keychain entries and log
                        lines that device holds. Four defects, twenty-five criteria, and the
                        failing count descending `5 -> 4 -> 2 -> 1 -> 0` - three of the four
                        defects are read by exactly one criterion each, and the fourth moves two
extension/vscode/       the VS Code Cockpit: a thin client, no validation logic. The one directory
                        with a build step, because the extension host is not Node's loader
                        (`npm run package` produces the `.vsix` you can hand to somebody else)
acceptance/             Veridian judged by Veridian: `veridian-mvp.yaml` (the goal),
                        `acceptance.yaml` (7 criteria, judged by the `local-process` world) and
                        `environment.yaml`. `npm run acceptance` runs it TWICE - a first run that
                        passes and a second that fails is the signature of a world a run inherited
                        rather than built
tests/                  2700 tests over 453 suites in a root `node --test` run: this tree's own
                        2608 plus the Cockpit's 92

dist/                   GENERATED by `npm run build`. Never edited, never committed.
extension/vscode/out/   GENERATED by `npm run build` inside extension/vscode. Same rule.
extension/vscode/veridian-cockpit-*.vsix  GENERATED by `npm run package`. Same rule.
```

The tree above is the program. `dist/` is the artifact the package and the container ship, and it
exists for one reason: Node will not strip types for files under `node_modules`, so an installed
Veridian cannot be the `.ts` files above. `npm run build` compiles them and copies `schemas/` in;
`npm run smoke:dist` proves the result runs from a directory that is not the package.
`extension/vscode/out/` exists for the same kind of reason one runtime further out - the extension
host is not Node's loader either - and `npm run smoke:out` is its equivalent check. The Cockpit's
archive is a third artifact, produced by a third-party tool from an allowlist in the manifest, and
`npm run smoke:vsix` reads it back rather than trusting the tool that built it. The MCP surface is a
fourth, and the only one whose artifact is a *running program* rather than a file: its interface is a
child process reading stdin and writing stdout, so no unit test can reach it - `npm run smoke:mcp`
spawns the real server and drives it over a real pipe, and needs no build, because the source tree is
the program.

The interfaces are small on purpose:

```
EnvironmentAdapter:  create() start() deploy() execute() observe()
                     snapshot() restore() reset() stop() destroy()
Validator:           validate(criterion, observation) -> ValidationResult
ValidationResult:    criterion_id, status, actual, expected, timestamp, evidence,
                     environment_id, run_id
```

Layering is enforced by hand, and `core/*` may not import `adapters/*`, `validators/*`, `cli/*` or
`mcp/*` - the `mcp/` surface is a door, and `tests/mcp-demo.test.ts` holds that first clause as an
executable rule by walking `core/` and requiring it to name the surface nowhere;
`validators/*` may not import `adapters/*` (the shared vocabulary lives in
`core/environment/web-observation.ts`, `db-observation.ts`, `k8s-observation.ts`,
`posix-observation.ts`, `os-observation.ts`, `cloud-observation.ts`,
`container-observation.ts`, `vscode-observation.ts`, `api-observation.ts`,
`process-observation.ts`, `data-observation.ts` and `mobile-observation.ts`
for exactly that reason);
`cli/*` may import all of them, and so may `mcp/*`, which reaches the engine through `cli/*`
rather than by importing a world itself.

---

## Scope

**In, for the MVP:** VS Code + Veridian Core + a local application + a browser + Playwright +
deterministic acceptance criteria + evidence + reset/replay. Twelve adapters exist: `local-web`,
`local-db`, `local-api` and `local-process` - four worlds that substitute nothing - and eight
*simulated* ones. Three of the real ones are also the argument that `EnvironmentAdapter` is a seam
rather than a browser harness with an interface bolted on: `local-db` judges a SQLite file,
`local-api` is that proof's mirror - a world that is **real** and reached over a socket, where the
contract puts its own request rather than observing one the application made - and `local-process`
is the same argument aimed at a subject with no socket at all: a real program run as a real child
process, judged on its exit code, its two streams, a probe of whether it is still up and the files
it wrote under a real directory. `sim-k8s`: a real application
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
`sim-data`: a real application process really opens a TCP socket and really writes a broker protocol
to it, and is judged on the topics, partitions, records, offsets, replication assignments and
consumer-group state the substitute behind that socket holds, with no broker, no ZooKeeper and no
message-broker software anywhere in the loop. `sim-mobile`: a real application process really issues
commands and really reads the device back, and is judged on the bundles, permissions, deep links,
notifications, keychain entries and log lines the substitute handset holds, with no emulator, no
image and no booted system anywhere in the loop.
`local-api`: no substitute at all - a real service, judged through its own HTTP interface on loopback,
with the contract's own requests as the observation. `local-process`: no substitute at all either,
and no socket - a real program run as a real child process and judged on the text it printed, the
code it exited with and the files it really wrote. In all
eight of the simulated ones, the substitution is
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
name: one is a client *of* Veridian, the other is a world *for* it. The `data` world is the argument
once more, on the axis that is easiest to overclaim: it does not run a broker, and it does not pretend
the *transport* is a substitute either - the listener is a real socket, the bytes are real and the
frame is decoded and bounds-checked for real. What is stood in is the **broker** behind that socket,
which is why the reading names the surfaces it substitutes and not the socket it did not.

Also built, and named here rather than left for the reader to discover: the **VS Code Cockpit**
(`extension/vscode/`) - a thin client over the same local Core interface the CLI drives, so CLI, CI
and MCP can drive one engine. *"MCP is the door. Veridian is the building."* It is the third runtime
in this repository: the extension host loads JavaScript and is not Node's loader, so the Cockpit is
compiled to `out/`, and `npm run smoke:out` is the check that loads that compiled artifact (no test in
this tree can). It ships by three routes - a development install (a checkout plus F5), a packaged
`.vsix` (`npm run package`, read back by `npm run smoke:vsix`, because an archive built by a
third-party tool is a fourth artifact nothing else here can load), and the two extension
marketplaces that archive is published to, which read their descriptions off the same manifest. One
thing is **not** claimed: the
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
| [`docs/DISTRIBUTION-AND-ENVIRONMENTS.md`](./docs/DISTRIBUTION-AND-ENVIRONMENTS.md) | What comes after the MVP: the npm, Docker, VS Code and extension-marketplace routes, the next adapters in the order they can be proven, and the environments that are blocked with their blocker named. |
| [`extension/vscode/README.md`](./extension/vscode/README.md) | The Cockpit's front door: what the extension is not, how to install it for development, and what only a real VS Code test host could exercise. |

## License

**BSD 2-Clause** - see [`LICENSE`](./LICENSE). It is recorded as a reversal of the build-time MIT
default in [`docs/IMPLEMENTATION-PLAN.md`](./docs/IMPLEMENTATION-PLAN.md), assumption A12.

*Veridian was formerly named AVF ("Agent Validation Fabric"); `docs/PLAN.md` predates the rename, so
read "AVF" as Veridian and the plan's `.avf/` as `.veridian/`.*
