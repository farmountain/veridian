# Phase 07 -- The isolation substrate

| | |
|---|---|
| **Status** | **blocked here** -- the design is written and the blocker is measured on this machine, in `docs/ISOLATION-AND-MCP-PLAN.md` |
| **Depends on** | 06 (the seam has to be honest about what it enforces before a substrate is put behind it) |
| **Source** | `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 (E1); `docs/GAP-CLOSURE-DESIGN.md` S6 (W6) |
| **Touches** | a new `IsolationPort` in the shape of `ProcessRunner`; the world that adopts it; a CI job |
| **Acceptance** | a run inside the substrate refuses an action the host would have allowed, and the bundle records which substrate held it |

## Why this phase exists

The seam is built. The substrate behind it is not, and the tree says so rather than implying otherwise.
`docs/ISOLATION-AND-MCP-PLAN.md` S3.1 measures the blocker and it is not a design problem:

```
docker      NOT INSTALLED          (not on PATH)
--allow-net rejected               bad option, exit 9      (with a positive control)
--allow-fs-read / --allow-fs-write / --allow-child-process      accepted
```

*"Not buildable on this machine"* is the plan's own verdict, and the correct response is the one this
repository has already used once: **a CI-proven phase.** The `Dockerfile` precedent is exact -- it is a
route that exists, is built and run by a job, and is verified in CI rather than locally, because this
machine has no container runtime and *an unbuilt Dockerfile is a claim*. The container-image job has
run, which is why the Dockerfile is a built image rather than a correct-looking file.

The reason a phase rather than a wish is that the *shape* is already decided, and a decided shape is the
expensive half. The plan specifies an `IsolationPort` **in the same shape as `ProcessRunner`**, landing
only in the pass that can run it. A port with no wall-clock deadline and no falsification is a port that
will be trusted before it is measured.

## What is already true

- **The seam exists.** Every world already hands the runner a file allowance at the request seam, and
  `environment.json` pairs each declared policy with the enforcement measured for it.
- **The vocabulary exists** and distinguishes `enforced` from `unenforceable` for a *stated* reason,
  which is exactly the distinction a substrate has to land on: with no substrate, a dimension is
  unenforceable and says why; with one, it becomes enforced and names which substrate held it.
- **The distribution route exists.** `Dockerfile` is built and run in CI; `npm pack` -> install -> run is
  a separate job; the `.vsix` route has its own job. Adding a substrate is a fourth artifact whose
  correctness no local test can reach, and the CI pattern for that already exists three times.
- **The MCP half of the same plan has landed** (`mcp/tools.ts` and the seven other files, eight tools,
  `npm run smoke:mcp` spawning the real server as a child over a real pipe). So this phase is the *other*
  half of W6 and owes nothing to that one.

## What this phase does

1. **In the pass that can run it:** declare `IsolationPort` structurally, in the shape `ProcessRunner`
   already has -- a request in, an outcome out, a refusal that carries its own reason. Do not invent a
   richer interface; the seam's value is that worlds adopt it without a core change, and that has now
   held **ten** times across twelve worlds.
2. **Adopt it in one world first**, the same way a new step kind is introduced: one world, one
   credential, one probe. A capability only one world has must be refused by name everywhere else, or a
   contract that means nothing there is silently judged there.
3. **Make the bundle record the substrate.** The reading must say *which* substrate held the world, for
   the same reason `simulated` names each surface a `sim-*` world stands in for. A run that does not say
   what confined it is a run whose evidence cannot be audited.
4. **Add the CI job and watch its first run.** Both of the last two such jobs found defects on their
   first execution, and the acceptance-contract step printed `FAIL (MAX_ITERATIONS)` on a runner because
   an extraction had silently dropped a behaviour only that contract asserted. *An unexecuted check is
   not a formality that was deferred; it is a defect that has not been observed yet.*

## Acceptance criterion

- A run inside the substrate **refuses an action the host would have allowed** -- a write outside the
  world's roots, or an outbound socket -- and the refusal is a recorded boundary crossing, not a crash.
- The bundle names the substrate that held the world, and a reader can tell from the bundle alone
  whether a run was isolated.
- The CI job's first run is green, and its log carries the demonstration rather than the intention: the
  refusal and the bundle field.

## Falsification probe

- **The substrate must be shown to change the thing it claims to change.** Run the same application with
  the substrate off and on, and expect two different readings for the same action. If both readings
  agree, the port is being consulted and its answer is ignored -- which is the shape of every guard no
  code path can trip.
- **The negative control.** Assert the allowed action still succeeds inside the substrate. A substrate
  that refuses everything passes the first probe and is useless, and *a "control" that does not change
  the thing it claims to change is not a control*.
- **Read the failure before choosing a hypothesis.** Both of this phase's neighbours had their first
  failure diagnosed correctly only by reading the assertion rather than re-running it.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/mcp-demo.test.ts` | That the eight tools stay eight, and that nothing under `core/**` names the MCP surface |
| `tests/boundary-roster.test.ts` | That a new adapter is classified and registered in both directions |
| `tests/package-manifest.test.ts` | The lockfile's root entry agrees with the manifest -- the same fact written in two places and reconciled by nothing |
| the `distribution`, `image`, `mcp` and `cockpit` CI jobs | Each artifact read back rather than assumed |

## Context budget

**Read:** `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 and S8 (the refusals); `core/process.ts`;
`docs/GAP-CLOSURE-DESIGN.md` S6 (W6).

**Do not read:** `docs/ISOLATION-AND-MCP-PLAN.md` S3.2/S4 in full. The MCP surface has landed; its
guard is a row in the table above, not this phase's subject.

## Refusals

- **No stub adapter.** The plan refuses it by name: a stub would make a criterion pass against a
  substrate that does not exist, which is the false `PASS` this product exists to make impossible.
- **No MCP tool that is the first implementation of anything.** MCP is a door; the building is behind it.
- **No change to `core/**` to make the substrate fit.** If the seam needs widening, that is a finding to
  record, not a silent edit.
- **Do not land the port before the pass that can run it.** A port with no execution is the unverified
  claim this repository has paid for twice.
