# Phase 09 -- Documentation currency

| | |
|---|---|
| **Status** | next -- nothing blocks it, and it is the release valve for every other phase |
| **Depends on** | 01 |
| **Source** | `docs/GAP-CLOSURE-DESIGN.md` S4 (W3) |
| **Touches** | `AGENTS.md`, `README.md`, `extension/vscode/README.md`, `docs/*.md`; no source file except to **read** it |
| **Acceptance** | every vocabulary a document prints matches the code, and every count is re-measured at edit time |

## Why this phase exists

This repository has one recurring defect class, and it is not a code defect. It is recorded in `AGENTS.md`
under four separate names, and it is the same shape each time:

> **A document that prints a vocabulary must print every member in full, and a list of names in a
> document is read by nothing that could disagree with it.**

The measured instances, each one found by a guard or by a count rather than by reading:

| What drifted | Where it lived | What found it |
|---|---|---|
| `db.query` | `README.md`, `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`, and `AGENTS.md`'s own layout table | a new suite's first assertion, which pinned `registry.names()` to the four the code exports |
| `db.rowCount` | a document | the schema's `^[a-z0-9]+(\.[a-z0-9]+)+$` -- a name no contract could *express* |
| `web.visible` | implemented, exported, registered, and named by no document | `tests/readme-rosters.test.ts` on its first run |
| the observation vocabulary | both the `core/environment/` layout row and the README's layering paragraph -- **one family short while each clause carried its own ordinal** | `tests/observation-vocabulary.test.ts` |
| `sim-posix` substituting "Kali's attack network" | `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` S5 | comparing the two lists; the constant says egress is **refused** and names four surfaces the cell omitted |
| "the twelve `demo:*` scripts" | `docs/GAP-CLOSURE-DESIGN.md` | counting `package.json`'s `demo*` scripts -- **fourteen** |
| "one of seven kinds" | `README.md` | `STEP_KINDS` holds **eleven** |
| the layering rule | stated in **six** places; **five** were stale | a grep for the rule's spelling, which found two of the five only after the pattern was widened to the *exclusive marker* "the only layer" |
| the Documentation table | `AGENTS.md` -- `docs/` gained an eighth file while the table listed seven | `tests/docs-roster.test.ts` |

Three of those were found by **counting**, not by reading. Two were found only by **widening the
search**. That is the phase.

## What is already true

The guards mostly exist. What does not exist is a pass that runs them **as a programme** and repairs what
they report, and the difference matters: each guard was written after its own drift, so nothing has
swept the whole surface since the worlds landed.

- `tests/docs-roster.test.ts` -- every on-disk doc is indexed, every row names a real doc, the table is
  read rather than the whole file, and the rule *"Add a one-line index entry here for each new doc"* is
  present. **Its selection is flat-only twice over**: `onDisk` reads the top level of `docs/` and the
  row parser's character class contains no `/`. A document in a subdirectory is invisible to **both**
  halves. This is the `docs/phases/` situation, and it is recorded in this program's index rather than
  hidden.
- `tests/demo-rosters.test.ts` -- four rosters (`package.json`, the two command blocks, the CI workflow
  as **three** statements plus the self-acceptance route as a **fourth**), and a fifth assertion holding
  the ordering claim that the self-acceptance step sits above the demo loop.
- `tests/readme-rosters.test.ts`, `tests/observation-vocabulary.test.ts`,
  `tests/simulated-surfaces.test.ts`, `tests/schema-vocabulary.test.ts`, `tests/step-kinds.test.ts`,
  `tests/package-manifest.test.ts`.
- **Two count sites are known to be irreducibly prose:** the artifact name `veridian-sim-evidence` and an
  ordinal in a file's header are read by no code, and *a count cannot be pinned by a test that itself
  changes the count*. Reverting those three prose repairs left the suite at `2259 pass / 0 fail` --
  which is the measurement behind calling them corrections rather than guards.

## What this phase does

1. **Run every roster guard as one pass and repair what it reports.** Not one guard at a time; the point
   of a sweep is that a file can be right about a rule and cite the old version of it 180 lines later.
2. **Widen every search before trusting its silence.** The two statements reachable only through "the
   only layer" are proof that a pattern built from the phrase the searcher has in mind finds only the
   copies that use that phrase. Search for the **rule**, in each of its spellings.
3. **Re-measure every count at the moment its document is touched**, and record the movement in the
   count-movement record rather than adding to a number. *An arithmetic total that happens to reconcile
   is the total nobody goes back and checks* -- so take the measurement, do not compute it.
4. **Extend the flat-only guard, or state the exception.** A guarded vocabulary that cannot see a
   subdirectory is a guard whose coverage is a naming convention. Either the phase teaches
   `docs-roster` to walk recursively -- and falsifies that by putting a file in a subdirectory and
   watching it fail -- or it records the omission where the guard lives.
5. **Correct the README in the same pass as the change that falsifies it.** A README that describes a
   command that no longer behaves that way is the same defect as a validator that reports a pass it did
   not observe.

## Acceptance criterion

- Every roster guard in the tree passes **and has been falsified at least once in this pass** by taking
  one member out and watching it fail by name. A roster guard that has never been broken is a guard
  nobody has watched work.
- Every count touched by this phase's edits is re-measured by running the thing it counts -- `node --test`
  on both trees, `adapters/*-environment.ts` on disk, the `demo*` scripts in the manifest.
- Any vocabulary a document prints is printed **in full**, with no member factored out into a shared
  prefix (the shorthand that hid `web.visible`), and no member that the code does not export.
- The `docs-roster` flat-only limitation is either removed or written down, and the choice is stated
  rather than implied.

## Falsification probe

- **Take one out and watch it fail.** For each roster guard touched: delete a member from the document,
  run the guard, expect a failure naming that member, restore byte for byte. The line ending is detected
  from the file about to be edited and **printed**, and the probe must not restore the file before
  running the suite -- a probe that measures the original is a verdict about work that did not happen.
- **The scope probe.** For any guard that reads a whole document, count the occurrences of the thing it
  looks for. If every member is named at least twice, a whole-document question passes with the block two
  members short -- the vacuous pass `tests/observation-vocabulary.test.ts` discovered in its own first
  draft. The guard needs a **scope**, and the scope needs two in-guard controls asserting the scope held.
- **The reconciliation probe.** For any probe whose needle is deleted-anchor text, reconcile the control's
  count against an independent count taken by hand. One such control printed `1 time(s)` where the
  independent count said **7**, and a probe that deletes every reference reports `FIRED` while leaving
  the scope it claims to test unexercised.

## Guards that must still pass

Every guard named in *What is already true*, plus the docs-roster's fourth assertion, which is the reason
this phase's own output files are described in the phase program's index.

## Context budget

**Read:** the specific document a drift is reported in, plus the constant or register the document is
supposed to agree with. Read them **as a pair** -- the defect only exists in the gap between them.

**Do not read:** the plan documents this program decomposes. This phase repairs what the tree says about
itself; the plans are phases 10 through 12's subject.

## Refusals

- **No formatter, no linter, no markdown linter.** There is deliberately no `npm run format`, and
  `prettier` is not installed. A first `prettier --write` would touch almost every file.
- **No new document to describe a document.** Every repair lands in the file that was wrong.
- **No count pinned by a test that changes the count.** Re-measure.
- **No guard added for a premise.** A premise in prose can be invalidated by a change that never opens
  the file it lives in, so the way to hold one is to search for it -- and the search is the phase's step,
  not a file it adds.
