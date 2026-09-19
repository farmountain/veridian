# Instrument integrity and prompt coverage

This document is the plan the current work is executed against, and the audit trail of what
executing it decides. It closes two different classes of gap and is written as one plan because
both were found by the same act: **running Veridian's own instrument over the runs Veridian had
already produced, and reading the answer rather than the intention.**

- **The instrument** - the **four** ways `veridian metrics` reported something that was not true
  about the runs on disk (W-A, which turned out to have two sites rather than one, plus W-B and
  W-C). The fourth was the plan's own omission and is recorded in §3A rather than folded into
  W-A's section, because it was found by a different act - comparing two metrics against each
  other rather than reading either against the product.
- **The prompt** - whether the clarification ladder's self-prompting rung is reachable at each
  point in the lifecycle where an unknown can arise, and whether its exit is bounded (W-D).

Read [`PLAN.md`](./PLAN.md) for the product rule these metrics measure, and
[`BOUNDARY-ENFORCEMENT.md`](./BOUNDARY-ENFORCEMENT.md) for the earlier instance of the same
defect class: a rule that was recorded rather than applied.

---

## 1. What the measurement found

`node cli/veridian.ts metrics --defects AC-001,AC-002,AC-003` over the 149 run directories on
disk, exit **1**:

```
runs measured: 142 (+7 unreadable)
M1 result consistency: INCONCLUSIVE (142 runs over 14 subjects: ...)
M2 defect detection: 3/3
M3 false PASS: 117
M4 reset reproducibility: no (304 resets recorded)
M5 evidence completeness: 6744/6744 criteria (100%)
```

`142 measured + 7 unreadable = 149` reconciles with the directory listing, so the population is
the whole history and not a sample of it.

**Three of those five lines are wrong, and they are not all wrong in the same direction.** The
block above is the reading as it was taken, and it is left as it was taken. `M3` and `M4`
over-accused the product, and *that* is the direction this section was written about: a metric that
over-reports trains its reader to skip it, which is the failure mode this repository has already
paid for at the capability report that warned about the `json` artifact it had just written. `M2`
is the third, and **its error runs the other way** - it *credited* a detection no run had
established and read as a clean bill, which is why it survived the first pass: an over-accusation
is loud and gets read, and an over-credit is silent and gets believed. It was found by comparing
M2 and M3, which read the same caller-supplied list and answered it differently, rather than by
reading either one. §3A is what it cost.

That leaves `M1` and `M5` right - see §1.3.

### 1.1 M3 reports 117 false PASS, and the product's number is 0

`falsePasses()` (`core/metrics/metrics.ts`) iterates every run, and for each run with
`verdict === "PASS"` asks whether any criterion named in `expected` "never failed". The `expected`
list comes from `--defects AC-001,AC-002,AC-003`, and **a criterion id is a name inside one
contract**. The list is therefore meaningful only for the goal whose contract declares those ids,
and it is currently applied to every run of every goal in the population.

Measured decomposition of the 129 `PASS` runs:

| Reading | Count |
| --- | --- |
| `PASS` runs | 129 |
| `PASS` runs with required evidence missing | 0 |
| `PASS` runs accused of blessing a known defect | 117 |
| `PASS` runs not accused | 12 |

The 117 span **twelve** subjects and none of them is `shopping-cart@local-web`:
`veridian-mvp@local-process` 32, `local-process@local-process` 13, `veridian-cockpit@sim-vscode`
12, `sim-container` 11, `sim-k8s` 7, `sim-mobile` 7, `sim-posix` 6, `sim-os` 6, `sim-cloud` 6,
`sim-vscode` 6, `sim-data` 6, `local-api` 5. That sum is 117 exactly.

The decisive experiment reuses the shipped function rather than re-deriving its answer:

```
falsePasses(runs of shopping-cart@local-web, ["AC-001","AC-002","AC-003"])  ->  0
```

**So the product property holds and the instrument disagrees with it.** `PLAN.md` §33 asks for
zero false PASS; the twelve runs that could have produced one produced none, and the 117
accusations are all aimed at runs of other goals whose contracts reuse the ids `AC-001`,
`AC-002`, `AC-003` for unrelated claims.

The root cause is visible in the same file: `subjectOf()` was written for exactly this, and M1
calls it. M3 does not.

### 1.2 M4 reports `no`, and the report conflates two properties

`resetReproducibility()` has two branches in one loop and returns one `reproducible` flag for
both:

- **(a)** `run.resets < last - 1` - the reset property: `n` iterations need `n - 1` resets, and
  the count comes from the environment's own recorded transitions rather than from a belief that
  a reset was requested.
