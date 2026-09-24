# The digital twin: aligning a two-way vision with a one-way product

This document answers one question: **what of the bidirectional digital-twin vision is already
true in this tree, what is genuinely missing, and what must not be built at all?** It is written
the way the rest of this repository's plans are written - every claim anchored to a `file:line` or
to a command's own output, every guardrail given a falsification probe, and a section stating what
the document does **not** claim.

## 0. What this rests on, measured

| Fact | Measurement |
|---|---|
| Tip | `8220075` on `main` and `feat/mcp-surface`; tag `v0.5.0` -> `3960824` |
| Suite | `node --test` -> 2556 tests / 425 suites / 0 failing, `duration_ms` ~10300 |
| Types | `npx tsc --noEmit` -> silent, exit 0 |
| Worlds | 12 adapters, 12 validator families |
| Twin vocabulary in the tree | `grep` for `digital[- ]twin`, `Environment Lifecycle Index`, `\bELI\b`, `materializ`, `lineage` -> **zero hits**. Every `reconstruct` hit is unrelated prose (a k8s substitute, a doc comment about rebuilding a run) |

Two tooling facts belong here rather than in a footnote, because they change how this document was
produced and a reader is entitled to know:

- **KARM was unavailable.** `mcp_karm_kakeya_a_karm_substrate_health` was called twice and both
  calls returned, verbatim:
  `Tool mcp_karm_kakeya_a_karm_substrate_health is currently disabled by the user, and cannot be called.`
  I quote it and name no cause; the file this repository keeps on the subject records why naming one
  is the defect (*an error message may only name a cause the reporter observed*). The reasoning below
  is therefore explicit step-by-step CoT/ReAct rather than a KARM-driven loop. Nothing here is
  presented as KARM output, and no KARM metric is cited.
- **HipCortex had nothing to say about this subject.** `get_live_beliefs` -> *"No live beliefs
  found."*; `reflect` on the twin returned `Confidence: 0.5`, `LLM: unavailable`, and ten evidence
  bullets that are **entirely about an unrelated tracking-pipeline session**. That output is not used
  as design input here. It did corroborate one *method* rule this document applies throughout: an
  **absence verdict needs a known-present control in the same run**, because absence is the one
  answer every broken instrument returns. That is why section 3 states, for each gap, not only what
  is missing but what is measurably present beside it.

## 1. The goal this is aligned against

The vision is not new to this repository. Read against `docs/PLAN.md`, three sections already
declare the twin's *substance* while never using the word:

- **§43 Snapshot and Replay Architecture** - `Environment Snapshot -> Execution -> Observation ->
  Failure -> Restore Snapshot -> Replay`, with every agent run beginning from a snapshot `S0` "which
  enables agent comparison".
- **§59 Strategic Moat** - *"the unified environment abstraction + reproducible state +
  cross-environment validation + evidence model"*, rendered as
  `Same Goal -> Same Acceptance Contract -> Different Environment -> Same Validation Semantics ->
  Comparable Evidence`.
- **§60 Final Architecture Principle** - *"Do not build the intelligence that creates the software.
  Build the world that determines whether the software actually works."*

So the correct first finding is a **negative** one about the gap analysis itself: this is not a
vision the plan omitted. It is a vision the plan holds in the vocabulary of *snapshot, replay,
reproducible state and comparable evidence*, and which the tree has since implemented in pieces
without ever giving the pieces a name. Section 3 measures each piece.

ReAct trace, step 1: `plan(§43, §59) -> observe(tree) -> conclusion: the task is to join and name,
not to invent`. That conclusion determines the whole shape of what follows, and section 3.6 is where
it is defended.

## 2. Why "twin" is a type claim before it is a feature claim

First principles. Discard the marketing words and write down what the vision asserts.

A digital twin asserts the existence of a **mapping** between two states of the same system:

```
M_out :  S_sandbox  ->  S_external(dst)      the export direction
M_in  :  S_external(src)  ->  S_sandbox      the import direction
```

Three properties follow immediately, and none of them is optional:

