# Phase 01 -- Land the working tree

| | |
|---|---|
| **Status** | in flight -- the code exists and is uncommitted |
| **Depends on** | -- |
| **Source** | `docs/INSTRUMENT-AND-PROMPT-PLAN.md` S3, S3A, S4, S5, S6; `docs/DIGITAL-TWIN-PLAN.md` S4 (W0) |
| **Touches** | the modified files below, plus `core/evidence/world-identity.ts` and three new documents |
| **Acceptance** | `npm run gate` exits 0, `npm run acceptance` passes twice, and the counts in prose match the run |

## Why this phase exists

The working tree carries two finished pieces of work that no commit records. Measured with
`git diff --stat` and `git status --porcelain`:

```
12 files changed, 443 insertions(+), 50 deletions(-)
AGENTS.md                             10
README.md                              8
core/clarification/engine.ts          12
core/clarification/types.ts            9
core/evidence/index.ts                 2
core/evidence/types.ts                16
core/evidence/writer.ts               53
core/metrics/metrics.ts               44
docs/INSTRUMENT-AND-PROMPT-PLAN.md    22
tests/clarification-ladder.test.ts  +259
tests/evidence-bundle.test.ts         49
tests/schema-vocabulary.test.ts        9

untracked:
core/evidence/world-identity.ts
docs/DIGITAL-TWIN-DESIGN.md
docs/DIGITAL-TWIN-PLAN.md
```

An unlanded tree is not a neutral state. Every phase after this one would be building on a base that
`git stash` can remove, and the measurements it reports would describe a tree nobody else can check
out. This tree has already recorded what that costs in a smaller form: a probe whose cleanup failed
left a stray zero-byte `bundle.test.ts` at the repository root, and **an empty file is still a test to
a discovery runner**, so a failed probe had added a test to the very count it was measuring.

## What is already true

Two independent bodies of work are in the tree, both with their falsification recorded in prose:

- **The instrument repairs** (`docs/INSTRUMENT-AND-PROMPT-PLAN.md`). M3's false-PASS count is scoped by
  subject, the same rule reaches M2, M4's two conflated properties are split, and the per-iteration
  `rollup` carries the preparation's own `prepared.ok` rather than a literal `true`. `metrics.ts` grew
  44 lines, the ladder engine 12, and the three test files above hold the new properties.
- **World identity in the bundle** (`docs/DIGITAL-TWIN-PLAN.md` W0). `core/evidence/world-identity.ts`
  derives a world's kind and name from the plan's twelve identity slots -- two flat fields and ten
  per-world blocks -- because *the plan is the only thing every world has in common*. Its guard is not
  a new file: it is the assertion in `tests/evidence-bundle.test.ts` that counts a world the record
  declared and the written document dropped, and expects `world:web:http://127.0.0.1:4173`.

## What this phase does

1. **Read the diff before committing it.** `git diff` and the untracked file, in full. A commit whose
   message describes work the diff does not contain is the defect this phase's own acceptance
   criterion is written against.
2. **Run the gate.** `npx tsc --noEmit` is silent when clean; `node --test` reports the whole suite.
   Both figures are recorded **at the moment they are taken**, not recalled.
3. **Run the self-acceptance contract.** `npm run acceptance` runs its contract twice inside one
   invocation and exits 1 when the two disagree. It is the only check in the tree that reads the CLI
   as a program rather than as a module, and the repairs above touch `core/metrics/metrics.ts`, which
   the compiled artifact also carries.
4. **Correct the four live prose sites** that carry the suite counts, in this pass:
   `AGENTS.md`'s status banner, `AGENTS.md`'s build block, `README.md`'s quickstart fence and
   `README.md`'s layout table. Four sites, because a number in prose is a claim that the very commit
   which changes it falsifies.
5. **Add the missing Documentation rows.** `docs/DIGITAL-TWIN-DESIGN.md` and
   `docs/DIGITAL-TWIN-PLAN.md` are untracked and unindexed, and
   `tests/docs-roster.test.ts` fails when a file in `docs/` has no row in `AGENTS.md`'s table. Phase
   11 owns the *audit* of that table; this phase owns the minimum that keeps the guard green.

## Acceptance criterion

- `git status --porcelain` is empty.
- `npm run gate` exits 0, and the test and suite totals it printed are the totals written into the
  four prose sites.
- `npm run acceptance` prints `run 1: exit 0 - PASS` and `run 2: exit 0 - PASS`.
- `node --test tests/docs-roster.test.ts` exits 0.

## Falsification probe

Revert one repair and watch the tree say so, then restore it byte for byte.

- **The instrument.** Make `falsePasses()` stop calling `subjectOf()` -- that is the defect
  `docs/INSTRUMENT-AND-PROMPT-PLAN.md` S1.1 exists to describe -- and expect the M3 subtests in
  `tests/run-metrics.test.ts` to fail by name. If they do not, the guard was never holding the rule.
- **The world identity.** Delete `worldIdentity()`'s `cloud` branch and expect
  `tests/evidence-bundle.test.ts`'s dropped-world assertion to fail naming the world it lost.

A probe that cannot name the test it breaks is not a probe. The harness must decide each file's line
ending **from the file it is about to edit** and print what it detected, because a skipped probe does
not fail -- it silently reduces coverage, and this repository has paid for that three times
(`docs/GAP-CLOSURE-DESIGN.md` S12.6).

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/run-metrics.test.ts` | M1's subject grouping, M3's three states, M2's exclusion from the CLI exit predicate, and the falsified-metrics probes |
| `tests/execution-loop.test.ts` | The PASS clause carrying its reading, and the boundary crossings surviving a reset |
| `tests/evidence-bundle.test.ts` | The bundle never lying by omission, including the world it declared |
| `tests/schema-vocabulary.test.ts` | The rung vocabulary and the ambiguity schema, read through `oneOf` const branches rather than `enum` |
| `tests/clarification-ladder.test.ts` | The per-gap bound reached, and the per-run cap of zero spent before it is checked |
| `tests/boundary-roster.test.ts` | Twelve adapters, each classified, each with a register entry |
| `tests/docs-roster.test.ts` | Every document indexed, every index row real |

## Context budget

**Read:** `git diff` for the twelve modified files; the three test files; `core/metrics/metrics.ts`;
`core/evidence/world-identity.ts`.

**Do not read:** `docs/DIGITAL-TWIN-DESIGN.md` and `docs/ISOLATION-AND-MCP-PLAN.md`. Neither is
touched by this phase, and phase 02 onward read them by section.

## Refusals

- **Do not squash the two bodies of work into one commit.** They are separate claims -- one about the
  instrument, one about the bundle -- and a reader auditing a verdict needs to be able to revert one
  without the other.
- **Do not commit `dist/`, `out/` or `*.vsix`.** All three are generated and ignored; a committed
  archive is a binary nobody can diff against the extension it claims to be.
- **Do not "fix" a red gate by editing the assertion.** `docs/GAP-CLOSURE-DESIGN.md` records both
  directions of that mistake; read the failure message before choosing a hypothesis.
