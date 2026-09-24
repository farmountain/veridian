# Phase 04 -- The ESI interchange document

| | |
|---|---|
| **Status** | built |
| **Depends on** | 03 (there is nothing worth exporting until the predicate says what may leave) -- landed |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W3); `docs/DIGITAL-TWIN-DESIGN.md` S6 |
| **Touches** | `core/metrics/esi.ts` (the writer, beside the ELI); `tests/esi-interchange.test.ts`; no `schemas/` entry, see below |
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

### What was measured, and one correction to this phase's own words

`AC-7`'s "byte-identical to the source's" cannot be true of the document as the phase first described
it, because dENV is what makes the export an export: a `database` world's name and a `process` world's
command line are *rendered* and *refused* respectively, so the exported identity block is deliberately
not byte-equal to the raw bundle. The claim that can be true - and the one now asserted - is that the
**round trip** is lossless: `parseEsi(exported.json).world` is byte-identical to the block the exporter
wrote. Both halves are in the suite, and the second is asserted only for a kind where rendering is a
no-op (`web`), which is the one place the two readings coincide.

Both of the phase's falsification probes were run, each against a file whose line ending was detected
and printed (`CRLF`), with the harness **not** restoring the file before the suite:

| Probe | What was patched | Observed |
|-------|------------------|----------|
| Order | `canonicalJson`'s key sort removed | `the ESI is byte-stable` fails, **1** subtest |
| Predicate's reach | `exportDocument(raw)` replaced with a pass-through | `nothing the predicate refused reaches the ESI` fails, **2** subtests |

The second is the seam between phases 03 and 04, and it fires in both directions asked of it: the
sibling assertion ("the app name is in the artifact") still passes, so it is the *escape* being
detected rather than an empty document.

**No schema was added,** which this phase's `Touches` row left open. A schema's job is to be read by a
validator, and this document has no reader in this tree: the import half is phase 08, the Cockpit
surface is phase 05, and `core/schema/registry.ts` resolves schemas for the *contracts* the engine
loads. A schema nothing validates against is the capability list this repository has paid for five
times - a claim beside the code rather than derived from it - so the document's shape is held by
`parseEsi`'s parsing and by the roster guard on `esi.ts`'s exports instead.

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