1. **`M` is a partial function.** There is a declared domain `dom(M)` outside which the map does
   not exist. A bucket, a container image and a mobile keychain entry do not map to each other, and
   a map that silently stretches to cover them is a lossy promise, not a twin.
2. **`M` carries a fidelity label.** Without one, `M` is *unlabelled*, and an unlabelled map is
   unfalsifiable: no reading can ever contradict it. Fidelity is not a feature of the twin. It is
   **the type of the mapping** - the same relationship `BoundaryPolicy` has to `BoundaryReport`.
3. **`M_in` moves state across a trust boundary.** Export writes sandbox state outward; import
   writes *external, unvetted* state inward. Those are not symmetric operations and must not share
   one implementation.

Now the inversion, which is the move that makes this buildable at all. The vision asks *"how do we
export the sandbox to production and import production into the sandbox?"* Invert it:

> **What must never cross, in either direction?**

That question is answerable today, cheaply, with no new infrastructure, and its answer **is** the
sanitization boundary and the domain declaration `dom(M)`. The forward question is a multi-year
programme; the inverted question is a predicate and a redaction pass. This is the same inversion
this repository already used to order its adapter roadmap in
[`DISTRIBUTION-AND-ENVIRONMENTS.md`](./DISTRIBUTION-AND-ENVIRONMENTS.md), where each remaining row
was reframed from "blocked" to "the `sim-*` world that answers it".

Paul-Elder, applied to the gap analysis's own assumptions. Two of them do not survive contact with
the tree:

- **Assumption: "production" is a well-defined target.** For a product whose second governing rule
  is *"the agent is a client of the product"*, the sandbox deliberately has **no** production. Twelve
  worlds, and the closest thing to a peer is a **substitute** the world itself stands in. So the
  export direction has no natural `dst` unless the operator names one, which means Phase 1 below is
  a *format*, not a deployment.
- **Assumption: the twin is additive to the verdict.** It is not. Importing external state makes the
  run's world one it **inherited**, and section 6 shows this repository has paid for that rule
  three times. The twin therefore changes programme *ordering* even before it changes code.

## 3. The six claims, each measured

Three verdicts are used, and a fourth is refused. The verdicts are **satisfied**, **partial**,
**missing**. The refused option is "unknown", because a claim nobody measured is not a third kind of
claim - it is an unrun check, which this repository treats as a defect that has not been observed
yet.

| # | Claim from the gap analysis | Verdict | What is measurably present | What is actually missing |
|---|---|---|---|---|
| 1 | No Environment Lifecycle Index (ELI) | **partial** | A per-run identity surface; cross-run enumeration; a 6-column cross-run snapshot | A module that *joins* them; identity that survives into `environment.json` |
| 2 | No bidirectional materialization | **partial** (export) / **missing** (import) | `snapshot()`/`restore()` are interface members; 7 worlds implement, 3 refuse by name | Any ESI reader/writer outside `.veridian/`; the import direction entirely |
| 3 | No fidelity / sanitization boundary | **partial** | A declared-vs-measured vocabulary already exists; a redaction precedent already exists | A fourth *fidelity* dimension; a general export predicate |
| 4 | No Cockpit twin surface | **missing, and correctly deferred** | The Cockpit is a thin client over Core | Anything - see 3.4 for why building it now would be a UI over nothing |
| 5 | Isolation still open | **missing, deferred by measurement** | `docs/ISOLATION-AND-MCP-PLAN.md` §3.1 records `docker` absent from `PATH` and `node --permission --allow-net` rejected with exit 9 | The substrate - and it is a *precondition* of claim 2's import direction, not a sibling |
| 6 | Documentation lag | **partial, and the lag is vocabulary** | `PLAN.md` §43/§59 pre-declare the substance | The words. The repair is naming, not re-planning |

### 3.1 Claim 1: the ELI is three pieces that do not know about each other

Measured, three independent surfaces already exist:

