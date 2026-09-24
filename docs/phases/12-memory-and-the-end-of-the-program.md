# Phase 12 -- Memory, and the end of the program

| | |
|---|---|
| **Status** | in flight -- the disclosure half is built; the discipline half is this phase |
| **Depends on** | 09 (the memory rules are stated in the same documents the sweep repairs) |
| **Source** | `docs/GAP-CLOSURE-DESIGN.md` S7 (W7); `AGENTS.md`'s Memory section; `.github/skills/hipcortex-memory/SKILL.md` |
| **Touches** | `core/memory/**`; `tests/memory-port.test.ts`; the memory section of `AGENTS.md` |
| **Acceptance** | the tree's account of its own memory matches the port's behaviour, and the phase program is closed |

## Why this phase exists, and why it is last

Every other phase in this program produces a fact. This one is about what happens to the facts, and it is
last because it is the only phase whose subject is the program itself: **a phase program that is not
written down anywhere durable is a plan that dies with the session that produced it.**

The memory half is also where this repository made its sharpest recorded mistake, and the rule that came
out of it is the reason the phase has an acceptance criterion rather than a paragraph:

> **An error message may only name a cause the reporter observed.**

`HttpMemory#post()` read only `response.status`, so the substrate's own
`403 {"error":"precondition blocked: PII risk=0.90 patterns=[\"PII:...\"]"}` reached the log as the bare
word `HTTP 403`, under a warning that went on to assert the substrate was **unreachable**. It was
reachable and healthy; a content precondition had refused the write. The false diagnosis was not
cosmetic: it sent the agent through four scratch probes and four terminal runs hunting a host, a payload
size, a record type and a header -- all four eliminated, none ever at fault -- while the answer had been
returned and thrown away two lines earlier.

Three further errors compounded, and each is now a rule in `AGENTS.md`:

1. **A string was read as a fact about a person.** The host renders an unavailable tool as *"currently
   disabled by the user"*, and that attribution is the **message's**, not a measurement. The phrase was
   copied out of the error string, reported to the operator as a claim about their own configuration, and
   then **written into a memory record as durable fact** -- so it would have survived into every later
   session. The operator had disabled nothing; re-running both tools answered immediately, **in the same
   session in which both were reported as disabled**.
2. **Two different failures were merged into one story.** The first `open_intent` rejection was a
   client-side schema error -- `must have required property 'target_entity'` -- not a disablement, and
   folding it into "your configuration is blocking me" gave one invented cause two pieces of apparent
   support.
3. **No retry preceded the diagnosis.**

The other half is the *environment observation* rule. Observations must go through the intent/receipt
path -- **never `add_memory`**:

```
open_intent     { actor, target_entity }              -> intent_id      (target_entity is REQUIRED)
accept_receipt  { actor, intent_id, observation, sensor_path, ok }  -> {"ok": true}
```

A gate reading filed this way is a **receipt, not a claim**: the observation is the command, its exit code
and its counts. That distinction is the same one the phase program's own index draws between *built* and
*observed*, and it is why this phase is last.

## What is already true

- **`core/memory/` is optional and never required to run.** Version 1 of Veridian must not depend on a
  memory server being up.
- **`tests/memory-port.test.ts` holds both halves of the defect above**: a refused write reports
  `precondition blocked` and does **not** contain "unreachable", while a genuine `ECONNREFUSED` still
  does. *Unreachable* means `ECONNREFUSED` -- the one cause that word is still allowed to name.
- **`core/memory/` has tests because the port had none**, and the absence is exactly why the defect
  reached a demo run.
