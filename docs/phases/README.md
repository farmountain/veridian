# The phase program

The remaining work in this repository is documented across **five** files totalling **209,791 bytes**
(measured: `docs/DIGITAL-TWIN-PLAN.md` 12,270; `docs/DIGITAL-TWIN-DESIGN.md` 27,169;
`docs/ISOLATION-AND-MCP-PLAN.md` 57,541; `docs/INSTRUMENT-AND-PROMPT-PLAN.md` 34,247;
`docs/GAP-CLOSURE-DESIGN.md` 78,564). None of those five is wrong, and none of them is redundant. The
problem is arithmetic: carrying all five at once is tens of thousands of tokens before a line of code
has been read, and a context window spent on the plan is a window with nothing left for the work.

This directory is the divide-and-conquer answer. **Thirteen phases, one file each.** A phase file is
written to be read *alone*: it states what is already true, what it changes, the acceptance criterion
it is judged by, the probe that would falsify it, the guards from the existing tree that must still
pass, and the context it does and does not need. Nothing in the thirteen assumes a reader has opened the
five files above.

## The phases

| # | Phase | What it delivers | Status | Depends on |
|---|-------|------------------|--------|------------|
| 01 | [Land the working tree](./01-land-the-working-tree.md) | The instrument repairs and world identity reach a commit, with the counts re-measured | **built** | -- |
| 02 | [The ELI join](./02-the-eli-join.md) | One row per run, joined from the bundles already on disk | next | 01 |
| 03 | [dENV and the export predicate](./03-denv-export-predicate.md) | A total predicate over the record, with a known-present control | planned | 02 |
| 04 | [The ESI interchange document](./04-the-esi-interchange.md) | Export only: identity plus dENV, byte-stable | planned | 03 |
| 05 | [The Cockpit twin surface](./05-the-cockpit-twin-surface.md) | A thin client over the join, with no validation logic | deferred | 02, 03, 04 |
| 06 | [Network enforcement](./06-network-enforcement.md) | The one boundary dimension enforced nowhere becomes enforced somewhere | next | 01 |
| 07 | [The isolation substrate](./07-the-isolation-substrate.md) | A real substrate behind the seam that already exists | **blocked here** | 06 |
| 08 | [Import into a prepared world](./08-import-into-a-prepared-world.md) | An imported world enters through `prepare()` or not at all | gated by 07 | 04, 07 |
| 09 | [Documentation currency](./09-documentation-currency.md) | The documentation guards run as a programme rather than one at a time, and what they report is repaired | next | 01 |
| 10 | [Veridian judged by Veridian](./10-veridian-judged-by-veridian.md) | The CLI judged as a product by `local-process`, and a run judged as a witness by `acceptance:ladder` | **built** | 01 |
| 11 | [The distribution and environments ledger](./11-the-distribution-and-environments-ledger.md) | Every row of the world table true of the tree, and every "blocked" row naming the world that answers it | next | 01, 09 |
| 12 | [Memory, and the end of the program](./12-memory-and-the-end-of-the-program.md) | The tree's own account of its memory matches the port's behaviour, and the program is closed | **in flight** | 09 |
| 13 | [The always-on budget](./13-the-always-on-budget.md) | The instruction file every turn loads, cut back to the invariants it must hold | **built** | 01 |

Statuses mean exactly this, and nothing more:

- **built** -- the deliverable exists and has been *observed running*, not merely written. What
  remains for such a phase is keeping it true, which is why 10 is a phase at all rather than a
  heading somebody closed by hand.
- **in flight** -- the work exists in the working tree and is not committed. The phase is *landing*
  it, not writing it.
- **next** -- nothing blocks it; it is the first thing to pick up after 01.
- **planned** -- the design is written (in the source file named per phase) and no code exists.
- **deferred** -- a deliberate order, not a blocker. The named dependency is a *reason*.
- **blocked here** -- a measurement on this machine says the phase cannot be *proven* here. See the
  phase file; the blocker is a runtime that is absent, not an absence of design.
- **gated by N** -- the phase is buildable, and would be a false `PASS` if built before N lands.
- **frontier** -- the phase's own acceptance criterion is a decision and a measurement rather than
  code, because building it before the measurement exists would be the thing this tree refuses.

That is a **closed list of eight**, and a phase's spelling is this list's rather than its own: the
`| **Status** |` cell in a phase file, and its Status here, must both begin with one of the eight.
`built` is the newest member and it arrived the way a vocabulary grows - phase 10's own file used it
while this list did not have it, which is the drift the guard below is for. `frontier` is declared
and currently unclaimed, which is a fact about the remaining work rather than an error.

## How to run a phase

1. Read this file. Read **one** phase file. Do not read the other eleven.
2. Load the tree the same way, because a window spent on the repository is a window not spent on the
   work. Two practices, both paid for here:
   - **Never read `AGENTS.md` whole.** It is the largest file in the tree and most passes need none
     of it. Grep it for the spelling you need, then read a window of about forty lines around the
     hit. A whole read costs the entire budget and buys one paragraph.
   - **Redirect verbose output to a file and read the summary.** A full `npm run gate` transcript and
     a twelve-file `git diff` have each overflowed this window. Send the output to
     `$env:TEMP\<name>.log`, then take the lines you need - `Get-Content ... -Tail 8`, or a `grep` for
     the summary block - so the transcript stays on disk and the reading stays small.
