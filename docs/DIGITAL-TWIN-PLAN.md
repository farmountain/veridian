# Digital twin - the execution plan

`docs/DIGITAL-TWIN-DESIGN.md` is the argument: what the vision claims, what the tree already holds,
and which six claims are satisfied, partial or missing. This document is the other half. It is the
plan the design's section 7 phases are executed against, written to be unambiguous at the only
level that matters - **the file, the anchor and the assertion**.

It exists for one reason. A phase list that says *"Phase 0: world identity into the bundle"* reads as
complete and decides nothing. The decisions that actually cost time are the small ones: one field or
ten, which seam the completeness signal lands at, whether the import direction can ship, whether a
new vocabulary is needed for fidelity. Each of those is answered below, at a file and an anchor, with
the rung it was resolved at and the probe that would falsify it.

---

## 1. What this adds to the design document

| The design document says | This document adds |
|---|---|
| six claims, each measured | the work item that closes each claim, with its acceptance criterion |
| five phases with ACs derived from M1..M5 | the exact seam each change lands at, and the guard already in the tree that must still pass |
| "do not invent a parallel vocabulary" | what is *extended*, named member by member |
| one falsification probe per AC | what the probe deletes, what must fail, and what must **not** fail |
| the constraint that an imported world is inherited | the lifecycle point the import enters at, and the refusal when it cannot |

It adds no seventh phase. The five are the design's.

---

## 2. The self-prompting recommendations

Every open question this plan had to settle, the rung it was settled at, and why it was not escalated
to the operator. This is the cross-cutting requirement discharged at the design level rather than at
the level of prose: **rung 4 answers from material the run already holds, and only a question it
cannot answer that way is a question for a person.**

| # | Open question | Rung | Grounds | Escalated |
|---|---|---|---|---|
| Q1 | One identity field on `EnvironmentRecord`, or ten - one per world block? | `self_prompted` | A thirteenth world must not widen `EnvironmentRecord`; `BOUNDARY_ENFORCEMENTS` is the precedent for a *value vocabulary* a field carries rather than a field per member. | no |
| Q2 | Which artifact carries the identity - `environment.json` or `result.json`? | `derived` | `EnvironmentRecord`'s own doc header: *"`environment.json`: what world this run measured, so a reader can rebuild it."* The identity is what "which world" means. `result.json` receives it because `serializeResult` embeds the same record, which is why `parseRunSnapshot` already reads `environment["adapter"]` from it. | no |
| Q3 | Is a missing world identity an M5 incompleteness or a validator failure? | `inferred` (`confidence 0.85`) | M5 is defined as required-evidence completeness and is computed from the criteria; the world is not a criterion's evidence, it is the run's subject. M5's *per-run* path is the correct home, and `evidenceCompleteness` exists in two places for exactly this split. | no |
| Q4 | Can the import direction (`M_in`) ship in Phase 3? | `derived` | `docs/ISOLATION-AND-MCP-PLAN.md` section 3.1's measured absence (`node --permission --allow-net` rejected, exit 9) plus design section 6. Importing unvetted state *is* the untrusted-input case; and an imported world is a world the run inherited, which this repository has paid for three times. | no |
| Q5 | Does the ELI need a new persistence layer? | `derived` | `listRuns` and `readRunHistory` already turn `.veridian/runs/*` into readings. The ELI is a join over those, so it adds a module and no storage. | no |
| Q6 | Does fidelity need a vocabulary of its own? | `derived` | `BOUNDARY_ENFORCEMENTS` is already declared-versus-measured with four members. A parallel vocabulary would be the defect design section 5 refuses by name. | no |
| Q7 | Does the Cockpit twin surface ship in this pass? | `deferred` (`reason: "non_blocking"`) | Phases 0-3 are its precondition and the extension is a separate build-stepped tree. Deferred rather than omitted, and the deferral is recorded in the design's section 3.4 rather than here. | no |

**Escalations: zero.** No question required the operator, because every one resolved at rung 1, 2 or 4
from material already in the tree, and the two that could not (Q4, Q7) were answered *no* and
*deferred* - which is the fail-safe direction. This is the honest reading of the operator's
instruction: self-prompting has higher priority, and the way that shows up in a plan is that the
operator is not asked anything.

The one thing this table cannot claim is that the rungs were *executed*. They were not: Q1..Q7 were
settled by reading the tree and the design document, and are recorded here as the grounds for a
decision already taken. A recorded `Resolution` with its rung is the vocabulary the protocol owns;
re-running the ladder over this document would be a good next step and is **not** what happened.

---

## 3. The bounded exit, per lifecycle point