- **The memory rules are stated in four places** (`AGENTS.md`'s Memory section, the skill, the port's own
  doc comments, and the tests' names), which means the drift risk here is the same drift risk phase 09
  sweeps -- and the section is therefore in scope for that sweep.

## What this phase does

1. **File this program's facts durably.** The decision that the backlog was split into twelve phases, which
   source documents were chosen, which were rejected, and what each phase covers -- recorded as a
   **Decision** so a later session does not re-derive it. The record's `target` must **stand alone**: it
   names the decision, the alternatives and the reason, with no pronouns.
2. **File the environment observations as receipts.** The censuses, the gate readings, the git state and
   the port-readiness probes go through `open_intent` -> `accept_receipt` with `target_entity` supplied,
   because a receipt is the observation -- the command, the exit code, the counts -- and `add_memory`
   would make it a claim.
3. **Correct in place rather than contradicting.** A record that turns out wrong is updated, not answered
   with a second record. *Two records that disagree are one claim that will be read twice.*
4. **A refusal is reported, never skipped, and never renamed.** If the substrate refuses a write, the
   reason it gave is the report: a refusal arrives as `HTTP 403` with a content precondition in the body,
   and a refusal is **not** an unreachability. The honest response is to report the reason and keep
   writing on the next decision.
5. **Close the program.** The exit condition is **aligned, not delivered**: the phase program is complete
   when the twelve phases each have a status that is true of the tree, when the next actionable phase is
   named, and when the facts needed to start it are durable. It is *not* complete when every phase is
   "done" -- a program that reports twelve green phases over a tree that still has open work is the same
   defect as a demo that reports `PASS` over an unbuilt world.

## Acceptance criterion

- The phase program's decision is durable, and a **fresh session** can name the next phase and its
  dependency from the memory and the index alone, without reading any plan document.
- Every environment observation taken during this program is a **receipt**; no observation was filed with
  `add_memory`.
- `tests/memory-port.test.ts` passes, and it is re-probed rather than trusted: the refused-write branch
  must still say `precondition blocked` and must still not say "unreachable".
- Every phase document carries a status that is true of the tree **as measured**, and each gives the
  anchor -- a path, a symbol or a command -- it was measured against.

## Falsification probe

- **The renamed-cause probe.** Make the port report a refusal as "unreachable" and expect the named
  subtest to fail. Then restore it and make it report a genuine `ECONNREFUSED` as something else and
  expect the other half to fail. Both halves exist and both must be re-run.
- **The stand-alone probe.** Take one memory record written during this program and remove the file it
  came from. If the record cannot be understood without it, the record fails the rule and is rewritten.
- **The pointer-not-literal probe.** Any requirement naming a *place* (`cluster.name`, `health.path`,
  `database.path`) must be resolved as a pointer. It was once read as a literal key, so a correct
  document raised three **blocking** gaps for values sitting in the file, and the operator's answer would
  have been written to the literal key -- *a question the answer cannot close.*
- **The alignment probe, which is the phase's real subject.** Ask the index for the next phase and act on
  it. If the answer is stale, the program was documented rather than closed.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/memory-port.test.ts` | A refusal names its refusal and an unreachability names its cause |
| `tests/mcp-demo.test.ts` | That nothing under `core/**` names the MCP surface -- the layering rule as code |
| `tests/environment-gaps.test.ts` | That the environment predicate is one implementation, iterated over the register rather than restated |
| `tests/docs-roster.test.ts` | That this phase's own document is indexed, if it is a top-level `docs/*.md` |
| `npm run gate` | The whole thing: typecheck, then the suite, on both platforms in CI |

## Context budget

**Read:** `AGENTS.md`'s Memory section; `core/memory/`'s port and its test; `.github/skills/hipcortex-memory/SKILL.md`.

**Do not read:** the plan documents. By this point in the program their still-open content has one
address, and that address is the index.

## Refusals

- **No memory dependency for running Veridian.** It is optional by construction, and version 1 must work
  with the server down.
- **No `add_memory` for an environment observation.** That path is the intent/receipt seam.
- **No KARM metric as evidence in the tree.** KARM is a research scaffold, and a `COMPLETE` metric is not
  evidence of general competence.
- **No second record that contradicts a first.** Correct in place.
- **No "twelve phases, all done" closing sentence.** The closing statement is the status of the tree, and
  a status is measured.
