# Phase 03 -- dENV and the export predicate

| | |
|---|---|
| **Status** | built |
| **Depends on** | 02 (the ELI names the rows; dENV says which of them may leave) |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W2); `docs/DIGITAL-TWIN-DESIGN.md` S8's Phase 2 |
| **Touches** | `core/metrics/denv.ts`, `core/metrics/eli.ts` (the join), `scripts/denv-reading.mjs`, and `tests/denv-export.test.ts` |
| **Acceptance** | AC-5 and AC-6 of `docs/DIGITAL-TWIN-PLAN.md` S4 |

## Why this phase exists

An ELI row is a reading of a run, and a run's own files can contain things that must not travel: the
absolute path of the operator's checkout, the command line that started it, the environment a repair
agent inherited. `docs/DIGITAL-TWIN-PLAN.md` calls the per-row decision that keeps those out **dENV**,
and it is carried on the shape the boundary work already uses -- a **declared-versus-measured** pair --
rather than on a vocabulary of its own. This tree has eleven worlds and exactly one vocabulary for "what
this world said it would do" beside "what it was measured doing"; a second one for exports would drift
from it.

The reason this is a phase rather than a paragraph is the word **total**. A predicate that refuses a
named list of keys is not a predicate: it is a list, and the list is right up until a bundle carries a
key nobody thought of. The requirement in the plan is that the predicate is **total over the record** --
defined for every key, including ones invented after it was written -- so a new field is refused by
default rather than exported by default.

## What is already true

- `core/environment/types.ts`'s `BOUNDARY_ENFORCEMENTS` pairs each *declared* policy with the
  enforcement *measured* for it, and `environment.json` writes the pair. That is the shape W2 reuses.
  This paragraph first named `core/environment/boundary.ts` for it, and there is no such file: **read
  the vocabulary at `types.ts`, which holds `BOUNDARY_ENFORCEMENTS` and the derived
  `BoundaryEnforcement`** - the two names were one module written twice.
- `core/evidence/writer.ts` already has the serialization seam: `serializeEnvironment` writes a fixed
  key set, and `environmentRecord()` builds it. Anything that leaves the process already passes through
  one function, which is what makes a total predicate expressible at all.
- The tree already knows what a rejection looks like from the other direction:
  `core/environment/confinement.ts` refuses a request that leaves the allowed roots and records the
  refusal rather than silently resolving it. A refused export should record the same way -- a refusal
  is an observation, not an absence.

## What this phase does

1. **Write the predicate as a totality, not a blacklist.** For every key in the record, the predicate
   answers one of: *exports as itself*, *exports in a rendered form*, or *does not export*, with the
   reason. A key it has no rule for is refused. The stub for an unknown key must be reachable in the
   test; a default branch no fixture reaches is a branch nothing holds.
2. **Make the refusal visible without making it fatal.** A refused value never reaches an artifact --
   that is the acceptance criterion -- and the fact that it was refused is itself recordable, on the
   same argument that gives `sim-cloud` a `refusalBody`: *a status code is a verdict; the body is the
   evidence*.
3. **Prove the totality with a known-present control.** See the probe below. This is the half of the
   phase that decides whether the predicate is real.

## Acceptance criterion

- **AC-5** -- dENV is empty across a clean reset. Read on this repository's own bundles rather than on a
  fixture, because `.veridian/` is gitignored and holds no committed file: a unit test asserting a
  delta over it would pass here and fail on a fresh clone, reporting the checkout rather than the code.
  The reading is therefore `npm run reading:denv`, which calls the same `listEliEnvDeltas` the fixture
  suite exercises. **Measured 2026-09-24** over 14 subjects and 1527 pairs: `local-api@local-api` is
  6 runs, **15 pairs, 0 non-empty** -- AC-5's own figure, and the only subject whose reading is clean.
  Five keys move on the other thirteen subjects, and the first draft of this bullet named three of
  them: `boundary` (ten subjects), `app_path` (`sim-container`, `sim-mobile`, `veridian-cockpit`,
  `veridian-mvp`), `world` (`veridian-mvp`), `valid` (`local-process`) and `browser`
  (`shopping-cart`). Every one of those is contract drift, a published port, an operator's checkout
  or a world that really is recorded invalid -- recorded as a change and not as a failed reset, which
  is why the reading is scoped to one subject rather than taken across different ones.
