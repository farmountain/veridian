# Phase 08 -- Import into a prepared world

| | |
|---|---|
| **Status** | next -- 07 has landed, so the gate is cleared; the exit condition is stated in `docs/DIGITAL-TWIN-PLAN.md` |
| **Depends on** | 04 (the document exists) and 07 (there is something to import *into*) |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W3's import half) and S6; `docs/DIGITAL-TWIN-DESIGN.md` S6 |
| **Touches** | `core/environment/load.ts`; the world that accepts an import; a new test |
| **Acceptance** | AC-8 of `docs/DIGITAL-TWIN-PLAN.md` S4: an import is staged at `prepare()` or not at all |

## Why this phase exists, and why it is gated

Phase 04 exports. This phase would import: take an ESI and materialise a world from it. The plan holds
the import half **outside its own exit condition** until the isolation substrate exists, and the reason
is the one rule this repository has paid for **three separate times**:

> **A world a run inherits is not a world that run built.**

The three payments, each in a different layer:

1. `sim-posix`'s `prepare()` made directories without clearing them, so a second run's first observation
   read a `/etc/veridian/policy.conf` that run had never installed, and **two criteria reported `PASS`
   on an artifact from someone else's run.** The run still ended `PASS` with 13/13 -- a false `PASS`, the
   class this product exists to make impossible.
2. `scripts/acceptance.mjs` runs its contract **twice** inside one invocation, and the second run is the
   check, because a single run on a fresh checkout would pass over a world that never rebuilt at all.
   Falsified: blowing away `#rebuild` gave `run 1: exit 0 - PASS / run 2: exit 1 - FAIL`.
3. The un-consumed state left behind because `stop()` keeps a sandbox on purpose, so the *next* run's
   first observation can read the previous run's files.

An imported world is the fourth form of the same defect, and the only defence that has ever worked here
is a single implementation of "make the world" that both `prepare()` and `reset()` call -- `rebuild()`
-- with a test that writes a file into the tree, asserts it **is** readable first (so the test cannot
pass vacuously), and requires it to be gone after a fresh `prepare()`.

## What is already true

- **The constraint the twin vision did not state is already written down:** an imported world enters
  through `prepare()`, because this repository has paid for an inherited world three times. That sentence
  is the whole of this phase's design.
- `core/environment/load.ts`'s `finalizeEnvironment(raw, schemas, source, limits)` is the one place a
  document becomes an `EnvironmentPlan`, and it refuses a bad world by name (a missing
  `$.start.command`, a bad `$.reset.strategy`, a `"custom"` reset with no command, `user === "root"` for
  a posix world, a privileged OS account, a privileged cloud principal). An import is a second producer
  of the same shape and must go through the same refusals.
- **The refusal precedent exists and is the template.** `examples/vscode-cockpit` **refuses by name**
  when `extension/vscode/out` is absent, naming `npm run build`, rather than skipping -- because *a
  skipped check reports a green suite*. An import presented as live must refuse in the same voice.
- `INCONCLUSIVE` is not `PASS`, and it is the right answer for an imported world that cannot be
  materialised.

## What this phase does

1. **Stage the import at `prepare()` and nowhere else.** If the materialisation fails, the world is not
   presented as live: every criterion is `INCONCLUSIVE`, never `PASS`. AC-8 exists to make that
   unfalsifiable-sounding clause falsifiable.
2. **Route the import through the same refusals as any other plan.** An imported document is not a
   privileged document: a plan it cannot express is refused by the same code that refuses a
   hand-written one.
3. **Reverse the export/import the way phase 04 wrote it.** Phase 04's AC-7 asserts export -> import
   yields a byte-identical identity block; this phase is where that assertion acquires an implementation
   on the second half, and where the dENV reading of zero must hold in both directions.
4. **Record which world was imported, and from where.** The bundle already names a world by kind and
   name; an imported world's bundle must make the import visible, or a reader cannot tell a world that
   was built from a world that was handed over.

## Acceptance criterion

- **AC-8** -- an import is staged at `prepare()`. A world presented as live without a successful
  preparation produces `INCONCLUSIVE` on every criterion and **never** `PASS`.
- Export -> import -> export yields a byte-identical identity block, and the dENV refused-key reading is
  zero in both directions.
- An import of a document the plan cannot express is refused by name, by the same code that refuses a
  hand-written plan.

## Falsification probe

- **The vacuous-pass probe, which is the one that decides the phase.** Stage an import, make the
  materialisation fail, and expect every criterion to be `INCONCLUSIVE` rather than `PASS`. Then make
  the materialisation *succeed* and expect the criteria to be judged normally -- the negative control, so
  the guard is not passing by refusing everything.
- **The inherited-world probe, copy the existing one rather than inventing a new one.** Write a file
  into the imported tree by hand, assert it **is** readable, then run a fresh `prepare()` and require it
  to be gone. Falsified in the tree today by restoring the old `prepare()`, which fails that test alone,
  19/20.
- **The refusal probe.** Present an unimplementable import and expect a refusal naming its cause, not a
  silence. An empty refusal is an observation nobody can read.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/execution-loop.test.ts` | The reset semantics and the crossings surviving one |
| `adapters/sim-posix/posix-port.test.ts` | `rebuild()` as one implementation of prepare-and-reset |
| `scripts/acceptance.mjs` | That a run rebuilds the world it uses, by running twice |
| `tests/demo-rosters.test.ts` | That this repository's own acceptance routes stay named in four places |

## Context budget

**Read:** `docs/DIGITAL-TWIN-PLAN.md` S4's W3 block and S6; `core/environment/load.ts`;
`adapters/sim-posix/posix-port.ts`'s `rebuild()`.

**Do not read:** `docs/DIGITAL-TWIN-DESIGN.md` beyond S6. The vision's argument is settled; this phase is
the constraint that came out of it.

## Refusals

- **No import path outside `prepare()`.** The plan refuses this by name, and it is the single reason the
  phase is gated.
- **No `PASS` for a world that was not materialised.** `INCONCLUSIVE` is not `PASS`.
- **No skipping.** If the import cannot run, refuse by name and say the command that would fix it -- the
  `examples/vscode-cockpit` shape. A skipped check reports a green suite.
- **No second `rebuild()`.** One implementation of "make the world", called by both `prepare()` and
  `reset()`.