3. Check the phase's `Depends on` against `git log --oneline -1` and `git status --porcelain`. A phase
   whose dependency is unlanded is a phase whose acceptance criterion cannot be met, and finding that
   out after the work is how a run reports progress from its own intentions.
4. Do the work. The phase file names the file and the anchor for each move.
5. Run the phase's **falsification probe** *before* running the gate. A probe that has not been run is
   a claim about coverage, not coverage: the probe is what turns the acceptance criterion into a
   measurement, and the tree has paid for the alternative five times over.
6. Run `npm run gate` and report the **real** output. Then run any demo the phase names, because a
   green unit suite and a working artifact are two independent claims.
7. Correct the phase's status cell **and** any count the change moved, in the same pass. A phase that
   landed while its own file still says `planned` is the defect this program would be introducing.

## The rule this program is built on

> **A phase is a context budget, not a topic.** Every file here is sized so that one phase plus the
> tree it touches fits in one window with room left for the work. If a phase file grows past that, the
> phase is two phases and the split is the deliverable.

Two consequences, both deliberate:

- The thirteen files are **not** a summary of the five. A summary would restate the plan and double the
  bulk. Each file carries only what its own phase needs to be executed, and points at the source for
  the argument.
- The source files are **not** retired. They hold the reasoning behind the work and the audit trail of
  what past passes found falsified (`docs/GAP-CLOSURE-DESIGN.md` S9's F1..F6 is the clearest example).
  This directory is how a reader *executes*; those files are how a reader *understands*. A phase file
  that needs a source's argument cites the section rather than reproducing it.

## What this program refuses

- **A phase with no acceptance criterion.** A phase whose success is "reasonable" is a phase whose
  success cannot be false, and this tree already records what a clause that cannot be false costs
  (`docs/BOUNDARY-ENFORCEMENT.md`: the third clause of the `PASS` rule could not fail).
- **A phase boundary drawn by topic.** The cuts are at dependency and proof seams -- "this cannot be
  proven until that exists" -- and not at "this concerns the twin".
- **A count recalled rather than taken.** Every figure in these files was measured at writing time.
  A number in prose is a claim that the very edit which changes it falsifies.
- **A phase that starts before its dependency lands.** Phase 01 exists as its own phase precisely
  because a working tree that has not landed is a working tree every later phase is building on top of.

## Where the work comes from

Each phase's `Source` row names the document and section that holds the argument for it. The five
files, and what each is authoritative for:

| Document | Authoritative for |
|----------|-------------------|
| `docs/INSTRUMENT-AND-PROMPT-PLAN.md` | The four ways `veridian metrics` reported something untrue about the runs on disk, and the self-prompting rung's reachability |
| `docs/DIGITAL-TWIN-PLAN.md` | The twin work items W0..W4, their acceptance criteria and their refusals |
| `docs/DIGITAL-TWIN-DESIGN.md` | Why a twin is a join and a name rather than a new layer, and the measured defect it opens with |
| `docs/ISOLATION-AND-MCP-PLAN.md` | The isolation substrate's blocker (S3.1) and the MCP surface (S3.2/S4) |
| `docs/GAP-CLOSURE-DESIGN.md` | The seven gap-closure work items' statuses, and S9-S12's audit trail of what executing them decided |

`tests/phases-roster.test.ts` holds this directory, and it reads `docs/phases/` off the disk rather
than from a list. It asks five things of the table above: that every phase file on disk is named in
it, that every row names a file that exists, that the numbers run `01` to `12` with no gap, that
every status -- the row's and the phase file's own -- is one of the eight declared above, and that
the row's status **agrees with the phase file's**.

And it asks one thing of the phase files themselves rather than of the table: that each carries a
`## Context budget` heading with **both** a `**Read:**` and a `**Do not read:**` line. This is the
one question here that is about **shape** rather than agreement, because a budget has nothing to
agree with. It is asked because a file naming only what to read is a file whose reader will fill the
window with the first list and never reach the second, which is the failure the whole directory was
built to prevent - so the shape of the budget is checked rather than left to the honour of whoever
writes the next phase.

That last question is the one this paragraph used to answer wrongly. `tests/docs-roster.test.ts`
holds the top level of `docs/` and cannot hold this directory: its selection reads the top level of
`docs/` and its row parser's character class contains no `/`, so a document in a subdirectory is
invisible to **both** halves of it. Neither half is a defect -- it was written for a flat directory,
and flat is still all it claims. What *was* a defect is that this paragraph credited the coverage to
it anyway, which is the same shape as a capability list written beside the code instead of derived
from it, and the four rows it could not see had silently drifted into naming
`09-instrument-residual-readings.md`, `10-ladder-residual-readings.md`,
`11-documentation-currency.md` and `12-the-next-world.md` -- four files that are not in this
directory -- while the four that **are** held no row at all. The earlier statuses in this file were
`planned` for work that had been designed and not built, and two of those four rows were left behind
by a rename the table never learned about. A roster in prose and a roster on disk are two lists of
one thing, and only one of them can be read.