- **(b)** `run.iterations.length > 1 && !run.environmentValid` - the world was recorded invalid
  at the end of a run that observed more than one iteration.

Measured:

| Branch | Fires | Detail |
| --- | --- | --- |
| (a) the reset property | 0 | holds for **142 of 142** runs |
| (b) validity at exit | 1 | `run-20260916-114813-ded994` |

`ded994`'s own `result.json` was read rather than inferred: `state: ABORTED`,
`verdict: INCONCLUSIVE`, `iterations: 3`, `environmentValid: false`. It took the **reset-failure
abort path** (`core/execution/loop.ts`, the `!reset.ok` branch), so its detail string -
*"re-observed after a reset while the environment was not valid"* - is false about it: the run
did not re-observe anything after the failing reset. It stopped because the reset failed, which
is the behaviour the product wants.

**M4's `no` is therefore a false alarm by construction.** The reset property it names is 142/142,
and the single violation is a correct abort labelled as a reproducibility failure.

This also **refutes an earlier hypothesis** this work carried: that `ded994` was evidence the
per-iteration `rollup` call was being handed a value it should not be. It was not. The
measurement killed the causal story, and the story is recorded here rather than dropped because
the next reader will have the same idea.

### 1.3 Two lines that are right, and one that is unmeasurable

`M1` refuses a mixed population rather than comparing one - correct, and it names the 14 subjects
it found. `M5` is 6744/6744. Those are the two, and the heading used to say three because `M2`
was counted among them; §3A is where that was corrected, and the correction is recorded rather
than smoothed over because a count in prose is exactly the kind of claim nothing reads.

`M2` is deliberately not a clause of the CLI's exit condition, because without `--defects` it has
no ground truth and an unmeasurable metric must not be able to fail a command. **Scoping M2 did
not change that**, and it should not have: the reason M2 is not an exit clause is that it is
unmeasurable without ground truth, and a metric that *is* measurable over the whole history is
still unmeasurable when nobody named a defect. What scoping changed is what `3/3` *means* - and on
this history it means nothing, which is what §3A records.

---

## 2. Decisions of record

Three decisions were taken autonomously, against the repository's own rules as the tiebreaker.

**D-1: the instrument is repaired, the product is not.** M3's product number is 0 and M4's reset
property is 142/142. Nothing in the run engine is changed to make a metric read better. A metric
that is repaired by changing the thing it measures has measured nothing.

**D-2: the ground truth stays a caller-supplied list, and it gains a subject.** `--defects` is
ground truth; Veridian cannot derive it, because a bundle records what was observed and not what
was intended. The repair is not to remove or narrow the flag. It is to make it **scoped**, and to
make the report **say which subject it scoped to** so a reader can never mistake a scoped `none`
for a whole-history one.

**D-3: W-C is a provenance change, not a behaviour change, and it is reported as one.** See §5.
It is included because the field it touches is one of the four `PASS` clauses in `PLAN.md` §18,
and because the justification for its current value is written down nowhere.

Two premises this work carried in were checked against the code and corrected rather than
carried:

- *"M4 does not print its violations."* It does - `formatMetrics` prints each one. The claim was
  false.
- *"`environmentValid: true` in the loop is a guard no code path can trip."* It is tripped, twice:
  at the prepare failure and at the reset failure. What is true is narrower, and is stated in §5.

---

## 3. W-A: scope M3's findings by subject

**Site:** `falsePasses()` and `FalsePass` in `core/metrics/metrics.ts`.

**Repair.** Reuse the existing private `subjectOf()` - do not write a second derivation of "what
is this a reading of", because two implementations of one rule disagree the first time a world
arrives that only one of them was written for. M1 and M3 must answer the subject question with
one function.

**The flag gains a subject.** `MetricOptions` carries the subject the `expected` list belongs to.
When it is absent and the population spans more than one subject, M3 reports **unmeasured** and
names the subjects - it does not fall back to the whole-history behaviour it has now, and it does
not narrow silently.

**`FalsePass` gains a `subject` field** so a finding names the goal and world it is about, not
only the run id. A run id is derived from a timestamp; the subject is what makes the line
actionable.

**`formatMetrics` gains a fourth M3 state.** The three it has are: findings printed; `INCONCLUSIVE`
because nothing was named; `none`. The fourth is **`INCONCLUSIVE` because the named defects belong
to a subject this history does not contain (or contains beside others)** - which is a different
sentence from "no defects were named" and must read as one.

