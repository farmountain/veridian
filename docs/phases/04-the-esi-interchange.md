# Phase 04 -- The ESI interchange document

| | |
|---|---|
| **Status** | planned |
| **Depends on** | 03 (there is nothing worth exporting until the predicate says what may leave) |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W3); `docs/DIGITAL-TWIN-DESIGN.md` S6 |
| **Touches** | a new interchange writer beside the ELI; a new test; `schemas/` only if the document gets a schema |
| **Acceptance** | AC-7 of `docs/DIGITAL-TWIN-PLAN.md` S4; AC-8 belongs to phase 08 |

## Why this phase exists

Phases 02 and 03 produce a view and a rule about what may leave it. This phase produces the document
that actually leaves: the identity block plus the dENV-approved readings, in a shape a second machine
can read. `docs/DIGITAL-TWIN-PLAN.md` calls it an ESI and constrains it in two ways that are the whole
of the phase:

- **Export only.** There is no import path in this phase. The import half is phase 08, and it is gated
  on the isolation substrate because an imported world is a world the run did not build.
- **Byte-stable.** Exporting the same bundle twice produces the same bytes. A document whose field
  order or key order depends on object iteration is a document two readers cannot diff, and this tree
  already paid for that shape once: a bundle ledger that only appended described a bundle that did not
  exist, listing 36 artifacts for 10 files with four different sizes for one path.

## What is already true

- `serializeEnvironment` writes snake_case keys from an explicitly built record, which is already
  order-stable in practice because the record is constructed rather than spread. The phase's job is to
  make that a **tested property** rather than an accident of construction.
- The tree has a precedent for a document that must be read back rather than trusted: the `.vsix`
  route. `npm run smoke:vsix` exists because a packaging tool's output is not the source tree's
  contract, and *an archive has to be read back to be known*. The ESI deserves the same treatment one
  layer in: the test writes it, reads it back, and compares.
- `schemas/` holds one schema per contract (`goal`, `acceptance`, `environment`, `run`, `result`,
  `ambiguity`) and `core/schema/registry.ts` resolves them from the package root via `core/assets.ts`.
  If the ESI gets a schema it goes there, and the loader's own rule applies: Veridian's own files
  resolve against the module, the operator's against the working directory.

## What this phase does

1. **Define the document.** The world identity block (`kind`, `name`, `detail`) plus the dENV-approved
   per-run readings. Nothing that the predicate refused appears, and nothing the predicate refused is
   represented by a placeholder -- an absent key means the exporter did not carry it, and the reason
   lives in the refusal record.
2. **Make byte-stability a test.** Export twice from the same bundle and compare the two strings with
   `assert.equal`. Then export a record whose keys were inserted in a different order and assert the
   output is identical, because that is the property that makes the first assertion mean anything.
3. **Make the read-back the assertion.** The test parses the exported document and checks the identity
   block field by field against the bundle it came from. *An archive has to be read back to be known.*

## Acceptance criterion

- **AC-7** -- exporting a bundle and re-importing its bytes yields an identity block **byte-identical**
  to the source's, and a dENV reading of zero refused keys reaching the document.
- Exporting the same bundle twice produces identical bytes, and reordering the input record's keys does
  not change the output.

## Falsification probe

Two probes, because the phase has two claims.

- **Order.** Make the writer emit keys by iterating an unordered structure and expect the
  byte-stability assertion to fail. If it does not, the writer was already ordered by construction and
  the test is holding a property the code gets for free -- which is worth knowing, and is why the probe
  is run rather than reasoned about.
- **The predicate's reach.** Feed the exporter a record carrying a key phase 03 refuses, and expect the
  read-back assertion to fail. If the export still matches, phase 03's predicate is being bypassed by
  this writer, and the two phases disagree about what may leave.

The second probe is the one that matters: it is the seam *between* two phases, and this repository's
oldest rule is that two implementations of one rule disagree the first time a world arrives that only
one of them was written for.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/assets.test.ts` | That a file resolved against the caller's directory is not a file the installed program can find -- both halves |
| `tests/schema-vocabulary.test.ts` | That a vocabulary the engine owns and a schema re-states cannot drift |
| `tests/step-kinds.test.ts` | The same rule for the step-kind register |

## Context budget

**Read:** `docs/DIGITAL-TWIN-PLAN.md` S4's W3 block; the ELI module from phase 02.

**Do not read:** `docs/ISOLATION-AND-MCP-PLAN.md` S3.1. The import half is phase 08 and the substrate
is phase 07; neither is this phase's decision to make.

## Refusals

- **No import in this phase.** Writing the reader before the substrate exists would produce a code path
  that resolves a world on this machine and calls it the world's.
- **No `.vsix` rebuild, no extension change.** `docs/DIGITAL-TWIN-PLAN.md` S5 refuses it by name: the
  Cockpit surface is phase 05, and an artifact repackaged to carry a document nobody reads is a
  distribution change with no consumer.
- **No second schema-registry root.** `core/assets.ts` exists because conflating Veridian's own files
  with the operator's was a real defect that reported a missing schema sitting inside the package.