1. **A per-run identity declaration.** `EnvironmentPlan` (`core/environment/types.ts:475`-`635`)
   carries two flat identity fields - `url` (`:491`) and `databasePath` (`:516`) - and **ten**
   per-world declaration blocks: `api` (`:502`), `cluster` (`:526`), `posix` (`:537`), `os`
   (`:548`), `cloud` (`:560`), `container` (`:575`), `vscode` (`:588`), `process` (`:602`),
   `data` (`:612`), `mobile` (`:623`). Two plus ten is twelve: **every world already has an identity
   slot**, and `local-web` and `local-db` are identified by the two flat fields. The count
   reconciles exactly, which is what distinguishes it from a recalled figure.
2. **A cross-run snapshot.** `RunSnapshot` (`core/metrics/metrics.ts:42`-`60`) already carries
   `runId` (`:43`), `verdict` (`:44`), `goalId` (`:55`), `adapter` (`:56`), `criteria` (`:58`) and
   `iterations` (`:60`) - six columns. `listRuns` (`core/metrics/history.ts:65`) already enumerates
   the runs directory and `readRunHistory` (`:29`) already reads each one.
3. **A per-run lifecycle record.** `EnvironmentRecord` (`core/evidence/types.ts:73`) carries
   `transitions` (`:101`) - the state-machine walk - beside `BoundaryRecord` (`:51`).

So the ELI is **not missing as data**. It is missing as a **join**: nothing composes (1), (2) and
(3), and - the sharper and more actionable half - surface (1) does not survive into the bundle at
all. That is section 4, and it is the first thing worth fixing.

### 3.2 Claim 2: materialization exists inside the world and nowhere outside it

Measured across `adapters/` (251 matches over 20 files): `snapshot()` and `restore()` are members of
`EnvironmentAdapter` (`core/environment/types.ts:140`), implemented by `local-db`, `sim-os`,
`sim-posix`, `sim-cloud`, `sim-container`, `sim-mobile` and `sim-vscode`, and **refused by name**
through `NO_SNAPSHOT` constants by the last three of those rather than silently downgraded to a
restart. `local-web` and `local-process` state plainly that they do not snapshot.

That is real materialization, and it is **exactly the export direction of the twin, scoped to a
single sandbox**. What does not exist is any *cross-system* materialization: there is no reader or
writer of a state interchange document outside `.veridian/`, so `M_out` has no wire format and
`M_in` has no implementation. The gap analysis's word "no bidirectional materialization" is
therefore true about the *system* and false about the *world* - and conflating those two is how a
solved problem gets rebuilt.

### 3.3 Claim 3: the fidelity vocabulary exists; only its fourth dimension does not

`BOUNDARY_ENFORCEMENTS = [enforced, unsupported, not-requested, unenforceable]`
(`core/environment/types.ts:91`, type at `:97`) is already a **declared-versus-measured**
vocabulary, and it is already the right shape for fidelity: it says what was *claimed* and, in the
same document, what was *achieved*. `BoundaryReport` (`:126`) and `BoundaryPolicy` (`:133`) are the
pair that keeps them apart, and `BreakdownRecord`-style pairing of `policy` with `enforcement`
per boundary is already written into the bundle (`core/evidence/types.ts:51`).

A **redaction precedent** also exists, measured in `sim-mobile`: a recorded command has its secret
flag value **redacted rather than omitted**, so the request's shape survives into the bundle while
the value does not. That is the sanitization boundary's core idea, already implemented once, at a
seam where the stakes were a single flag.

What is missing is (a) the fourth dimension - *data fidelity*, distinct from network and filesystem
enforcement - and (b) a **general** export predicate rather than one key's special case. Neither
requires a new vocabulary. Both require extending one that already exists, which is the opposite of
what the gap analysis implies.

### 3.4 Claim 4: a Cockpit twin surface would be a UI over nothing

There is no twin surface in `extension/vscode/`, and building one now would invert the dependency
the extension's own README states. The Cockpit is *"a thin client over a stable local Core
interface"*; a twin panel needs the core artifact, the index and the wire format to exist first.
Building the panel first would produce the exact defect pattern this repository records repeatedly -
a surface whose backing fact is a literal, a claim pretending to be a record. **Deferred, on
measurement, to Phase 4**, and the deferral is a decision rather than an omission.

### 3.5 Claim 5: isolation is a precondition of the twin, not a sibling of it