**The CLI clause was expected to need a guard, and the expectation was wrong.** `cli/veridian.ts`'s
exit predicate contains `metrics.falsePasses.findings.length > 0`, and the plan predicted it would
have to gain the same `measured` shape line above it already uses for M1 - *"only an answered
finding is a violation."* Implementing the scoping showed that guard is **already inside the
report**: `falsePasses` returns an empty `findings` list whenever it declined to look, so a
finding is by construction an answered reading and the predicate cannot be reached by an
unmeasured one. The clause is therefore left exactly as it was, and that is a deliberate decision
rather than an oversight - the 117 accusations disappear because the *report* stopped making them,
not because the exit predicate learned to ignore them.

The distinction matters because the two are not interchangeable. A guard in the predicate would
make the CLI refuse to act on a finding the report was still willing to state, so the printed
output and the exit code would disagree about whether the history had a problem. *Guard the
reading, not the reader* - and if a reader ever does need its own guard, the finding it is
guarding was already wrong.

**Interface change to `successMetrics`:** M3's report becomes an object carrying at least
`measured` and `findings`, mirroring `ConsistencyReport`'s three-states-documented shape rather
than continuing to be a bare array. A bare array cannot say "I did not look".

### 3A. W-A's second site: M2's ground truth was not scoped either

**Site:** `defectDetection()` and `DetectionReport` in `core/metrics/metrics.ts`.

This site was not in the plan. It was found by running the repaired M3 beside the unrepaired M2
and reading the two lines together:

```
M2 defect detection: 3/3
M3 false PASS: INCONCLUSIVE (3 named defect(s) over 14 subjects: ...)
```

**One caller-supplied list, two metrics, and they answered it differently.** M3, repaired a
paragraph earlier, *refused* to compare - it named all fourteen subjects and declined. M2, reading
the same `--defects AC-001,AC-002,AC-003` and the same population, printed a clean `3/3`.

**M2 was right about its arithmetic and wrong about its question.** `defectDetection` tested
`runs.some((run) => observedFailing(run, criterionId))` over the **whole** population, so a
criterion id failing under any subject credited that id's detection under every subject. Over this
history `AC-001` fails in `inventory-db`, `veridian-mvp`, `local-process` and nine other goals -
so all three ids counted as detected, and `3/3` was produced without `shopping-cart` ever being
looked at.

**The failure directions are opposite, and that is why the asymmetry is the finding rather than a
detail.** M3 *accused* 117 healthy runs and was spotted at once, because an accusation is loud.
M2 *credited* three detections no run under the named subject had established, and it read as the
best line in the block - so it was read as the one line that was certainly right, and it was the
second one that was wrong. **A metric can be wrong by being too kind**, and the kind direction is
the one that survives a reading pass.

**The repair is the same rule M3 already uses, applied to the second report rather than copied
into it.** `subjectOf()` is the one derivation; `defectDetection` gained the same
`expectedSubject` parameter, the same `measured` three-state, and the same `subject`/`subjects`
fields on its report, so the two metrics cannot answer the subject question differently again.
`formatMetrics` gained a fourth M2 state to match M3's - `INCONCLUSIVE` because this history does
not hold the named subject - because a report whose two halves refuse for two different reasons
must be able to say which refusal it is.

**M2 remains outside the CLI's exit predicate, and scoping did not change that.** Its absence was
never about being unscoped; it is that M2 is unmeasurable without ground truth, and a scoped
metric is still unmeasurable when no defect was named. The absence is now held by a test rather
than by a sentence: `tests/run-metrics.test.ts` asserts an unmeasured M2 is not a violation, and a
second one asserts a *scoped* M2 is not either.

**Everything here was falsified rather than trusted.** Four probes, each patch → run → restore,
each scored by the failing **test titles** it produced rather than by a substring, and each
restored byte for byte afterwards: restoring the unscoped `filter`, widening `measured`, ignoring
the caller's `subject`, and dropping the empty-`missed` branch on an unmeasured read. They fired
as a group with the two W-B probes in one harness run - *six of six* - which is recorded in §8.

---

## 4. W-B: split M4's two properties

**Site:** `resetReproducibility()` and `ResetReport` in `core/metrics/metrics.ts`.

**Repair.** Branch (a) keeps the name `resetReproducibility` and the `reproducible` flag,
because the reset property is what that name means and it is measured. Branch (b) becomes a
separately-named report - `worldValidityAtExit` - because *"the world was valid when the run
ended"* and *"the world was rebuilt between observations"* are two properties with two different
repairs, which is the same argument `sim-os` already records for splitting `owner`, `acl` and
`access`.

