# Phase 11 -- The distribution and environments ledger

| | |
|---|---|
| **Status** | **built** -- all fourteen of `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`'s phase headings are built and each names a command that was run, and `tests/simulated-surfaces.test.ts` holds the world table and each declared surface in both directions |
| **Depends on** | 01, 09 |
| **Source** | `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` -- the bulkiest plan in the tree. The size is given with its **unit** and its **state**, because the first version of this row was not: **171,249 bytes / 1,853 lines at `d3a7ab1`**, line endings normalised. It previously read `173,104 bytes / 1,853 lines`. The line count is identical and the byte figure is 1,855 higher, against a document with 1,853 line terminators - so the byte count is the **CRLF** reading and the two figures agree to within two bytes once each terminator is counted twice. A byte count in that basis is a reading of a **Windows checkout** rather than of the document, which is why `tests/phases-roster.test.ts` normalises line endings before comparing sizes. The two residual bytes are not accounted for here and are stated rather than rounded away. |
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
   next" has one address rather than fourteen headings and a section spread through the ledger.
5. **Correct anything S1 through S3 asserts that the tree has since falsified** -- and count what the
   document *claims* against what the tree *does*, because the two failures this document has already
   had were both a claim about a world that the world contradicted.

## What was measured

### The one code obligation was a real defect, and the guard could not see it

`tests/simulated-surfaces.test.ts` parsed the world table's first cell with `/`([^`]+)`/` - **the first
backticked token and no more**. So a row reading `` `sim-k8s` / `sim-mobile` `` registered under
`sim-k8s` and dropped `sim-mobile` **silently**, and the guard that exists to catch a table disagreeing
with the code could not catch a table that stopped naming a world. Measured rather than argued:
reintroducing that row left the guard at `3 pass / 0 fail`.

Three changes close it, and the third is the one that would have caught it:

- The cell is read as `tokensIn(cells[0])` and `assert.equal(named.length, 1, ...)` refuses a row naming
  more than one world, in the words of the defect: *"A row is a statement about one world. A cell naming
  two is a row that has not been split yet, and the second world it names is dropped by the parse that
  reads the first - which is how `local-api` / `local-process` came to be one row with two statuses to
  choose between."*
- A second assertion refuses a world named **twice**, because a table that names one world twice and
  omits another has the same arithmetic as a two-world row with a different presentation.
- `names exactly the worlds the registry registers, in both directions` reads `registeredAdapters()` and
  `adapterDescriptors()` from `cli/worlds.ts` and requires the table and the registry to name each other,
  with a control asserting the registry holds at least twelve. **The old guard only ever asked whether
  the worlds it could see were declared; it never asked whether every declared world was visible.**

### Six probes, and all six fire

`scripts/probe-world-table.mjs`, run in one pass, each reporting whether the replacement changed the text
before the guard was run - because a probe whose change marker is never printed is indistinguishable from
one that works:

| Probe | Aimed at | Result |
|-------|----------|--------|
| a two-world row | the document | `# pass 1 \| # fail 3` |
| a row for a world the registry does not register | the document | `# pass 3 \| # fail 1` |
| a registered world with no row | the document | `# pass 1 \| # fail 3` |
| one world named twice | the document | `# pass 1 \| # fail 3` |
| a surface dropped from a document row | the document | `# pass 3 \| # fail 1` |
| a surface dropped from the constant | `core/environment/k8s-observation.ts` | `# pass 3 \| # fail 1` |

Both files restored byte for byte, asserted by re-reading them, and the guard on the restored tree reads
`# pass 4 \| # fail 0`. The last two probes are the two directions of one claim and they matter together:
**a guard that reads one direction cannot see a world the document declares and the code does not**, and
the fifth and sixth rows returning the same failing pair is that claim measured.

**The sixth probe did not fire on its first version, and the reason is worth keeping.** Its needle spanned
two lines and was written with `\n`; `core/environment/k8s-observation.ts` is CRLF, so the needle matched
nothing and the script printed `text changed: false`. A probe that matches nothing changes the file to
what it already said and reports a working guard over a change that never happened - the same class as the
column-zero `not ok` scrape and the CRLF anchor this repository has already paid for. The script now
builds a multi-line needle from the file's own convention.

### The two directions of the world table were already correct, and one of them was not

S5's twelve rows are twelve registered worlds, each naming exactly one world, and the `local-api` /
`local-process` row the phase file predicted had already been **split** rather than edited. Nothing in S5
needed a status changed, which is the answer the phase was written to be able to give either way.

### All fourteen headings are built and observed

Each heading now carries one state word - `(built and observed)` - and §4 carries one table giving, per
heading, the command that was actually run and its result: thirteen local exits and one CI job. Fourteen
demos were run in a single pass; `npm run demo` (`local-web`) exits 0 and `npm run demo:no-browser` exits
**2** on purpose, which is why neither is a row - the table's subject is a phase, and the second's
acceptance criterion *is* a non-zero exit code.

**A2 is the row that is honest rather than tidy.** `docker` is not on `PATH` here, so its observation is
CI job `container image`, 16s, success - on run `35423126548`, the last **pushed** commit. Thirteen rows
were taken on this tree; that one was not, and the document says so in the table's own prose rather than
letting a reader infer that all fourteen were re-taken together. **The `still open` state has no member
and the `superseded` state has no member**, which is why §4 states the three states and then reports zero
for two of them instead of leaving a reader to notice.

### Two claims in S1-S3 were falsified by the tree

- **S3's last table row** said a VS Code extension adapter was *"recorded in §5 as a real, unblocked
  future adapter"*. It is Phase C7 and it is **built** - `sim-vscode` loads a real extension in a real
  Node process - and §5 holds no such row. So the cell was wrong twice: the row it pointed at does not
  exist, and the thing it called future is not. *This is the failure mode the phase predicted, one
  section earlier than predicted: a claim about a world that the world contradicted.*
- **S1's decomposition table** answers six request rows and its status columns name **ten** worlds; the
  tree holds twelve. Four worlds arrived after the request - `sim-vscode`, `local-api`, `local-process`,
  `sim-mobile` - and no row asked for them. The fix is not to rewrite the history of a decomposition but
  to say which table is current: S1's status columns answer the six rows as written, and **§5's table is
  the roster**, compared to the code by a guard rather than to this one.

### One more stale measurement, in a place no guard can reach

S4's Cockpit block printed a fenced reading - `72 tests`, `12 files`, `119.98 KB` - and phase 05's twin
surface had moved all three (to `92`, `13`, `125.09`). It was found by counting figures rather than by
reading the prose. **The world table in the same document has a guard and this block does not**, which is
the whole difference: a roster in a table is compared to a constant and a reading in a fence is compared
to nothing. The block was re-taken and now says so.

### Criterion 4, and the answer it turned out to have

The criterion asks that the still-open work have exactly one address. **There is no still-open heading in
this document**, so the address is not here - and the deliverable is that statement plus a place to go.
`docs/phases/README.md` gained a **What is still open, in one place** table naming four items: phases 07
(`blocked here`, with its two measurements), 08 (`gated by 07`), 12 (the receipt half of its memory
criterion), and the one obligation this document carries that is not a phase at all - **A2's re-run after
the next push**. The plan's own backlog and the program's backlog are now one list in one file, which is
what the criterion asked for and is the only form of it that a reader can act on.

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