`docs/ISOLATION-AND-MCP-PLAN.md` §3.1 defers the isolation substrate, and its absence is a
**measurement** rather than a preference: `docker` is not on `PATH`, and `node --permission` rejects
`--allow-net` with exit 9. Those figures are recorded in that document with a positive control.

The inversion that matters here: importing unvetted external state into a sandbox **is** the
untrusted-input case that isolation exists for. So the twin's import direction cannot ship before
the substrate does, and the twin does not raise the priority of isolation so much as *depend* on it.
This is a sequencing constraint derived from the tree, and the gap analysis did not state it.

### 3.6 Claim 6: the lag is vocabulary, and the repair is naming

Zero tree hits for twin/ELI/materializ/lineage, beside `PLAN.md` §43 and §59 declaring the
substance. Both facts are true and they point the same way: **the plan is not behind the code, and
the code is not behind the plan - the words are behind both.** The correct response is a name for an
existing join, not a new roadmap. Compare this repository's own record of the opposite failure,
where a document described a command that no longer behaved that way and the README was corrected in
the same pass: here the document is *ahead*, and the code needs the vocabulary so that the join has
something to be called.

## 4. The first defect worth fixing, measured

This is the finding the rest of the document exists to make actionable, and it is the inverse of the
shape this repository records most often.

`environment.json` is documented as *"what world this run measured, so a reader can rebuild it"*
(`core/evidence/types.ts:73`). The record it holds is `EnvironmentRecord`, and
`serializeEnvironment` (`core/evidence/writer.ts:147`-`180`) writes exactly:
`adapter`, `app`, `app_path`, `url`, `database_path`, `command`, `args`, `env`, `health`, `reset`,
`browser`, `valid`, `health_report`, `boundary`, `transitions`.

**None of the ten per-world declaration blocks appears in that list.** The two flat identity fields -
`url` and `databasePath` - do survive; the ten named blocks do not.

Consequences, stated precisely rather than dramatically:

- `local-web` and `local-db` are still identified by the bundle (`url`, `database_path`).
- `local-api` keeps its flat `url` but loses its `ApiPlan` - the block that exists, in the file's own
  words, *"as an identity, deliberately not folded into `url`"*.
- The eight `sim-*` worlds and `local-process` lose their declaration entirely. A reader opening a
  `sim-cloud` bundle cannot learn which account, region or principal the verdict was reached against
  from `environment.json` - only `adapter: "sim-cloud"`.

