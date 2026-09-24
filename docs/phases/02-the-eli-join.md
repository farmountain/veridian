# Phase 02 -- The ELI join

| | |
|---|---|
| **Status** | next -- nothing blocks it |
| **Depends on** | 01 (the world identity has to be in the bundle before anything can join on it) |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W1); `docs/DIGITAL-TWIN-DESIGN.md` S1-S2 |
| **Touches** | a new `core/evidence/eli.ts` (or `core/metrics/eli.ts`); a new test; `cli/veridian.ts` only if a verb is added |
| **Acceptance** | AC-3 and AC-4 of `docs/DIGITAL-TWIN-PLAN.md` S4 |

## Why this phase exists

The runs on disk are already a ledger. `.veridian/runs/<run-id>/` holds `environment.json`,
`result.json`, the per-criterion observations and the execution log, and two readers already walk it:
`core/run/history.ts` (`listRuns`, `readRunHistory`) reads the history, and `core/metrics/history.ts`
reads the *reading* off disk for M1..M5. What is missing is a single view a reader can ask a question
of -- "every run of this goal against this world, with what each one concluded" -- without writing the
join by hand each time.

`docs/DIGITAL-TWIN-DESIGN.md` calls that view an **ELI**, and its recommendation is deliberately
unexciting: **a join and a name, not a new layer.** The temptation this phase refuses is to build a
fidelity vocabulary, a parallel scoring scheme or a second store. Every one of those would be a second
answer to a question the bundle already answers.

The measured defect the design opens with is the reason the join needs phase 01 first: until
`worldIdentity()` existed, `environment.json` named a run's adapter and could not name its world, so
`sim-cloud`'s substitute provider was recorded and its account was not. A join keyed on "which world"
is a join over a field that did not exist.

## What is already true

- `worldIdentity(plan)` returns `{ kind, name, detail }` or `null`, and `worldLabel()` renders it as
  `cloud:acct-cart` / `cluster:cart-dev` -- **one definition**, because a second spelling of that format
  would be a second answer to "which world is this".
- `serializeEnvironment()` writes the identity into `environment.json`.
- `subjectOf()` in `core/metrics/metrics.ts` already computes the string M1 groups on -- the same
  subject string phases 01 and 09 depend on. **The ELI must reuse it rather than compute its own**, for
  the reason above: two implementations of one rule disagree the first time a world arrives that only
  one of them was written for.
- `listRuns` / `readRunHistory` already enumerate the runs and tolerate the unreadable ones -- over a
  real history the instrument reported `142 runs measured (+7 unreadable)`, so a join that assumed
  every directory parses would be a join that crashes on this repository's own history.

## What this phase does

1. **Define the row.** One row per run, keyed by `runId`, carrying at least: the run id, the goal id,
   the adapter, the world label from `worldLabel()`, the verdict and state, the iteration count, and
   the subject string from `subjectOf()`. Every field comes off a bundle already on disk.
2. **Make the join explicit about what it refuses.** A run whose `environment.json` predates the
   identity field has `null` for its world, and that is a **reading**, not an error to paper over.
   Writing `unknown` would be inventing a rendering for "not declared", which is the parallel
   vocabulary `core/evidence/world-identity.ts` refuses in as many words.
3. **Expose it as a function first**, a verb only if the function is used. `cli/veridian.ts` has a
   `metrics` verb that "reads bundles; starts nothing"; an ELI verb is justified when a reader needs
   it from the command line, and not before.
4. **Test the two properties that decide whether the join is sound:**
   - one row per run, keyed by `runId`, over a synthetic history with more than one goal and more than
     one adapter;
   - **two runs of one goal against one adapter join; two different goals do not.** The negative half
     is the load-bearing one: M1's first version asked its question of a population that mixed
     subjects and printed `M1 result consistency: yes (3 runs)` for three runs that had failed
     different criteria under different contracts. A join that merges two goals would reintroduce that
     with a friendlier name.

## Acceptance criterion

- **AC-3** -- a single call returns one row per run, keyed by `runId`, over a history containing more
  than one goal and more than one adapter.
- **AC-4** -- two runs of one goal against one adapter appear in one group; two runs of two different
  goals do not appear in the same group, and the group count is the goal count.
- A run whose bundle declares no world produces a row with a `null` world rather than a row that is
  dropped or a row that invents a name.

## Falsification probe

Delete the grouping key from the join -- make it group on nothing, or on the adapter alone -- and
expect the AC-4 assertion to fail. Grouping on the adapter alone merges the eleven browserless worlds
with each other and is the closest thing to a plausible mistake here; if the test still passes, it is
asserting a property of the fixture rather than of the join. This is exactly the trap
`docs/INSTRUMENT-AND-PROMPT-PLAN.md` S3A records: the first version of the mixed-population test used
three runs with *identical* signatures, so removing the comparison gate left every assertion passing.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/run-metrics.test.ts` | That the ELI and M1 cannot disagree about what a subject is |
| `tests/evidence-bundle.test.ts` | The bundle's own shape, which the join reads |
| `tests/mcp-demo.test.ts` | That nothing under `core/**` names the MCP surface, and that the eight tools stay eight |

## Context budget

**Read:** `docs/DIGITAL-TWIN-PLAN.md` S4's W1 block only; `core/metrics/metrics.ts`'s `subjectOf`;
`core/run/history.ts`; `core/metrics/history.ts`.

**Do not read:** `docs/DIGITAL-TWIN-DESIGN.md` beyond S2 (the recommendation), and nothing of
`docs/ISOLATION-AND-MCP-PLAN.md`. The twin's import half is phase 08 and its isolation is phase 07.

## Refusals

- **No fidelity vocabulary.** No second score, no confidence number, no "twin-ness" metric. The verdict
  and the evidence are the reading.
- **No new store.** The ELI is a projection over `.veridian/runs/`, computed on read. A cache is a
  second source of truth that disagrees with the bundles the first time a run is deleted.
- **No KARM metric as evidence.** `docs/DIGITAL-TWIN-PLAN.md` S5 refuses this by name: a control
  plane's own output is not a reading of the application.
