# Phase 06 -- Network enforcement

| | |
|---|---|
| **Status** | built -- `core/environment/confinement.ts`, held by `tests/confinement.test.ts` |
| **Depends on** | 01 |
| **Source** | `docs/GAP-CLOSURE-DESIGN.md` S9 (W1's retro, the open item); `docs/BOUNDARY-SPINE-DESIGN.md`; `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 |
| **Touches** | `core/environment/confinement.ts`; `core/environment/types.ts`; the adapters whose seam can hold the guard; `tests/boundary-roster.test.ts` |
| **Acceptance** | the network dimension stops being answered by a rule nobody wrote down |

## Why this phase exists

The boundary migration made one dimension honest and left another exactly as it was. Measured, from
`docs/GAP-CLOSURE-DESIGN.md` S9: **all eleven worlds now declare a file allowance at the request seam**
and `filesystemWrite` moved from `enforced` in three worlds to **eleven** -- while the retro's own open
item says, in as many words, that *"`network` is still not enforced anywhere"*.

The premise that has to be corrected before any code is written is in `core/environment/types.ts`, and
it is stale in a way no compiler notices: a bolded claim there says the three worlds that confine a
child are exactly the three that answer with a measurement. That was true when written and is now false
-- the migration left the network arm alone, which is precisely why the sentence went stale. *A premise
in prose is neither a name nor a count, and a guard over a document cannot hold it*: the assertion set in
`tests/boundary-roster.test.ts` stayed correct because nothing about the **set** changed; what went
stale was the **reason**. It was found by searching the tree for the claim, not by reading the file the
change touched.

The corrected statement, which this phase must make true rather than merely write down: **the separation
is a front door, not a child.** Two worlds whose every request passes a guarded route answer
`enforced`; `local-process` has no door and answers `unenforceable`; the other nine answer
`unsupported`. Two plus one plus nine is twelve.

## What is already true

- `core/environment/confinement.ts` exists and carries the seam. `core/process.ts` exists and is the
  runner the worlds hand a file allowance to.
- The vocabulary already has four values, and `environment.json` pairs each **declared** policy with the
  enforcement **measured** for it. Adding a fifth value, or a second vocabulary, is refused here.
- **Measured on this machine, with a positive control:** `node --permission` accepts `--allow-fs-read`,
  `--allow-fs-write` and `--allow-child-process`, and rejects `--allow-net` with `bad option`,
  **exit 9**. So a child process cannot be network-confined on this runtime by that flag, and a phase
  that assumes otherwise would be writing an option the runtime does not have.
- Two worlds own the door: their application reaches the control plane through routes the substitute
  itself answers. Every other `sim-*` world's application talks to its substitute over standard I/O or
  over the substitute's own in-process surface, and the two real worlds start a child or an HTTP
  service.

## What this phase does

1. **Derive the network value for all twelve worlds from what each one's code does**, rather than
   declaring it. The two worlds with a guarded route answer `enforced` **only if** the route actually
   refuses an address outside the world's own origin -- and that refusal is recorded as a boundary
   crossing, which is what makes the answer earned rather than asserted.
2. **Keep `unenforceable` for the world that has no door**, with the measured reason attached:
   `--allow-net` does not exist on this runtime. *An error message may only name a cause the reporter
   observed*, and the reporter observed `bad option`, exit 9.
3. **Keep `unsupported` for the nine**, honestly, because none of them holds an egress seam to guard.
   The tempting move -- marking them `enforced` because no test reaches outside them -- is the defect
   this phase exists to prevent.
4. **Correct the stale premise in `core/environment/types.ts`** in the same pass, and correct the
   matching sentence and assertion title in `tests/boundary-roster.test.ts`, so the reason matches the
   set for the first time since the migration.

## Acceptance criterion

- For each of the twelve worlds, the network dimension answers with one of the existing four values, and
  the value is **derived** from the code rather than read off a literal list beside it. A capability
  report must be derived from what the code did, not from a literal list beside it -- the tree has paid
  for the alternative.
- At least one world's egress attempt is **refused and recorded**, so its `enforced` answer is backed by
  a crossing in the bundle rather than by a declaration. If no world can earn `enforced` on this
  machine, the phase's honest output is that every world is `unenforceable` or `unsupported` **and the
  measured reason is attached** -- which is a smaller claim and a true one.
- `core/environment/types.ts`'s premise and `tests/boundary-roster.test.ts`'s explanation state the
  corrected separation, and a search of the tree for the old sentence returns nothing.

### What was measured, and how the phase was found

This phase was found **already built** when it was picked up, and that is worth recording rather than
quietly flipping its status. Its `| **Status** |` cell said `next` in both the table and its own file,
and the two agreed with each other while both being false of the tree - which is the one thing the
phase guard cannot see, because it compares a status with a status and not with the code.

| Claim of this phase | Where it was measured | Reading |
|---|---|---|
| The stale premise is corrected | `core/environment/types.ts` (the `BOUNDARY_ENFORCEMENTS` doc block) | States *"the separation is a front door rather than a child"*, and names the two guarded-door worlds beside `local-process` |
| The guard derives the split rather than restating it | `tests/boundary-roster.test.ts` (`NAMING_ENFORCED` / `NAMING_UNENFORCEABLE`, derived from each adapter's own `boundaries()` arm) | 14 pass / 0 fail; `enforced` = `local-api`, `local-web`; `unenforceable` = `local-process`; the other nine `unsupported` |
| The answer is earned rather than declared | `adapters/local-web/local-web-environment.ts`'s `boundaries()` | `network === "allow" ? "not-requested" : this.#boundaryHeld ? "enforced" : "unsupported"` - read back from `#spawn`, not written as a literal |
| A refusal is recorded as a crossing | `adapters/local-web/local-web-environment.ts` `#collect`, asserted at `tests/local-web-environment.test.ts` | The crossing carries `boundary: "network"` and the refused subject |
| The old sentence is gone from the tree | `Select-String` over `core`, `tests`, `docs`, `adapters` | Two hits remain, both in `docs/GAP-CLOSURE-DESIGN.md` and `docs/RULES-PAID-FOR.md` - and both are the *record* of the defect, quoted rather than believed |

**The probe, run against a file whose ending was detected from the file and printed (`CRLF`), with the
harness not restoring it before the suite:** patching `local-process`'s network arm from
`"unenforceable"` to `"enforced"` fails **3** subtests - the vocabulary claim, the document roster,
and the count - which is the derivation proving it reads the adapters rather than a list.

The third probe this phase names - patching the stale sentence back - is recorded here as the phase
itself records it: **useless on its own.** A guard that holds a vocabulary's *membership* cannot hold
its *meaning*, which is why the search above is a step of this phase rather than something a test
covers.

## Falsification probe

- **The declared-versus-measured probe.** Make one world answer `enforced` for network while its route
  answers an outside address, and expect the boundary test to fail. This is the phase's central claim;
  if it cannot fail, the derivation is decorative.
- **The derived-not-listed probe.** Replace the derivation with a literal twelve-entry map and expect a
  test to fail. If nothing fails, the derivation is a restatement and the phase has changed no property.
- **The stale-premise probe, already known to be useless on its own.** Patching the old sentence back
  into `core/environment/types.ts` leaves `tests/boundary-roster.test.ts` at 14 pass / 0 fail, because
  that guard asserts only that the prose **names** the four values and the three worlds. *A guard that
  holds a vocabulary's membership cannot hold its meaning.* The way to hold a premise is to search for
  it, so the phase adds the search as a step rather than pretending the guard covers it.

All three probes are run against a file whose line ending is detected **from the file itself** and
printed, and the harness must not restore the file before running the suite.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/boundary-roster.test.ts` | Twelve adapters selected by `implements EnvironmentAdapter`, each classified, each with a register entry, in both directions |
| `tests/sim-k8s-environment.test.ts` | That the runner's allowance reaches the dependencies the application imports -- the regression that made a demo report `INCONCLUSIVE (ABORTED, 0 iteration(s))` |
| `tests/execution-loop.test.ts` | A crossing seen in an early iteration still fails the run after the reset |
| every `tests/*-environment.test.ts` | That each world's own reading still says what it said |

## Context budget

**Read:** `docs/GAP-CLOSURE-DESIGN.md` S9's W1 retro only; `core/environment/confinement.ts`;
`core/environment/types.ts`'s boundary block; `tests/boundary-roster.test.ts`.

**Do not read:** `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 in full -- its measured facts are quoted above,
and the substrate itself is phase 07. `docs/DIGITAL-TWIN-*.md` are untouched by this phase.

## Refusals

- **No `--allow-net`.** The runtime rejects it with `bad option`, exit 9. Writing it would be writing an
  option that does not exist and reporting an enforcement that never ran.
- **No fifth vocabulary value.** Declared, enforced, unenforceable and unsupported are the four the tree
  has; a new one for "we did not look" would be a rendering for an absence.
- **No promotion of `unsupported` to `enforced` because nothing tests it.** A boundary that cannot be
  tripped is not a boundary, and a world with no egress seam has nothing to enforce.
- **Do not widen a boundary to make a test pass.** When the mobile suite's path fixture turned out to be
  platform-dependent, the fixture was the defect and the predicate was left byte for byte alone -- *a
  repair aimed at the predicate would have widened a boundary in order to make a test pass, which is the
  one direction a boundary repair must never go.*
