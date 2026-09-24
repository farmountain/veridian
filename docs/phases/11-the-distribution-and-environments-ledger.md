# Phase 11 -- The distribution and environments ledger

| | |
|---|---|
| **Status** | next -- a document phase with one code obligation |
| **Depends on** | 01, 09 |
| **Source** | `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` (158,325 bytes / 1,653 lines -- the bulkiest plan in the tree) |
| **Touches** | that document, plus whatever code it turns out to be wrong about |
| **Acceptance** | every row of the world table is true of the tree, and every "blocked" row names the world that answers it |

## Why this phase exists

`docs/DISTRIBUTION-AND-ENVIRONMENTS.md` is the largest plan in the repository and the one whose subject
has moved the most underneath it. It carries **fourteen `### Phase` headings** in S4 (`A1`, `A2`, `B`,
`C`, `C2`, `C3`, `C4`, `C5`, `C6`, `C7`, `D`, `D2`, `C8`, `C9`), a world table in S5, "what comes after"
material in S6, and one retrospective per phase in S7 (942 through 1594). Written when the tree held one
adapter, it now sits over twelve.

Its two load-bearing sentences are correct and are the reason it is worth a phase rather than an
archive:

> **Veridian does not ship infrastructure. Veridian ships worlds.**
>
> **a phase is built when it can be proven, not when it can be written.**

And its S5 has already been reframed once, correctly: **every remaining "blocked" row names the `sim-*`
world that answers it**, because a world may be simulated and a real-infrastructure absence is not a
blocker. That reframing is what lets a document with fourteen phases be *finished* rather than stalled --
and it is also what makes the document's own staleness dangerous, because a reader who trusts a stale row
now expects a world that exists.

**S5 is guarded and has already been caught wrong.** It recorded `sim-posix` as substituting *"Kali's
attack network"* while `POSIX_SIMULATED_SURFACES` says the opposite in as many words -- its `egress`
member reads *"the sandbox has no network beyond its own loopback listeners; egress is refused, not
routed"* -- and omitted four surfaces the constant does declare. `tests/simulated-surfaces.test.ts` reads
both sides now: a declared world must print exactly the declared set, and a world the document calls
**built** may not print a backticked surface no constant declares.

## What is already true

- **The world table is guarded in one half.** `tests/simulated-surfaces.test.ts` reads the constant's
  import, its entry in `DECLARED`, the document's world table and the row's `Status` cell, and requires
  all four to agree. Adding an import and a table entry while the document still said
  `vscode-host ... planned` would have left the world unchecked -- and *a loop over a correct list passes
  for the wrong reason right up until a member is missing*.
- **A row can have to be split rather than edited.** S5 carried
  ``| `local-api` / `local-process` | real child process, real HTTP | - | planned (Phase D) |`` -- one row
  naming two worlds, one of which was about to become **built**. Adding a row would have duplicated;
  editing the status would have claimed the other was built. *A guard with three extension points has
  three ways to fall behind: the import, the table entry, and the row that was never made.*
- **Four routes ship and each has a route of its own**: a clone, an npm package (`npm run smoke:dist`,
  plus a full `npm pack` -> install -> run round trip), the Cockpit (development install and `.vsix`),
  the marketplaces that `.vsix` is published to, and a container image. The Dockerfile is verified in CI
  because Docker is not installed on this machine and *an unbuilt Dockerfile is a claim*.
- **The seven-plus-one job structure is real and its numbers have been measured.** The workflow's `jobs:`
  keys are seven -- `gate`, `demo`, `worlds`, `dist`, `mcp`, `image`, `cockpit` -- and a run *displays*
  eight rows because `gate` is a matrix over two platforms. Both figures are right and they count
  different things; a reader who "fixes" one of them is correcting a count that was never wrong.
- **`docs/GAP-CLOSURE-PLAN.md` is the checklist a new world satisfies**, twelve additive places each
  measured at a file and an anchor, and it records what one of the six guards does when a directory is
  not a world (`adapters/sim-mobile/` holds a port, a suite and a reading vocabulary and **no adapter**,
  which broke a guard whose mechanism was a directory listing).

## What this phase does

1. **Bring the fourteen phase headings into one of three states, with evidence for each:** *built and
   observed* (the command and its output), *superseded* (by which world, with the world named), or
   *still open* (with the row that answers it named). A phase that is "planned" with no world named is
   the state this document's own reframing abolished.
2. **Reconcile S5 with the tree in both directions** -- which means reading `DECLARED` and the document
   together and letting the guard do the comparison, not doing it by eye.
3. **Split any remaining multi-world row before touching either status.** The `local-api` row is the
   precedent, not the exception.
4. **Fold the still-open rows into the rolling backlog** this program's index holds, so that "what is
   next" has one address rather than fourteen headings and a section in a 158 kB file.
5. **Correct anything S1 through S3 asserts that the tree has since falsified** -- and count what the
   document *claims* against what the tree *does*, because the two failures this document has already
   had were both a claim about a world that the world contradicted.

## Acceptance criterion

- Every row of S5's world table is true of the tree, and `tests/simulated-surfaces.test.ts` passes with
  this phase's edits in place.
- Every one of the fourteen `### Phase` headings is in one of the three states, and a *built* one carries
  a command that was actually run.
- No row names two worlds. No row prints a surface no constant declares.
- The still-open work has exactly one address, and this program's index points at it.

## Falsification probe

- **Take a surface out of a document row** and expect `tests/simulated-surfaces.test.ts` to fail naming
  it. This probe has fired before; re-run it rather than re-inventing it.
- **Take one out of the constant** and expect the same guard to fail the other way. A guard that only
  reads one direction cannot see a world the document declares and the code does not.
- **Reintroduce a two-world row** and expect the guard's row reader to complain. If it does not, the
  split rule is not held and the row will be edited into a false claim the next time a world lands.
- **Answer "is this phase built?" from the document alone, then from the tree.** If the two answers
  differ, the row is the defect. *A document that prints a vocabulary must print every member in full*,
  and a document that assigns a status must read the code that earns it.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/simulated-surfaces.test.ts` | The import, the `DECLARED` entry, the table row and the `Status` cell agree |
| `tests/demo-rosters.test.ts` | The four rosters, including the CI workflow's own list of demos |
| `tests/package-manifest.test.ts` | The manifest and its lockfile agree, and the optional peer declaration is written in both places it is written |
| `scripts/smoke-dist.mjs` | The **compiled** CLI resolves its own schemas -- asserted as exit 2, not exit 3 |
| the `distribution` / `image` / `mcp` / `cockpit` jobs | Each artifact read back rather than assumed |

## Context budget

**Read:** S4's heading list and the one phase this pass is working on; S5 in full (it is the guarded
half); the constant the row is supposed to agree with.

**Do not read:** S7 -- the retrospectives -- except for the one phase being classified. S7 is where the
history is kept so that the rest of the document can be current, and reading all 650 lines of it is how
this document became unreadable in the first place.

## Refusals

- **Do not delete S7.** The retrospectives are the record of decisions that were taken and reversed, and
  this repository keeps those rather than tidying them away.
- **Do not promise an adapter.** The next adapters are ordered by what can be *proven*, not by what can be
  written.
- **Do not put Postgres, Kafka, Redis or Kubernetes in the tree.** They may be integrated with; they are
  not to be competed with, and the MVP runs on a local machine.
- **No second copy of a roster.** A list of worlds printed here and in the constant is one list written
  twice; the constant is the source and the document is compared to it by a guard.