The operator's requirement is that clarification and self-prompting span the whole lifecycle *with an
exit*, so the loop cannot run forever. The vocabulary already carries every bound; what follows is
where each one applies and which value in the tree holds it.

| Lifecycle point | What may be raised there | Bound | Held by |
|---|---|---|---|
| DEFINE (goal, acceptance, environment) | any kind; this is where most ambiguities are raised | `budgetMs` 120000 per document, `maxQuestionsPerRun` 5, `maxQuestionsPerRound` 3 | `DEFAULT_CLARIFICATION_POLICY`, `#askInRounds` |
| Resolving one gap | every rung, ending in `deferred` | `maxSelfPromptRoundsPerAmbiguity` 2 | `#selfPromptFor`, checked **before** each attempt |
| Resolving one gap by self-prompting | rung 4 only | `maxSelfPromptRoundsPerRun` 10 and `selfPromptBudgetMs` 60000 | `#selfPromptFor`, both checked before each attempt |
| The whole clarification phase | all rungs | straight line: no rung is retried except rung 4, whose retries are bounded above | `resolve()`'s ordered walk |
| A headless run | rung 5 | `no_user_available` | `UserPromptPort.available === false` defers instead of blocking |
| A run whose questions exceed the budget | rung 6 | `question_budget_exhausted` | `#askInRounds`'s leftovers, recorded as deferrals and **never a guess** |
| VALIDATE / OBSERVE / EXECUTE | any kind, origin `validation`/`execution` | the run's own `limits.maxIterations` and `limits.maxRuntimeMs` | `RunOutcome.limits`, recorded so a reviewer can *see* the loop was bounded |

**Exit condition, stated as a property rather than a hope:** every path above terminates, and the
termination is *recorded* - `ClarificationReport.budgetExhausted`, `.unresolvedBlocking`,
`.selfPromptRounds` and `.byVia` are counts of work done, not capability flags, and
`Resolution { via: "deferred" }` carries one of `DEFER_REASONS` naming which bound was reached. A run
that exhausts a budget says which budget; it never silently succeeds.

The value this pass does **not** change is `DEFAULT_CLARIFICATION_POLICY`. Two is right for a rung
that grades its own homework, and widening it to "make self-prompting more available" would be the
opposite of the operator's requirement.

---

## 4. Work items

Each item names its files, its acceptance criterion, its falsification probe, and the guard already
in the tree that must still pass afterwards.

### W0 - the world identity survives the bundle

**The defect.** `EnvironmentPlan` carries twelve identity slots: two flat fields (`url`,
`databasePath`) and ten per-world blocks (`api`, `cluster`, `posix`, `os`, `cloud`, `container`,
`vscode`, `process`, `data`, `mobile`). `EnvironmentRecord` declares none of them,
`environmentRecord()` copies none, and `serializeEnvironment()` writes fifteen keys with no block
among them. Only `local-web` and `local-db` remain identified, through the flat fields. A `sim-cloud`
bundle can name its adapter and cannot name its account.

**Files.** `core/evidence/types.ts` (`EnvironmentRecord`), `core/evidence/writer.ts`
(`environmentRecord`, `serializeEnvironment`), `core/evidence/index.ts` (barrel), new
`core/evidence/world-identity.ts`.

**AC-1.** For all twelve registered worlds, the `world` written into `environment.json` names the
kind and the name the plan's own block declares.

**AC-2.** A run whose bundle cannot name its world is **incomplete under M5**, on both the per-run and
the aggregate path, and the missing entry names the run.

**Probe.** Delete the `world` key from `serializeEnvironment` and run
`tests/world-identity.test.ts`: the guard reads both the plan's block list and the serializer's keys,
so it must fail **naming the world**, not merely fail. Then delete one branch of the derivation and
confirm the guard names that kind.

**Must still pass.** `tests/docs-roster.test.ts`, `tests/observation-vocabulary.test.ts`, and every
existing bundle test.

### W1 - the ELI as a join

**Files.** new `core/evidence/eli.ts` (or `core/metrics/eli.ts` if it must read snapshots), barrel.

**AC-3.** Every run on disk contributes exactly one row, keyed by `runId`.

**AC-4.** Two runs of one goal on one adapter join; two different goals do **not**. The join reuses
the subject string M1 already computes, so the ELI cannot answer a question M1 refuses.

**Probe.** Group a mixed history and confirm the ELI reports two subjects, then change
`RunSnapshot.goalId` to `null` for one run and confirm it becomes a third subject rather than joining.

### W2 - dENV and the export predicate

**Files.** the ELI module, plus a predicate extending `BOUNDARY_ENFORCEMENTS`' shape.

