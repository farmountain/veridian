# Phase 13 -- The always-on budget

| | |
|---|---|
| **Status** | built -- the always-on file is cut and every figure was re-taken afterwards |
| **Depends on** | 01 |
| **Source** | this program's own governing rule in `docs/phases/README.md` -- *"A phase is a context budget, not a topic"* -- measured against the figures below |
| **Touches** | `AGENTS.md`; three new `docs/*.md`; `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`; `docs/phases/README.md`; `tests/phases-roster.test.ts`; `tests/observation-vocabulary.test.ts`; `tests/docs-roster.test.ts`; `.github/instructions/typescript.instructions.md` |
| **Acceptance** | `AGENTS.md` is under **60 KB**, every guard still passes, and the extraction is proved byte for byte |

## Why this phase exists

**The phase program was aimed at the wrong file.** Twelve phase files were cut so a reader could open
one of them alone, and they are already the right size -- they did not need the cut, and they are not
what was overflowing the window.

Measured on this machine, before this phase:

| File | Bytes | Loaded when |
|---|---|---|
| `AGENTS.md` | **290,252** over 3,005 lines | **every turn** |
| one phase file | 5,933 -- 9,415 | when that phase is worked on |
| all twelve phase files | 103,617 | never, by design |
| `docs/phases/README.md` | 11,731 | once per phase |

`AGENTS.md` is the workspace instruction file, so it is injected on **every** turn of **every** phase.
A phase file costs 6--9 KB when it is opened; `AGENTS.md` costs 290 KB always. The twelve-file split
could not have fixed an overload whose cause is a document that is read before the phase file is.

The distribution of that 290 KB is the whole argument:

| Section | Lines | ~Bytes | Share | What it is |
|---|---|---|---|---|
| `## Rules this build has paid for` | 1,371--2,986 (**1,616**) | ~155,000 | **53%** | a defect register |
| `## Layout` | 334--915 (**582**) | ~56,000 | 19% | a tree map |
| `## Build / test commands` | 916--1,249 (**334**) | ~32,000 | 11% | a command reference |
| `## Distribution` | 1,250--1,370 (**121**) | ~12,000 | 4% | a route reference |
| everything else | header 1--94, then 95--333, 2,987--3,005 (**~417**) | ~40,000 | 14% | the invariants |

**The 53% is a defect register**, and a register is reference material: a reader consults the entry that
bears on what they are touching. It is not something every action needs in front of it. The same is true
of a tree map and a command list. What *must* be always-on is the 14%: the two governing rules, the hard
scope boundary, the core invariants, the working agreements, the memory protocol, the platform traps,
and the two indexes that guards read.

## What is already true

- **`AGENTS.md` is the workspace instruction file and is injected whole.** It states its own role at the
  top: *"This is the single always-on instructions file for this workspace -- do not add a second one."*
  This phase does not add a second one; it keeps `AGENTS.md` as the always-on file and moves reference
  material out of it, leaving a pointer where each moved section was.
- **The documentation index and the obligation already exist.** `AGENTS.md` carries a Documentation
  table and the sentence *"Add a one-line index entry here for each new doc instead of duplicating its
  content in this file."* Three new documents enter through that obligation rather than beside it.
- **Three guards read `AGENTS.md` by design, and two of them read it for a *place*.** Measured:
  `tests/docs-roster.test.ts` holds the Documentation table (and holds that it reads the *table* rather
  than the whole file); `tests/observation-vocabulary.test.ts` names `AGENTS.md` as the document whose
  `core/environment/` layout entry it enumerates; `tests/demo-rosters.test.ts` reads the `Running
  things:` command block. Each of the three stays valid only if the section it reads either stays or
  takes its reader with it.
- **A second distribution document would be a second statement of one roster.** The other four defects
  of that shape are recorded four times over (`db.query`, `db.rowCount`, `web.visible`, the observation
  vocabulary). `## Distribution` therefore merges into the existing
  `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` rather than becoming `docs/DISTRIBUTION.md`.
- **The guards are green at the figures above**: `npm run gate` exits 0 at **2569** tests over **426**
  suites, `npm run acceptance` prints `exit 0 - PASS` for both of its runs.

## What this phase does

1. **Extract the three reference sections into indexed documents**, by script rather than by hand:
   `## Rules this build has paid for` to `docs/RULES-PAID-FOR.md`, `## Layout` to `docs/LAYOUT.md`,
   `## Build / test commands` to `docs/BUILD-AND-TEST-COMMANDS.md`. Each extracted block is moved
   **verbatim** -- a defect register that is paraphrased while being moved is a register whose entries
   have lost the measurements that made them rules.
2. **Merge `## Distribution` into `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`** as a named section, so the
   routes are stated once.
