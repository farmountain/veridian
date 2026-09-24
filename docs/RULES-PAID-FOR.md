# Rules this build has paid for

> Moved verbatim out of `AGENTS.md` so that the always-on instruction file stays a budget rather
> than a library. Nothing here was rewritten in transit; each entry keeps the measurement that
> made it a rule.


Each of these cost a real defect. They are not style preferences; each one is a way a run has
already reported something that was not true.

- **A textual overlay on a source file must be re-expressed in that file's own line ending.** The
demo's multi-line defect is authored with `\n`; a Windows checkout holds `cart.js` in CRLF, so the
edit matched nothing and the demo reported a `PASS` the application never earned. `defects.ts`
computes the file's newline and converts, and `examples/shopping-cart/demo.ts` learned the same
lesson the hard way - its own copy of the replacement left a defect injected and still printed
"restored the correct app". **There is exactly one implementation of undoing a defect
(`repairOne`), and a function that changes a file must not announce a change it has not verified.**
- **A test that asserts a property of the checked-out file is asserting a property of the developer's
platform, not of the program.** The rule above is right, and the first test written for it was wrong
in the one way that rule does not cover: it read `examples/inventory-db/app/build.mjs` and asserted
`body.includes("\r\n")`. Measured, `git ls-files --eol` reports the committed blob as **`lf`**,
`core.autocrlf` is `true` on this machine and `false` in CI, and there is no `.gitattributes` to
normalise either way - so that assertion was a statement about Windows, and `gate (ubuntu-latest)`
failed on it at `416/417` the first time the workflow ran. It could never have passed there. The
property is not "the file is CRLF"; it is "the overlay is expressed in the file's own ending". Do
**not** "fix" this with `.gitattributes` forcing `eol=lf`: that would delete the CRLF checkout that
naturally reproduces the original defect, and the natural reproduction is worth more than the
tidiness. *The same shape as the `resolveSibling` defect one section down, one layer out: there the
platform was the filesystem, here it is the developer's git configuration.*
- **And that test proved nothing even where it passed, which is the worse half.** Every block in the
inventory demo's defect table is a **single line** - `quantityOnHand: 30,`, `return Math.round(dollars
* 100);`, `WHERE quantity_on_hand < reorder_level` - so `newlineOf`/`inStyle` never touched them and
the line-ending rule was never reached. Measured rather than argued: replacing `newlineOf` with a
function that always returns `"\n"` left that test **16/16 green**. The comment above it claimed "D1's
block is multi-line precisely so that a mismatch would be visible here", and that sentence was false
about the very table it described. The rule is now held by `tests/defect-text.test.ts`, against the
shared implementation, with synthetic multi-line blocks and both endings supplied by the test; under
the same probe it fails **4 subtests**, which is the difference between a test and a comment. The demo
test keeps the honest half - that *its* table is single-line, and therefore ending-insensitive by
construction, so the rule cannot be exercised there and must be tested somewhere it can be. *A test
that passes whether or not the rule holds is not a test. And a green suite is not evidence that a rule
is held - it is evidence that nothing has broken it yet; the evidence is what happens when you break
it on purpose.*
- **A contradiction detector must key on (observable, scenario), not (validator, target).** Two
criteria reading the same selector with different values are the *ordinary* shape of a contract -
add an item and expect 1 row, add and remove and expect 0. Keyed on the target alone, the detector
raised three blocking questions about a correct contract. Whether two different scenarios can both
hold is a question about the application, which Veridian refuses to model.
- **`joinPointer` escapes the tokens it is given, so a pointer that has already been built must
never be passed back in as a token.** Doing so produced `/~1criteria~12/expect/0` - a path naming a
single key, which resolves to nothing. A path is not decoration: the engine writes the operator's
resolution to it and the failure report quotes it. Build paths with the flat form,
`joinPointer("criteria", index, "expect", expectIndex, "target")`.
- **A gap's path names a place that may not exist yet - its container, however, must.**
`hasPointer(document, parentOf(entry.path))` is the invariant; asserting the leaf resolves is wrong,
because a missing key *is* the gap. `tests/definition-resolution.test.ts` holds this line and also
asserts no path carries `~1`.
- **An absolute path must stay absolute.** `nodeIo` joined every caller's path onto its root, so
`--goal D:\repo\examples\goal.yaml` was looked for at `D:\repo\D:\repo\...` and reported as "the
goal file does not exist" - naming a file that was sitting right there, which sends the reader to
check the one thing that is not broken. `memoryIo` had always handled this; the real filesystem now
matches it.
- **Layering is enforced by hand because nothing else enforces it.** `core/*` must not import
`adapters/*`, `validators/*`, `cli/*` or `mcp/*`. `validators/*` must not import `adapters/*` - the
shared vocabulary lives in `core/environment/web-observation.ts` for exactly that reason. `cli/*` may
import all of them, and so may `mcp/*`, which imports `core/*` only through its public entry points -
measured rather than assumed, `mcp/server.ts` names `core/io.ts`, `core/evidence/index.ts`,
`core/definition.ts` and `core/clarification/index.ts` and nothing inside them.
`core/clarification` is the lowest layer of all. **This rule is stated in full in six places, and
`mcp/` landing left five of them stale** - this entry, `README.md`'s layering paragraph, the layering
block in `.github/instructions/typescript.instructions.md` and the one in
`docs/IMPLEMENTATION-PLAN.md` each named three prohibitions for a four-layer tree, and
`docs/ISOLATION-AND-MCP-PLAN.md`'s own §3 paragraph on where `mcp/` sits called `cli/*` "the only
layer allowed to import all three". `docs/ISOLATION-AND-MCP-PLAN.md` §4.5 is the only statement that
was right, and it was right because it was written by the same change that landed the layer: it
predicted this drift in as many words (*"a new layer is exactly the change that makes a stale rule
look current"*). That the same document carried both statements, 180 lines apart, is the sharpest
form of the finding - a file can be right about a rule and cite the old version of it in the same
breath. Nothing failed, because a rule enforced by hand has no guard over its own prose -
`tests/mcp-demo.test.ts` holds the first clause by walking `core/` and requiring it to name the
surface nowhere, which is the code and not the documents. All five were corrected in the same pass,
and found by **grep** for the rule's spelling rather than by reading any of them - and **two of the
five were reachable only by widening that grep**: `README.md` and `ISOLATION-AND-MCP-PLAN.md`'s §3
paragraph state the rule through an *exclusive marker* ("the only layer") and contain the words "must
not import" nowhere at all, so a pattern built from the phrase the searcher already has in mind finds
only the copies that use that phrase. A seventh site, `core/environment/web-observation.ts`, states
two of the clauses as the reason that file exists and names no consumer layer, so it is a citation
and not a statement of the rule - *a count that includes both is a count that will be corrected
again.*
- **`tsconfig.json` is strict in ways that change how you write code:** `verbatimModuleSyntax`
(every type-only import needs `import type`), `erasableSyntaxOnly` (no enums, no parameter
properties, no namespaces), `noUncheckedIndexedAccess` (indexing yields `T | undefined`, so
`arr[i] ?? fallback`), and `allowImportingTsExtensions` (imports carry the `.ts` extension).
- **A bundle ledger that only appends describes a bundle that does not exist.** The bundle is
last-write-wins per path: `screenshots/AC-001.png` is the same file on iteration one and iteration
four, because the layout names an artifact by criterion and not by iteration. `RunBundle` appended
every write anyway, so the canonical demo's passing run listed **36 artifacts for 10 files**, naming
`artifacts/AC-001.observation.json` four times with four different sizes (4096, 4096, 3010, 3010) and
leaving a reader no way to tell which size is the file on disk. The ledger is now keyed by path
(`#artifactAt`), so the newest write to a path replaces the row standing for it. *An inventory that
disagrees with `Get-ChildItem` is a claim, not a record.*
- **The loop's three counts collapse different failures into the same numbers, so they cannot be
compared as a substitute for the criteria.** `passed: 3, failed: 1` is what a run reports whether
AC-001 broke or AC-003 broke, and a repeat-run consistency check (M1) that compares counts would call
two runs equal that failed different criteria - the one thing "the same code produced the same result
twice" is supposed to mean. `IterationSummary` now carries `criteria` (every criterion's status *as
that iteration observed it*), because the bundle keeps only the final iteration's per-criterion
detail and the earlier iterations are otherwise unrecoverable.
- **A schema that re-lists a vocabulary its engine owns will fall behind it, and the failure mode is
not a lint warning.** `result.schema.json` enumerated the clarification `origin` values and omitted
`iteration`, which the run itself produces mid-loop, so `finish()` threw while writing the result,
which meant `writeResult` never landed, which meant `world.teardown()` was skipped and the process
outlived its own `INCONCLUSIVE -> stop` (a four-iteration hang, no bundle). The schema now `$ref`s
`ambiguity.schema.json`, and `tests/schema-vocabulary.test.ts` holds the line. *One definition,
referenced.* The same failure was found in the **types**: `IterationSummary` was declared word for
word in both `core/evidence/types.ts` and `core/execution/types.ts`, which is how a field added to one
goes missing from the artifact supposed to contain it. It is now declared once, in the evidence layer
that owns the bundle shape, and re-exported by the execution layer - the same direction `RunOutcome`
already travels.
- **An environment record built before the loop describes the world the run started in, not the world
it used.** `world.transitions` grows while a run works - the reset between iterations is the event it
exists to show - and `loop.ts` read it once, at `prepare()`, then wrote that same value into
`environment.json` and into every `result.json` afterwards. The canonical four-iteration demo resets
the world **three times**, and its bundle recorded seven transitions ending at `ready` before the
first observation: the record said the run never reset. Nothing failed, because nothing was checking -
which is the point. The record is now built by a function, `envRecord()`, called at each write site,
and `finish()` rewrites `environment.json` so the bundle does not end up holding two readings of one
fact (this file frozen at `ready`, `result.json` listing three resets). Found by building the metrics:
M4 counts `from: "resetting"` transitions, and it reported a violation on a run whose own execution log
showed the resets. *A metric that can only agree with you is not a metric - this one disagreed, and it
was right.* `tests/execution-loop.test.ts` holds both halves.
- **A run-time flag has to reach the *plan*, not just the object built from it.** `--browser none`
decided whether to construct a browser and then handed the adapter the environment document, where
`browser.enabled` was still `true`. The adapter can see only the plan, so with no page and a plan that
promised one it named the single cause it could not rule out - "Playwright is not installed" - for a
run where Playwright *was* installed and the operator had switched the browser off on purpose. Four
`INCONCLUSIVE` criteria, one false dependency to go install, and a bundle whose `environment.json`
recorded a world (`browser.enabled: true`, `reproducibility.browser: chromium`) the run never used.
`applyBrowserChoice()` now derives the effective plan once in `cli/arguments.ts` and the CLI builds the
adapter, the loop *and* the record from it; the message for a disabled plan is a fact about the plan,
which is the only thing the adapter ever knew. *An error message may only name a cause the reporter
observed.* `tests/cli-arguments.test.ts` holds the derivation; the two adapter messages were already
held by `tests/local-web-environment.test.ts`.
- **A delta names its subject and its verb in the same order, or it accuses the wrong run.** M1's
differences printed `${runId} vs ${against}: ${detail}` where the detail was assembled
baseline-first: over a real history it read `run-...-073547 vs run-...-072554: verdict: PASS vs
INCONCLUSIVE` about a run that was `INCONCLUSIVE` and a baseline that was `PASS` - an invitation to
debug the healthy run, and one this agent nearly took. The detail is now built run-first, matching the
prefix, and the test looks each value up *by the ids in the prefix* rather than matching a literal
string, so a reordering fails instead of merely changing. *A line that is only ever read by whoever
wrote it agrees with itself.*
- **Print ASCII in anything a console will display.** This machine's code page renders an em dash as
`鈥?`, so a CLI message or a demo line using one arrives as noise. The rule covers every string the program
can print, not just CLI narration: criterion messages, failure reasons, the `failure.md` written into
a bundle, and test titles, because a test runner prints those too. Re-measured rather than trusted:
the tree carries 259 non-ASCII characters and **none is in a string Veridian prints**. 208 sit on
comment lines, 11 are `§` in the `description` fields of `schemas/*.schema.json` - metadata that
`core/schema` never reads, let alone quotes back, since a violation is reported as a `path` and a
`message` - and the remainder is a trailing comment in `.github/hooks/format.mjs`. The only
descriptions that reach a bundle's `failure.md` are the operator's own, read out of their
`acceptance.yaml`. The figure that used to stand here - "roughly thirty such strings" - did not
reproduce when it was checked. *An inventory that only checks the output you happen to look at is a
claim, not a record; so is a count nobody can reproduce.*
- **A runtime documented as "runs TypeScript directly" may still refuse the one copy that ships.**
Both this file and the README said "no build step: Node 22 strips types and runs `.ts` directly". True
for every file in this repository, and false under `node_modules` -
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, raised for an import and for a `bin` entry alike - so
`"bin": "./cli/veridian.ts"` could never have run for anyone who installed the package. The claim was
not wrong about the codebase; it was wrong about the world the codebase would be shipped into, and a
distribution claim is only ever about that world. Distribution is now three routes (`## Distribution`):
the clone still runs source, and the package runs `dist/`, which is why `npm run smoke:dist` exists -
**the shipped artifact is the one no test in `tests/` can reach, so it needs a check of its own.**
- **A file the install path resolves through the *caller's* directory is a file the installed program
  cannot find.** `loadSchemaSet` read `schemas/goal.schema.json` through the operator's `nodeIo`,
  which was correct for exactly as long as the only way to run Veridian was from its own repository
  root. Installed, that path resolves inside the *user's* project, and the error named a missing goal
  schema sitting inside the package - the worst kind, because it sends the reader to inspect the one
  thing that is not broken. The fix is two roots and a vocabulary for them: `core/assets.ts` resolves
  Veridian's own files against `import.meta.url`, `io.ts` resolves the operator's against the working
  directory, and `cli/veridian.ts` uses one port for each. `tests/assets.test.ts` holds both halves.
  *The defect was invisible to the whole suite because every test shared the property that hid it -
  they all ran from the repository root. This is the same shape as "a guard no code path can trip is
  not a guard", one layer out: an environment every test shares is an environment no test varies.*
- **A client that discards a response body is blind by its own hand, and one that then names a cause
it never observed is worse than blind.** `HttpMemory#post()` read only `response.status`, so the
substrate's `403 {"error":"precondition blocked: PII risk=0.90 patterns=[\"PII:...\"]"}` reached the
log as the bare word `HTTP 403`, under a warning that went on to assert the substrate was
**unreachable**. It was reachable and healthy; a content precondition had refused the write. The
false diagnosis was not cosmetic: it sent this agent through four scratch probes and four terminal
runs hunting a host, a payload size, a record type and a header - all four eliminated, none ever at
fault - while the answer had been returned and thrown away two lines earlier. `#post()` now carries
the status *and* the substrate's own stated `error` (preferred over the raw body, flattened and
bounded to 300 characters, and guarded so a non-JSON refusal cannot become a parse error), and the
warning claims only that memory became unusable. `tests/memory-port.test.ts` holds both halves: a
refused write reports `precondition blocked` and does **not** contain "unreachable", while a genuine
`ECONNREFUSED` still does. *An error message may only name a cause the reporter observed - and the
reporter is the only one holding the evidence.* This is also why `core/memory/` has tests now: the
port had none, which is why the defect reached a demo run.

- **A metric that reports `none` for a comparison it never made is the comfortable pass it exists to
  refuse.** `formatMetrics` printed `M3 false PASS: none` whenever it found no false passes, including
  when `--defects` had named nothing - and without a named defect, half of M3 (a `PASS` that blessed
  code known to be broken) is not comparable, because nothing said what was broken. The line claimed a
  clean bill on the strength of the half it could still check. `M2` had always answered correctly
  (`INCONCLUSIVE (no known defects were named to detect)`), so the two ground-truth-dependent metrics
  disagreed about how to behave when the ground truth was absent - and `README.md` already promised
  the behaviour M3 did not have. M3 now says `INCONCLUSIVE`, naming what was left out, while a false
  pass it *did* find is still printed. Found by running the metrics over a paired
  browser/browserless pair, which is also what proves M1 discriminates on real bundles: two worlds,
  one codebase, and M1 named each criterion that moved. `tests/run-metrics.test.ts` holds both halves;
  stashing the fix fails exactly one of the two, which is the difference between a test that passes
  and a test that tests.

- **A platform CI claims to cover, but has never run, is a platform that does not pass.** This file
  said CI "runs `npm run gate` on `ubuntu-latest` and `windows-latest`", and the workflow did - but the
  repository had no remote until this session, so the workflow had never executed once. Its first run
  found **two** defects, both on ubuntu, and both the same bug: a leading separator - or the empty
  first path segment that stands for it - silently dropped. `resolveSibling` (`core/goal/load.ts`)
  skipped every empty segment in order to collapse `.`, `..` and `//`, which deleted the POSIX root
  along with them, so `/home/runner/.../acceptance.yaml` came back as `home/runner/.../acceptance.yaml`
  and `loadDocument` reported as missing a file sitting in plain sight; the demo exited 3 before it
  ever reached a browser. `core/schema/validate.test.ts` built its repository root from `url.pathname`
  with the leading `/` stripped - the very strip that leaves a Windows drive letter intact and turns a
  POSIX path relative - so all six of its schema subtests said `could not be read`. Windows sees
  neither, because `D:/x/a.yaml` has no leading separator and no empty first segment to lose. Both now
  go through the platform-aware primitive (`fileURLToPath`, and a rooted check before the collapse),
  and `core/goal/load.test.ts` exercises the POSIX cases on every platform - which is the only way one
  developer on one platform can hold a two-platform claim. *An inventory that only checks the output
  you happen to look at is a claim, not a record; so is a check that has never run.*

- **A guard that no code path can trip is not a guard, and a bundle field that is a literal is a claim
  pretending to be a record.** The `PASS` rule has three clauses and the third - "there was no safety
  violation" - could not be false. `networkPolicy` and `filesystemWrite` were declared in
  `schemas/goal.schema.json`, defaulted by the clarification ladder, parsed into `GoalLimits`, and then
  read by nothing that could act on them: no occurrence in `core/execution/**`, `core/environment/**`,
  `adapters/**` or `validators/**`. `rollup`'s `noSafetyViolation` was implemented and tested, and
  `loop.ts` read an `options.safetyViolation` the CLI never set, so the value it tested was always
  `null`; `core/evidence/writer.ts` then wrote `safetyViolation: null` as a **literal**, so even a
  violation nobody detected could not have been recorded. The structural cause is the `--browser none`
  defect recurring one layer down: `EnvironmentPlan` had no boundary field, so the adapter - which sees
  only the plan - could not have enforced one even in principle. *A run-time fact has to reach the
  plan, not just the object built from it.* The plan now carries `boundary`, the adapter installs a
  route guard it can actually hold and reports the rest `unsupported`, the loop reads the world's
  crossings when it builds its verdict, and `environment.json` pairs each declared policy with the
  enforcement measured for it. Full audit and design in
  [`docs/BOUNDARY-ENFORCEMENT.md`](./docs/BOUNDARY-ENFORCEMENT.md).

- **A reset restores the world; it does not restore the record.** The adapter accrues boundary
  crossings for the run and never clears them on `reset()`, which looks wrong the first time it is
  read - the world it is describing is a fresh one. Clearing them is the defect: an iteration that
  reached outside the boundary would be followed by a clean one, and the run would report `PASS` with
  an empty `crossings` list, the evidence of the violation destroyed by the very act of repairing it.
  That is the shape of false pass M3 exists to refuse. `tests/execution-loop.test.ts` holds it - a
  crossing seen in an early iteration still fails the run after the reset - and the reason is written
  at the field rather than only in the test.

- **The package manager validates the dependency tree, not the metadata that describes the package.**
  Moving `bin` to `./dist/cli/veridian.js` left `package-lock.json`'s root entry still naming
  `cli/veridian.ts`, and `npm ci` accepted the pair without complaint - it was checked by building the
  mismatched manifest-plus-lockfile in a temporary directory and watching the install proceed past the
  sync check. That is the **same shape** as the licence drift this repository already paid for, where
  the lockfile said `UNLICENSED` while the manifest said `MIT` for as long as one had been edited
  without the other. `name`, `version`, `license`, `bin`, `dependencies`, `devDependencies` and
  `engines` are each written in **two** places and reconciled by nothing, so a change to any of them in
  `package.json` has to move the lockfile's root entry in the same pass. `npm install
  --package-lock-only --ignore-scripts` is the tool; `git diff --stat package-lock.json` should show
  one line. *An identifier declared in several places is a claim that will disagree with itself if the
  places are edited independently - and the thing you would expect to catch it does not even look.*

- **A validator family that decides every verdict in its world had no unit coverage, while the other
  family had 26 kB of it.** `validators/playwright/web-ui-validators.test.ts` is a thorough suite;
  `validators/database/` had none, so `db.table`, `db.column`, `db.count` and `db.value` - the four
  functions that decide *every* database criterion's status - were exercised only end to end, by one
  demo, through one contract. The whole family's status semantics were held by a single example. This
  is the same shape as "the shipped artifact is the one no test in `tests/` can reach", one layer in: a
  *verdict path* reachable only through one happy-path demo is a path whose failure modes are untested.
  `validators/database/db-validators.test.ts` now holds the roster, the malformed-observation path, each
  comparison and each status, at 68 tests - **and it was falsified rather than trusted**: replacing the
  number branch in `compareCell` with a single text comparison makes four subtests fail, each naming a
  different property. *Compare families by the coverage they declare, not by whether they are
  implemented - "it works" and "it is tested" are different claims.*

- **A roster in prose and a roster in a registry are two lists of the same thing, and only one of them
  is executable.** `db.query` was named as a member of the database validator family in `README.md`,
  in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` **and** in this file's own layout table, while
  `DB_VALIDATORS` held four entries and no source file mentioned the name anywhere. Nothing failed,
  because a list of names in a document is read by nothing that could disagree with it. It was found
  by the new suite's *first* assertion, which pins `registry.names()` to the four the code exports -
  a measurement of the code, against which three documents were wrong. *A list of names in a document
  is a claim about the code, and the cheapest way to hold it is a test that reads the code.* **This is
  the same shape as a count that does not match the run, and as an identifier written in both
  `package.json` and its lockfile**: a fact recorded in prose drifts because nothing reads it.

- **A requirement that names a *place* must be resolved as a pointer, not read as a literal key.** The
  worlds register declares each adapter's requirements as dot-paths (`cluster.name`,
  `health.path`, `database.path`), and the detector read each one with `Object.hasOwn(environment,
  requirement.field)` - so `cluster.name` was looked for as a key with a literal dot in its name, was
  absent from every correct document, and `clarify` raised three *blocking* gaps for values that were
  sitting in the file. Worse, the operator's answer would have been written to the literal key, so the
  gap would have reappeared on the next run: a question the answer cannot close. Fixed by routing every
  requirement through `getPointer`/`joinPointer` on the split path, which is the same helper the ladder
  already used for criteria. `tests/environment-gaps.test.ts` drives the *real* descriptor table rather
  than a fixture, and holds both halves - a missing nested requirement is reported at its pointer whose
  *container* exists, and an answer lands where the adapter reads it. *A path is not decoration: it is
  where the operator's answer is written and what the failure report quotes.*

- **Two implementations of one rule disagree the first time a world arrives that only one of them was
  written for.** "This world has no HTTP" was decided in two places: the detector's `hasNoHttp`, which
  knew only about a *database file*, and the environment loader's `readBrowser`, which infers a browser
  from the presence of a `url`. `sim-k8s` is a world with neither, so the detector asked it for a URL
  and handed it `expectStatus: 200`, the ladder derived `browser.enabled: true`, and the loader then
  refused the pair it had just been handed - `this definition cannot be run`, before the run ever
  reached the cluster. The predicate now lives once, on the shape of the world (`url`, `databasePath`,
  `cluster`), and the loader and the detector agree because there is one of them. *An environment
  predicate duplicated across two layers is a claim about agreement that nothing checks - and the
  divergence is not a near miss, it is `INCONCLUSIVE` on every criterion at best and a false promise at
  worst.*

- **A capability report must be derived from what the code did, not from a literal list beside it.** The
  `sim-k8s` and `local-db` adapters warned for *every* evidence kind a criterion requested, including the
  `json` artifact the same function had written two statements earlier - so the demo printed
  `produces \`json\` artifacts and cannot produce \`json\`` thirty times, and a reader who learned to skip
  those lines had learned to skip the one that is true. The set is now read off the artifacts actually
  written, so it cannot disagree with them. *A second list is free to drift from the writes; a derived
  one is not - and a sentence that contradicts itself is worse than silence, because it trains the
  reader.*

- **A test that asks whether a value is in a list cannot see a list that is wrong in a different way.**
  The first version of the new suite's strongest assertion was
  `!raised.includes(pointerOf(requirement.field))` - and it **passed with the literal-key defect
  deliberately reintroduced**, because that defect moved the reported path from `/cluster/name` to
  `/cluster.name`: a different list, containing neither the string the test looked for. It now keys on
  `context.reason`, which is unique per requirement and not templated, and asserts the resulting path
  list is empty - under the same probe it fails **three** subtests. *A membership test is a question
  about one string, and a defect is a claim about a set.*

- **A register whose members are schema `oneOf` branches needs a guard of its own.** `STEP_KINDS` in
  `core/acceptance/` and the `Step.oneOf` branches in `schemas/acceptance.schema.json` are the same
  vocabulary written twice, in two languages, reconciled by nothing - so a step kind the engine
  implements and the schema rejects (or the reverse) is a criterion no document can express. Exactly
  this had already happened once in this repository to a *validator name* (`db.rowCount`, unwritable
  under the schema's `^[a-z0-9]+(\.[a-z0-9]+)+$`). `tests/step-kinds.test.ts` now reads the schema and
  pins the register to it. *A vocabulary the engine owns and the schema re-states falls behind the
  engine, and the failure mode is not a warning: it is a document that cannot be written.*

- **A read must not mutate the record it reads.** The substitute control plane recorded a pod's events
  *inside* the derivation of its snapshot, so the first read of a namespace wrote `count: 1` and the
  second wrote `count: 2` - and M1, which compares exactly these documents, would have called one
  cluster two different worlds. A real cluster records its events when its controller acts, not when a
  client looks. `adapters/sim-k8s/cluster-port.test.ts` reads twice and asserts the two documents are
  `deepEqual` and that every count is still one. *An observation that edits what it observes cannot be
  repeated, and a measurement nobody can repeat is an opinion.*

- **A resource that is absent and a request that is refused are two different observations, and HTTP
  already has a word for each.** The substitute control plane answered every route it did not serve
  with `405`, so a request for a resource the cluster does not hold came back as
  `GET is not supported for /apis/apps/v1/namespaces/dev/configmaps` - a message **naming a cause the
  server had not observed**, since `GET` was served and the *resource* was what was missing. It sends
  the reader to inspect their method. A criterion over that status has only one honest translation,
  `INCONCLUSIVE`, for a question whose answer was actually known. An unknown resource is a `404`
  naming it; an unsupported method on a known resource is a `405`. Both are now answered by their own
  condition, and `cluster-port.test.ts` holds each. *A substitute that merges `404` and `405` makes the
  verdict unearned, and an error message may only name a cause the reporter observed.*

- **A probe must be shown to change the thing it claims to change, and to measure the thing it claims
  to measure.** The root `node --test` run reported **695** against a documented 634, and the first two
  probes each pointed somewhere wrong. `git status --short` found the first cause: a stray
  `?? bundle.test.ts` at the repository root, 0 bytes, left behind by a falsification probe whose
  cleanup had failed - and **an empty file is still a test to a discovery runner**, so a failed probe
  had added a test to the very count it was measuring. Deleting it moved the run to 694. The second
  probe *appeared* to exonerate the root runner: renaming `extension` to `extension.hidden` reported
  695 both ways. It proves nothing - **renaming a directory inside the tree does not remove it from a
  recursive glob**, and the tree still held `extension.hidden/vscode/src/*.test.ts`. The decisive
  probe was to ask the root run whether it contained test names that exist *only* in the extension
  (`the manifest and the Cockpit declare the same commands` matched twice): it does. The decomposition
  is 634 + 60 = 694. In the same session a path check printed
  `preLaunchTask matches a declared task : False` for two labels that are byte-identical, because the
  probe rested on a `.Count` produced by a PowerShell pipeline rather than on a count of the objects it
  was assumed to count; compared directly, the two match. *A "control" that does not change the thing
  it claims to change is not a control, and a failed probe is not evidence about the code - in both
  cases the files were right and the measurement was wrong.*

- **A generated tree that is not ignored is one `git add .` away from being committed, and a comment in
  a configuration file is a check you cannot run.** `extension/vscode/out/` existed and was **not**
  ignored - `git check-ignore -v` matched `node_modules/` for the extension's dependencies and nothing
  for its build output, so the next `git add .` would have committed the compiled tree, the same defect
  class as committing `dist/`. The rule is now explicit and re-verified (`IGNORED_EXIT=0`). The other
  half is the `.vscode/launch.json` written first with a `//` block explaining its pre-launch task:
  the configuration was correct and **unverifiable**, because the file stopped being plain JSON to the
  parser anything would use to check it. The comment was moved into the documentation and the file
  reduced to JSON that parses, after which its four path facts could be - and were - asserted.
  *Anything you cannot check, you have to take on faith, and this repository does not.*

- **A flag's value is not an operand.** The `sim-posix` substitute's `adduser` took "the words that do
  not start with `-`" as its operands, so `adduser --system --home /var/lib/cart-web cart` created an
  account named `/var/lib/cart-web` and treated the real name as a group to join - and it **exited 0**,
  so the world reported success for a command it had not performed. A criterion asking whether `cart`
  exists could then never pass, however many iterations re-observed it, and the symptom was a single
  criterion that stopped moving while the rest of the progression descended cleanly. Found by reading
  the bundle's own exec artifact for that criterion, where the account name beginning with `/` was
  sitting in plain sight. *A criterion that stays `FAIL` after its defect has been repaired is a
  defect in the criterion, the target spelling, the substitute, or the reading - not in the repair*,
  and an exit code of 0 is not evidence that a command did what its name says. Held by two tests, each
  falsified by deleting one `index += 1`.

- **A world a run inherits is not a world that run built.** `stop()` keeps the `sim-posix` sandbox on
  purpose, because a bundle quotes paths inside it - so the *next* run's first observation can read the
  previous run's files. `prepare()` made directories without clearing, so the second run's first
  iteration read a `/etc/veridian/policy.conf` that run had never installed (its own application had
  written `policy.cfg`, which is the defect under test) and **two criteria reported `PASS` on an
  artifact from someone else's run**. The next `reset()` wiped it, so the symptom was a progression one
  iteration out of step rather than an error, and the run still ended `PASS` with 13/13 - a false
  `PASS`, the class this product exists to make impossible. It was found by running the demo twice in a
  row and comparing the two progressions, not by reading the port, and the demo's own narration had
  been *right* the whole time while the world was wrong. `prepare()` and `reset()` are now one
  implementation, `rebuild()` - *two implementations of one rule disagree the first time a world arrives
  that only one of them was written for* - and `posix-port.test.ts` holds it by writing a file into the
  tree by hand, asserting it **is** readable first (so the test cannot pass vacuously), then requiring
  it to be gone after a fresh `prepare()`. Falsified: restoring the old `prepare()` fails that test
  alone, 19/20.

- **A repair the world never observed is not a repair.** The first measured `sim-posix` run's second
  iteration was identical to its first, because a change written to the tree had not been re-read by
  the world that judged it. On this adapter the repair is a file write against a tree the *next*
  iteration rebuilds, so the reset is what makes the fix observable - but the rule generalises: *a loop
  that reports progress from its own intentions is reporting the wrong run.*

- **An evidence bundle that omits the actor's own transcript is a bundle a reader cannot audit.** The
  repair agent's stdout was not persisted; diagnosing the `adduser` defect required reconstructing what
  the agent had done from the injected program, the exec record and the reading - the bundle held the
  criteria's evidence and not the actor's decisions. **Built.** `RepairOutcome.transcript` carries the
  gate's own output, `CommandRepairGate` fills it on every answer including the timeout (where the
  partial output is the evidence explaining why the command never finished), and the loop writes it to
  `artifacts/repair-<iteration>.log` *before* it acts on the answer - a transcript that landed after
  the verdict it explains would be a file a reader reaches only once the run is over, and the mid-run
  write is the one an external agent actually reads. It is registered with `kind: "log"` and
  `criterion_id: null`, because a transcript backs no criterion and naming the nearest one would be a
  claim the file cannot support, and it is named in the *same* `iteration.repair` log line as the
  decision it belongs to, because two events could disagree about which iteration the file describes.
  Nothing in the verdict reads it: a repair is believed only once the criteria are re-observed from a
  clean world, which is exactly why it is safe to store verbatim. Held by `tests/command-repair-gate.test.ts`
  (11 tests) and five tests in `tests/execution-loop.test.ts`; falsified rather than trusted - deleting
  `transcript` from one of the three returns fails three named subtests, and making the path
  iteration-independent fails *"keys each transcript to its own iteration"*.

- **A message that copies its input is not a summary, and a bound by lines is not a bound.** The repair
  note quoted the tail of the actor's stderr - `lines.slice(-3)` - which is unbounded in the one
  direction that matters: a command printing a single 4000-character line put all 4000 characters into
  `result.json`, `latest-failure.md` *and* `execution.log`, three files a reader scans rather than
  reads. Found by a test that asserted the note stays a note, which is the assertion that would have
  been written as a formality if the line-based version had been trusted. `tail()` now flattens and caps
  at the same 300 characters `core/memory`'s port already applied to a refused write, keeping the last
  characters because that is where a failure states its cause, with a leading `...` so the reader is
  told something was dropped rather than left to guess. The cap is on the *note*; the transcript beside
  it is the record and is stored whole. Reverting `tail` to the line-based version fails the test that
  names the rule.

- **A record nobody is told about is one nobody reads.** `writeRepairTranscript` names the path it chose
  on the console as well as in the bundle: an operator watching a run in a terminal has no way to guess
  that the actor's output was kept, and which path a transcript lands at is the loop's decision, so the
  loop is what reports it.

- **A step whose name states an outcome must fail when that outcome does not happen** - restated one
  layer in, because the fourth demo is where it was found again. `AC-013` expects the world to *refuse*
  a command naming a path outside the sandbox, and judges the refusal rather than the exit code, so a
  substitute that resolved the escaping path would read the developer's own tree while calling it the
  sandbox's. The criterion's own description carries the limitation it knows about: the validator reads
  the world's *result* and not its stated *reason*, so it cannot distinguish a path that escapes from a
  command the world does not implement. *A verdict may only claim what its reading observed.*

- **A check that waits a fixed number of turns is asserting the machine's schedule, not the program's
  behaviour.** `extension/vscode/scripts/smoke-out.mjs` activated the compiled Cockpit and then awaited
  a single `setTimeout(..., 0)` before reading the status bar, justified by a comment saying one turn
  "is enough for a synchronous dashboard read to have landed". That justification was false about the
  read: `refresh()` awaits `readLastSummary`, which is real `fs` I/O. So the turn is a race, and the run
  that lost it printed `1 of the compiled extension's checks failed` about a **healthy** extension - the
  next three runs of the same gate, one of them from a deleted `out/`, passed unchanged. That is what a
  schedule assertion looks like when it breaks, and *"it passed twice" is not evidence about the run it
  failed on*. The wait is now bounded and keyed on the condition (`settled`), and **the probe is to make
  the thing being awaited arrive late**: with one extra turn injected before the dashboard is written,
  the bounded wait passes and the old fixed-turn wait fails **both** dashboard checks. The bound is the
  other half - a wait that cannot fail would be worse than the sleep it replaced, because it would turn
  every check after it into a formality. The same edit added a check nothing had: the no-folder window
  must *hide* the status bar, which the old sequence never asserted. *A test that waits on a clock is
  testing the clock.*

- **A substitute that resolves a token as a path cannot tell a grant from an escape.** `osEscapes`
  tested a token against `^[A-Za-z]:` to recognise a drive, so `icacls <path> /grant x:(R)` - an
  account named `x` - was refused as a boundary crossing, and so was any registry value whose data
  began `a:b`. The world reported "this names a place outside the sandbox" about a *permission grant*,
  which sends the reader to inspect the path. A drive **path** has a separator after the colon; a grant
  token does not, and a token whose tail has no separator is `parseGrant`'s question, not the escape
  predicate's. Tightened to `^([A-Za-z]):[\\/]`, and the tightening loses nothing: a drive-relative
  spelling (`D:secrets.txt`) still reaches the command, whose own resolution refuses it by name. *An
  error message may only name a cause the reporter observed - and here the reporter named a path it had
  not looked at.* Held in `adapters/sim-os/os-port.test.ts`.

- **A command that skips the world's own path grammar gives one world two answers for one question.**
  Every path-taking command in the substitute (`where`, `icacls`, `chmod`, `reg`) resolved through the
  family's grammar and refused what it cannot express; `type`/`cat` went straight to the host mapping,
  and `path.join` accepts a separator the grammar does not have. So in a Windows world `type
  /etc/os-release` looked *inside the sandbox* for `etc/os-release` and answered "cannot find the path
  because it does not exist" - a missing-file answer for a spelling the world would have **refused**,
  and a second grammar for one world's paths. Resolved first, the two commands agree: both refuse the
  other family's spelling, for the stated reason. *This is the same shape as the environment predicate
  written twice - two implementations of one rule disagree the first time a world arrives that only one
  of them was written for.*

- **Two readings of one fact in one log is one reading too many.** `create()` logged the *resolved*
  sandbox root while `environment.start` logged `this.#plan.os?.root` - the document's own spelling,
  which may be relative to the io root. A reader asking "where did this world actually live" would
  trust the second, and it is not a path this machine can open. The same edit added both to the
  `os.exec` line (`root` as the document spells it, `host` as this machine can open it) rather than
  replacing one with the other, because a log holding only the first cannot answer the question and a
  log holding only the second cannot be compared with the document the reader is holding. *A record
  that disagrees with itself is not a harder record to read; it is a wrong one.*

- **A guard whose null branch is reachable by omitting a field is a guard no document reaches.**
  `linkAcceptance` refuses a contract that names a different goal - but `finalizeAcceptance` sets
  `goalId` to `null` when `goal_id` is absent, the schema does not require it, and
  `examples/sim-os/acceptance.yaml` **did not carry one**. So the newest world's cross-goal
  contradiction guard - the check that stops one goal's criteria being evaluated against another's
  environment - was dormant, while every other demo's contract exercised it. Nothing failed, because a
  guard's unreached branch is silent by construction. The field is now declared, which is what makes
  the guard's live branch live for that demo. *The third occurrence in this repository of "a guard no
  code path can trip is not a guard", after the boundary clauses that could not be false and the
  `--browser none` flag that never reached the plan.* Found by asking why `latest-result.json` had no
  `goal_id` where the other demos' did.

- **A list of variable names recalled in a test is a claim about two files that nothing reconciles.**
  A test asserting the environment names the `sim-os` adapter declares listed `VERIDIAN_OS_HOST_ROOT`
  among them - a name that exists in **neither** file. Its neighbours (`VERIDIAN_OS_ROOT`,
  `VERIDIAN_OS_FAMILY`, `VERIDIAN_OS_SYSTEM`, `VERIDIAN_OS_USER`) were right, so it read as a typo in
  a list rather than as a claim nothing checks, and the list is exactly what a reader consults to learn
  the interface. It now reads the names out of the application's own source
  (`readProvision().match(/VERIDIAN_OS_[A-Z_]+/g)`) and intersects that set with the adapter's - so the
  test's subject is the agreement, not one recalled spelling of it. *Two files that must agree need a
  test that reads both, or the agreement is an opinion.*

- **An assertion against a literal cannot fail, so it is not a test.** The same suite carried
  `assert.match(JSON.stringify(...), /"simulated":"substitute"/)` - a regex matched against a string
  the test itself had just built. It would have passed with the field removed, with the value changed,
  and with the whole reading replaced by a constant. Replaced by an assertion on the reading the code
  actually produced. *This is the falsification probe written as a permanent test: if you cannot say
  what would make it fail, it cannot be doing work.*

- **A roster written as a shared prefix plus suffixes reads as complete while hiding an omitted
  name.** `README.md` printed the browser family as `element, value, text, count, url, console,
  network` - which required the reader to expand `console` into `console.clean` and `network` into
  `network.ok`, and which **omitted `web.visible` entirely**: implemented, exported in
  `WEB_UI_VALIDATOR_NAMES`, registered in `cli/veridian.ts`, and named by no document at all. Found by
  `tests/readme-rosters.test.ts` on its first run, which parses the README's layout block and compares
  each family's printed roster against the constant the code exports - not by reading the README, which
  looked complete. Falsified twice: deleting one name from the README fails the comparison naming it,
  and restoring the shorthand fails *"which is not a validator name - the family prefix was factored
  out into the column, and that is how a name went missing"*. *A document that prints a vocabulary must
  print every member in full, and the cheapest way to hold it is a test that reads both.* The third
  occurrence of the shape the `db.query` / `db.rowCount` entries record. The **fourth** is the
  observation vocabulary, and it is the first whose enumeration is a *chain of ordinals*: `AGENTS.md`'s
  `core/environment/` layout row and `README.md`'s layering paragraph both listed the twelve
  `*-observation.ts` files, and both were one family short while each clause carried its own ordinal -
  so `the eleventh` was already spoken for and the row misinformed rather than merely omitting. Both
  are corrected, and `tests/observation-vocabulary.test.ts` holds them. **And the guard's own first
  draft was the same defect one layer in, which is why this paragraph exists**: it asked its question
  of the *whole document*, and every stem in `AGENTS.md` is named at least twice (once in the ordinal
  chain, once in a `validators/` row; `data` and `mobile` three times), so it would have passed with
  the chain two families short - the exact drift it was written after. That was found by *counting*
  the stems rather than by reasoning about the guard, and the fix is a scope (the enumeration only,
  with two in-guard controls asserting the scope held) plus three falsifying probes. *A set test over
  a whole document cannot see a block that is short when every member of that block is also named
  elsewhere in the document - and the way to know is to count, not to reason.*

- **A predicate written as an `||` chain covers a new world with somebody else's block.** Adding
  `os` to `hasNoHttp` left the earlier `posix` test passing unchanged - it iterates its own kind, so the
  new world's predicate could have been wrong in its own way with nothing failing.
  `tests/environment-gaps.test.ts` now runs the HTTP questions against **every** no-HTTP world the
  register names, and it was falsified rather than trusted: deleting `!isMissing(environment.os)` fails
  with `sim-os was asked /url, and it has no address`. *A test that iterates a list can only cover the
  list it was written with; the coverage has to come from the register.*

- **A reading is about the run that wrote it, not the run you meant.** Reading
  `.veridian/latest-result.json` to quote the fifth demo's progression returned four `INCONCLUSIVE`
  criteria - the last run in the bundle was the `--browser none` cart demo, not the `sim-os` demo. The
  figures quoted in `README.md` were re-measured after re-running the demo. *A bundle is a file; the
  verdict in it belongs to whoever wrote it last.*

- **A sub-resource is a query parameter, and a router that matches only the path cannot tell two
  requests apart.** The sixth world's defect D2 is one word: a tagging request aimed at an object
  instead of at the bucket that owns it. The substitute's route table keyed on the path alone, so
  `.../objects/cart.js?tagging` and `.../buckets/cart-assets?tagging` both landed on the same handler
  and the criterion read `PASS` for both - a defect that is *invisible to the world under test* rather
  than missed by it. The sub-resource is now part of the route (`#misplacedSubResource` answers a
  sub-resource asked of the wrong resource with a stated reason naming both) and the log line carries
  `routeAddress`, the request as it was actually made including its query. *A route is a request, not a
  path - and a criterion that can only distinguish two requests by their query string is a criterion
  the router has to be able to distinguish them for.*

- **A refusal with an empty body is an observation nobody can read.** The substitute answered every
  refusal with a status code and nothing else, so the `call` reading recorded *that* a request was
  refused and never *why* - and a criterion about a permission decision is a criterion about the
  reason. `refusalBody(reason, status, message)` now renders `{ kind, reason, status, message }` at
  every refusal site, and the adapter carries it into the reading. *A status code is a verdict; the
  body is the evidence, and a validator may only quote what it was given.*

- **A meter is a count of events, so it is part of the world and has to be reset with it.** The
  sixth world's meter describes the account's *current life*: a reset begins a new one, because a bill
  that carries a previous world's writes into a fresh one describes two worlds with one number. The
  rule generalises past cost: any reading that is a function of the run's own history - a counter, a
  log, an event list - is state, and a reset that restores the resources and not the history leaves a
  bundle whose evidence belongs to an iteration the reader is not looking at.

- **A capability only one world has must be refused by name everywhere else, or a contract that means
  nothing there is silently judged there.** `call` is the sixth step kind and the only one that puts
  *the criterion's own* request to the world; the other four adapters refuse it by name, and the cloud
  plan - and only the cloud plan - admits it. That refusal is the reason a cloud contract cannot drift
  onto a world where "make this request and read the answer" has no meaning. *A vocabulary that grows
  must grow its refusals with it: a step kind recognised by the schema and unhandled by a world is a
  criterion reported `INCONCLUSIVE` at best and fabricated at worst.*

- **A rendering pin must be measured against the source, not recalled.** The action vocabulary admits
  `s3` as a service segment and camel-case verbs (`putBucketVersioning`, `createBucket`), so the
  pattern that guards it is `/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/` - which the first attempt, a
  tidy `/^[a-z]+(\.[a-z][A-Za-z]*)+$/` recalled from the *validator* naming rule, rejected outright.
  The two rules are different because the two vocabularies are different, and the one next door looked
  close enough to reuse. `statementSpelling` had the same shape of error in its own doc comment: it
  described four fields and renders three (principal is deliberately absent, because a statement is
  read for what it grants rather than for whom it happens to name). *An assertion about a message is an
  assertion about the code's wording - read the wording from the source.*

- **A defect table and the test that reads its `correct` blocks must both convert line endings, and
  the half that fails silently is the negative one.** The sixth demo's test asserted
  `program.includes(defect.correct)`, and `D4` is the only entry whose block is multi-line - so on this
  Windows checkout, which holds `provision.mjs` in CRLF, that assertion could never match a block
  authored with `\n`. `examples/defect-text.ts` exists to encode exactly this (`defectStates` converts
  through `inStyle` before counting) and the test was written as if it did not. It now goes through
  `occurrences(program, inStyle(block, newlineOf(program)))` and asserts an exact count of **1** for
  the correct form and **0** for the defective one - which is stronger than the old check in the way
  that matters, since `String.replace` edits the first match and a second occurrence would leave one
  site unedited. And the rule is not only about the positive half: an ending-blind `!includes(defective)`
  is **true for every file**, so the assertion that the shipped program is correct was the one that
  could fail while the assertion that it is not defective could not. *A line-ending-blind assertion
  measures the developer's `core.autocrlf`, and its negative half passes vacuously - which is worse
  than failing, because it reports a rule held that nothing checked.* This is the second time this
  repository has paid for this rule and the first time the *test* paid rather than the demo; the entry
  above about `defects.ts` is the first.

- **An assertion that every identity in a contract equals the plan's identity assumes the contract
  holds one identity.** The sixth demo's contract names `principal/svc-cart` - the account the
  application runs as, which the plan states - **and** `principal/svc-reader`, a reader the program
  itself creates for the front end. Both are legitimate, and the test that asserted every name in the
  contract equalled `cloud.principal` failed on a *correct* contract. It now derives the set from the
  contract, asserts it is exactly those two, that neither is privileged, and that each is either the
  plan's principal or a name the program actually creates - so a future criterion naming an account
  nobody wrote fails, which is the check that keeps a criterion from judging a policy that does not
  exist. *Read the document before asserting what it cannot contain: "the identity the run judges as"
  and "the identity a criterion asks about" are two different questions, and a contract may answer
  both.*

- **When a test fails, read the failure before choosing a hypothesis - and only then decide whether
  the product or the test is wrong.** Both failures this segment were the test's, and both were
  diagnosed by reading the assertion rather than by re-running it: one asserted a property of the
  developer's git configuration, the other a property the contract never had. Neither was a guess -
  each was a reading of the failure message, which named the value and the expectation. The
  complementary rule is the repository's older one: a green suite is evidence that nothing has broken,
  not that a rule is held. Both fixes were therefore **falsified** - one by filing a defect against a
  criterion no defect claims, one by putting a typo into a `correct` block - and each probe failed the
  named subtests before being reverted. *"The test is wrong" is not a hypothesis; it is a
  conclusion, and it needs the same evidence as the reverse.*

- **A comment beside a narration line that claims what a test does becomes false the moment the test
  changes.** The demo's `filed against: ...` line carried a comment explaining that the filed criteria
  excluded the criteria that move *with* a defect - a claim that was true of an earlier test and
  contradicted the one that shipped, which asserts the report names every further criterion that moves.
  The narration and its comment are one artefact; a change to either has to be read against the other
  in the same pass. *Prose next to code is a claim about the code, and it goes stale at exactly the
  moment the code moves.*

- **A one-character edit is never one fact, and a defect table needs controls before it can have a
  headline.** The seventh demo's bind mount is misspelled by one character (`./contxt` for `./context`),
  and that single character moves **seven** readings: the mount criterion reads `source absent`, the
  container it belongs to stays `created` and never `running`, its healthcheck never runs, both of its
  captured output streams are empty, and the criterion's own `exec` never reaches a process - because
  every one of those is a *separate true consequence* of a mount the world could not resolve. That is
  what makes the other three defects the controls: `D1`, `D2` and `D3` are each read by exactly one
  criterion, so a reader can see one edit produce one reading before watching one edit produce seven.
  *A defect table whose entries all move many criteria has no control in it, and a demo with no control
  cannot show that its readings are caused by the edit rather than by the world being flaky.*

- **A program's completeness line must count the arrays it actually sent.** The seventh demo's
  provisioner prints `cart-web provisioned: N files, M commands` where both figures are read off the
  arrays it wrote - which is why no test may assert that the application's source *contains* that
  sentence. It does not, and could not: a line assembled from a constant and two lengths is not a
  literal anywhere in the file. Assert it against a reading of the run, or against the pattern the
  readiness check matches, and nowhere else. Its sibling: **an application may not read stdin**, because
  `nodeProcessRunner` spawns with `stdio: ["ignore", "pipe", "pipe"]` - so a program that prompts gets
  an immediate EOF, not a hang, and a criterion that waits for the prompt waits forever.

- **A self-declaration about a program is a legitimate defect target precisely because nothing in the
  world reads it.** `D3` edits the service-start banner the application prints on stderr. No validator
  in the family consults it, no other criterion moves with it, and it changes nothing about the world -
  which is exactly what makes it the control: it is the one defect whose consequence is *only* the
  criterion that names it, so a run that repaired it can be distinguished from a run that repaired the
  world around it. *A defect that changes no state is not a weaker defect; it is the measurement that
  the rest of the table is calibrated against.*

- **A world's stated limits belong in the value the criterion compares, or the comparison asserts
  something the world does not do.** `container.limit` compares `memory 268435456 bytes, cpus 1, pids 64
  (declared, not enforced)` and `container.port` compares `18080:8080/tcp (exposed)`. Drop the
  parenthetical and both comparisons become false claims: the first would say a limit *held*, the second
  that a port was *reachable*. A substitute that is honest about its own boundary has to carry that
  honesty into the comparison, not only into its documentation. *A rendering helper's name is not the
  value its sibling validator compares - read the helper before writing the expectation.*

- **An assertion that every expectation on a criterion is one validator is a claim the contract never
  made.** The seventh demo's `AC-026` is judged by `container.probe` **and** by `container.logs` - both
  legitimate, because the criterion asks whether the probe succeeded and what the container said while
  it ran. A test that asserted every expectation on that criterion was `container.probe` failed on a
  *correct* contract. It now derives the validator set from the contract and asserts the one property
  that actually matters: every name in it is a registered validator. *Read the document before
  narrowing it - "the validator this criterion is about" and "the validators this criterion uses" are
  two different questions.*

- **A repair agent walks the defect table in criterion order, so a test that walks it backwards is
  testing its own loop.** `repair.ts` picks the first unrepaired defect whose criterion is failing, so
  the seventh demo repairs `D1` then `D2` then `D3` then `D4` - and the first version of the demo test
  asserted the reverse order (`D4` first) and failed against a working agent. The order is a property
  of `repair.ts`, not of the table, and a test that re-derives it from its own iteration must read the
  file it is describing. The repair counts it asserts are `[4, 3, 2, 1, 0]`.

- **A correction to a count in prose is a correction to a claim about a register, so read the
  register.** `README.md` said a step is "one of seven kinds" while `core/acceptance/steps.ts` holds
  **eleven** in `STEP_KINDS` - a figure that had drifted through four new worlds without anything
  reading it. The same pass found `AGENTS.md` quoting `1273` tests and `1213` of the tree's own, where
  the measured run was `1456` and `1396` - and the count stood at `2258` and `2186` when that sentence
  was written, which is the rule demonstrating itself. **Then it moved again, by exactly what the next
  pass contributed.** The ordering assertion added to `tests/demo-rosters.test.ts` made the root run
  report `2259` and this tree's own `2187`, and the figure had to be corrected in four more places
  across `AGENTS.md` and `README.md` in the same pass - *a number in prose is a claim that the very
  edit which changes it falsifies, which is why the only durable fix is to re-measure rather than to
  promise, and why this entry is a record rather than a guard.* **The three prose repairs were then
  probed rather than trusted**: reverting the artifact name to `veridian-sim-evidence`, the header
  ordinal to *"The tenth demo"* and the quickstart count to `2258` each left the suite at
  `2259 pass / 0 fail`, which is the measurement behind calling them corrections rather than guards.
  No guard was added for any of them, because there is nothing for one to compare against: the
  artifact's name has no machine-readable source of truth beside it, an ordinal in a file's header is
  read by no code, and a count cannot be pinned by a test that itself changes the count. *Both are the same defect as a roster printed in a
  document: a number is a claim about the code, and the cheapest way to hold it is to read the code -
  the difference is that a number cannot be pinned by a test the way a name can, so it has to be
  re-measured at the moment the document is touched.* **It moved a third time, for the same reason and
  by four suites rather than one**: the W1 boundary migration and the `sim-data` world took the root run
  to **2305** and this tree's own to **2233** (the Cockpit's 72 unchanged), and the figure was corrected
  in four places across `AGENTS.md` and `README.md` in the same pass. The four suites are
  `tests/sim-vscode-environment.test.ts`, `tests/sim-container-environment.test.ts`,
  `tests/sim-data-environment.test.ts` and `tests/sim-cloud-environment.test.ts`, each of which gained
  an assertion that its world hands the runner a file allowance - the first three as new files, the
  fourth growing in place. The entry's own figures are left standing above because a record of what was
  measured then is not made false by what is measured now. **A fourth movement came from W4's guard,
  and it is the smallest one yet**: `tests/package-manifest.test.ts` contributed 8 tests, taking the
  root run to **2313** and this tree's own to **2241** (the Cockpit's 72 unchanged), corrected in the
  same four places. It was measured by running `node --test` rather than by adding 8 to 2305, which is
  the whole point of the rule - and the addition would have been right, which is exactly why a figure
  that happens to be reachable by arithmetic is the figure nobody goes back and checks. **A fifth
  movement came from W5, and it is the first one this record can attribute only in part**: the root run
  now reports **2321** and this tree's own **2249** (the Cockpit's 72 re-measured by running its own
  `node --test` rather than assumed, and the suite count still **377**). Two of the eight are named
  outright - `tests/runtime-report-slices.test.ts` contributes 4 and has no `describe`, so it moves the
  test count and not the suite count, and `tests/demo-rosters.test.ts` gained one `it` block when the
  fourth roster was generalised from a constant into a set - and the remaining four are **not
  attributed here**, because they were never measured at the moment they were written: an earlier gate
  in this stretch read **2316** where the document then said 2313, and the difference was not chased.
  That is the honest half of this rule, and the half worth keeping: *a figure that is re-measured is
  corrected, and a figure whose movement is not measured is only ever restated.* **A sixth movement is
  the first one this record can attribute in full, because a single new file caused all of it**:
  `adapters/sim-mobile/mobile-port.test.ts` contributes **49** tests over **14** suites, taking the
  root run to **2370** tests over **391** suites and this tree's own to **2298** (the Cockpit's 72
  re-measured by running its own `node --test`, not assumed, and still **72**). Both figures were
  measured by running `node --test` on both trees. The decomposition itself was **measured rather than
  assumed** this time, which is the part the record had never done before: 2370 - 72 = 2298 rests on
  the claim that the Cockpit's tests are *inside* the root run, so that claim was checked directly by
  searching the root run's own output for a test title that exists only in the Cockpit
  (*"the manifest and the Cockpit declare the same commands"*) and finding it there **twice**. *A
  decomposition is an arithmetic claim about two measurements, and it is only as good as the evidence
  that its two halves are nested rather than disjoint.* **A seventh movement is the second one
  attributable in full, and this time every contributing file was measured alone rather than inferred
  from the total**: the root run reports **2456** tests over **410** suites and this tree's own
  **2384**, with the Cockpit's 72 re-measured by running its own `node --test` and still **72** -
  though its `# suites` line reads **0**, because no test in that tree sits inside a `describe`, so the
  root run's 410 suites are all this tree's own rather than the 338 a subtraction would have produced.
  Three files account for the whole test movement: `tests/sim-mobile-demo.test.ts` **34** tests over
  **6** suites, `validators/mobile/mobile-validators.test.ts` **48** over **12**, and
  `tests/sim-mobile-environment.test.ts` **4** over **1** - 86 tests and 19 suites, which is exactly
  2370 + 86 and 391 + 19. `adapters/sim-mobile/mobile-port.test.ts`'s **49** over **14** is
  deliberately absent from that sum, because it was already inside the previous figure: *a file that
  has not moved since the last measurement is not part of this movement, and adding it back would
  have produced an attributed total that reconciles with nothing.* **An eighth movement is the first
  caused by a *test* rather than by a world, and the first whose second figure deliberately did not
  move**: `tests/clarification-ladder.test.ts` contributes **5** tests over **0** suites, taking the
  root run to **2461** tests with the suite count unchanged at **410**. The unchanged half is the
  load-bearing one, because that file holds five bare `it` blocks and no `describe`, so a reader who
  expected the suite count to rise with the test count would have gone looking for a missing
  `describe` that was never wanted - and the temptation is real, because every earlier movement in
  this record moved both figures. Re-measured by running `node --test` on both trees (the Cockpit's
  **72** re-measured rather than assumed, its `# suites` still **0**), with the decomposition proved
  the way the seventh movement proved it: a title that exists only in the Cockpit *("the manifest and
  the Cockpit declare the same commands")* appears **twice** in the root run's own output. **A ninth
  movement is the first moved by a guard rather than by a world or by a ladder**:
  `tests/observation-vocabulary.test.ts` contributes **5** tests over **1** suite, taking the root run
  to **2466** tests over **411** suites and this tree's own to **2394** (the Cockpit's **72**
  re-measured by running its own `node --test` rather than assumed, its `# suites` still **0**, so all
  411 of the root run's suites are this tree's own rather than the 339 a subtraction would have
  produced). Both figures were predicted before they were measured - 2461 + 5 and 410 + 1 - and both
  predictions were **right**, which is precisely the case this record exists to distrust: *an
  arithmetic total that happens to reconcile is the total nobody goes back and checks*, and the eighth
  movement is the entry above recording a figure whose movement was not measured at the moment it was
  written. The decomposition was proved the way the seventh and eighth were. **A tenth movement is the
  first caused by a documentary guard rather than by a world, a ladder or an observation vocabulary**:
  `tests/docs-roster.test.ts` contributes **4** tests over **1** suite, taking the root run to **2476**
  tests over **413** suites and this tree's own to **2404** (the Cockpit's **72** re-measured by running
  its own `node --test` rather than assumed, its `# suites` still **0**, so all 413 of the root run's
  suites are this tree's own rather than the 341 a subtraction would have produced). The prediction was
  2472 + 4 and 412 + 1, and both were **right** - which is the ninth movement's own warning, so both
  figures were taken by running `node --test` on both trees and the decomposition proved the way the
  seventh, eighth and ninth were: a title that exists only in the Cockpit *("the manifest and the
  Cockpit declare the same commands")* appears **twice** in the root run's own output. The four live
  prose sites were corrected in the same pass - `AGENTS.md`'s status banner and its build block,
  `README.md`'s quickstart and its layout table - while every figure in the movements above was left
  standing, because *a record of what was measured then is not made false by what is measured now*.
  **An eleventh movement is the first caused by a *surface* rather than by a world, a ladder, an
  observation vocabulary, a guard or a document**: `mcp/server.test.ts` contributes **45** tests over
  **6** suites, taking the root run to **2521** tests over **419** suites and this tree's own to
  **2449** (the Cockpit's **72** re-measured by running its own `node --test` rather than assumed, its
  `# suites` still **0**, so all 419 of the root run's suites are this tree's own rather than the 347 a
  subtraction would have produced). The prediction was 2476 + 45 and 413 + 6, and both were **right** -
  the ninth movement's own warning again, so both figures were taken by running `node --test` on both
  trees and the decomposition proved the way the seventh through tenth were: a title that exists only
  in the Cockpit *("the manifest and the Cockpit declare the same commands")* appears **twice** in the
  root run's own output. One further fact about this movement is worth keeping: the counts moved only
  once the **two failures inside it were repaired in the product** - `get_failure` read an absent
  `failure` key as a present one, and answered a failure report path for a run that recorded no failure
  - so the movement is a measurement of a *working* suite rather than of a longer one.
  The four live prose sites were corrected in the same pass - `AGENTS.md`'s status banner
  and its build block, `README.md`'s quickstart and its layout table - while every figure in the
  movements above was left standing, for the reason the tenth movement states.
  **A twelfth movement is the first caused by a *guard* over that surface rather than by the surface
  itself**: `tests/mcp-demo.test.ts` contributes **10** tests over **3** suites, taking the root run to
  **2531** tests over **422** suites and this tree's own to **2459** (the Cockpit's **72** re-measured
  by running its own `node --test` rather than assumed, its `# suites` still **0**, so all 422 of the
  root run's suites are this tree's own rather than the 350 a subtraction would have produced). The
  prediction was 2521 + 10 and 419 + 3, and both were **right** - the ninth movement's own warning for
  the third time, so both figures were taken by running `node --test` on both trees and the
  decomposition proved the way the seventh through eleventh were: a title that exists only in the
  Cockpit *("the manifest and the Cockpit declare the same commands")* appears **twice** in the root
  run's own output *and* **twice** in the Cockpit's own. What distinguishes this movement from every
  one before it is the file that did **not** move the counts: `scripts/mcp-smoke.mjs` was written in
  the same stretch and contributes nothing to either figure, because it is a **script outside the
  discovery glob** - the same deliberate asymmetry `scripts/acceptance.mjs` already carries, and the
  reason `npm run smoke:mcp` is declared in the manifest and executed by a job rather than by the
  suite. *A count that moved is not the same claim as "the change was measured", and the half of this
  pass the count cannot see is the half that checks the program actually runs.* The four live prose
  sites were corrected in the same pass, as were the eleventh movement's - `AGENTS.md`'s status banner
  and its build block, `README.md`'s quickstart and its layout table.
  **A thirteenth movement is the first caused by the *instrument itself***: the M1/M2/M3 subject
  scoping and M4's split branches took the root run to **2556** tests over **425** suites and this
  tree's own to **2484** (the Cockpit's **72** re-measured by running its own `node --test` rather than
  assumed - 72 tests, `# suites` still **0** - so all 425 of the root run's suites are this tree's own
  rather than the 353 a subtraction would have produced). It is the second movement attributed **in
  full**, and this time the attribution was taken from the diff rather than assembled from the failure
  messages: counting added `it(` and `describe(` lines across `git diff -U0 -- tests/` returns **25**
  and **3**, decomposed as `tests/run-metrics.test.ts` (**24** it / **2** describe) and
  `tests/execution-loop.test.ts` (**1** it / **1** describe) - 24 + 1 = 25 and 2 + 1 = 3, which is
  exactly 2531 + 25 and 422 + 3. The decomposition was proved the way the seventh through twelfth were:
  a title that exists only in the Cockpit *("the manifest and the Cockpit declare the same commands")*
  appears **twice** in the root run's own output. The four live prose sites were corrected in the same
  pass - `AGENTS.md`'s status banner and its build block, `README.md`'s quickstart and its layout
  table - and the wall-clock figure beside them moved from `~7s` to `~9s` on the strength of the run's
  own `# duration_ms 9256.6`, because a duration is the same kind of claim as the two counts beside it
  and had been carried from a smaller suite for three movements. *A movement whose cause is a repair to
  the thing that measures the suite is the one movement whose figures are most likely to be quoted
  without being taken.*
  **A fourteenth movement is the first whose contribution is attributable and whose *remainder* is
  not, and the record says which is which rather than folding the second into the first.**
  `tests/phases-roster.test.ts` contributes **9** tests over **1** suite - measured by the run that
  exercised it, which reported 9 tests over 1 suite - and the root run now reports **2568** tests over
  **426** suites with this tree's own at **2496** (the Cockpit's **72** re-measured by running its own
  `node --test` rather than assumed - 72 tests, `# suites` still **0** - so all 426 of the root run's
  suites are this tree's own rather than the 354 a subtraction would have produced). The subtraction
  is what refuses the comfortable total: 2568 - 9 = **2559**, which is **three** above the figure the
  thirteenth movement recorded (**2556**) and **one** above the figure the live prose was carrying
  (**2558**) - so the live prose had *already* drifted two above its own record before this pass
  touched it, and the remaining three arrived with work that is uncommitted in this tree and was
  never measured at the moment it was written. That half is stated rather than absorbed, for the
  reason the fifth movement records: *a figure that is re-measured is corrected, and a figure whose
  movement is not measured is only ever restated.* The decomposition was proved the way the seventh
  through thirteenth were: a title that exists only in the Cockpit *("the manifest and the Cockpit
  declare the same commands")* appears **twice** in the root run's own output *and* **twice** in the
  Cockpit's own. The four live prose sites were corrected in the same pass - `AGENTS.md`'s status
  banner and its build block, `README.md`'s quickstart and its layout table - and the wall-clock
  figure beside them moved from `~7s` to `~8s` on the strength of the run's own
  `# duration_ms 7750.3582`, which is the second time that figure has been re-taken by measurement
  and the first time it has been corrected *downward* - and `npm run gate` then re-measured it at
  `7551.3687` in the same pass, which is *why* the figure is written as a rounded `~8s` rather than as
  either reading: two invocations of one suite that differ by 200 ms are two samples of one duration,
  and a record that quoted either as though it were the duration would be quoting a machine's schedule
  as though it were the program's. *A movement that is not attributable in full
  is not a movement to describe loosely: name the part you measured, say what the remainder is, and
  let the arithmetic that does not reconcile be the evidence that something else moved.*
  **A fifteenth movement is the first this record can attribute to a single assertion, and the first
  whose cause is the guard rather than the world it guards.** `tests/phases-roster.test.ts` grew from
  **9** tests to **10** over the same **1** suite - the sixth question, that every phase file carries a
  `## Context budget` heading with both a `**Read:**` and a `**Do not read:**` line - and the root run
  now reports **2569** tests over **426** suites with this tree's own at **2497** (the Cockpit's **72**
  re-measured by running its own `node --test` rather than assumed - 72 tests, `# suites` still **0** -
  so all 426 of the root run's suites are this tree's own rather than the 354 a subtraction would have
  produced). The arithmetic is exact and is stated as exact: 2568 + 1 = 2569, one assertion, one test,
  one unit. Which is precisely the case this record exists to distrust, so both figures were **taken**
  by running `node --test` on both trees and the decomposition was proved the way the seventh through
  fourteenth were - a title that exists only in the Cockpit *("the manifest and the Cockpit declare the
  same commands")* appears **twice** in the root run's own output. Two things are stated rather than
  left to inference. The fourteenth movement's remainder of **three** unattributed tests is
  **untouched** by this one: adding one assertion that happens to be countable says nothing about three
  that were never measured when they were written, and folding them into a figure that now reconciles
  would be exactly the comfortable total that movement refused. And the wall-clock figure **did not
  move** - this pass read `# duration_ms 8044.4786`, which rounds to the `~8s` both sites already
  carried - so it was re-taken and found *correct* rather than re-taken and changed, which is a
  different outcome for the same procedure and one worth being able to tell apart. The four live prose
  sites were corrected in the same pass: `AGENTS.md`'s status banner and its build block, `README.md`'s
  quickstart and its layout table. *A count that moves by one is the count most likely to be corrected
  by addition instead of by measurement - and the only reason this entry exists is that here, addition
  would have produced the same number.*
- **A document that names what a world *substitutes* is making a claim about a `*_SIMULATED_SURFACES`
  constant, and a claim nothing reads drifts.** `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 recorded
  `sim-posix` as substituting *"Kali's attack network"*, and `POSIX_SIMULATED_SURFACES` says the
  opposite in as many words: its `egress` member reads *"the sandbox has no network beyond its own
  loopback listeners; egress is refused, not routed"*, and `posix-port.ts` refuses the one command that
  would need one with the reason `this world has no egress; nothing outside 127.0.0.1 can be reached
  from the sandbox`. So the cell named a surface the world deliberately refuses as though it were a
  feature, and omitted four the world does declare (`package-index`, `permissions`, `egress`,
  `provisioning`). It was found by comparing the two lists, not by reading the sentence - which read as
  complete, because three of its four tokens were right and the fourth had the shape of a name. The
  five `sim-*` cells now print their constants' members verbatim, and `tests/simulated-surfaces.test.ts`
  reads both sides: a declared world must print exactly the declared set, and a world the document
  calls **built** may not print a backticked surface no constant declares. Three assertions, each
  **falsified rather than trusted**: restoring the original sentence fails subtest 1 with both sides
  printed; reintroducing `attack-network` as a backticked member fails the same subtest with a message
  naming the invented surface; and putting a backticked name on `local-web`'s row while camel-casing
  one container surface fails all three, exit 1. *This file now states the rule about three different
  vocabularies - a validator name, a step kind, and a simulated surface - and the third was still in
  the wild because it is the one no schema carries: `STEP_KINDS` and the validator rosters have
  `schemas/` files that re-state them, and nothing re-states a surface.*

- **An engine floor is a claim about the world a file ships into.** `extension/vscode/package.json`
  declared `"engines": { "vscode": "^1.94.0" }` **and** `"type": "module"`, so the compiled
  `out/host/activate.js` is an ES module - and the Node.js extension host could not load one until
  VS Code **1.100**. The declared floor was six minor releases below the first host that can activate
  the file, so on 1.94 through 1.99 the extension would install cleanly and then never start, which is
  the worst shape a compatibility claim can take: nothing errors at install time. Read out of the
  release notes rather than recalled - *"ESM support for extensions - The NodeJS extension host now
  supports extensions that use JavaScript-modules (ESM). All it needs is the `"type": "module"` entry
  in your extension's `package.json` file."* The floor is now `^1.100.0` and `@types/vscode` matches
  it, and `src/packaging.test.ts` reads the module format out of `tsconfig.json` and the floor out of
  the manifest and asserts the second admits the first - so the pair cannot drift apart again.
  Falsified by restoring `^1.94.0` and watching it fail naming the version. *A package that installs
  and cannot start is indistinguishable from a working one until somebody uses it.*
- **A packaging tool packs what the manifest allowlists, and warns rather than fails about a licence
  it cannot find.** `vsce` force-includes exactly two things - the manifest and the README - and
  derives everything else from the manifest's `files`. With `files: ["out"]` the extension's licence
  was outside the allowlist, so it did not travel, `vsce` printed `WARNING LICENSE, LICENSE.md, or
  LICENSE.txt not found`, packaged **10** files and **exited 0**. A warning is not a check, so the
  build stayed green over an extension that would have been redistributed without the licence it is
  redistributed under. `LICENSE` is now listed, the copy at `extension/vscode/LICENSE` is compared
  byte for byte against the repository by `src/packaging.test.ts` and again inside the archive by
  `smoke:vsix`, and both halves were falsified - appending a line to the copy fails with *"the licence
  in the archive is the repository's, byte for byte (1327 bytes)"* and exit 1, and taking `LICENSE` out
  of `files` fails *only* the archive's licence check, because the packaging step reports nothing.
  *The tool's behaviour was read out of the tool* - both the licence filter and the `LICENSE` to
  `LICENSE.txt` rename come from `@vscode/vsce`'s own source, after the first hypothesis (that `files`
  was widening to `src/`) was falsified by an archive whose `src/` list was empty.
- **An archive is a claim about the extension, and a stale one is the quiet failure.** `npm run gate`
  rebuilds `out/`; packaging is a separate step and a separate tool. An archive built before the last
  source edit installs an extension nobody compiled, and *both* of the things a reader would check
  first - its file count and its manifest - are entirely correct. `smoke:vsix` compares every compiled
  file in the archive with the build's bytes, so staleness is a failure rather than a silent second
  copy. Falsified: a byte appended to `out/bundle.js` after packaging fails *"every compiled file in
  the archive is byte-identical to the one on disk"* and exits 1. *An archive has to be read back to
  be known, which is the same reason `smoke:dist` and `smoke:out` exist - one runtime further out
  each time, and never optional.*
- **A file a packaging tool copies by convention is a file nothing promised to compare, and the
  readme is the one a marketplace shows.** `smoke:vsix` byte-compared the six compiled files, the
  icon and the licence, and asked of `extension/readme.md` only that it *existed* - while that file is
  the extension's long description and sits inside the artifact the upload carries. So editing it
  *after* packaging shipped a description that disagreed with the repository, and every check here
  passed. Found by editing it after a packaging pass and then asking which files this script actually
  reads back; fixed by comparing its bytes to the source's, beside the licence comparison it mirrors;
  falsified by appending a line to `extension/vscode/README.md` after packaging -
  `FAIL the readme in the archive is the source's, byte for byte`, exit 1, restored byte
  for byte to `30A9464E...`. *A check a tool's convention makes look redundant is a check nobody
  writes - and the order is: edit every file that travels, then package, then read the archive back.*

- **A guard built on a `*_SIMULATED_SURFACES` constant has to be extended in three places at once, and
  the new entry has to be falsified.** `tests/simulated-surfaces.test.ts` reads four things that must
  agree for the eighth world to be covered: the constant's import, its entry in `DECLARED`, the
  document's world table, and the row's `Status` cell. Adding the import and the table entry while the
  document said `vscode-host ... planned` would have left the world unchecked - and a loop over a
  correct list passes for the *wrong* reason right up until a member is missing. The entry was
  therefore falsified by deleting `` `workspace` `` from the document row: `2 pass / 1 fail`, naming
  `'workspace'`, then reverted. The same shape one file over: `tests/readme-rosters.test.ts` was
  extended with the ninth validator family and falsified by dropping `vscode.probe` from the README's
  roster (`1 pass / 1 fail`, naming it), because a roster guard that has never been broken is a guard
  nobody has watched work. *A document that prints a vocabulary must print every member in full - and
  the way to know the guard holds it is to take one out and watch it fail.*

- **A predicate written twice is a diverging pair, and the half that lags is the one nobody reads.**
  `hasNoHttp` in `core/clarification/detect.ts` decides whether a world is asked for a `url`, a
  `health.path` and a `browser.enabled`, and it had grown its **eighth** clause
  (`!isMissing(environment.vscode)`) when the eighth world landed. `tests/environment-gaps.test.ts`
  carried the same vocabulary a second time, by hand, as `NO_HTTP_KEYS`, and its derived assertion
  named the six non-HTTP worlds it expected to cover - so the *test* had fallen one world behind the
  *detector*. Nothing failed, because the detector was right: the world was skipped correctly and the
  test simply did not know it had been. The list names **nine** shapes and the derived set names the
  nine worlds that declare one, and the test is what proves the detector has not quietly lost one - a
  figure re-measured rather than recalled, and one that had already drifted to `seven` in this very
  paragraph by the time the two worlds after the eighth landed. *A test that
  re-states a predicate rather than iterating the register can only cover the worlds it was written
  with* - the same rule the `hasNoHttp` `||`-chain entry already records one layer up, arriving this
  time at the test rather than at the code.

- **A vocabulary spelled as a `oneOf` of `const` branches is invisible to an `enum` walker, so the
  guard keeps passing while describing nothing.** `tests/schema-vocabulary.test.ts` exists to hold
  `RUNGS` and the ambiguity schema to one list. The ladder is written as `oneOf` branches of
  `const` - one branch per rung - because that is what lets each branch carry its own fields
  (`evidence`, `confidence`/`source`, `assumption`, `answer`, `reason`). A walker that collected only
  `enum` arrays therefore found **no** ladder and reported no disagreement, which is the vacuous
  pass, not the clean one. `via` had been listed in the vocabulary's `slots` since the guard was
  written, so the guard *named* the slot it could not see. The walker now reads `const` strings too,
  groups them by their parent `oneOf`, and a second assertion pins the schema's rung order to the
  engine's own walk - because a schema that prints the rungs in one order while the engine walks them
  in another documents a ladder nobody implements. *This is the fifth occurrence of "a vocabulary the
  engine owns and the schema re-states", and the new twist is the shape of the re-statement: an
  `enum` is one list, a `const` group is one list written as N siblings, and a guard that reads one
  spelling is blind to the other.* Read the schema's own JSON before trusting a walker's silence.

- **Inserting a rung renumbers every rung after it, and prose is read by nothing.** Adding
  `self_prompted` between `defaulted` and `answered` invalidated **six** independent claims, none of
  which any compiler reads: four numbered rung markers in doc comments and a test title
  (`core/clarification/engine.ts`, `core/clarification/types.ts` x3,
  `core/clarification/engine.test.ts`); the ladder roster printed in this file's own layout block
  (`(derived → inferred → defaulted → answered → deferred)`); and, in
  `docs/IMPLEMENTATION-PLAN.md`, the `Resolution` union, the ladder diagram, the heading *"3.5 The
  exit - four independent stops"*, the row `| maxRungsPerAmbiguity | 3 |` naming a policy field that
  **does not exist in `Policy` at all**, the claim *"No rung is retried. The ladder is a straight
  line, so it terminates in <= 5 steps by construction"* (rung 4 is exactly the rung that may retry),
  and two port-class names recalled rather than read (`CliPromptPort`, `ScriptedPromptPort`; the code
  exports `createCliPromptPort` and `scriptedPromptPort`). `npx tsc --noEmit` stayed silent through
  every one of them, and so did the whole suite. The test title was the one that *mattered* - it read
  *"stop 4 - the ladder is a straight line, so termination needs no budget"* and it was asserting a
  product-wide property that the new rung makes false - so it was retitled to name its own subject
  (*"with no self-prompt port every rung is attempted once"*), which is true, rather than deleted.
  *A numbered marker, a heading that counts its contents, and a roster in a document are three
  spellings of one claim: "this is what the code holds". The cheapest way to hold a name is a test
  that reads the code, and the only way to hold a number is to re-measure at the moment the document
  is touched - which is why this file says so in four separate entries now.*

- **A probe's anchor text obeys the file's line endings, and a skipped probe reports a verdict it did
  not earn.** The rung-4 falsification harness edits `core/clarification/engine.ts` by string
  replacement, and its second probe - the one that deletes the wall-clock ceiling - was authored with
  `\n` while the file holds `\r\n`. The anchor did not match, so the probe printed
  `SKIPPED - the anchor text is not in the file` and the harness went on to print
  `verdict: every probe fired = false` - a **true** reading of the harness with a **wrong** implied
  cause, since the two probes that did fire proved the code was fine and only the third was untested.
  The fix is three lines - detect the file's EOL, and route every anchor and replacement through it -
  after which the probe fired on its first re-run and named subtest 26, *"the wall-clock ceiling is
  the bound an attempt cap cannot replace"*. *This is the third time this repository has paid for the
  CRLF rule and the first time it was paid at a probe rather than at a demo or a test*, and the
  distinction is worth keeping: a skipped probe does not fail, it **silently reduces coverage**, so
  the harness must not treat "did not fire" as "did not matter". *A probe that cannot run is not
  evidence, and a verdict line computed over a skipped probe is a claim about work that did not
  happen.*

- **A probe is falsified by the test it breaks, not by a string it searches for - and a needle naming
  a string the failing assertion never reaches reports the reverse of what happened.** The third form
  of the same defect, found while falsifying `adapters/sim-mobile/mobile-port.ts` against its own
  suite. The escape probe replaced the boundary predicate with an unconditional acceptance, and it
  **fired**: `tests=49 pass=46 fail=3`, naming `refuses a path outside both trees a command may open,
  and records the attempt` and `records which client made the crossing`. The harness nevertheless
  printed `verdict: did not fire`, because it searched the output for
  `outside both directories a command may open` - the **reason string** the refusal path builds, which
  the coverage never reaches: the first assertion the tree evaluates is `call.result === "refused"`,
  and it fails there. So the three probes were tightened to declare `breaks: [<test title>, ...]` and
  to require **every** declared title to appear in the scraped failing-test names, which is a claim
  about what the probe *moved* rather than about what the file happens to contain. That distinction
  is load-bearing rather than stylistic: the other two probes' original needles were `absent` and
  `<redacted>`, and neither is evidence of anything. `absent` is a word that appears in the
  **titles** of the tests the probe broke, so it would have read `FIRED` with the probe disabled;
  `<redacted>` appears in no failing title at all and was matching somewhere else in the output
  entirely. So two verdicts that read `FIRED` were coincidentally right about coverage and had never
  been computed from it. *A substring is a question about a document; the question was "which tests
  did this break", and only the failing-test names answer it.* This is the
  fourth time this repository has recorded a harness reporting something it did not measure, after
  the CRLF anchor, the column-zero `not ok` scrape, and the probe that restored the file before
  running the suite - and the generalisation they now share is one sentence: **a harness's verdict
  has to be computed from the same evidence a reader would use, or it is a second opinion about the
  wrong thing.**

- **An assertion about a message must read the message's wording from the code, not recall it.**
  The new `createSelfPromptPort` suite asserted the decline note matched
  `/confirmed:2|"confirmed":2/` - the colon-shaped field format a reader expects from a structured
  logger. `consoleLogger` renders fields as `key=value` inside parentheses, so the measured line is
  `veridian debug: self-prompt declined (path=/target attempt=1 confirmed=2)` and the assertion failed
  against **correct product code**. The failure message printed `actual:` with the real line, which is
  what made the diagnosis a reading rather than a guess, and the assertion was replaced by that exact
  line. *The generalisation is not "logging tests are brittle" - it is that a test asserting a
  message's shape is asserting a property of the formatter, so it has to quote the formatter rather
  than an expectation of it.* The same pass produced its sibling: the port's hostile-inputs loop
  wrote `candidates: candidates as readonly string[]` and `npx tsc --noEmit` answered `TS2352`,
  *"Conversion of type `number[] | boolean[] | ...` to type `readonly string[]` may be a mistake"* -
  a cast is a claim, and when the compiler disputes it the type should be declared
  (`readonly (readonly unknown[])[]`) rather than asserted away.

- **The empty string is a value a criterion writes on purpose, and the one guard that read it as a
  missing field was the one asking the wrong question.** The tenth world's `AC-002` asserts
  `process.stdout` `equals: ""` - "the program wrote nothing to stdout while refusing" - and
  `clarify` refused the contract, reporting *"states no comparison"*, because the predicate deciding
  whether an expectation compares anything was `isMissing`, and `isMissing("")` is `true`.
  `isMissing` answers *"did the author supply a value"*, which is the right question for every field
  the ladder fills in and the wrong one here, and the code already said so twice: `core/validation/
  assertions.ts`'s `statedComparisons` keys on the property being **present**, and
  `core/acceptance/plan.ts` refuses on the same presence test - so `core/clarification/detect.ts` was
  the one place that disagreed, and the tenth contract was the first to write the sentence and be
  refused for it. The failure mode was the worst one available: a **run-blocking** question the
  operator could not answer, because they had already answered it. The fix is narrow on purpose -
  `statesComparison(key, value)` accepts `""` for `equals` and keeps `contains: ""` and
  `matches: ""` refused, because every string contains the empty string and the empty pattern matches
  everything, and those two genuinely are the always-passing expectation the check exists to refuse.
  *Widening `isMissing` itself would have been the easier edit and the wrong one: the defect was in
  the guard's predicate, not in the input, and a guard relaxed at the wrong seam stops guarding.*

- **A path field resolved at one seam and re-resolved at the next is a doubled path, and the marker
  of the defect is an error naming a path the operator never typed.** The tenth world's plan gets its
  own copy of a rule the ninth world wrote: `databasePath` and `appPath` are resolved against the io
  root by the loader, so anything an adapter resolves *again* becomes `…/sandbox/…/sandbox`. Measured
  rather than reasoned about: the first run reported `ENOENT` for a doubled sandbox root while the
  directory was sitting there under the single spelling. The accessor is now one function,
  `#hostRoot(block) = this.#io.resolve(block.root)`, called at every accession site (the file probe,
  the `PROCESS_ENV` table, both `#spawn` sites and both `hostRoot` readings), so the second
  resolution cannot be written by hand anywhere. The complementary half is the distinction that makes
  the fix non-mechanical: **a value handed to a *child process* must be absolute** - the child's cwd
  is the application's own directory, not the tree root - **while a value the adapter itself opens
  against the process cwd may stay root-relative.** *A rule paid for at one world and not restated at
  the next is a rule that has not been learned; the second occurrence is the one that proves it.*

- **A reading's field is not inert: a validator family's rendering helpers are part of its contract
  surface.** `process.host` is a *targetless* validator - it asks about the world itself - so the
  string it compares is not read out of the raw observation by the criterion but built by
  `renderHost(data)`, and `renderHost` reads `data.root`. Which means the observation's `root` field
  does not merely describe the world: it **is** the value `"cart-builder (root sandbox)"` is compared
  against, and any edit to how that field is produced silently changes what a targetless criterion
  asserts. Held by a test that reads the contract's own expectation and the adapter's own reader
  rather than by a comment. *A field nobody's criterion names directly is a field nothing appears to
  depend on - and the renderers are where that appearance is wrong.*

- **A contract that pins the byte count of a stream the application composed from a value the world
  supplies is pinning that value.** `AC-002` originally compared the whole of `process.run`'s
  rendering, `"exit 2, stdout empty, stderr 2 lines (N bytes)"`, and the refusal quotes the absolute
  path it could not read - so `N` moved with the length of this machine's checkout, and the assertion
  was about the operator's directory name rather than about the program's behaviour. It now compares
  `"exit 2, stdout empty, stderr 2 lines"` and lets the family's `process.size` reading carry the
  length where a length is the point. The distinction that keeps the rule from over-reaching is in
  the same file: `AC-005` legitimately pins `42` bytes of a file whose text the program composes from
  a constant, and legitimately compares the other refusal's rendering *with* its `(36 bytes)`,
  because nothing in that stream is machine-dependent. *The question is never "is a byte count too
  strict"; it is "does this length depend on something outside the world". Found by running the
  contract against the correct program rather than by reading it.*

- **A defect aimed at a criterion must not take down the world.** `D3` was first authored to misspell
  the word `ready` in the daemon's banner - which is the line the world's `start.readyPattern` waits
  for - so `probe()` timed out, the run never came up, and the criterion it was filed against never
  got the chance to move. The demo reported `INCONCLUSIVE` four times and exit 2 for a defect whose
  *intent* was to be observable. It now misspells `channel` instead: the banner still names the
  daemon, the pattern still matches, the world starts, and the criterion reads `FAIL` for the reason
  it was written to catch. Held by a guard that asks the source, with each defect applied in turn,
  whether the readiness line survives - *and the positive control beside it* (`assert.notEqual(edited,
  program, …)`) is what keeps that question from being asked of a defect whose block is not in the
  file at all. *A comment saying "do not aim a defect at the readiness line" is not a guard; the
  guard is a test that applies the defect and re-reads the line.*

- **A reading must record the world's own spelling of a declaration, and the host path that
  declaration resolved to must be a second named reader of the same field rather than the same
  expression read twice.** The tenth world's reading carried the *accession* path - the absolute,
  machine-specific spelling - so whether `AC-003` passed depended on how the operator had spelled
  their `--goal`, which is an artefact of the command line and not of the world. Proved by a
  one-variable experiment rather than argued: the same tree, run twice, with `--goal examples/
  local-process/goal.yaml` and with the absolute path, gave `exit 0` and `exit 1` respectively, with
  `AC-001` the only mover. There are now two named readers of one field and they are documented as
  reading it for opposite purposes: `#hostRoot(block)` is the accession, used wherever this machine
  must open the directory, and `#declaredRoot(block)` is the declaration, used wherever something is
  *written down* - so the reading records `"root": "sandbox"`, which is what the environment document
  says and what a human can check against it. `adapters/local-process/process-port.ts` carries the
  same distinction at its own seam: `FileProbeRequest.root` takes the **accession, never the
  declaration**. *A field that is both an input to the agent and an output of the recording is two
  fields in one slot; name them separately or a future edit will conflate them.*

- **A defect's `criterionId` is a claim that its block sits on that criterion's code path, and the
  only way to hold that claim is to compile, inject, run and watch.** `D4` was filed against `AC-006`
  - a criterion about the narration `add` prints on stdout - while its block edited the *stderr*
  branch inside `verify()`, so the criterion it named could never have moved however many iterations
  the loop ran. Nothing failed: the demo still descended to zero, because `D4` had *some* effect
  somewhere else, and a reach table written from the defects' names agreed with the names. It was
  retargeted to `add()`'s own `say("out", …)` line, and the row probe that caught it - edit the block,
  run the program, read what the world answers - now stands as the guard, with the reach map derived
  from the engine's parsed comparisons rather than recalled. *A defect table and the criteria its
  entries name are two lists of the same thing, and only one of them can be executed.*

- **A scan for which criteria a defect moves is a substring test over serialized text, and one
  document's serialization of a value can be a substring of another's.** The first version of the
  tenth world's reach derivation asked whether `JSON.stringify(expectation.raw)` contained
  `"equals":4` - and `AC-006`'s size expectation serializes as `"equals":42`, so `D2` was credited
  with a criterion it does not touch and the derivation disagreed with the run. It now reads the
  values through the keys the engine itself parsed (`expectation.comparisons.map((key) =>
  expectation.raw[key])`) and compares them **typed** - `value === 4` for a number, `typeof value ===
  "string" && value.includes(needle)` for a string - so the question is about a value and never about
  how a document happens to render one. *Serialization is not meaning: a text scan answers "does this
  string appear", and the question was "is this the value".* Held and falsified (`equalsNumber(4)` →
  `equalsNumber(404)` fails the row it belongs to).

- **A guard about a *line the world prints* must be asked of the source with the defect applied, not
  of the defect's block.** The tenth demo's `D3` is safe only for as long as the line it edits is not
  the line the readiness pattern waits for, and the property is about the *edited* program, so it
  cannot be read off the defect's own text: the guard composes `program.replace(defect.correct,
  defect.defective)`, asserts the result differs from the shipped program - which is the positive
  control that stops a stale anchor from passing vacuously - and only then asserts the readiness
  literal survives. Both halves are needed and both were measured. The rule is written at the field in
  `examples/local-process/defects.ts` as well as in the test, because the next author of a defect
  reads the table and not the suite. *A guard that asks a defect a question about itself answers a
  question about its spelling; the world only ever sees the edited file.*

- **A test that re-states a predicate rather than iterating the register can only cover the worlds it
  was written with - and the recurrence is the proof.** `core/clarification/detect.ts`'s `hasNoHttp`
  grew a clause per world and was **correct** when the tenth landed (`!isMissing(environment.process)`
  as its eleventh clause); `tests/environment-gaps.test.ts` carried the same vocabulary a second time,
  by hand, as `NO_HTTP_KEYS` and a derived set naming the worlds it expected - and neither had been
  extended. Nothing failed, because a stale *test* list is silent by construction: the detector
  skipped the new world correctly and the test simply did not know it had been. This is the **second**
  occurrence of exactly this shape, after the `||`-chain that covered a new world with somebody else's
  block. Fixed by adding the shape and the world, **falsified 2/2** (dropping the detector's clause
  fails with *"was asked /url, and it has no address"*; dropping the test's key fails with *"one
  registered world per no-HTTP shape"*). *The fix procedure is: read the code first, then the test -
  never the other way round, because the code is the thing that was right.*

- **A probe harness must decide the file's line ending from the file it is about to edit, and it must
  print what it detected.** This is the CRLF rule discharged by construction instead of by
  remembering, and it exists because remembering had already failed twice at probes. Every harness
  written since computes `eolOf(path)` per file, composes each anchor and each replacement through it,
  and reports the detected endings on its own output line
  (`line endings: detect.ts="\r\n" gaps.test.ts="\r\n"`), so a future EOL mismatch is visible in the
  transcript rather than in a wrong verdict. *A harness that hard-codes its ending is a harness that
  silently under-tests on one platform; a harness that prints what it detected is one whose coverage
  can be read.*

- **A world that stands nothing in gets no simulated-surface constant and no `simulated` field, and
  the absence is a claim rather than an omission.** `local-process` is the second world in this tree
  that is entirely real, so there is no `PROCESS_SIMULATED_SURFACES` and none is wanted, its reading
  carries no `simulated` key, and `cli/worlds.ts` says so where the adapter is registered rather than
  leaving it to be inferred from the file's silence. The distinction the whole set rests on is that a
  simulated world must be *recorded* as simulated and a real one must not be decorated: a field
  reading `simulated: none` would suggest the other answer had been available. And the corollary that
  has now held eight times: a tenth validator family whose world has no socket, no page and no
  substitute still needed **no change in `core/`** beyond its own reading vocabulary.
  `tests/local-process-demo.test.ts` asserts the absence directly, because a claim nobody reads is a
  claim that drifts. *Two worlds' worth of proof that `EnvironmentAdapter` is a seam is worth more
  than two worlds' worth of interface; the rule that keeps the proof honest is "say which, and say
  it where the world is registered".*

- **A published artifact is not a repaired artifact, and a version a marketplace already serves can
  never be replaced - only superseded.** The Cockpit's own 72-test suite was green *before* the
  repair and green *after* it, which is the point: **a green unit suite and a working artifact are
  two independent claims**, and only the second one is the product. The claim was settled by putting
  the real compiled Cockpit inside `sim-vscode` and judging it with eleven acceptance criteria -
  the world installs the archive's own manifest, activates it in a real child process, invokes its
  commands and reads what it wrote to a channel. That world reported two defects, both in
  `extension/vscode/src/host/vscode-port.ts`, both invisible to the suite:
  `registerCommand` wrapped the handler and then wrote `void handler().catch(...)` - **a discarded
  promise is not a discarded wrapper**, so `vscode.commands.registerCommand` answered `undefined`
  and every caller that chained on its answer failed; and `openPath` used the answer of
  `workspace.openTextDocument` with `.then` on no shape check at all. The falsification is what makes
  the reading a measurement rather than an impression: patching each defect back into the *staged
  compiled* artifact moved **exactly one** criterion each (`AC-008`, `AC-010`), and restoring the
  artifact returned the run to `PASS 11/11` with complete evidence. Note *where* the probe had to
  reach: `vscode-port.ts` is **not** a member of the world's `MODULE_REGISTER`, so no registry edit
  could have exercised it - the probe patches the compiled bytes, and it must snapshot its golden copy
  from a **known-good** state, because a snapshot taken after the artifact was already patched
  silently converts the control into a second copy of the defect. Then the part that costs money:
  **the archive attached to `v0.2.1` had been built before the repair.** Read back by expanding the
  downloaded asset and reading `extension/out/host/vscode-port.js` inside it - the discard defect
  present, the shape guard absent, and the bytes differing from the build - and the **VS Code
  Marketplace was serving that same `0.2.1`** (`lastUpdated 2026-09-15T15:36:02.787Z`), so the
  defective build was public and the version could not be overwritten. `npm run package` succeeding
  says only that a file was written; it says nothing about whether the file is current. The version
  moved to `0.2.2`, and the rule this repository now holds is: **after every repackage, read the
  attached asset back and hash it** - the same discipline `smoke:dist`, `smoke:out` and `smoke:vsix`
  already apply one runtime out, applied to the one artifact that leaves the machine for a place
  nobody here can inspect.

- **A command block is a roster, and a roster that omits a command a reader was promised is the
  fourth occurrence of one shape.** `package.json` declares thirteen `demo*` scripts; `AGENTS.md`'s
  `Running things:` block listed eleven and named neither `demo:vscode` nor `demo:data` - both
  declared, both shipped, both described at length in `README.md`, and both absent from the one block
  a reader copies from. `README.md`'s own prose roster beneath its quickstart block omitted
  `demo:cockpit` in the same way. Nothing failed, because a list of names in a document is read by
  nothing that could disagree with it - the shape this file already records three times (`db.query`,
  `db.rowCount`, `web.visible`). `tests/demo-rosters.test.ts` now derives the roster from the manifest
  and compares it against the **fenced code blocks** of both documents rather than against the whole
  file, because the drift was a missing *block* entry while the same demo was described at length in
  the layout table. It tolerates exactly one named exemption - `demo:no-browser` is introduced in its
  own paragraph rather than in the quickstart - and asserts beside it that the exempted name is still
  printed somewhere on the page, so a named exemption cannot quietly become an omission. Its first run
  failed on a **correct** document: the header comment stated the reader-versus-roster distinction
  while the code asserted the stricter claim, and *a comment describing what an implementation does is
  not the implementation*. It was split into four `it` blocks for the same reason, so that a failure
  names one property instead of whichever fired first. Falsified 3/3: deleting the `demo:cockpit`
  fence line from either document, and inventing a demo into `README.md`, each failed the subtest that
  names it. **And the roster has a third list, which was the one nobody read.** `AGENTS.md`'s
  *"Running things:"* block and `README.md`'s quickstart are two documents; `.github/workflows/ci.yml`
  is a third statement of the same roster, and it said something different. The `worlds` job ran
  **seven** demos while `package.json` declared thirteen, so `demo:api`, `demo:local-process`,
  `demo:data` and `demo:cockpit` were declared, shipped and documented in `README.md` while **no CI job
  executed them** - and the build was green, because a job that runs seven of thirteen demos passes.
  Fixed in `623aab9` and proved by run `35033297178`, where the job's own log carries eleven
  `##[group]npm run demo:X` markers by name. The demos are run from `for world in db k8s ...; do`
  rather than from `strategy.matrix`, so `demosInWorkflow` reads the loop's own world list and unions
  it with the demos named literally (`npm run demo`, `npm run demo:no-browser`), and discards any
  match containing `$` because `echo "::group::npm run demo:$world"` is itself a line of the file. The
  file was then seven `it` blocks over three rosters, falsified 3/3 at the workflow too - a world dropped
  from the loop, the refusal demo dropped from the canonical job, and an invented demo added to the
  workflow, each naming its subtest before being reverted. *A guard that reads two of three statements
  of one roster is a guard that can be green while the third is wrong - and the count of `it` blocks is
  a number in prose, so it gets re-measured whenever this entry is touched.*

- **A guard has to read every spelling of the thing it is looking for, or it reports a correct document
  as wrong.** The self-acceptance route is named in **four** places - the manifest declares it,
  `README.md`'s quickstart fence and `AGENTS.md`'s command block print it, and
  `.github/workflows/ci.yml` runs it - so `tests/demo-rosters.test.ts` grew a fourth roster, as its own
  `describe` block holding all four, on the same argument as the three already there. Its workflow
  reader matched only `run: |` followed by bare command lines, which is how the demo loop is written,
  while the new step is an inline `run: npm run acceptance` scalar - so the check failed against a
  **correctly** running the command, and the only reason that is known rather than suspected is that
  the workflow was *read* after the check failed instead of edited until it went green. Both spellings
  are now accepted by one line-shaped pattern rather than a substring, because a `#` comment naming a
  script is a note *about* CI, and a roster that accepted one would be satisfied by the paragraph
  explaining why the command exists. Falsified **4/4** - the route was deleted from each of the four
  places in turn, each run failed naming that place and no other, and every file was restored byte for
  byte with the harness printing the endings it detected (`manifest="\r\n" ...`). *A guard that reads
  one spelling of a multi-spelling thing is the same defect as a guard that reads two of three
  statements of one roster, one layer in: the document is right and the check is wrong.*

  **A roster is not a `describe` block, and the count this entry's predecessor promised to re-measure
  is therefore two numbers rather than one.** The file is now **twelve** `it` blocks over **four**
  rosters, held in **three** `describe` blocks - because the manifest, the two command blocks and the
  workflow are four *places* while two of them are read by the same pair of assertions, so "four
  rosters" counts subjects and "three describe blocks" counts the code's grouping. Writing one figure
  for both is how a correct file came to be described by a sentence that was wrong about it. The fifth
  assertion in the fourth roster is the newest, and it is there because the step's *position* was a
  claim made only by a comment: the self-acceptance step has to sit **above** the demo loop, because
  every run in that job writes the same `.veridian/latest-result.json` and the upload step carries the
  whole of `.veridian/` - so the reading a reader opens first is whichever run wrote that file last,
  and the artifact's own comment says that has to be `cockpit`. Falsified 2/2 by a harness that
  computes each file's ending from the file it is about to edit and prints what it detected
  (`ci.yml="\r\n"`): moving the step back below the loop fails *"runs it before the demo loop, so the
  artifact's newest reading is the Cockpit's"*, and deleting it fails *"is run by a CI job, rather
  than only described by one"*, with the file restored byte for byte after each probe. *A comment
  about CI is read by nothing; an ordering claim is held only by a check that reads the order.*

- **A metric that compares two readings must first establish that they are readings of the same
  thing, and the identity it needs may not be in the thing it compares.** M1 asks "did the same code
  give the same result twice", and `signature()` answered with the iteration index, each criterion's
  id and status, and the verdict - **no goal, no adapter**. A criterion id is a name *inside one
  contract*: both the cart demo and the inventory demo name `AC-001`..`AC-004` and both repair them in
  ascending criterion order, so two runs of `shopping-cart` on `local-web` and one of `inventory-db` on
  `local-db` produced **byte-identical signatures** and `veridian metrics` printed
  `M1 result consistency: yes (3 runs, ...)`. That is a false PASS by construction, in the one place
  whose entire purpose is to refuse one, and it was found by running the reproduction rather than by
  reading the function - the criteria collided because the *contracts* collide, which no amount of
  reading `metrics.ts` reveals. The fix carries the subject on the reading (`RunSnapshot.goalId`,
  `.adapter`, from the bundle's own `goal_id` and `environment.adapter`, `null` when absent) and
  **groups the population before comparing anything**, which is also why `signature()` is left
  subject-blind on purpose: `compareTo` should not have a question to ask about two unrelated claims.
  Three states, not two - the runs agreed, the runs disagreed, and this population is not a question
  M1 can answer - so `ConsistencyReport` gained `measured`, `formatMetrics` prints three lines, and
  the CLI counts a violation only when `measured && !consistent`. Writing it as `runs > 1 &&
  !consistent`, which is what it was, worked for the single run by accident and would have accused a
  clean-but-heterogeneous history of a divergence it had refused to look for: **a false FAIL beside
  the false PASS, and the second one would have hidden the first.**

- **A test whose fixtures cannot be told apart does not test the gate that tells them apart, and the
  green suite is what hides it.** The first version of the mixed-population test used three runs with
  *identical* signatures - the reproduction, and the reason the defect went unnoticed - so removing
  the comparison gate left every assertion passing: `differences` was empty because the signatures
  agreed, not because the population had been refused. Falsifying the guard is what found this, and it
  found it only because the probe was run rather than trusted; the test now carries a positive control
  that asks the same two readings of **one** subject and asserts the machinery *does* name a delta, so
  the empty list is evidence of a refusal. *A test that passes whether or not the rule holds is not a
  test* - and the fixture that made the defect invisible is exactly the fixture a test written from
  the defect will reach for.

- **A probe harness that restores the file before running the suite reports "did not fire" for
  reasons that have nothing to do with the code.** The M1 harness patched `metrics.ts` correctly,
  restored it, and *then* ran `node --test` - so all four probes reported `did not fire` against the
  **unpatched** file, which reads as four rules that are not held. A probe that measures the original
  is a verdict about work that did not happen, and it is the same failure the repository already
  records at the CRLF anchor and at the column-zero `not ok` scrape. The harness now patches, runs,
  then restores, decides each file's ending from the file it is about to edit and prints what it
  detected, and asserts the anchor was present before patching and that the patch changed the file.
  Under it all four probes fire by name: removing the comparison gate, widening `measured`, treating
  an absent subject as a match, and dropping the formatter's mixed branch each fail the subtest that
  names the property.

- **A premise in prose is neither a name nor a count, and the guard over a document cannot hold it.**
  Moving the confine seam into `core/process.ts` did not touch `core/environment/types.ts`, and it
  falsified a bolded invariant inside that file's doc block: *"The three worlds that confine a child
  are exactly the three that answer this question with a measurement"*. True when written, because
  only three worlds confined a child at all; after the migration **all twelve** hand the runner a file
  allowance (eleven when the migration landed - `sim-mobile` arrived after it and does the same, which
  is why this figure had to be re-measured rather than carried), so the left side of that equality
  denotes every row while the right side still holds of three. The same premise was repeated in
  `tests/boundary-roster.test.ts` as an explanation (*"the
  other eight act in process and hold no boundary to measure"*, which was the superseded spelling
  while eleven worlds existed) and as an assertion title and
  message, and nothing failed: the assertion's **set** stayed correct, because the migration left the
  network arm alone, so what went stale was the **reason**. It was found by searching the tree for the
  claim rather than by reading the file the change touched, which is the only way it could have been
  found. The correction is narrower and is now what all four places say - the separation is **a front
  door, not a child**: the two worlds whose every request passes a guarded route answer `enforced`,
  `local-process` has no door and answers `unenforceable` because `--allow-net` does not exist on this
  runtime, and the other nine answer `unsupported` - two `enforced` plus one `unenforceable` plus nine
  `unsupported` is the twelve. And the guard over that doc block was **measured
  rather than assumed** to be useless against it: patching the false sentence back in leaves
  `tests/boundary-roster.test.ts` at **14 pass / 0 fail** (exit 0, line ending detected first, anchor
  asserted present, edit asserted to have changed the file, file restored byte for byte), because that
  block asserts only that the prose **names** all four enforcement values and all three worlds - *a
  guard that holds a vocabulary's membership cannot hold its meaning.* Three kinds of prose claim now
  have three recorded fates: a **name** can be pinned by a test that reads the code, a **count** can
  only be re-measured when the document is touched, and a **premise** can be invalidated by a change
  that never opens the file it lives in - so the way to hold one is to search for it.

- **A guard's *purpose* is the property it must hold; its *mechanism* is only how it was measured,
  and the two drift apart in silence.** `tests/boundary-roster.test.ts` exists so that *"a twelfth
  world cannot join either side of this split in silence"* - that is its purpose, and it is right.
  Its mechanism paired the rows it had walked off `adapters/` against a `readdirSync` of the
  **directory names** under `adapters/`, so what it actually asserted was that every directory under
  `adapters/` holds a world. That is a claim about the tree's **layout** rather than about the
  **code**, and it was true for exactly as long as the two happened to coincide. `adapters/sim-mobile/`
  is where they stop coinciding: it holds a substitute device port, a 49-test suite and a reading
  vocabulary, and **no adapter** - so the guard's first assertion failed with
  `every adapter directory contributed exactly one row to this guard's walk`, `actual` naming
  `'sim-mobile'` and `expected` not. The directory is not a world, so it cannot escape a split about
  worlds; what *can* is an **adapter nobody classified**, and that is found by selecting on
  `implements EnvironmentAdapter` - robust to the filename, the directory and the filing - which
  measured exactly the twelve `*-environment.ts` files and nothing else. The guard's walk now derives
  its population that way, and a register cross-check beside it holds the complementary failure in
  **both** directions: an adapter nothing can construct, and a declared world with nothing behind it.
  *The tempting repair was to write the missing adapter, and it was the wrong one* - a twelfth world
  is not one file but a plan block, a schema, a loader, a `WORLDS` entry, a surfaces-guard extension,
  a validator family and a demo (`docs/GAP-CLOSURE-DESIGN.md` W2 specifies all of it and
  `docs/BOUNDARY-SPINE-DESIGN.md` decision 6 defers it), and **a declared world with no adapter
  behind it is worse than none, because the register cross-check now names it** - which is what the
  falsification probe watched happen when an unregistered adapter file was seeded into the tree and
  the guard failed with *"every adapter in `adapters/` is a world `cli/worlds.ts` declares, and every
  world it declares has one"*. Falsified rather than trusted, three probes, each firing by name and
  message and each restored byte for byte: the old directory-name walk back in place (`fail=1`), the
  seeded unregistered adapter (`fail=2`), and `asksForConfinement` answering `false` for everyone
  (`fail=3`). *A guard whose mechanism is a naming convention is a guard whose coverage is a
  coincidence, and a guard whose stated purpose survives a change to its mechanism is the guard
  working - read the purpose, then fix the mechanism, and never widen the claim to fit.*

- **A test built from a positive cap cannot see where a bound is placed, and the input that can see
  it is the cap already reached.** `core/clarification/engine.ts` checks the per-run round budget
  **before** it spends a round, which is what makes the worst case a bound that was already reached
  rather than one that is one over - and the guard written for the ladder
  (`tests/clarification-ladder.test.ts`) was first drafted with `maxSelfPromptRoundsPerAmbiguity: 2`
  for the bound and a *positive* per-run cap for the placement. Falsified rather than trusted, by
  moving the cap block below `rounds += 1;` and `this.#selfPromptRounds += 1;` in a probe: the
  bound subtest **still passed**, because with a positive cap the two placements differ only in a
  boundary the per-gap cap already covers. The subtest that failed was the one whose policy sets
  `maxSelfPromptRoundsPerRun: 0` - a cap already spent, where *check first* answers `attempts: 0`
  and *increment first* answers `attempts: 1`. *A test whose inputs cannot reach the difference
  cannot see the difference*, and a guard about a before/after placement therefore has to be written
  from the degenerate case rather than the typical one; the same file's four properties were each
  falsified by a probe naming exactly one subtest, 4 of 4, with the tree restored byte for byte.

- **A read allowance and a write allowance answer two different questions, and `--allow-fs-read` is
  an allowlist rather than a widening.** `demo:k8s` was found failing at `INCONCLUSIVE (ABORTED, 0
  iteration(s))`, exit 2, and the cause was not the cluster and not the application: the adapter
  confined the deploy child with `readRoots: [appPath]`, while `examples/sim-k8s/app/deploy.mjs`
  imports `yaml`. The permission model **enforces its allowlists against the interpreter's own module
  resolution**, so `node_modules/yaml/package.json` was refused - `ERR_ACCESS_DENIED`,
  `permission: FileSystemRead` - **before the program's first statement ran**, the child exited 1,
  preparation reported `ENVIRONMENT_FAILURE`, and the run aborted with no iteration to observe: an
  `ENVIRONMENT_FAILURE` wearing the application's clothes. Correlated exactly rather than assumed:
  an import census over `examples/**` returned three lines, and `sim-k8s` is the only world whose
  application imports a real package - and the only world that failed. The repair extends the
  *existing* allowance (`readRoots: [appPath, ...dependencyReadRoots(appPath)]`, derived by walking
  **up** the way Node does) and leaves `writeRoots` alone, so the measured `filesystemWrite`
  dimension is unchanged. *A program's source and its dependencies are two directories, and a
  permission model that enforces allowlists does not know the difference.*
- **The guard that should have caught it asserts the presence of an allowance, never its width - and
  the unchanged test count is the measurement that proves nothing in the tree held the rule.**
  `tests/boundary-roster.test.ts` selects every adapter via `implements EnvironmentAdapter` and asks
  `asksForConfinement(text)` whether `confinement:` appears at all; every assertion is about
  membership, none about content. So the `sim-k8s` regression was green in the suite and red in the
  demo, and the repair left the suite at **2466 tests unchanged** - which is not a coincidence but
  the diagnosis: a suite whose count does not move when a rule is repaired and re-broken is a suite
  that never held it. The guard that does hold it (`tests/sim-k8s-environment.test.ts`, asserting the
  runner's allowance reaches the dependencies the application imports) moved the run to **2472 over
  412 suites**, and it was falsified **2 of 2** - an adapter-only allowance breaks the adapter guard,
  and a derivation that stops at the start directory breaks four confinement subtests beside it.
  *Two independent claims: "the allowance is declared" and "the allowance covers what the program
  reads" - and a guard written against one of them cannot see the other.* Its sibling: a guard that
  asserts a helper's output against a literal cannot hold a helper that walks the **real** filesystem,
  because the literal is then a property of the machine the test happens to run on.
- **A count in prose is a claim, and a handoff that recalls one is a claim too.** Twelve worlds have
  landed and `AGENTS.md`'s own summary line says so correctly (*"the MVP is implemented and green,
  and eleven more sandbox worlds have landed"* - 1 plus 11 is 12), but six other places still said
  eleven or thirteen, and **the handoff that listed them was itself wrong twice**: it flagged
  `AGENTS.md:7` and `AGENTS.md:814` as drift, and measurement showed the first is an MVP-plus-eleven
  decomposition and the second reads *"Twelve adapters are registered, eleven of them need no
  browser"*, which is internally consistent. Both false flags were caught by **counting**
  (`adapters/*-environment.ts` returns 12, `demo*` scripts in `package.json` return 14, the ci.yml
  loop names 12) rather than by reading, and the six real corrections were then applied against those
  measurements: two manifest descriptions, three `ci.yml` comments and one `AGENTS.md` clause. *A
  number cannot be pinned by a test the way a name can - which is why the only durable fix is to
  re-measure at the moment the document is touched, and why a handoff that recalls a count instead of
  taking one inherits the same defect it is reporting.* The extension's description travels inside a
  packaged artifact, so correcting it required a repackage and a readback - and the readback is the
  half that matters: **the archive's hash moved** (`85BD2672DFE9A6B5` to `FB0898395806AB19`, 122303
  to 122304 bytes) and `smoke:vsix` compared the archived manifest field-for-field, which is the only
  thing that says the file a reader downloads is the file the correction is in.
- **A readback that globs a directory selects by name order, and a name order is not the artifact you
  meant.** The distribution-route script resolved the built archive with
  `Get-ChildItem *.vsix | Select-Object -First 1` and returned **`veridian-cockpit-0.2.2.vsix`** - the
  stale one - because both versions are gitignored and accumulate, and `0.2.2` sorts before `0.3.0`.
  A hash read off the wrong file is a measurement of something, and it is not a measurement of the
  build. The archive name has a single definition in this tree (`scripts/vsix-archive.mjs`, the same
  one `smoke:vsix` uses) and it is resolved from the manifest's own `version` field rather than from
  the directory listing. *A readback that globs answers "which file is first" when the question was
  "which file did the build just write".*

- **A guard over an index is the fifth time this repository has asked "does the document name the
  code", and the first whose *falsification harness* was itself wrong.** `AGENTS.md` obliges a
  one-line index entry per new document in as many words - *"Add a one-line index entry here for each
  new doc"* - and nothing held it: `docs/` gained an eighth file (`ISOLATION-AND-MCP-PLAN.md`) while
  the Documentation table still listed seven, and the drift was silent for exactly the reason the
  `db.query` / `db.rowCount` / `web.visible` / observation-vocabulary entries already record - *a list
  of names in a document is read by nothing that could disagree with it*. The nearest existing checks
  each name one document for their own purpose and none enumerates the directory, so a new document
  could arrive un-indexed in silence, which is what happened. `tests/docs-roster.test.ts` now reads the
  directory and the table together, and the **scope** is the load-bearing part rather than a stylistic
  choice: `AGENTS.md` names the first document in its table repeatedly below the table - in the status
  banner, in the AVF-rename note, in two rosters - so a question asked of the whole file would pass
  with the table two rows short: the vacuous pass `tests/observation-vocabulary.test.ts` discovered in
  its own first draft, arriving here at the second guard to need the same correction.
  **Then the probe that falsified the guard fired for the wrong reason, and what caught it was the
  probe's own control.** Its guard-deletion needle was the document path spelled as a markdown link,
  which matched **three** lines rather than the single table row, so the control printed `1 time(s)`
  where an independent count taken then said **7** - and a probe that deletes every reference reports
  `FIRED` while leaving the scope it claims to test entirely unexercised. The anomaly was turned into a
  repair by *measuring* it rather than by re-running and hoping, the needle was re-aimed at a phrase
  unique to the table row, and the control then read `5` - which reconciled exactly with `7 - 2`
  occurrences on the deleted line - and was itself able to fail the probe through a threshold. *A probe's verdict has to be computed from the tests it broke,
  and its control has to be reconciled against an independent count: a control that is only printed is
  decoration.* This is the sixth time this repository has recorded a harness reporting something it did
  not measure, after the CRLF anchor, the column-zero `not ok` scrape, the probe that restored the file
  before running the suite, the substring needle, and the probe that read the wrong file's count.

- **An extraction can be faithful for a composition and lossy for an observation, and only an
  assertion that runs will say which.** `cli/` was split into `./validate.ts` and `./session.ts` as a
  pure move, and it moved the composition correctly while dropping one `logger.info` call. `main` had
  emitted `resolving the definition` on **both** fronts - inside `runClarify` and inside `runValidate` -
  and afterwards `cli/validate.ts` logged `running` and nothing else, so the second line was gone. The
  whole suite stayed green, **2531 tests before and after**, because no test in `node --test` reaches
  that path's log stream at all: the only thing that reads it is `acceptance/acceptance.yaml` AC-006, a
  `process.stderr` expectation inside a contract the suite never runs. The contract caught it on its
  **first** execution on a runner, `run 1: exit 1 - FAIL  (MAX_ITERATIONS, 1 iteration(s))`. The repair
  restores the line in `runValidate` rather than deleting the expectation, and the reason is measured
  rather than sentimental - the blast radius was checked and is exactly **one** expectation, since the
  other `process.stderr` uses in that contract are two prose lines in a grammar comment, an
  `equals: ""` and a `contains` on an unaffected path - so AC-006 is the only criterion that can catch
  this regression. *A log line an operator watches is a behaviour, and a behaviour needs an assertion
  somewhere that runs.* The generalisation mirrors an older rule in this file: that one says two
  implementations of one rule disagree the first time a world arrives that only one of them was written
  for - and here **one implementation was split into two, and the split lost a behaviour only one of the
  halves carried.**

- **A test that hard-codes an absolute path asserts the developer's platform, and this is the fourth
  time this file has recorded that shape.** `adapters/sim-mobile/mobile-port.test.ts` handed a world the
  literal `D:/elsewhere/cart` to be refused as a path outside both trees. Under `node:path`'s `win32`
  semantics that string **is** absolute, so the world refused it and the test passed; under `posix`
  semantics it is **relative**, so `posix.resolve` folded it into the world's own context root, the world
  resolved it happily, and four assertions failed - on `ubuntu-latest` only, which is why the local
  Windows gate could not see it. Measured rather than reasoned: `posix.isAbsolute("D:/elsewhere/cart")`
  is `false`, `posix.resolve("/a/b/app", "D:/elsewhere/cart")` is `"/a/b/app/D:/elsewhere/cart"`, and
  `win32.isAbsolute` of the same string is `true`. The fixture now derives its spelling from the world's
  own geometry, `resolvePath(world.context, "..", "..", "elsewhere", "cart")`, which lies outside both
  trees on either platform and is refused on both. The half worth keeping is *which* side was repaired:
  `mobile-port.ts`'s boundary predicate is correct and was left byte for byte alone, because **the
  fixture was the defect** - and a repair aimed at the predicate would have widened a boundary in order
  to make a test pass, which is the one direction a boundary repair must never go. Falsified rather than
  trusted: two probes fired naming the tests they broke, both files were restored byte for byte, and the
  suite reports 49 tests / 14 suites / 0 failures. *The four instances are one class, and the class is
  not "CRLF" or "paths" - it is that a test can only ever assert a property of the machine it runs on, so
  a claim about the program has to be expressed in terms the platform cannot change.*

- **A suspected drift is not a drift, and the count is what tells the two apart.** Writing an entry about
  the movement of the suite counts, this agent noticed that the CI paragraph above says the workflow "has
  seven jobs" while the jobs table of a real run lists **eight** rows - and took that as a fifth instance
  of a number that had drifted. Measuring it refuted the suspicion: the workflow's `jobs:` keys are
  `gate`, `demo`, `worlds`, `dist`, `mcp`, `image` and `cockpit` - seven - and the eighth row exists
  because `gate` is a matrix over two platforms, so a run *displays* two legs of one job. Both figures are
  right and they count different things, and the correction that was about to be written would have been
  a false one. *The rule that a number must be re-measured rather than recalled cuts both ways: it keeps a
  document from carrying a stale count, and it equally stops a reader from "fixing" a count that was never
  wrong - and the only way to tell those apart is to take the measurement.*

- **A markdown bullet is a bullet because of its line position, so an edit that absorbs a newline deletes
  a member of the list the bullet was in - and nothing but a parser of that document can tell.** Phase 11's
  index gained a `## What is still open, in one place` table inserted immediately before the paragraph
  that declares the eight status words. The replacement's `newString` ended `...and nothing more:` where
  its `oldString` had ended `...and nothing more:` plus a blank line, so `` Statuses mean exactly this,
  and nothing more: `` and `- **built** -- the deliverable exists...` were joined onto **one line**. The
  document then read as a closed list of eight that printed seven, and every bullet below survived intact
  - nine of the ten lines were byte-identical to what they had been, which is why a diff would not have
  shown it and a read would not have caught it. `tests/phases-roster.test.ts` caught it in two assertions
  at once: `declaredStatuses()` matches `/^- \*\*(.+?)\*\* -- /gm`, so the absorbed first bullet stopped
  being a member (7 where the prose says 8), and `spells every status with a word the document declares`
  then reported `row 11: built` as a status the document does not declare - the second failure naming the
  *consequence* while the first named the *cause*. **A prose edit in a document whose structure is parsed
  is a structural edit**, and the remedy is to run the guard before believing the edit was cosmetic: this
  one was submitted as an insertion, read as an insertion, and was a deletion.

## A name in a document standing in for a capability

`docs/ISOLATION-AND-MCP-PLAN.md` recorded phase 07's blocker as *"Not buildable on this machine (no
container runtime; the `Dockerfile` is CI-only by precedent, and Docker is installed nowhere here)"* -
and the load-bearing word was **Docker**. It is installed nowhere here. `podman` 5.7.1 is installed at
`C:\Users\user\AppData\Local\Programs\Podman\podman.exe`, with a machine that existed and was stopped,
and `podman machine start` was all that stood between this tree and a real substrate. Every clause of
the sentence was true and the sentence was false, which is the shape worth keeping: **a document may
name the *thing* it looked for instead of the *property* it needed, and the two differ by a vocabulary
the document does not hold.** Two readings reinforced it, and both were instruments rather than
measurements: `podman version --format '{{.Client.Version}}'` answers `5.7.1` against a **stopped**
machine - so a probe written to check *is a runtime installed* passes on a machine that can run
nothing - and the check was written for one runtime's name when the question was whether any runtime
answered. The correct probe is `{{.Server.Version}}`, because only a live runtime returns one. *A
blocker recorded as an absence of a named tool is a claim about that name; record the property you
asked about and the probe that asked it.*

## Two mechanisms can both be right, and the guard between them may still be wrong

`local-process` adopted the isolation substrate and its network arm now names **both** `enforced` and
`unenforceable`, because a container can sever the network and an interpreter cannot. The guard that
held this seam - `tests/boundary-roster.test.ts`'s *never lets one world answer both ways, so the
three-way split cannot collapse to two* - went red, and it was the guard that was wrong rather than the
code. It had been written as a flat refusal, which is the right rule and was a true description of a
tree where every world's answer was a literal. The distinction it was missing is mechanical: **two
enforcement literals in one arm is a report making two claims at once; one answer *selected* from a
reading is not.** So the rule narrowed rather than relaxed - the two-word case is now permitted only
alongside a read of `#isolation`, which is the same discipline the same file already applied to the
*filesystem* arm - and the set of worlds naming `enforced` became exact at three with the third named
and justified rather than absorbed. *A guard written against a static tree becomes a guard that refuses
correct code and accepts incorrect code once the tree gains a conditional; the remedy is to ask what
decides, not to loosen the assertion.*

## The instrument disagrees with the code: bisect before choosing

The first `scripts/probe-isolation.ts` reported the port as failing to write through a mount it had
mounted correctly. The port was right. The probe had built a container path by splitting a host root
out of a string and pasting the remainder, which left a Windows `\` before the filename, so the
container wrote a file literally named `rw0\inside.txt`, the host never saw it, and the probe reported
the permitted half as broken. It was settled only by `scripts/probe-isolation-bisect.ts`, which printed
`containerPathOf(mounts, root/inside.txt) -> /veridian/rw0/inside.txt` beside a host listing of
`["inside.txt"]` - the mapping and the directory, side by side, which is what made the disagreement
visible. The fix was to hand the port a **program file** so the port did its own translation, and
`containerPathOf` now normalises `\` to `/`. **When a measurement disagrees with expectation, the
instrument is a candidate cause before the code is** - and the way to decide is to print the value the
instrument computed beside the value the world holds, because two readings of one fact printed together
cannot both be wrong without saying so.

## A container does not inherit the environment of the process that started it

The first wiring of the substrate through `core/process.ts` set the world's variables on the spawn and
stopped there. `podman run` passes through only what `--env` names, so the child read `undefined` for
the one value telling it where its sandbox is, and failed with `ERR_INVALID_ARG_TYPE: The "path"
argument must be of type string or an instance of Buffer or URL. Received undefined` - a failure that
reads as an application defect and is an environment one. Two consequences worth keeping: the
environment now travels as `--env=NAME`, so each value is read from the runtime's own environment and
none of them ever appears on a command line; and the translation of a **host path into the mount it
names** had to move into the port, because the mounts are the port's and a world that had to re-derive
them to describe itself would be a world that has to know how it is being held. *A spawn's `env` option
is the runtime's environment, not the container's, and the difference is invisible until the container
reads a variable.*

- **A byte total is a reading of the checkout until the line endings are normalised, and the difference
  is the line count.** `docs/phases/README.md` opened by stating that its five source documents total
  `210,900 bytes`, and `tests/phases-roster.test.ts` re-measured them and passed - on Windows. Run
  `35958249177`'s `gate (ubuntu-latest)` failed the same assertion with five disagreements, each one
  exactly one byte per line smaller than the document claimed:
  `docs/DIGITAL-TWIN-PLAN.md: says 12270, is 12078`, and 58,650 against 57,965 for
  `docs/ISOLATION-AND-MCP-PLAN.md`. The five differences summed to **2,875**, which is the line count
  of those documents - so the arithmetic was never wrong and the *unit* was. `core.autocrlf` is `true`
  here: the index holds `LF`, this checkout holds `CRLF`, and `git ls-files --eol` reports
  `docs/RULES-PAID-FOR.md` as `w/mixed`, so two readings of one file on one machine can disagree while
  no word of it changes. The count is now taken of the content with `\r\n` normalised to `\n`, which is
  the ending the index holds - and the guard's message says so, because a reader who sees a disagreement
  has to know which of the two things moved. *A count that moves with a checkout setting is a
  measurement of the checkout, and it will agree with the document on exactly one platform.* The
  related half is that the assertion passed here for a reason it was not written for: this machine's
  number and the document's number were both CRLF, so they agreed about a unit neither of them named.

- **A probe that changes a value no assertion consults is not a probe - and the first version of this
  one did exactly that, from the other side of the mistake this register already records.** Two new
  assertions in `tests/isolation.test.ts` guard the unavailable reading of the isolation port, and the
  probe written to falsify them edited `unavailable()`'s default `substrate` from `""` to `"docker"` -
  the shape that would name a runtime with no version. The suite stayed at `# pass 14 / # fail 0`, which
  reads as a guard with no teeth. It is not: **the podman machine was running on this machine**, so
  `isolationCapability()` answered `available: true` and returned from the branch above the assertions.
  The default parameter is consulted only on the path where no runtime answered at all, which cannot
  happen here while a runtime is up. The earlier form of this mistake edited an assertion's *needle* and
  weakened the question; this one edited a *default* that the code path in force never reads, so the
  probe changed a value and measured nothing. The probe that works forces the state the assertion lives
  in - `VERIDIAN_ISOLATION_IMAGE=veridian/does-not-exist:never`, the lever `scripts/probe-isolation.ts`
  already uses - and perturbs a value that state really returns: dropping the version in the factory
  fired *"a runtime is named together with the version it gave back"*, and naming a flag fired *"the
  flags this port applies are named only once a probe watched them hold a boundary"*, one named subtest
  each, `# fail 1`. *Before trusting a green probe, ask which state the assertion is in and whether the
  machine can reach it - and restore with `git checkout --` followed by a `git status --porcelain`
  reading, because a probe whose file was never restored reports the reverse of what happened.*

- **An assertion whose branch is unreachable on the machine that runs it is an assertion only the second
  platform checks - and that is a reason to run the second platform, not to trust the first.** The
  assertion `gate (windows-latest)` falsified required `IsolationResult`-style semantics of
  `IsolationCapability.substrate`: *empty whenever the boundary did not hold*. The field's own doc block
  had said `Empty when none answered` since it was written, and every path in `measure()` that found a
  runtime passes `found.name` on - deliberately, because a reader has to tell "nothing answered" from
  "docker answered and the boundary did not hold". On this machine no runtime was up, so `substrate`
  was `""` and the assertion passed - for the wrong reason, having never reached the state it was about.
  `ubuntu-latest` has no runtime either and passed the same way. `windows-latest` runs Docker in
  Windows-container mode: it answers a server version, cannot run a Linux image, and produced
  `'docker' !== ''`. The replacement states what is true in every state and keeps teeth - a runtime is
  named together with the version it gave back, and the flag list is non-empty exactly when the boundary
  was measured to hold. *A test that passes on one platform because its branch is unreachable has not
  been tested, and the platform that can reach it is the instrument that finds the difference.*
- **One field cannot spell the difference between "declared nothing" and "declared and not staged",
  and it is the second state a run reports.** Phase 08's import was first modelled as a single
  `import` field on `EnvironmentPlan`: a plan either came from an interchange document or it did not.
  The model is circular and the circle was invisible until the acceptance criterion was written out.
  Verification *compares* an identity, so the plan must exist before the comparison - yet a plan may
  not be presented as a world when a declaration reached it and no verification did. With one field
  those two states have the same value, `null`, so AC-8's clause *an import is staged at `prepare()`
  or not at all* stopped being falsifiable: there was no state a reader could construct that was
  *declared and unstaged*. Split into `imported` (the declaration the operator's document makes) and
  `adopted` (the verification the program completed), and the state becomes reachable, refusable, and
  testable - which is the whole of the criterion. The pair is checked in **one direction only**: a
  record with no matching declaration is refused by name, while a declaration with no record is
  allowed, because that is the state the verifier builds a plan in on its way to producing the record.
  *When a criterion's clause sounds unfalsifiable, the field model is the first thing to check - a
  state the model cannot represent is a state no test can construct.*

- **A guard written as a regex over a module's whole source cannot pass when the module's own prose
  uses the word it forbids.** The claim "`core/metrics/import.ts` reaches no adapter" was first
  written as a pattern over the module's text, and it could never be true: the module's doc block
  explains *why* it reaches for no adapter, so the word appears, and the assertion would have failed
  for a file that satisfied it. It would have been "fixed" by loosening the pattern, which is the
  move that turns a guard into decoration. The replacement reads the module's **actual `import`
  statements** and filters those paths, which is the question that was meant. *A guard over a source
  file's text is a guard over everything the file says - including the sentences that explain the rule
  - so read the file's imports, exports or AST rather than its words.*

- **A guard that holds where a decision *lives* is not a guard that holds what the decision *does*,
  and only the second is the acceptance criterion.** Phase 08's suite was written with a roster over
  `core/environment/manager.ts`: it asserted the pair `plan.imported !== null && plan.adopted === null`
  appears in the source, and that its position in `prepare()`'s own slice is above the `"creating"`
  step. Both assertions were true, both were precise, and neither measured AC-8 - which is about what
  a **run produces**, not about where a refusal is typed. The suite's own doc block claimed
  *`EnvironmentManager.prepare` refuses it, so every criterion is `INCONCLUSIVE`* while nothing called
  `prepare()`. The missing half was added: build the declared-and-unstaged plan, run `prepare()` against
  an adapter double, and read `ok === false`, `failure.kind === "ENVIRONMENT_FAILURE"`, a message
  naming the document, and `calls === []` - the last being what makes the staging *staging* rather than
  *reporting*, because nothing was created and so there is no window in which an unadopted world could
  be observed and judged. The negative control is a second subtest in which a *verified* world prepares
  and `create` is called. Falsified: disabling the refusal with `if (false && ...)` took the suite from
  `18 pass / 0 fail` to `17 pass / 1 fail`, failing on exactly `refuses a declared-and-unstaged import
  before the world is created at all`, and the line was restored and the restore asserted by reading it
  back. *A source-text guard is cheap, survives refactors that change behaviour, and answers a different
  question - so write it, and then write the half that runs the thing.*
- **A document's own size is a count site when another document states it, and the guard over it lives
  in a third place.** Phase 08's pass closed by editing `docs/INSTRUMENT-AND-PROMPT-PLAN.md` to record
  the W-D audit, and the gate came back `2692 pass / 1 fail` on *the byte count it measured for each of
  the five source documents* - `docs/INSTRUMENT-AND-PROMPT-PLAN.md: says 33726, is 35625`. The count was
  in `docs/phases/README.md`, the document it counts was one directory away, and the guard was
  `tests/phases-roster.test.ts`. Three places for one number, and the edit that moved it touched none of
  them: adding prose to a plan document is not obviously a change to an index table, so nothing in the
  edit's own context suggested a count was at stake. **The list of count sites in `tests/docs-roster.test.ts`
  is not the list of counts that can move.** That one reads stated *test totals*; this one is a byte
  total over five named documents, and it is checked by a different file answering a different question.
  So the rule is not "remember the fifth site" - it is: after editing any file under `docs/`, run the
  documentary guards (`tests/docs-roster.test.ts`, `tests/phases-roster.test.ts`,
  `tests/phase-anchors.test.ts`) as the pass's own gate rather than discovering them in the whole-tree
  run. They are fast, they are not part of `npm run gate`'s first failure mode, and the whole-tree run
  reports them as one unnamed suite among 451. *A guard is only preventive if it is run before the
  thing it guards has been sent* - and the containment here is worth naming, because the alternative to
  a guard that fires is a document that states a figure nobody re-measured.
- **The document that must be kept true is the one written in the present tense; the one that must not
  be touched is the one that names the moment it measured.** A plan item deferred behind a precondition
  expires when the precondition is met, and **no commit records that event** - the work that satisfies
  it lands somewhere else entirely. So the sweep is not "which document looks out of date", which
  requires reading every document, but **"whose precondition has now been met"**, which points at the
  gate directly. Asked that way, this pass found three: `docs/DIGITAL-TWIN-PLAN.md`'s import half
  (cleared by the world-import work), `docs/ISOLATION-AND-MCP-PLAN.md`'s MCP surface (built as a fourth
  consumer), and W4's Cockpit twin (built as phase 05, `extension/vscode/src/twin.ts`). Each was
  corrected at its own address rather than at its date, because a status row states *the tree's* status
  rather than *the pass's*. What decides whether a stale sentence may be rewritten at all is not its
  title and not its staleness - it is whether the document is a *description* or a *record*, and the
  tree already had the answer: `docs/GAP-CLOSURE-DESIGN.md` opens `**Status:** design. **Date:**
  2026-09-17. **Base commit:** da4831e` and `docs/BOUNDARY-SPINE-DESIGN.md` opens `Date 2026-09-16.
  Base commit d05a6f7`, while `tests/docs-roster.test.ts`'s `COUNT_SITES` comment had already called
  `docs/DIGITAL-TWIN-DESIGN.md` *"an archived design document"* whose figure *"is a measurement of that
  document's own moment"* and which is *"right to"* carry it, because *"rewritng them would destroy the
  audit trail"*. The near-miss is the reason this is a rule: `docs/DIGITAL-TWIN-DESIGN.md`'s section 3
  presents a six-row census whose verdicts have **all six** moved - `eli.ts`, `denv.ts`, `esi.ts`,
  `twin.ts`, `import.ts`, `isolation.ts` all now exist - so the correction was one edit away from being
  made, and making it would have rewritten *the argument the plan it sourced exists to answer*. A
  census that shows six open gaps is the only thing that explains why the plan has six work items; a
  census edited to show none leaves a plan with no reason to have been written. *The document that
  argues a plan into existence is not the document that reports whether the plan succeeded* - and the
  tell is a date in the header, because a document that names the moment it measured has already said
  which tense it is in.