The reason this is the *inverse* of the common defect is worth recording, because it is what makes
the fix cheap and its absence hard to notice. The rule this repository paid for repeatedly is *a
run-time fact has to reach the plan, not just the object built from it*. Here the fact **did** reach
the plan - deliberately, with the plan's own comments explaining why - and then the plan's identity
was dropped one layer later, at serialization. Nothing failed, because nothing reads
`environment.json` for identity: the per-criterion **reading** carries identity (the `sim-cloud`
source says so directly: *"every reading names the account, the region and the declared principal it
did it as, because the first question asked of a cloud result is whose account"*), and the criteria
are what the verdict is computed from. Identity survives *inside* the artifacts and evaporates in
the summary. **A summary that cannot name its subject is not auditable, however complete its
artifacts are** - and this is precisely the property `PLAN.md` §59 names as the moat
(*"comparable evidence"*).

The fix is narrow on purpose, following the seam that already exists:

- Extend `EnvironmentRecord` (`core/evidence/types.ts:73`) with the world's declaration - one
  optional field, or a discriminated `world: { kind, name, detail } | null` - rather than ten
  top-level fields, so a thirteenth world does not widen the record by a key.
- Extend `environmentRecord()` (`core/evidence/writer.ts:539`) to copy it, and
  `serializeEnvironment` (`:147`) to write it. Both are single call sites; the record is built by a
  function precisely so a second resolution cannot be written by hand.
- Extend **M5** (evidence completeness) so that a plan-declared identity missing from the bundle is
  an *incompleteness*, not a silent `null` - because a silent `null` is exactly how this defect
  stayed invisible.

## 5. Do not invent a parallel vocabulary

The strongest single recommendation in this document is a negative one. Four words the vision wants
already exist in this tree with adjacent meanings, and a new vocabulary beside them would be the
fifth occurrence of a defect this repository has recorded five times - *a vocabulary the engine owns
and something else re-states will fall behind*, in the schema, in a roster, in a `oneOf`, in a
surfaces constant, in a document.

| The vision's word | What already exists | Where |
|---|---|---|
| fidelity | `enforced / unsupported / not-requested / unenforceable` - declared versus measured | `core/environment/types.ts:91` |
| sanitization | a secret flag **redacted rather than omitted**, so shape survives | `adapters/sim-mobile` |
| snapshot / replay | `snapshot()` / `restore()` as interface members, refused by name where impossible | `core/environment/types.ts:140`, `adapters/*` |
| lifecycle | `transitions` and `BoundaryRecord`, already in the bundle | `core/evidence/types.ts:51`, `:101` |

So Phase 0 below **adds no vocabulary**. It gives the existing join a name - *Environment Lifecycle
Index*, *ESI* for the interchange document, *fidelity* as a fourth `BOUNDARY_ENFORCEMENTS`-shaped
dimension - and then reuses the enforcement pair for all of them.

## 6. The constraint the vision did not state

`PLAN.md` §43 says every run begins from snapshot `S0`. The twin's import direction violates that
unless it is staged, and this repository has already paid for the violation three times:

1. `sim-posix`'s `prepare()` did not clear the sandbox, so a second run's first iteration read a
   file **it had never installed**, and two criteria reported `PASS` on another run's artifact. It
   was found by running the demo twice and comparing progressions, not by reading the port.
2. `scripts/acceptance.mjs` exists because one run on a fresh checkout would pass over a world that
   never rebuilt at all - *a world a run inherits is not a world that run built*.
3. `sim-cloud`'s provisioning guard counted the account's **whole life** rather than the current
   run's requests, so after a restart whose re-provisioned application connected zero times, the
   *first* provisioning's call satisfied the count.

Therefore the rule the twin must obey, stated as a constraint rather than a preference:

> **An imported world enters through `prepare()`, as a declaration, and never as a live world.**

A run that imports `S_external` must record it as a declared input, rebuild the sandbox from it at
`prepare()`, and be judged against resources **this run** materialized. Anything else re-imports the
exact false-`PASS` class this product exists to make impossible - and it does so in the one place
where the state is by construction not the product's own.

## 7. Phases, with measurable acceptance criteria

Each phase carries an acceptance criterion **derived from an existing metric** rather than invented,
and a probe that falsifies the guard. The derivation matters: M1..M5 are already the repository's
measurable definition of "the world worked", and a twin criterion that does not reduce to one of
them is a criterion nothing can measure.

**Phase 0 - name the join, and stop the identity leak (section 4).**

| # | Acceptance criterion | Derived from | Falsification probe |
|---|---|---|---|
| AC-1 | For every world whose plan declares an identity block, the bundle's `environment.json` carries it | M5 evidence completeness | Delete one key from `serializeEnvironment`; a guard that reads the plan's field list **and** the serializer's keys must fail, naming the world |
| AC-2 | A plan-declared identity absent from the bundle is an M5 incompleteness, not a `null` | M5 | Remove the identity from `environmentRecord()`; M5 must report it missing |

**Phase 1 - the index (the ELI), as a join over data that exists.**

| # | Acceptance criterion | Derived from | Falsification probe |
|---|---|---|---|
| AC-3 | Enumerating existing bundles yields one row per run carrying `runId`, `goalId`, `adapter`, world identity, verdict | M1 subject identity | Point the index at a history of two subjects; the rows must not merge - the same shape M1's subject-scoping fix already guards |
| AC-4 | Two runs of one goal on one adapter join into a comparable pair; two different goals do **not** | M1 (`measured`, three states) | Widen the join; a heterogeneous history must report "not a question this could answer", never a divergence |

**Phase 2 - ΔENV, and the inversion.**

| # | Acceptance criterion | Derived from | Falsification probe |
|---|---|---|---|
| AC-5 | ΔENV over two runs of one subject is **empty** (the world came back to the same resources) | M4 reset reproducibility, extended from "a reset happened" to "the same resources returned" | Blow away a reset; ΔENV must become non-empty and name the resource |
| AC-6 | The export predicate is **total** and refuses a named key set, and a refused value never reaches the artifact | M3 zero false PASS | Remove the predicate; a secret must land in the bundle and the guard must fail - the *known-present control* the reflect output insisted on |

**Phase 3 - the wire format (ESI), export only.**

| # | Acceptance criterion | Derived from | Falsification probe |
|---|---|---|---|
| AC-7 | An ESI exported from a run, imported into a fresh sandbox, yields byte-identical `environment.json` identity and an identical ΔENV of zero | M4 + M1 | Corrupt one field in the ESI; the import must refuse by name rather than resolve |
| AC-8 | Import is staged at `prepare()` and the run is judged on resources *it* materialized | section 6 | Import as a live world; the run must report `INCONCLUSIVE`, never `PASS` |

**Phase 4 - the surfaces: Cockpit (3.4) and, if it ever lands, the isolation substrate (3.5).**
Only after Phases 0-3 exist. **AC-9:** the Cockpit twin panel reads the ELI and renders it, with no
validation logic in the extension - held by the existing `host-boundary` rule that only two files
may import `vscode`.

## 8. What this deliberately does not do

- **It does not build an orchestration or deployment layer.** The hard scope boundary in `AGENTS.md`
  forbids becoming an autonomous development platform or a cloud deployment platform, and a twin
  that deployed sandbox state to a provider would be the second one. Phase 3 produces a **document**;
  what a consumer does with it is the consumer's.
- **It does not add a vocabulary parallel to `BOUNDARY_ENFORCEMENTS`** (section 5).
- **It does not make import depend on anything but `prepare()`** (section 6).
- **It does not claim the import direction is available.** Phase 3 is export-only, and the import
  half is gated on the isolation substrate that `ISOLATION-AND-MCP-PLAN.md` §3.1 measured as
  unavailable on this machine.
- **It does not present any KARM metric as evidence.** KARM was unavailable for this document, and
  the honest statement of that is in section 0.

## 9. Order, and the exit condition

```
Phase 0  identity survives the bundle        one field, two call sites, two guards
Phase 1  the ELI, as a join                  no new data, one new module
Phase 2  dENV + the inverted predicate       reuses BOUNDARY_ENFORCEMENTS
Phase 3  ESI, export only                    gated: isolation, for import
Phase 4  surfaces                            gated: Phases 0-3
```

**Exit condition.** The twin is aligned - not "delivered" - when `environment.json` names its world
for all twelve worlds (AC-1), the ELI joins existing bundles without new persistence (AC-3), ΔENV is
computable and zero across a clean reset (AC-5), and the export predicate refuses a named key set
with a probe that proves refusal (AC-6). The import half is explicitly **out of the exit condition**
until the isolation substrate is available on a machine that can run it.

## 10. What would falsify each claim

| Claim | This document is wrong if |
|---|---|
| 1 The ELI is a join, not new data | an index over existing bundles cannot recover `goalId` and world identity without re-running |
| 2 Materialization exists inside the world | `snapshot()`/`restore()` turn out to be dead code - i.e. no adapter's implementation is reachable from the loop |
| 3 The fidelity vocabulary already exists | `BOUNDARY_ENFORCEMENTS` is never consulted for a *data* decision, only network/filesystem |
| 4 A Cockpit surface would be a UI over nothing | the ELI can be produced from data the Cockpit already holds |
| 5 Isolation is a precondition of import | an import path exists that cannot be reached by untrusted state |
| 6 The lag is vocabulary | `PLAN.md` §43/§59 are found to contradict, rather than pre-declare, the twin's properties |
| §4 The identity leak is real | `serializeEnvironment` writes a per-world block this document missed - **check this first, by reading `core/evidence/writer.ts:147`** |
| 3.1 Every world has an identity slot | a thirteenth world lands with no plan field, or the 2 + 10 = 12 reconciliation fails on a re-count |