- **AC-6** -- the export predicate is **total** over the record: it answers for every key, and it
  refuses a named key set whose members are chosen *because* they are present in the fixture.
- **The totality is over keys, and the first version of this phase stopped there - which was a hole.**
  `ruleFor` answered for every top-level key, and `world` was ruled `kept`, so the identity block left
  as a unit. But `worldIdentity()` builds that block out of the plan, and for **eight** of the twelve
  kinds the name or a detail is a location: `ClusterPlan.imagesPath` is documented as absolute on
  `databasePath`'s own rule, every `root` is absolute, `ProcessPlan.application` puts the operator's
  command line into `detail.command`/`detail.args`, and a `database` world is **named after its file**.
  Measured on this repository's own bundle: `database_path` is
  `D:/all_projects/Veridian/examples/inventory-db/app/data.db`, and for a post-W0 `local-db` run the
  *same value* is also `world.name` and `world.detail.path` - rendered in one slot and exported in the
  other. `world`, `boundary` and `reset` are now `rendered` through named renderers, and the guard is a
  **sweep over all twelve kinds** rather than a list of the ones that leaked, so a thirteenth block is
  a row somebody adds rather than a leak nobody notices. The falsification probe - reverting `world` to
  `kept` - fails exactly eight subtests, one per location-carrying kind.
- A refused value never reaches an artifact. Asserted by building a record that **does** carry a
  refused key, exporting it, and reading the exported document for the key's value -- not by reading the
  predicate's source.
- The refusal path is reachable: the fixture contains at least one key the predicate refuses, and the
  test asserts it is present in the input as its positive control.

## Falsification probe

The dangerous version of this test asks whether the exported document lacks a key. That assertion
passes for a predicate that refuses everything, for a serialiser that wrote nothing, and for a fixture
that never had the key -- three different defects, one green line.

So the control is explicit and it must be able to fail:

1. Assert the offending key **is** present in the record before export. (Positive control. If this
   fails, the probe measured a fixture, not a predicate.)
2. Export.
3. Assert the key's value is absent from the exported document, **and** that a known-good sibling key's
   value **is** present. (The sibling is what stops "refused everything" from passing.)

Then move the admitted/refused boundary -- make a key that was refused admitted -- and expect step 3's
second half to fail. A guard that cannot fail is the thing this tree has paid for four times over.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/boundary-roster.test.ts` | That declared-versus-measured is still one vocabulary across twelve worlds |
| `tests/evidence-bundle.test.ts` | The bundle's own completeness readings, which share the serialization seam |
| `tests/simulated-surfaces.test.ts` | That a world's declared surfaces and the document's table agree |

## Context budget

**Read:** `docs/DIGITAL-TWIN-PLAN.md` S4's W2 block; `core/environment/types.ts` for
`BOUNDARY_ENFORCEMENTS` (there is no `core/environment/boundary.ts`); `core/evidence/writer.ts`.

**Do not read:** the twelve `*-observation.ts` files. dENV is a decision about keys, and the per-world
readings are phase 02's input as a projection, not this phase's subject.

## Refusals

- **No new vocabulary for "may leave".** The declared-versus-measured pair already exists; a second one
  would answer the same question in a second spelling.
- **No export of an absolute host path.** A bundle already records the world's **own** spelling of a
  root beside the accession it resolved to, precisely because a field that is both an input to the agent
  and an output of the recording is two fields in one slot. An export keeps the declaration.
- **No "redact by default and log what was redacted" shortcut.** Redaction without a reason string is
  the empty refusal body this tree already rejected once.
