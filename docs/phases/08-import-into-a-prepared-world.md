# Phase 08 -- Import into a prepared world

| | |
|---|---|
| **Status** | **built** -- the verifier is `core/metrics/import.ts`, the declaration and the verification are two separate fields on the plan `core/environment/load.ts` builds, and the phase's own suite is `tests/world-import.test.ts` |
| **Depends on** | 04 (the document exists) and 07 (there is something to import *into*) |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W3's import half) and S6; `docs/DIGITAL-TWIN-DESIGN.md` S6 |
| **Touches** | `core/metrics/import.ts` (new); `core/environment/load.ts`; `core/environment/manager.ts`; `core/definition.ts`; `core/evidence/types.ts` and `core/evidence/writer.ts`; `core/metrics/denv.ts`; `schemas/environment.schema.json`; a new test |
| **Acceptance** | AC-8 of `docs/DIGITAL-TWIN-PLAN.md` S4: an import is staged at `prepare()` or not at all |

## Why this phase exists, and why it is gated

Phase 04 exports. The obvious reading of this phase is that it imports: take an ESI and materialise a
world from it. **It does not, and the first thing this phase measured was that the obvious reading is
the dangerous one.** An import that *materialises* is a second implementation of "make the world", and
a second implementation is exactly what the three defects below are made of. So the delivered thing is
narrower and stranger than the title: an import is a **verification**. The reader compares the identity
a document names with the identity the operator's own plan already derives, and refuses when they
differ; the world is then built by the adapter that would have built it anyway. `import` therefore
cannot produce a world, and *that* is the property that makes the phase safe rather than the substrate.

The reason it was gated at all is the one rule this repository has paid for **three separate times**:

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

- **The vacuous-pass probe, which is the one that decides the phase. RUN.** The refusal in
  `prepare()` was disabled (`if (false && plan.imported !== null ...)`) and the suite was re-run:
  **exit 1, `# pass 17 / # fail 1`, failing on exactly one named subtest** --
  `refuses a declared-and-unstaged import before the world is created at all`. The line was restored
  and the restore was asserted by reading it back (`git diff --stat` showing insertions and no
  deletions) rather than by the suite going green, because a suite that is green after a restore and a
  suite that was green all along are the same output. The **negative control** is the second subtest of
  the same describe: an adopted world prepares, `create` is called, and the adoption transition
  precedes the creation transition -- so the pair cannot pass for a manager that refuses everything.
- **The inherited-world probe, copied rather than invented.** Write a file into the tree by hand,
  assert it **is** readable, then run a fresh `prepare()` and require it to be gone. This is a **prior
  measurement cited rather than re-taken here**: `adapters/sim-posix/posix-port.test.ts` holds it, and
  the phase that last falsified it restored the old `prepare()` and got that test failing alone, 19/20.
  Re-taking it would say nothing about this phase, which adds no second implementation of
  "make the world" -- the whole reason the import verifies instead of materialising is so that it
  cannot.
- **The refusal probe. RUN.** Every refusal in this phase names its cause, and three are asserted by
  text rather than by truthiness: the mismatched identity (naming the world it found), the
  declared-but-unstaged plan (naming the document and the path), and the adoption record with no
  matching declaration (naming both paths). An empty refusal is an observation nobody can read.

## What this phase measured

- **AC-8 holds, and it is held by a refusal rather than by a comment.** `core/environment/manager.ts`'s
  `prepare()` returns `this.#refuse("ENVIRONMENT_FAILURE", ...)` when `plan.imported !== null` and
  `plan.adopted === null`, and that statement sits **above** `prepare()`'s `"creating"` step. So an
  adoption that was declared and not staged never reaches the point where a world is created, and the
  bundle's `environment.json` carries `imported: null` rather than an adoption nothing performed.
- **The two fields are the model decision the phase paid for.** `imported` is the declaration the
  operator's document makes; `adopted` is the verification the program completed. **One field cannot
  spell the difference between "declared nothing" and "declared and not staged", and it is the second
  state a run reports.** With one field the two states collapse and AC-8 stops being falsifiable,
  because the loader would have to verify an identity against a plan that does not exist yet. The pair
  is checked in one direction only: a record with no matching declaration is refused by name, while a
  declaration with no record is allowed - that is the state the verifier builds a plan in on its way to
  producing the record.