3. **Leave a pointer, not a summary.** Each moved section leaves a two-to-four-line entry naming the
   document and saying when to read it -- *"before changing a boundary"*, *"before adding a directory"*
   -- because a pointer that does not say when is a pointer nobody follows.
4. **Prove the move byte for byte.** The extraction is performed by a script that asserts the
   concatenation of what was extracted and what remains is exactly the original document, with only the
   pointers added. This is the only way to move ~2,500 lines without reading them, and it is also the
   stronger check: a hand move of this size cannot be verified at all.
5. **Take each guard that reads a moved section with it.** `tests/observation-vocabulary.test.ts`'s
   `AGENTS.md` target becomes `docs/LAYOUT.md`; the Documentation table gains its three rows; the
   `docs-roster` guard will demand them and is the authority rather than this list.
6. **Re-measure, not estimate.** The always-on figure after the move is taken with `Get-Item`, not
   computed by subtracting.

## Acceptance criterion

- `(Get-Item AGENTS.md).Length` is **below 60,000** -- a figure chosen as roughly the 14% that is
  currently irreducible, plus room, and **re-measured after the move** rather than predicted.
- `npm run gate` exits 0, at whatever totals it prints, with those totals written into the four live
  prose sites.
- `node --test tests/docs-roster.test.ts`, `tests/observation-vocabulary.test.ts`, `tests/demo-rosters.test.ts`
  and `tests/phases-roster.test.ts` each exit 0, because each reads a document this phase edits.
- No text is lost: for every extracted section, the number of lines in the new document matches the
  number of lines removed from `AGENTS.md`, and the script's byte assertion held.
- `AGENTS.md` still contains, in full and unedited, every section that is **not** moved.

## Falsification probe

- **The byte assertion is the probe for the move.** Re-run the extraction script against the moved tree
  and expect the assertion to fail, because the document it now reads is not the document it moved.
  Then restore byte for byte. A recovery script that cannot fail on a second run is a script whose
  assertion is decoration.
- **Each guard's reader must follow its document.** For `tests/observation-vocabulary.test.ts`: point
  its target back at `AGENTS.md` after the layout has moved and expect it to fail naming the missing
  enumeration -- which is the vacuous pass the guard's own scope control exists to prevent. Restore.
- **The always-on figure is a measurement, so probe the measurement.** State the pre-move figure from
  `Get-Item` rather than from this file, and take the post-move figure the same way. A figure recalled
  from this table is a figure this phase has already falsified by landing.
- Every probe decides each edited file's line ending **from that file** and prints what it detected,
  asserts the anchor was present before patching, asserts the patch changed the file, and restores byte
  for byte. A skipped probe does not fail -- it silently reduces coverage.

## Guards that must still pass

| Guard | Holds, and why this phase can break it |
|-------|---------------------------------------|
| `tests/docs-roster.test.ts` | Every `docs/*.md` is indexed. **Three new documents must be given rows**, and this guard is the authority on that rather than this file's list. |
| `tests/observation-vocabulary.test.ts` | The `core/environment/` vocabulary. **It names `AGENTS.md` explicitly**, so the layout's move must take its target with it. |
| `tests/demo-rosters.test.ts` | Four rosters. It reads `AGENTS.md`'s `Running things:` block, which **stays**; the block's neighbours may not. |
| `tests/phases-roster.test.ts` | This directory's index. **The table is found by its heading**, so the heading's spelling is this guard's business. |
| `tests/readme-rosters.test.ts` | The README's validator rosters, `AGENTS.md`'s layout row among them. |
| `tests/simulated-surfaces.test.ts` | The five `*_SIMULATED_SURFACES` constants and the document that prints them. |
| `tests/run-metrics.test.ts`, `tests/execution-loop.test.ts`, `tests/evidence-bundle.test.ts` | Phase 01's subject, untouched here, and still green afterwards. |

## Context budget

**Read:** `AGENTS.md`'s section boundaries only -- the `^## ` line numbers, never the sections -- and one
guard at a time as its turn comes. The extraction is performed by a script precisely so that the 290 KB
does not have to enter the window to be moved.

**Do not read:** the moved sections themselves. A defect register read while being relocated is a
register read at the cost this phase exists to remove. Read an entry when an entry is what you need.

## Refusals

- **No second always-on instructions file.** `AGENTS.md` stays the one, and the split is inside it.
- **No paraphrase while moving.** Extraction is verbatim; a rule whose measurement was rewritten in
  transit is a rule that has lost its evidence.
- **No `docs/DISTRIBUTION.md`.** The routes are stated in the document that already holds them.
- **No cutting a rule to save bytes.** The 14% that stays, stays in full -- the invariants are not
  reference material, and trimming one to fit a budget would trade a bounded cost for an unbounded one.
- **No count in this file trusted after the move.** Every figure above was measured before the work;
  the figures the phase reports are the ones it took after it.