**Branch (b) must distinguish its two causes.** *"The world was recorded invalid while the run
continued"* is a defect. *"The run aborted because the world could not be rebuilt"* is the product
working. The report reads the run's own `state` to tell them apart rather than inferring from
`environmentValid` alone, because `false` is the honest value in both cases and only the state
says which happened.

**The CLI clause is revisited.** `!metrics.reset.reproducible` stays, because the reset property
is a real property and one violation must still fail the command. The new report is **not** added
to `violated`, because on this history its single finding is a correct abort; if it is ever
promoted to a violation it must be promoted on the strength of a case where a run continued in an
invalid world, and no such case exists here.

---

## 5. W-C: carry the `environmentValid` reading

**Site:** the per-iteration `rollup({ ... })` call in `core/execution/loop.ts`.

**What is measured.** `rollup`'s `environmentValid` guard is live: with it false, `rollup` returns
`INCONCLUSIVE` with an `ENVIRONMENT_FAILURE` before it looks at any criterion. It is reached with
`false` on two paths - the prepare failure and the reset failure - so this is **not** a guard no
code path can trip.

**What is also measured.** On the path that reaches the per-iteration call, validity is a
precondition the loop has already enforced:

- `EnvironmentManager.prepare()` returns `ok: false` when the health check fails, and the loop
  aborts on that before its first iteration.
- `EnvironmentManager.reset()` returns `ok: false` when the health check fails after the reset,
  and the loop aborts on that before its next iteration. **A reset that returns `ok` is a reset
  that re-passed its own health check.**

So the value at that call is `true` on every path that reaches it, and the literal is currently
equivalent to the reading. **This repair changes no verdict anywhere.**

**Repair.** Pass `prepared.ok` - the same reading the bundle already records, through the same
`envRecord()` accessor - rather than the literal `true`, and write the entailment down at the
site, naming the two manager guarantees it rests on. The point is not that the value differs; it
is that a field `PLAN.md` §18 names as a `PASS` clause should *carry* the reading it came from.
If a world ever gains a way to become invalid **without** aborting, the place that value is
produced is already a reading and already has the comment explaining what would have to change.

**The stated limits of this repair, so it is not over-claimed:**

- It does not close a false `PASS`. No run observed a wrong verdict because of it.
- It does not change behaviour. Both spellings are `true` on every path that reaches the call.
- It is **not** justified by the earlier hypothesis about `ded994`, which was refuted in §1.2.

---

## 6. W-D: the self-prompting rung, per lifecycle point, with a bounded exit

**The mechanism exists and is not being rebuilt.** `core/clarification/` holds a six-rung ladder -
`derived`, `inferred`, `defaulted`, `self_prompted`, `answered`, `deferred` - where rung 4 is the
run answering its **own** gap from material it already holds. That rung is the reason a run can
resolve a gap without asking anyone.

**Measured coverage of the rungs:**

```
derived=2281   defaulted=454   self_prompted=0
```

Rung 4 has never fired on this history. That is a finding about **reachability**, not a missing
feature, and the honest response is to say so rather than to manufacture a seam that exercises it.

**Workstream.** For every lifecycle point where an unknown can arise - goal definition, acceptance
criteria, validation planning, test planning, environment requirements, and the run loop's own
runtime questions - record in this document, as a measurement at a file and an anchor:

1. **whether a detector exists there at all**;
2. **whether rung 4 is reachable there** - which is answered by whether the point supplies a
   self-prompt port, because a rung with no port is a rung that returns `null` and defers;
3. **what the exit is** - the per-gap cap, the per-run cap and the wall-clock ceiling, and which
   of those is the one that actually terminates the attempt;
4. **what the fallback is** when the point declines - a decline must be a recorded reason, not a
   silence.

**The exit must be checked at the placement, not merely present.** The per-run round budget is
spent *before* a round is granted, which is what makes the worst case a bound that was already
reached rather than one that is one over. Any guard written for this must include a case where the
cap is **already zero**, because a guard built only from positive caps cannot see the placement of
the check - the difference between before and after the increment only appears at the degenerate
input.

**No new host is invented.** Where a point has no port, the finding is recorded as a gap with its
reason, in the shape `ISOLATION-AND-MCP-PLAN.md` already uses for the deferred isolation
substrate: an absence that is a measurement rather than a promise.

---

## 7. What this plan does not claim

- **It does not claim M1 is repaired.** M1 already refuses a mixed population and names the
  subjects. Its `INCONCLUSIVE` is a correct answer to a question this history cannot pose.
