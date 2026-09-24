# Phase 09 -- Documentation currency

| | |
|---|---|
| **Status** | built -- `tests/docs-roster.test.ts` now indexes subdirectories, and ten roster guards were each falsified in that pass |
| **Depends on** | 01 |
| **Source** | `docs/GAP-CLOSURE-DESIGN.md` S4 (W3) |
| **Touches** | `AGENTS.md`, `README.md`, `extension/vscode/README.md`, `docs/*.md`, `tests/docs-roster.test.ts`; no source file except to **read** it |
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

## What was measured, and the two probes that were aimed wrong

The battery **is** the acceptance criterion, so it is recorded as it ran rather than as it was designed.
Each probe detected the file's own line ending first -- all six edited files measured **CRLF with
`bareLF=0`**, re-checked after the last restore -- applied one edit, ran exactly one guard, and restored
byte for byte before re-running to confirm green.

| Guard | Probe | Result |
|---|---|---|
| `boundary-roster` | `local-process` network arm: `unenforceable` -> `enforced` | `3` failures, naming the arm |
| `phases-roster` | one phase file's status set to disagree with the index row | `1` failure, naming both |
| `docs-roster` (subdirectory) | delete the `docs/phases/` row from `AGENTS.md` | `1` failure, naming `docs/phases/` |
| `docs-roster` (counts) | `README.md` -> `2600 tests over 431 suites` | `1` failure, naming both figures |
| `demo-rosters` | remove `demo:mobile` from `package.json` | `2` failures |
| `readme-rosters` | remove `web.visible` from the README's roster | `1` failure |
| `observation-vocabulary` | remove `data-observation.ts` from the README's layout row | `1` failure |
| `simulated-surfaces` | add `telemetry` to `sim-cloud`'s row | `1` failure |
| `step-kinds` | delete the `goto` branch from `acceptance.schema.json` | `3` failures |
| `schema-vocabulary` | remove `SKIPPED` from the five-member criterion-status enum | `1` failure |
| `package-manifest` | lockfile root peer range `>=1.40.0` -> `>=1.30.0` | `1` failure: *the Playwright peer declaration* |

Two probes did **not** fire on their first attempt, and neither was a guard defect:

| First attempt | What it left behind | Why |
|---|---|---|
| `package-lock.json`'s **top-level** `version` -> `0.4.9` | `8 pass / 0 fail` | the guard reads `packages[""]`'s `peerDependencies` / `peerDependenciesMeta`; it makes no claim about the version |
| `result.schema.json:54`'s three-member enum, minus `INCONCLUSIVE` | `8 pass / 0 fail` | that enum is not one of the guard's `VOCABULARIES`, so removing a member from it makes it a partial enumeration of nothing the guard polices |

**In both cases the guard was correct and unchanged, and the aim was wrong.** This is the same shape as
the column-zero `not ok` scrape and the scope-collapse probe that edited a neighbouring cell: a probe
pointed at the wrong part of the thing it tests reports the *reverse* of what happened -- here, a
`0 fail` that reads as a hole in the guard and is in fact a hole in the probe. A firing probe is the
only thing that separates "the guard checks this" from "the guard happened not to care".

## What this phase changed

1. **`docs-roster` now indexes subdirectories**, which is the flat-only limitation removed rather than
   written down. `directoriesNamed(rows)` matches a backticked `docs/<name>/`; `docDirectories` walks
   `docs/`, then one level into each entry, and keeps those whose children include a `.md` (`io.readDir`
   swallows every error, so **children** are how a directory is told from a file). A new assertion asks
   whether every such directory has a row, with a non-empty control. The probe above is what showed the
   new question can fail.
2. **A count-agreement assertion.** `COUNT_SITES` names the four live sites; each must yield a figure
   from `/N\s+(?:passing\s+)?tests?\s+over\s+M\s*suites?/` after markdown emphasis is stripped (the
   control), and every figure must be equal. **This asserts agreement, not truth** -- a test that itself
   changes the count cannot pin a count -- so the truth still comes from re-taking the measurement: five
   sites were edited to `2625` / `438` / `2553` / `72` in this pass and the reading is `npm run gate`.
3. **Count sites deliberately left alone**, and the reason each is not a drift: `docs/RULES-PAID-FOR.md`
   S883-887 and S911-914 are the historical `2568 -> 2569` movement written *as* a movement, and
   `docs/DIGITAL-TWIN-DESIGN.md:14` records the figure at that document's own moment.

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