- **The verification compares identities, not documents.** `core/metrics/import.ts`'s `firstDifference`
  renders `worldIdentity(plan)` on the local side and names the fact that differs ("the document names a
  `process` world called `loopback`") rather than reporting that two things differ. Its three exports -
  `importWorld`, `readImportDocument`, `isImportRefusal` - are held as a roster by the new suite in the
  same shape `tests/esi-interchange.test.ts` holds `esi.ts`'s four, and the module's **actual import
  statements** are asserted to reach no adapter.
- **The import is one file over from the export, on purpose.** It was written as
  `core/environment/import.ts` and moved to `core/metrics/import.ts`, because `core/environment` is a
  leaf and an import beside the loader would have made the loader's own directory into a consumer of
  the metrics barrel. `core/metrics/esi.ts` still exports its four functions and none of them resolves
  a world; that assertion was **not** edited to permit the change, and it did not need to be.
- **Export -> import -> export is byte-identical, and the negative control is total idempotence.** The
  suite asserts the ESI read back and exported again is byte-for-byte the same, and then asserts that a
  *second* round-trip changes nothing either, so a pass cannot come from a transform that differs on
  every pass in a compensating way.
- **Both directions of the dENV reading were taken.** `core/metrics/denv.ts` gained
  `imported: renderImport` as a **decided** rule rather than an unruled key - an unruled key is refused
  by name as "a field added after this table was written" - so the refused-key reading stays zero with
  an adopted record on the record, which is the second half of AC-7.
- **The instrumentation site was the environment record's third question.** `EnvironmentRecord` gained
  a required `imported` field, `serializeEnvironment()` writes it, and `evidenceCompleteness()` asks
  whether the written document carries it. That is what connects M5 - *100% evidence completeness* - to
  this phase rather than leaving the adoption as a fact only the in-memory plan knows.
- **`tests/world-import.test.ts`, 18 tests over 6 suites, all green**, in two halves: the roster half
  reads the *source text* to hold that the decision is in `prepare()` and above `creating`, and the
  behavioural half runs `prepare()` itself against an adapter double and reads the outcome. The second
  half exists because the first is not the criterion: AC-8 is about what a run produces, and a claim
  about source text is not a claim about a run.
- **Gate over the whole tree:** `npx tsc --noEmit` silent, and `node --test` at **2693 tests, 451
  suites, 0 failures**, measured over the finished tree - Veridian's own 2601 plus the 92 the VS Code
  Cockpit contributes. `docs/phases/07-the-isolation-substrate.md`'s `2675 tests / 445 suites / 0 fail`
  is that phase's own moment rather than a stale figure, so it is left as measured.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/execution-loop.test.ts` | The reset semantics and the crossings surviving one |
| `adapters/sim-posix/posix-port.test.ts` | `rebuild()` as one implementation of prepare-and-reset |
| `tests/esi-interchange.test.ts` | That `core/metrics/esi.ts` exports exactly its four functions and no import path - the assertion phase 08 made non-vacuous by not editing it |
| `scripts/acceptance.mjs` | That a run rebuilds the world it uses, by running twice |
| `tests/demo-rosters.test.ts` | That this repository's own acceptance routes stay named in four places |

## What this phase does not claim

- **It does not claim an imported world is isolated.** The import verifies an identity and stages a
  record; where the world's work then runs is phase 07's `IsolationPort`, and on this machine the
  substrate is Podman, not a kernel boundary. An adopted world and a locally built one are held to
  exactly the same confinement, and no more.
- **It does not claim a foreign world can be executed here.** A document naming a world this tree does
  not have is refused by name, not approximated. The refusal is the deliverable.
- **It does not claim the copy is safe.** A plan the document's own adapter block cannot express is
  refused by the same loader code that refuses a hand-written one - but "the same refusals" is a claim
  about the loader, not a security boundary. Nothing here has been red-teamed, and
  `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 still measures the substrate's own limits.
- **It does not claim the probe list was exhausted.** The falsification probes below were each run
  against a real defect in this pass and each is named there. A probe this file does not list is a
  probe nobody ran.

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
