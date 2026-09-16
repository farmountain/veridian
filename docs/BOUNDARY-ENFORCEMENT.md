# Boundary enforcement

Why the goal's safety limits are applied rather than only recorded, what was found missing first,
and the exact scope of the fix.

**Status: implemented.** Written before the change, kept afterwards as the record of the reasoning —
the same role `docs/IMPLEMENTATION-PLAN.md` plays for the MVP.

---

## 1. Why this document exists

`AGENTS.md` states a run is `PASS` only if every mandatory criterion passed **and** the environment
was valid **and** there was no safety violation **and** all required evidence exists.

An audit of the shipped build found that the third clause could not be false. `networkPolicy` and
`filesystemWrite` were declared in the schema, defaulted by the clarification ladder, parsed into
`GoalLimits`, and then never read by anything that could act on them. The guard that consumes a
violation (`rollup`'s `noSafetyViolation`) was implemented and tested, but no code path in a running
system could produce the value it tests — and a fourth defect meant that even had one, the bundle
could not have recorded it.

This is a **declared boundary mistaken for an enforced one**. A `PASS` resting on it asserts more
than was observed.

## 2. The audit

Every claim below was produced by reading the tree, not by reciting the README.

| # | Claim | Evidence |
|---|-------|----------|
| F1 | `networkPolicy` never reaches an enforcement point | Only reads are `core/goal/load.ts:143` (parse), `core/clarification/derive.ts:103` and `detect.ts:226` (default/require), `cli/veridian.ts:332` and `core/evidence/writer.ts:548` (record as metadata). Zero occurrences in `core/execution/**`, `core/environment/**`, `adapters/**`, `validators/**`. |
| F2 | `filesystemWrite` is read by nothing at all | Parsed at `core/goal/load.ts:144`; after that only the default rule (`derive.ts:109`), the required-limit detector (`detect.ts:226`) and its type. No consumer. |
| F3 | `safetyViolation` has no producer | `core/execution/loop.ts:57` reads `options.safetyViolation`, documented as "Non-null when an action crossed a declared boundary"; `cli/veridian.ts` never sets it, so it is always `null`. |
| F4 | The bundle hard-codes "no violation" | `core/evidence/writer.ts:185` writes `safetyViolation: null` as a literal. `RunOutcome` (`core/evidence/types.ts`) has no field to carry one. Two records of one fact, one of them constant. |
| F5 | `allow-list` is unrepresentable | `schemas/goal.schema.json` offers `networkPolicy: ["deny","allow-list","allow"]`, but no field anywhere carries the list. A policy with no parameter. |
| F6 | The plan cannot carry a boundary | `EnvironmentPlan` (`core/environment/types.ts:168`) has no boundary field, so an adapter could not enforce one even if it tried. This is the `--browser none` lesson recurring: *a run-time fact has to reach the plan, not just the object built from it.* |

`AGENTS.md:126-127` already scopes the MVP to a local trusted development mode and says the adapter
architecture must leave room for stronger isolation later. So F1–F6 are a **documented posture, not a
hidden gap** — but a posture described only in prose is not a record, and the artifact said
`safetyViolation: null` as though it had been checked.

## 3. Self-prompted questions

The clarification mechanism is applied to this change the way `AGENTS.md` requires it to be applied
to any goal: resolve by self-prompting first, and put only genuinely critical questions to the user.
These are the questions asked and answered before writing code. None required the user to answer,
because in each case the artifact itself settled it.

**Q1. Should a run whose declared boundary is unenforced be capped at `INCONCLUSIVE`?**
*Resolved: no.* `rollup`'s guard reads `input.safetyViolation === null` and its reason string is
"no safety violation". No world can prove the absence of *all* violations; it can only report the
ones it monitors. Enforcement does not make the guard provable — it makes violations **detectable**.
The clause has always meant "none was observed", so widening what can be observed is the fix, and
capping the verdict would be answering a different question.

**Q2. Then how does a reader learn the boundary was not applied?**
*Resolved: pair the declaration with its enforcement status, in the artifact that describes the
world.* `environment.json` is defined as "what world this run measured". A policy that was declared
and not applied is precisely a property of that world, so the two facts are written as one object and
cannot be read apart. `cli/veridian.ts` states it out loud at run start as well.

**Q3. Does this break the canonical demo, which declares `networkPolicy: deny`?**
*Resolved: no.* The demo's page is served from `127.0.0.1:4317` and makes no outbound request. Under
`deny`, same-origin is permitted and nothing else is attempted, so no crossing occurs.

**Q4. Is `filesystemWrite: sandbox` enforceable in this adapter?**
*Answered: no, and it must say so rather than imply otherwise.* The application runs as an ordinary
child process with the operator's privileges; only real process isolation could hold that boundary,
and `AGENTS.md` scopes the MVP local and trusted. `local-web` therefore reports
`filesystemWrite: unsupported` and the record carries it.

> **Superseded — the answer rested on a mechanism claim that measurement falsified.** "Only real
> process isolation could hold that boundary" is wrong. Node 22's permission model holds it
> in-process: `--permission --allow-fs-write=<dir>` confines a child's writes with no VM, no
> container and no image anywhere in the loop, and it is *measured* rather than assumed —
> `confinementCapability()` in `core/environment/confinement.ts` probes the permitted half first,
> because a probe whose permitted half fails measures nothing about the refused half. `local-web`,
> `local-api` and `local-process` now run their children under it and report `filesystemWrite:
> enforced`. The answer above is kept because it is what the self-prompting produced and because the
> error is the instructive part: it was a claim about a *runtime*, made without reading the runtime,
> and it is the fourth time this repository has paid for that shape. See §10.

**Q5. Should the boundary be raised through the clarification ladder as a gap?**
*Deferred, with reason.* It would demonstrate the protocol at one more lifecycle stage, but a
detector reports gaps in a **document**, and this is a fact about an **adapter**. Raising it as an
ambiguity would make the ladder's records mean two different things. The disclosure belongs in the
environment record, where it is already going.

**Q6. Should a second, non-web adapter be built to close `acceptance/veridian-mvp.yaml`?**
*Resolved: no.* `AGENTS.md` and `IMPLEMENTATION-PLAN.md` §8 forbid building an adapter the MVP
excludes, and doing so would not serve the goal of shipping something others install and run. The
gap stays recorded. See §7.

## 4. The design

Four moves, in dependency order.

**4.1 The boundary becomes part of the resolved plan.** A goal *declares* a boundary; the plan is
what the world is *built from*, so the plan is where an enforceable boundary lives.

```
GoalLimits.networkPolicy      "deny" | "allow-list" | "allow"
GoalLimits.networkAllowList   readonly string[]        (new — F5: allow-list needs its parameter)
GoalLimits.filesystemWrite    "deny" | "sandbox"
        ↓ merged in core/definition.ts
EnvironmentPlan.boundary      { network, allow, filesystemWrite }
```

`networkAllowList` is **declared with a default, not added to the schema's `required` list**, and the
implementation is where that was decided: adding it to `required` broke two tests in
`core/schema/validate.test.ts`, one of them named *"requires the whole safety-limit block, because an
omitted limit reads as an unlimited one"*. That name is the rule. The required block is the limits
whose absence would read as *unlimited*; `networkAllowList` has a default of `[]`, which under `deny`
and `allow-list` is the narrowest reading, so requiring it would be ceremony that teaches operators to
paste an empty array without reading it — and it would reject every goal document already in the tree,
including the canonical demo's. **A test that encodes a decision is allowed to overrule the edit that
contradicts it.**

**4.2 The adapter enforces what it can and reports what it did.** A new shared vocabulary in
`core/environment/types.ts` — the same place `web-observation.ts` lives, for the same reason: it
keeps `adapters/*` and `validators/*` from depending on each other.

```
BoundaryEnforcement  "enforced" | "unsupported" | "unenforceable" | "not-requested"
BoundaryCrossing     { boundary, subject, criterionId, at }
BoundaryReport       { network, filesystemWrite, crossings }
```

**`unenforceable` was added later and is not a synonym for `unsupported`.** `unsupported` means this
world has no mechanism for this boundary and never claimed one; `unenforceable` means a mechanism
*should* exist for it and demonstrably does not, so the absence is a finding about the platform rather
than a property of the adapter. Exactly one world answers that way — `local-process`, whose network
half reads `unenforceable` because **`node --allow-net` does not exist**: measured with a positive
control, `--permission` on this runtime is accepted (exit 0) while `--allow-net=127.0.0.1` is rejected
as a `bad option` (exit 9). `local-web` and `local-api` answer `enforced` for the same boundary,
because each has a guarded front door every request must pass (Playwright's route interceptor, the
contract's own request guard) and can therefore really refuse one. **The three worlds that confine a
child are exactly the three that answer that question with a measurement**, and
`tests/boundary-roster.test.ts` derives that split from the adapters themselves rather than from this
paragraph — so a twelfth world cannot join either side in silence.

`EnvironmentAdapter` and `WorldPort` each gain one read-only method, `boundaries(): BoundaryReport`.
It is **required, not optional**: an optional method is one a real adapter may silently omit, which
is F1 exactly.

**4.3 The loop reads the crossing live.** `safetyViolation` stops being a loop *input* that nobody
supplies and becomes a reading of the world, unioned with the injected value so the existing
injection point and its tests keep working. All four `rollup` call sites use it.

**4.4 The bundle records it.** `RunOutcome` gains `safetyViolation`, `serializeResult` writes it
instead of the constant (F4), and `EnvironmentRecord` gains `boundary`, whose every entry pairs a
policy with the enforcement status measured for it.

### What is deliberately unchanged

- `rollup`, its guards, and the `SECURITY_VIOLATION → FAIL` path. The code was right; it was starved.
- The verdict rule. No new way exists to turn a non-decisive status into a success.
- The schema's `safetyViolation: ["string","null"]`. The vocabulary was already there.

## 5. Implementation plan

Each step names the command that proves it. `npm run gate` is `tsc --noEmit` then `node --test`
(346 tests when this work started, 373 when it finished). Every step is done; the proof column names
the test that holds it rather than the file that was edited, because an edit is not evidence.

| Step | Change | Proof |
|------|--------|-------|
| 1 | `networkAllowList` in the schema, the loader, the derive rules and the required-limit detector | a goal omitting it still resolves with `[]`, and the ladder records the default — `tests/definition-resolution.test.ts`; a non-origin in the list is refused at its own index |
| 2 | Boundary vocabulary + `EnvironmentPlan.boundary` | `tests/definition-resolution.test.ts`: the plan carries the goal's policy, and its allow list only under `allow-list` |
| 3 | `PlaywrightSession.newPage` installs a route interceptor when the policy is not `allow` | `tests/playwright-guard.test.ts`: same-origin proceeds, a foreign origin is refused and named, an unparseable URL fails closed. The decision is proven offline; the wiring is proven by `npm run e2e` |
| 4 | `LocalWebEnvironment#capture` accrues crossings; `boundaries()` reports enforcement per policy | `tests/local-web-environment.test.ts`: a refused request becomes a crossing, `filesystemWrite` reports `enforced` because the child is confined, and an uninstalled guard reports `unsupported` rather than `enforced` |
| 5 | `WorldPort.boundaries()`, live `safetyViolation` in the loop | `tests/execution-loop.test.ts`: a world reporting a crossing yields `FAIL` + `SECURITY_VIOLATION` even though every criterion passed |
| 6 | `RunOutcome.safetyViolation`, `EnvironmentRecord.boundary`, both serializers | `tests/evidence-bundle.test.ts`: a violation reaches `result.json`, and the environment record pairs policy with enforcement |
| 7 | CLI disclosure when a declared boundary is unsupported | `npm run demo:no-browser`: the line appears, and the exit code stays 2 |
| 8 | README, `AGENTS.md`, `IMPLEMENTATION-PLAN.md`, this document's status | `npm run demo` unchanged at exit 0; `npm run gate` green |

## 6. Bounded exit

The self-prompting loop above is not open-ended. It stops when every question opened has one of four
answers — resolved by the artifact, resolved by the code, deferred with a stated reason, or escalated
to the user — and it is capped at the point where a further question would change no code. Q1–Q6 all
reached a terminal answer; none needed the user, because the repository already contained the rule
that decided it. Had one not, the question to the user would have been this single one:

> *Should Veridian refuse to run a goal that declares a boundary its only adapter cannot enforce?*

It was not asked because Q2 settled a weaker, sufficient answer: record it, disclose it, and do not
let a declaration be read as an enforcement.

## 7. Considered and deferred

| Considered | Deferred because |
|------------|------------------|
| Refusing to run when a declared boundary is unenforceable | `networkPolicy: deny` is the ladder **default**, so every goal written without limits would be refused. It would make Veridian unusable out of the box. || Capping the verdict at `INCONCLUSIVE` for an unenforced boundary | Q1: the guard means "none observed", and no world can prove a universal negative. |
| A boundary ambiguity raised through the clarification ladder | Q5: a detector reports document gaps, not adapter capabilities. |
| Real filesystem isolation (containers, jobs, a VM) | Out of MVP scope; the adapter interface leaves room for it. |
| A second non-web adapter, to close `acceptance/veridian-mvp.yaml` | Q6: excluded by the scope boundary. |
| Publishing to npm | Declined by the user at ship time, and since taken - see [`DISTRIBUTION-AND-ENVIRONMENTS.md`](./DISTRIBUTION-AND-ENVIRONMENTS.md) §4 A1. Out of *boundary enforcement*'s scope either way. |
| A schema for the bundle's `environment.json` | `schemas/environment.schema.json` describes the environment *document* an operator writes, not the environment *record* a run writes, and only `result.json` is validated by the writer. The new `boundary` block therefore has no machine-readable contract yet. Adding one is a bundle-format change of its own, larger than this fix, and the record still cannot claim an enforcement it did not measure. |

## 8. What would overturn this

- A second adapter that **can** enforce `filesystemWrite` — the record would then have to say
  `enforced` for that world, which is a different reading of the same document.
- A goal whose whole point is isolation, where "no violation observed" is insufficient without
  capability disclosure gating the verdict. That would need a fourth `rollup` guard, and the
  decision would be made there rather than here.

## 9. What the implementation changed about this plan

Four decisions were not in §4 and were taken while writing the code, each because the artifact
asked a question the design had not. They are recorded here for the same reason §2 is: the design
document is a claim too.

**A crossing is run-scoped and survives a reset.** `LocalWebEnvironment#crossings` is never cleared by
`reset()`. Clearing it would let an iteration that reached outside the boundary be followed by a clean
one, and the run would report `PASS` with an empty `crossings` list — the evidence of the violation
destroyed by the act of repairing it. *A reset restores the world; it does not restore the record.*
`tests/execution-loop.test.ts` pins it: a crossing in iteration two is still the run's in iteration
three.

**The guard is awaited, and an installation that fails reports `unsupported`.** A fire-and-forget
route registration whose promise rejected would leave `refusals()` empty while the adapter said
`enforced` — a false assurance built out of an unhandled rejection. `#boundaryHeld` therefore starts
`false`, a failed `newPage` sets it back to `false`, and the failure propagates as
`ENVIRONMENT_FAILURE`. The report takes the fail-safe direction.

**`refusalSubject` is exported.** The decision "is this request inside the boundary" is a pure
function of a URL, a method and an allow-list, and it is now provable without Chromium. This is the
same split the demo uses elsewhere: prove the logic offline, prove the wiring with a real browser.

**The CLI disclosure is narrow on purpose.** It warns only when the run was planned *without a
browser* — the one case where nothing could have refused a request — and only about the network half.
Warning about `filesystemWrite` on every run would be true and useless, and a signal that fires on
the default goal is a signal operators learn to skip. The full picture is in `environment.json`,
where the policy and its enforcement are written as one object.

## 10. What §8 anticipated, and what arrived

§8's first bullet was *"a second adapter that **can** enforce `filesystemWrite` — the record would
then have to say `enforced` for that world, which is a different reading of the same document."*
That condition has been met, twice over, and a design document whose stated overturn condition
arrives is obliged to say so rather than to be quietly outgrown.

**`local-process` met the second bullet, and inverted it.** There is no mechanism to hold a *network*
boundary for a host child process on this runtime, so the honest answer is not "unsupported by this
adapter" but "not available on this platform" — which is what `unenforceable` names. It is the
stronger of the two disclosures: `unsupported` reports an adapter's reach, `unenforceable` reports a
limit of the world every adapter runs in.

**`local-web`, `local-api` and `local-process` all met the first bullet for the filesystem half**,
through Node's permission model rather than through a VM. The consequence for this document is the
one §8 predicted: the same policy now reads differently in different worlds, and that divergence is
correct rather than inconsistent. A world whose every request passes a guarded front door can really
refuse one and reports `enforced`; a world with no such door has only the child's own socket to
reason about and reports `unenforceable`.

**And the audit that produced those three answers found a live defect beneath them.** The two worlds
that confine their child passed `writeRoots: []` when the policy was `sandbox` — an allowance list
that permitted nothing. The mechanism worked, the declaration was right, and the *boundary the
operator asked for was never held*, while `environment.json` said `enforced`. Measured across every
bundle on disk, the default policy is `sandbox`, so the defect was live on **every recorded run**.
It is fixed in both adapters, held by `tests/local-web-environment.test.ts` from both directions, and
falsified by two probes that each force the arm back.

**The last thing found was the root cause of a failure three worlds had each been mitigating
separately.** `core/process.ts`'s `ProcessHandle.stop()` awaited `exited` on POSIX but returned as
soon as `taskkill` closed on Windows. So `stop()` could resolve while the old child was still
closing, and a caller that stopped and immediately re-spawned — which is what every reset does —
could publish the *dead* child's result into the new child's slot. `probe()` reads the child and its
exit together, so it reported a world that was up as stopped, and the run aborted with *"never became
ready"*: an `ENVIRONMENT_FAILURE` naming a cause the environment had not observed. `local-web`,
`local-api` and `local-process` each carried a `#child !== handle` guard against it — three
mitigations of one defect, written three times because the defect was one layer below all of them.
Both branches now share the escalation bound and both await the child's exit, and
`tests/process.test.ts` holds that reading against a real child process. The three guards stay: they
make the invariant local to the fields they protect, and a fourth world that stops and re-spawns
should not have to rediscover why they are there. **The generalisable rule is the one this document
demonstrates twice — *fix the seam the defect belongs to, not each of the call sites that trip over
it*; three mitigations at three call sites is the signature of a bug one layer down.**

