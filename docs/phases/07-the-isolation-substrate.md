# Phase 07 -- The isolation substrate

| | |
|---|---|
| **Status** | **built** -- the port is `core/environment/isolation.ts`, the seam's own suite is `tests/process-isolation.test.ts`, and the job it adds is the `isolation` job in `npm run gate`'s workflow |
| **Depends on** | 06 (the seam has to be honest about what it enforces before a substrate is put behind it) |
| **Source** | `docs/ISOLATION-AND-MCP-PLAN.md` S3.1 (E1); `docs/GAP-CLOSURE-DESIGN.md` S6 (W6) |
| **Touches** | a new `IsolationPort` in the shape of `ProcessRunner`; the world that adopts it; a CI job |
| **Acceptance** | a run inside the substrate refuses an action the host would have allowed, and the bundle records which substrate held it |

## Why this phase exists

The seam is built. The substrate behind it is not, and the tree says so rather than implying otherwise.
`docs/ISOLATION-AND-MCP-PLAN.md` S3.1 measured the blocker and it was **not a design problem, and not
quite the problem it looked like**:

```
docker      NOT INSTALLED          (not on PATH)
podman      5.7.1 at C:\Users\user\AppData\Local\Programs\Podman\podman.exe
            machine "podman-machine-default" existed and was STOPPED
--allow-net rejected               bad option, exit 9      (with a positive control)
--allow-fs-read / --allow-fs-write / --allow-child-process      accepted
```

The blocker had been recorded as *"`docker` is not on `PATH` here"*, and the word that was wrong is
the one that looks most like a fact: **`docker`**. This machine had a runtime the whole time; it was
a different runtime, and its machine was stopped. `podman version --format '{{.Client.Version}}'`
answered `5.7.1` while the machine was stopped, which is what made the absence look total - a
**client** version is a reading about the installed program, and only `{{.Server.Version}}` comes back
from something that can actually run a container. `podman machine start` then succeeded and a real
container ran (`node:22-alpine`, `v22.23.3`), with write-back to a bind-mounted Windows directory
verified. *So the load-bearing error in the plan was a name standing in for a capability.*

The `Dockerfile` precedent still holds and was still followed: the port was landed in the pass that
could run it, and a CI job now measures it on a runner rather than trusting this machine.

*Recorded so the record is not the flattering half:* the port was built **before** this phase's own
last refusal was re-read. §Refusals says *do not land the port before the pass that can run it* - and
by the time the machine was measured, the port had already been written against the assumption that
no substrate existed. That ordering was wrong, it was not caught by anything, and the consequence was
that the port's first version carried a defect (`isolateProcess` refusing the host interpreter path)
that a pass run from the start would have met on its first execution.

The reason a phase rather than a wish is that the *shape* is already decided, and a decided shape is the
expensive half. The plan specifies an `IsolationPort` **in the same shape as `ProcessRunner`**, landing
only in the pass that can run it. A port with no wall-clock deadline and no falsification is a port that
will be trusted before it is measured.

## What was measured

Every reading below was taken on this machine and is quoted from the command's own output.

```
node scripts/probe-isolation.ts        exit 0
  substrate available: true (podman 5.7.1)
  1. on this host, unisolated:  inside written, outside written      <- the positive control
  2. inside the substrate:      inside written, outside EROFS
                                escape file on the host: false
                                the host sees the permitted write: true (contents x)
  3. a request it cannot hold:  applied false, with a stated reason
  verdict: host allowed and substrate refused = true
           permitted half worked AND host saw it = true

node --test tests/process-isolation.test.ts tests/isolation.test.ts   19 pass / 0 fail
npm run gate                                             2675 tests / 445 suites / 0 fail
```

Two of the three defects this phase found were **only findable through the runner**, and neither could
have been found by the probe:

- **`podman run` does not inherit the environment of the process that started it.** The first wiring set
  the world's variables on the spawn, which the container never sees, and the child read `undefined`
  for the one value telling it where its sandbox is: `ERR_INVALID_ARG_TYPE: The "path" argument must be
  of type string or an instance of Buffer or URL. Received undefined`. The environment now travels as
  `--env=NAME`, so each value is read from the runtime's own environment and none of them appears on a
  command line.
- **A bare runtime name would have gone through `cmd.exe` on Windows.** `core/process.ts`'s
  `wantsShell` hands a bare name to the shell, and the container vector carries a host path that can
  contain a space and an `-e` payload that always can. Both were proven to survive by resolving the
  runtime to an executable; the test that holds it uses a sandbox whose name contains a space and a
  payload containing `(` and `&`.