**AC-5.** dENV is empty across a clean reset.

**AC-6.** The export predicate is **total** over the record, it refuses a named key set, and a refused
value never reaches an exported artifact - proven by a **known-present control** in the same run,
per design section 0's method rule.

### W3 - the ESI interchange document, export only

**Files.** the ELI module, plus `core/metrics/import.ts` for the half that does not build anything.

**AC-7.** Export then import yields a byte-identical `environment.json` identity block and a dENV of
zero. **Met**, both directions, by `tests/world-import.test.ts`.

**AC-8.** An import is staged at `prepare()`. An import presented as a live world must give
`INCONCLUSIVE`, never `PASS`. **Met**, and the refusal is above the step that creates the world rather
than beside it, so a plan that declared an adoption and did not get one never reaches `create`.

**Not in scope.** `M_in` against real external state. Design section 3.5 makes isolation a
precondition, not a sibling - and the precondition now exists (phase 07), so this item is buildable
rather than blocked.

### W4 - surfaces

**Files.** `extension/vscode/`.

**AC-9.** A twin panel reads the ELI, and the extension gains **no** validation logic - the Cockpit is
a thin client over a stable local Core interface. **Met.**

**Was deferred** until W0-W3 were green, on design section 3.4's measurement - and they are green, so the
deferral has expired rather than been abandoned. It landed as phase 05 of the phase program:
`extension/vscode/src/twin.ts` reads the join and renders it, and AC-9 is held by reading that module's
imports rather than by asserting good intentions about them. Worth keeping beside the status: the
deferral's *reason* was that a surface built over a join that does not exist can only be built over a
guess about the join, so the order was the substance of the item rather than scheduling around it.

---

## 5. Order, and what this plan refuses

```
W0 -> W1 -> W2 -> W3 -> (W4)
```

W0 first because it is one field, two write sites and two guards, and because W1 cannot join on an
identity that does not survive the bundle. W3's import half stays out until the isolation substrate
exists.

**That gate has been cleared, and the sentence above is kept as the order this was built in rather than
as a current restriction.** The substrate landed as phase 07 of the phase program
(`core/environment/isolation.ts`), and the import half landed as phase 08
(`core/metrics/import.ts`), so the sequence W0 → W1 → W2 → W3 → (W4) is complete. One thing the
sequence did not anticipate and that is worth recording here, because it changes what "the import
half" means: **the delivered import is a verification, not a materialisation.** It compares the identity
an ESI document names against the identity the operator's own plan derives, refuses when they differ,
and the world is then built by the adapter that would have built it anyway. So an import cannot
construct a world - which is the property that makes it safe, and which is why it *could* land without
the isolation substrate it was gated on. The gate was cleared rather than jumped: the phase that built
it recorded that the materialising reading of this work item is the dangerous one.

This plan refuses, by name:

- a parallel vocabulary for fidelity, sanitization, snapshot or lifecycle (design section 5);
- any change to `DEFAULT_CLARIFICATION_POLICY`'s bounds;
- an import path that does not pass through `prepare()`;
- a twin surface in the Cockpit before Core exposes the join;
- any KARM metric presented as evidence, because KARM was unavailable when the design was written and
  no run in this pass produced one;
- rebuilding or repackaging the published `.vsix` unless the operator asks.

## 6. What the exit condition is, and is not

The twin is **aligned**, not delivered, when `environment.json` names its world for all twelve worlds
(AC-1), the ELI joins existing bundles without new persistence (AC-3), dENV is computable and zero
across a clean reset (AC-5), and the export predicate refuses a named key set with a probe that proves
the refusal (AC-6).

The import half was **outside** the exit condition until isolation was available - a statement about the
isolation substrate rather than about the twin - and **it is now inside it**, because both conditions
have been met: the substrate is phase 07 and the import is phase 08. The five acceptance criteria above
plus **AC-7** (round trip byte-identical in both directions) and **AC-8** (staged at `prepare()`, or
`INCONCLUSIVE` and never `PASS`) are therefore all met, each held by a suite that was falsified before it
was trusted: `tests/world-import.test.ts` for AC-7 and AC-8, with AC-8's probe measured by disabling the
refusal in `core/environment/manager.ts` and reading `17 pass / 1 fail` on exactly the named subtest.

**What this does not do is close the twin.** W4's Cockpit surface was deferred behind W0-W3 and has since
landed as phase 05, so the phase list is complete; what remains open about the twin is not a work item
but a property - an adopted world's *isolation* is phase 07's subject rather than this plan's, so a twin
that verifies where a world came from says nothing about where that world's work then runs.
