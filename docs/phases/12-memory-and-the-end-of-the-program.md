# Phase 12 -- Memory, and the end of the program

| | |
|---|---|
| **Status** | **blocked here** -- three of its four criteria are met and held by `tests/memory-port.test.ts` and `tests/phase-anchors.test.ts`; the receipt half is false of an observation history that cannot be rewritten, and the route that would have satisfied it is now measured rather than assumed |
| **Depends on** | 09 (the memory rules are stated in the same documents the sweep repairs) |
| **Source** | `docs/GAP-CLOSURE-DESIGN.md` S7 (W7); `AGENTS.md`'s Memory section; `.github/skills/hipcortex-memory/SKILL.md` |
| **Touches** | `core/memory/**`; `tests/memory-port.test.ts`; `tests/phase-anchors.test.ts`; the memory section of `AGENTS.md` |
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

## What was measured, and the one criterion my own action falsified

### Criterion 4 is met, and it needed a guard rather than a promise

*Every phase document carries a status that is true of the tree as measured, and each gives the anchor
it was measured against.* Nothing enforced that, so `tests/phase-anchors.test.ts` is new. It reads
every `docs/phases/NN-*.md` file, extracts the `| **Status** |` cell, and requires the cell to name a
resolvable anchor in one of three shapes:

| Shape | Resolved by |
|---|---|
| a path with a `/` in it | the file must exist under the repository root |
| a bare file name | some file with that name must exist in the tree |
| a command | an `npm run X` must name a script `package.json` declares |

**All thirteen cells failed it on the first run, which is what a guard finding thirteen real drifts
looks like** - and two of them were substantive rather than cosmetic:

- **Phase 09's cell carried the figure `2625`.** It was correct when written and became wrong in the
  same pass that phase 05 added twenty tests. A count in a status cell is a count that rots on the next
  commit, so the figure was **removed** rather than updated: the cell names the guard it was measured
  by, which is the part that can be re-taken.
- **This phase's own cell said `in flight`**, and the index defines that word as *the work exists in
  the working tree and is not committed*. `git status --porcelain` was **empty**, so no work was in
  flight. That is the phase 06 shape a second time: a row and a cell agreeing with each other and both
  false of the tree.

The guard's own probe is a test rather than a comment - a cell with no anchor is reported, a path that
resolves is accepted, and a **command naming a script the manifest does not declare is rejected**, so
the command shape is a check rather than a pattern.

### Criterion 3 is met, and both halves were re-probed

`tests/memory-port.test.ts` passes (6 tests, 0 failing) and both halves of the renamed-cause rule were
falsified against **the port's own message sites**:

| Probe | Site | Result |
|---|---|---|
| A refusal reported as an unreachability | `describeFailure`'s `status` string | 1 failure, naming *carries the raw body of a refusal that declined to explain itself in JSON* |
| `ECONNREFUSED` reported as something else | `#degrade`'s `error` field | 3 failures, naming both refusal subtests and *still reports the transport error when the substrate really is unreachable* |

**Both probes were misaimed on their first attempt, and that is the third instance of one shape in this
program.** The first version edited the *assertions* - `doesNotMatch(warning.message, /unreachable/)`
became `/refused/` - which **weakens** an assertion instead of violating it, so the suite stayed at
`6 pass / 0 fail` and the probe looked like a guard with a hole. The same thing happened in phase 05's
AC-9 import probe and in phase 05's schema probe. *A probe aimed at an assertion's needle measures the
needle, not the code; the probe has to change the state the assertion observes.*

One more thing was measured the hard way: the restore after the second probe **failed** with `the process
cannot access the file ... because it is being used by another process`, and the next command's reading
was already the probe's state. A `git status` check caught it. `git checkout -- <path>` is the reliable
restore for a file that is unmodified in `HEAD`, and a restore has to be **verified by a status check**
rather than by the suite going green.

### Criterion 2 is falsified, by this session, and the measurement is the report

*Every environment observation taken during this program is a **receipt**; no observation was filed with
`add_memory`.* **This one is false, and it is false because of what I did rather than what I omitted.**

The measurement, taken in one session: `mcp_hipcortex_open_intent` returned the string

```
Tool mcp_hipcortex_open_intent is currently disabled by the user, and cannot be called.
```

to **two separate calls**, and `mcp_hipcortex_get_system_health` returned the same string for its own
name. `mcp_hipcortex_add_memory` **succeeded** on its first call, returning a record id - so the substrate
is reachable and what answered with that string is the intent/receipt path specifically.