The third was the port's own first defect and is recorded in `docs/RULES-PAID-FOR.md`: the probe that
found it was itself wrong first.

## What this phase does not claim

- **Not every world is isolated.** One world adopted the substrate (`local-process`), and a document
  asks for it by declaring `process.isolation`. The other eleven run as they did. That is the plan's
  own instruction - *one world, one credential, one probe* - and `PLAN.md` S42's rule that containers
  must not be forced on every environment.
- **Not that the substrate is always available.** Where no runtime answers a server version, the world
  reports `substrate: null`, `network: unenforceable` and the reason the port gave - so the absence is a
  reading rather than a gap, and the CI job fails loudly on a runner that was supposed to have one.
- **Not that a boundary crossing is recorded for a refused socket.** `crossings` remains empty, for the
  reason it was already empty: nothing in this world observes an *attempt*, only the refusal the runtime
  handed back. This phase made one more thing refusable, not one more thing observable.


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

**Two of the three are met and measured; the third is written and unexecuted, and it says so.**

- **Met, with both halves read.** A run inside the substrate refuses an action the host would have
  allowed, and the permitted action still works -- `scripts/probe-isolation.ts` prints `outside: EROFS`
  for the escape against `outside: written` for the same program on the host, `inside: written` for the
  permitted half, and `the host sees the permitted write: true`, then exits 0 only when all three hold.
  It exits 1 when they do not, which was verified by denying it a usable image.
  - **One part of this is *not* met and is recorded rather than glossed:** the refusal is **not** a
    recorded boundary crossing. See §What this phase does not claim -- nothing in this world observes an
    attempt, only the refusal the runtime handed back, so `crossings` stays empty and the third clause
    of this bullet is false as written. That was already true of the filesystem seam before this phase,
    and the honest statement of the criterion is the one `core/environment/types.ts` makes.
- **Met.** `BoundaryReport.substrate` carries the runtime's own name and is written to
  `environment.json` as `boundary.substrate`, present-and-`null` when no substrate held the world, so a
  reader can tell from the bundle alone whether a run was isolated.
  - **And the negative control is a test rather than a paragraph:** before the first spawn the world
    reports `substrate: null` and `network: unenforceable` however its document is written, so a
    document that *asked* for a substrate cannot be read back as one that had it.
- **Met, on the job's second run, and the first run is the more useful half of the record.** The
  `isolation` job exists in `.github/workflows/ci.yml` and requires `# skipped 0` from both suites it
  runs, so a runner that lacks a runtime fails loudly rather than passing on skips.
  - **Its first execution found a real defect** - run `35958111544`, job `isolation substrate`,
    `failure`. Step 5 (the probe) passed, step 6 (the seam's suites) failed on
    ```
    not ok 2 - translates a Windows path's separators, because a container has only forward slashes
    # fail 1
    # skipped 0
    ```
    The assertion was a Windows behaviour asserted on every platform: on POSIX a backslash is an
    ordinary filename character, so `/host/sandbox\a\b.txt` names a file *beside* the mount rather
    than under it and the translation correctly answers `null`. The **port was right and the test
    overreached**, and the corrected test now holds a rule on both branches rather than skipping on
    one - *the translation converts what the composing host would have used as a separator*. The
    third step never ran, because a failed step skips its successors: **one platform-dependent
    assertion cost the world-level reading its first execution**, which is the compounding a CI job
    is for.
  - **The second execution is green** - run `35958249177`, job `isolation substrate`, all three steps
    `success`, with the readings taken on `ubuntu-latest`:
    ```
    substrate available: true (podman 4.9.3)
      inside:  written /tmp/veridian-isolation-run-30VzfU   <- on the host, unisolated
      outside: written
      inside:  written /veridian/rw0                        <- inside the substrate
      outside: EROFS
      the host sees the permitted write: true
    # pass 19  # fail 0  # skipped 0      the seam's own suites
    # pass 18  # fail 0  # skipped 0      the world's own suite
    ```
    A different runtime and version from this machine's (`podman 4.9.3` against `5.7.1`), which is the
    reading that makes the port's runtime-agnosticism a measurement rather than a claim: it tries
    `podman` then `docker`, reads a **server** version, and resolves the runtime to an executable so
    the vector never passes through a shell.

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