- **It does not claim a run engine defect was fixed.** §1.2's refuted hypothesis is recorded so
  the next reader does not re-derive it; nothing in `core/execution/` changes behaviour.
- **It does not claim the self-prompting rung is broken.** It is unimplemented *at the points that
  would reach it*, which is a different claim, and §6 measures which points those are.
- **It does not guess a command, a path or a count.** Every figure above was read off a run, a
  bundle or a file, and each is dated by the section that measured it. A figure whose movement is
  not measured is only ever restated, which is why the suite counts in `AGENTS.md` are re-measured
  in the same pass as the change that moves them.

---

## 8. Falsification

Every repair is held by a test that **fails when the rule is broken**, and each such test was
falsified by breaking the rule on purpose before it was trusted. The two shapes this repository
has already paid for apply directly:

- **A test that passes whether or not the rule holds is not a test.** The existing M3 suite uses
  single-element fixture arrays, which is exactly why the mixed-population defect was invisible to
  it. The new fixtures must include a **mixed-subject population** whose signatures are not
  byte-identical - a fixture where two subjects happen to produce identical signatures would let
  the guard be removed with every assertion still green, which is the shape the M1 guard's own
  first test had.
- **A positive control is required beside every negative one.** "M3 found nothing" is only evidence
  if the same machinery, asked the same question of one subject, *does* name a delta. Each new
  suite carries that control.

| Repair | Probe that must fail the named subtest |
| --- | --- |
| W-A scoping | restore the unscoped `expected` filter |
| W-A unmeasured state | widen the measured flag so an unmeasured M3 counts as clean |
| W-A CLI guard | drop **M1's** `measured` clause from the exit predicate |
| W-A M2 scoping | restore the unscoped `named` filter in `defectDetection` |
| W-A M2 unmeasured | widen M2's `measured` flag so it counts an unmatchable subject as measurable |
| W-A M2 caller's subject | ignore `expectedSubject` and re-derive the subject from the population |
| W-A M2 empty-on-unmeasured | report `missed` for a population M2 refused to measure |
| W-B split | merge branch (b) back into `reproducible` |
| W-B cause | report the correct abort as "continued in an invalid world" |
| W-C provenance | restore the literal `true` (see below - the *behavioural* suite stays green **and the source guard is expected to fire**) |

**The `W-A CLI guard` row names M1's clause, and the plan originally named M3's.** The exit
predicate has no M3 clause to guard: `falsePasses` returns an empty `findings` list whenever it
declines to look, so the guard lives in the report and the predicate is already unreachable from
an unmeasured reading (§3). "Drop the `measured` clause" therefore has exactly one meaning in that
function, and it belongs to M1 - the clause the predicate genuinely does not carry, because M1's
report exposes a `measured` flag and a *consumer* has to read it. A probe aimed at an M3 clause
that does not exist would have been a probe that cannot fail, which is the shape §8's own first
bullet refuses.

**Six of these ten rows were executed in one harness run, and all six fired.** The four M2 rows
and the two W-B rows were probed together, patch → run → restore, with the verdict computed from
the failing **test titles** rather than from a substring, and both files restored byte for byte. A
probe that scored itself by searching the output for a phrase would have reported the wrong
verdict: the failing assertions are `assert.equal(report.measured, false)`-shaped, and the reason
strings the refusal path builds are never reached by the coverage that breaks it. *A probe is
falsified by the test it breaks, not by a string it searches for.*

The last row is not a mistake, and its parenthesis is the part that was corrected. W-C changes no
behaviour, so **no behavioural test can hold it** - which is precisely the claim §5 makes, and a
probe that failed a behavioural subtest would refute §5. It is held by a test that reads the
source: the per-iteration `rollup` call must not carry a literal, and the comment naming the
entailment must be present, the same way `tests/sim-data-demo.test.ts` holds a readiness pattern
against a template and `tests/demo-rosters.test.ts` holds a roster against the manifest.

**That source guard is expected to fire, and it was measured rather than assumed.** Restoring the
literal moves the whole-tree run from `2551 pass / 0 fail` to `2550 pass / 1 fail` - one subtest,
the source guard, and nothing else. So the honest form of this row is two claims in one: the
*source* guard fires (measured, one subtest) and no *behavioural* subtest does (measured, zero).
Writing it as "must leave the suite green" conflated the two and would have been refuted by a
correct probe; the distinction is the whole reason §5 is justified by a source guard rather than
by an untestable assertion about a value that never differs.