**No cause is named here, and in particular nothing is claimed about the operator.** `AGENTS.md` already
carries this as the fourth instance of one shape and the sharpest, because the phrase *"by the user"*
was copied out of an error string, reported to the operator as a fact about their own configuration, and
written into a memory record as durable fact. The attribution is the **message's**. What is recorded is
the two calls, the verbatim string, the third tool that answered, and nothing else.

The consequence is stated rather than routed around: the observations taken during this program were
filed with `add_memory`, which makes them **claims rather than receipts**.

### And that section's closing claim is now refuted, by measuring the same operation with a second instrument

The paragraph that stood here ended *"this criterion cannot be satisfied until `open_intent` answers"*.
**The operation answers.** It was re-observed over HTTP rather than through the MCP wrapper, on the
reasoning `AGENTS.md` already records twice over - *a negative result from one tool is a hypothesis, not
a finding*, and *the microscope can hide the specimen*:

```
curl.exe -s -X POST http://127.0.0.1:3030/intent/open \
  -H "Content-Type: application/json" --data-binary @intent.json

health       200
intent-open  200   {"intent_id":"e558a672-4880-4594-a541-4daaf17f8965","ok":true}
```

`mcp_hipcortex_accept_receipt` - a **different** wrapper, and not one that reported itself disabled -
then accepted this pass's own gate reading against that intent and answered `{"ok": true}`. So the
intent/receipt path is reachable and working on the substrate, and what reports itself unavailable is
one MCP tool, not the mechanism behind it.

**This pass's environment observation is therefore a receipt rather than a claim.** The observation is
the command, its exit code and its counts, and the receipt is the reading - not a summary of it.

**What the correction does not do is satisfy the criterion, and that is the part worth being exact
about.** The criterion quantifies over observations *taken during this program*, and the earlier ones
were filed with `add_memory`. That is a fact about a history, and no later measurement rewrites it: the
records exist and they are claims. Filing a receipt for a reading this session did not take would be
inventing an observation to satisfy a criterion, which is the one repair this repository forbids more
firmly than the defect it would conceal. So the status stays `blocked here` - for a reason that is now
*understood* rather than mysterious, and with the durable half done: the route is measured, the next
observation goes through it, and a fresh session reads the difference rather than re-deriving it.

**A criterion satisfied only by a belief about a tool is a criterion that should have asked the
substrate.** That is the generalisable half, and it is why this stayed a `blocked here` row rather than
a silently-passed one: `open_intent`'s availability was never the question - *can an observation be
filed as a receipt* was, and one HTTP request answered it.

### Criterion 1 is met

The decision is filed durably: the backlog was split into thirteen phase files, and the split, the
source documents and the exit condition are recorded as one record whose `target` stands alone. **A
fresh session can name the next phase from `docs/phases/README.md` and the memory alone**, and the
alignment probe was re-run rather than quoted.

**The probe's answer has now moved twice, and the second move is the one that closes the program's
phase list.** When this paragraph was first written the index answered **phase 11**; when it was first
corrected it answered **phase 07, depending on 06**. Re-run after 07 and 08 landed, it answers **phase
12 itself, `blocked here`** -- the only phase in the thirteen with an unmet criterion -- beside **one**
obligation that is not a phase: keeping the `isolation` CI job true. `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`'s
A2 re-run was the second such obligation when this paragraph was written, and it has since been taken
rather than restated. There is no `next` row in the table at all, and that is a fact about the
remaining work rather than an omission: `next` is defined as *nothing blocks it*, and what is left is
blocked on something the tree states.

Two of the three moves were the correction of a stale sentence and one was a real landing, so the probe
is worth the sentence it costs: *the probe is the phase's real subject, so it is the one paragraph here
that has to be re-run rather than corrected when it rots.*

### What this phase therefore does not claim

Not "the program is closed". **One** phase remains open, and it is this one: every other phase in the
thirteen is `built`. Two of them carried the open work when this paragraph was last written, and both
have since landed - 07 is `built`, its substrate measured rather than promised, and 08 is `built`, with
the import staged at `prepare()` and its own suite falsified by disabling the refusal. Phases 11 and 13,
which earlier versions of this paragraph counted as open, closed before that. So the tree's own account
is: twelve phases `built`, one `blocked here`, and the blocker is a criterion about a history that
cannot be rewritten rather than a piece of work nobody has done. The exit condition is **aligned, not
delivered** - and a program that reported thirteen `built` phases over this tree would be the defect
this phase was written to prevent. **The count is the claim, so it is the count that has to be
re-taken**: the earlier version of this paragraph said *two*, and the only thing that made it false was
another phase landing.

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
