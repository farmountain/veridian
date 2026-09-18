# The boundary spine: claim what is held, and hold what can be held

Design for workstream **W1** of the eight-gap request. Date 2026-09-16.
Base commit `d05a6f7`.

## 1. Why this document exists, and how it was authorised

The `brainstorming` skill places a HARD-GATE before implementation and asks for approval after
each section. That checkpoint could not be honoured: every clarifying question put to the operator
returned *"The user is not available to respond and will review your work later. Work
autonomously and make good decisions."*

The substitute is therefore this section. **Every decision taken in lieu of an answer is recorded
here with its reasoning**, so the operator can audit the substitution rather than only its result.

| # | Question asked | Decision taken | Reasoning |
|---|---|---|---|
| 1 | Scope and order across the four workstreams | **One spec, W1 first** | W1 is the only workstream that changes product behaviour, and W2/W3 become cheap once worlds report their boundaries truthfully. |
| 2 | How far to push boundary enforcement | **Enforce for real where a child process is started** | Node's permission model was measured working on this machine with no install and no elevation (section 3). Nothing is promised that was not measured. |
| 3 | What to do about the network limit | **Add a third report state, derived from a measurement** | No `--allow-net` exists (section 3.2). Today that fact is reported with the same word used for "we did not build it", which is a permanence claim smuggled into a build claim. |
| 4 | The shape of the external-agent contract (gap 5) | **A versioned file contract this pass; not an MCP server** | `core/**` holds zero occurrences of `mcp`. A real MCP server is greenfield and cannot be finished and verified in the same pass as W1. Deferred explicitly in section 7. |
| 5 | How wide self-acceptance should be (gap 3) | **A subset of worlds, chosen for speed and decisiveness** | Self-acceptance that needs eleven worlds and a browser is self-acceptance nobody runs. |
| 6 | The `sim-mobile` world | **Deferred, with the reason recorded** | The operator's instruction was "all sandbox environments we planned". That is honoured by stating the plan, not by silently dropping a member of it. See section 7. |

## 2. What the reconnaissance actually found, including one hypothesis it destroyed

The gap request described boundary enforcement as "still incomplete in places". Measured against
the tree at `d05a6f7`, the shape is narrower and stranger than that.

### 2.1 The report is honest, and the reason is not the one I first wrote down

The first reading of the measurement was that seven of eleven worlds enforce a boundary and
report `unsupported` for it - an under-claiming defect, the mirror image of the over-claiming
defect `docs/BOUNDARY-ENFORCEMENT.md` was written about.

**That reading was wrong, and reading the code is what caught it.** `sim-posix-environment.ts:468`
states the position the measurement could not:

> The crossings list is reported even when empty, because here its emptiness means one specific
> thing - the sandbox root was never climbed out of.

and, immediately above it:

> the application is an ordinary child process with the operator's own privileges: it can open
> whatever socket and write wherever the operator can, and a report of `enforced` on the strength
> of a guard over argument vectors would be exactly the overclaim the boundary path exists to
> remove.

The substitution refuses *its own* path grammar, and records that refusal as a crossing. The
**application**, meanwhile, is still an unconfined host process that can write anywhere. Those are
two different facts, and `unsupported` is the correct report for the second one.

So the worlds are not under-claiming. They are separating two things correctly, and the surviving
defect is the one they all state in prose:

> `adapters/local-process/local-process-environment.ts:29` - **Neither boundary is enforced, and
> this file says so rather than describing a guard it does not have.** The child runs as an
> ordinary process with the operator's own privileges: it can open any socket and write any file
> this user can, and nothing here confines either.

**That sentence was true when it was written and is now false.** Section 3 is why.

### 2.2 The two doc comments that contradict each other

`core/environment/process-observation.ts:296` states that a spelling which leaves the root is
refused *"and the adapter records the refusal as a boundary crossing rather than reporting a
missing file - a resource that is absent and a place that is out of bounds are two different
observations, and only one of them is the application's problem."*

`local-process-environment.ts:541` states the opposite, in as many words:

> It is deliberately **not** recorded as a boundary crossing - only the application's escapes are
> crossings, and a criterion's spelling of a path is not the application.

**The adapter is the half that is right, and the core comment is the half that is wrong about the
mechanism while right about the requirement.** A target is written by the *operator* in
`acceptance.yaml`; a typo in it must not trip the `PASS` rule's third clause ("there was no safety
violation") and must not blame the application for a spelling the application never wrote. And the
distinction the core comment is reaching for - absent versus out of bounds - is **already held, in
a better place**: `validators/process/process-validators.ts:222` returns `unusable` for a spelling
that leaves the root and `unanswered` for a path nobody looked at, and its message names both the
reason and the remedy:

> A path is read relative to the root this world names, and `"../outside.txt"` is not one: a
> leading separator, a drive letter and a `..` that leaves the root each name this machine's
> filesystem rather than the world's. Write the path the way the criterion's own command wrote it,
> relative to the root the reading names.

An *absent* file is a third thing again, and a fact about the application. Three observations, three
statuses, no crossing - so the correction is a prose correction and not a behaviour change.

### 2.3 The one fact underneath both gaps

Gaps 1 and 2 are one fact from two directions: **the host child is not confined, and until now it
could not be.** The rest of this document is the mechanism that closes it, and the report changes
that make the record follow the act.

## 3. The measurements this design rests on

All three were run on this machine, Node `v22.18.0`, no install, no elevation.

### 3.1 A real application is behaviourally identical under confinement

Run against `examples/local-process/app/cart-build.mjs` with the environment the adapter really
sets (`VERIDIAN_PROCESS_ROOT` pointed at the sandbox):

| arm | output | exit |
|---|---|---|
| control `build`, no permission model | `cart-build: wrote 4 files into dist at version 1.4.0` | 0 |
| **held `build`**, `--permission --allow-fs-read=<app> --allow-fs-write=<sandbox>` | **identical line** | **0** |
| **held `verify`** | `verify: 4 files consistent with the manifest at version 1.4.0` | **0** |
| **held escape attempt** (write outside the allowance) | `ESCAPE: refused ERR_ACCESS_DENIED` | **0** |
| escape file on disk afterwards | **not created** | - |

Three properties, and all three matter:

- **Precise, not blanket.** The permitted write still succeeded. A confinement that broke the
  application would be a confinement nobody could adopt.
- **The refusal is a catchable error, and the exit code is 0** - so a refused write is an
  *observation*, never a hard crash. That is the shape the documentation already promises for a
  classified environment failure.
- **The escape file was not created at all.** The enforcement is real, not advisory.

A first version of this probe was wrong, and its own output is what said so. It omitted
`VERIDIAN_PROCESS_ROOT`, so the application's `ROOT` fell back to `"."`, resolved against the
application directory, and read **outside** the filesystem allowance: `build` died with
`Error [ERR_ACCESS_DENIED] ... at Object.lstat (node:fs:1635:14)` and `verify` with `dist could not
be read: Method Promise.prototype.then called on incompatible receiver undefined`. That reads as
"the permission model breaks the application". It does not - **the probe was measuring a
configuration the product never runs**, because the adapter always sets that variable. The lesson
is recorded rather than the first draft: *a probe that measures a configuration the product never
runs measures nothing about the product.*

### 3.2 The network limit is permanent, and that is measured rather than assumed

| arm | result | exit |
|---|---|---|
| `node --permission --allow-net=127.0.0.1 -e ...` | `bad option: --allow-net=127.0.0.1` | **9** |
| **positive control:** `node --permission -e ...` | `permission accepted` | **0** |

The positive control is what makes the first row a measurement. Without it, "node exited non-zero"
would be consistent with a broken probe.

What *is* available, measured from `node --help`: `--permission`, `--allow-fs-read`,
`--allow-fs-write`, `--allow-child-process`, `--allow-wasi`. There is no `--allow-net`, so
**network egress from a host child cannot be confined by this mechanism on this runtime** - and
any world reporting `unsupported` for it is reporting a permanent property of the platform as
though it were a gap in the world.

### 3.3 A confinement that reached the child through a shell would be mangled

`core/process.ts`'s `wantsShell` hands a **bare** command name to `cmd.exe` on Windows, which
joins the file and its arguments into one string. `--allow-fs-read=D:\a path with spaces` would
arrive damaged. The mechanism therefore hands back `process.execPath` - the absolute interpreter
that was just measured to support the flags - for which `wantsShell` is false and no shell is
involved. The shell-join hazard is removed by construction rather than by hoping no path has a
space in it.

## 4. The design

### 4.1 One shared mechanism, in `core/environment/confinement.ts`

```
ConfinementCapability  { available, reason, interpreter, mechanism }
ConfinementRequest     { command, args, readRoots, writeRoots, allowChildProcess }
ConfinementResult      { applied, command, args, reason }
confinementCapability(): ConfinementCapability     // measured once, memoised
confineChild(request): ConfinementResult           // applied, or says why not
```

Two rules the file exists to hold:

- **The capability is measured, not declared.** `confinementCapability()` runs
  `process.execPath --permission` against a trivial expression and reports what happened. A
  constant beside the code would be free to disagree with the runtime - the defect this repository
  records as *"a capability report must be derived from what the code did, not from a literal list
  beside it"*.
- **A request that cannot be confined is not confined silently.** `confineChild` returns
  `applied: false` with a stated reason, and the caller is the layer that decides what that means.
  A helper that quietly returned the unconfined argv would make every caller report `enforced`.

Only a Node child can be confined this way, because the flags are Node's. A world that starts a
non-Node interpreter gets `applied: false` and reports accordingly - which is a true statement
about that world, not a failure.

### 4.2 The third enforcement state

```
BOUNDARY_ENFORCEMENTS = ["enforced", "unsupported", "unenforceable", "not-requested"]
```

- `unsupported` - the world did not build a mechanism for this. **Invites a fix.**
- `unenforceable` - **the platform provides no mechanism for this.** A permanent, measured limit.
- `not-requested` - the policy was permissive, so there was nothing to hold.

The three are kept apart because a reader acts differently on each: the first two look identical
in a bundle today, and one of them is a build gap while the other is a property of the runtime.

Existing evidence is unchanged: **no schema enumerates this vocabulary** (measured), so this is a
core-and-prose change and not a document-format change.

### 4.3 Where the mechanism is installed

At the one seam each world already has: the argument vector handed to the process runner for the
application. For `local-process` that is `#spawn`. The adapter replaces `command`/`args` with the
result of `confineChild`, remembers whether it applied, and `boundaries()` reports from that
remembered fact:

- `filesystemWrite` is `enforced` **when the confinement was actually installed on the child this
  world started**, and `unsupported` when it was not. Derived from what the code did.
- `network` is `unenforceable`, because no mechanism exists - the same reason, at the same seam.

### 4.4 Correction, not expansion

Two prose claims are corrected because they are now false, and correcting them is the work:

- `local-process-environment.ts:27-36`'s header, which says nothing here confines either boundary.
- `process-observation.ts:291-300`'s doc comment, which says a refused target is recorded as a
  crossing while the adapter that does the recording implements the opposite rule.

## 5. What proves it

Each claim gets a test that fails when the fix is removed:

1. `confinementCapability()` reports what a real spawn did - falsified by returning a constant.
2. `confineChild` returns `applied: true` with an absolute interpreter and the allowance flags -
   falsified by dropping `readRoots` from the vector.
3. `confineChild` returns `applied: false` **with a reason** for a non-Node command - falsified by
   returning the argv unchanged with `applied: true`.
4. A confined child **writes inside the allowance and is refused outside it, while the permitted
   write still succeeds** - the positive half asserted separately from the negative half, because a
   probe whose permitted half fails measures nothing about the refused half.
5. `local-process` reports `filesystemWrite: enforced` **because the child was confined**, and
   `unsupported` when confinement did not apply - falsified by hard-coding the state.
6. The demo still passes end to end, which is the claim that the confinement did not break the
   application.

Every one is falsified by removing the fix and watching the named assertion fail, then restored.
A test that passes whether or not the rule holds is not a test.

## 6. Out of scope for this pass, and why

- **Propagating the mechanism to the other nine worlds that start a child.** The mechanism lands
  with one world as its proof, because the per-world read-allowance has to be measured per world
  and a bulk edit would be nine unverified allowances. It is the immediate next step and it is
  smaller than this one.

  > **Correction, recorded rather than edited away: the number in that paragraph is stale, and the
  > instruction is not.** It was written when ten worlds existed and one (`local-process`) confined,
  > so *nine* was right. Today **eleven** worlds are registered and **three** confine
  > (`local-api`, `local-process`, `local-web`), so the figure that paragraph is owed is **eight**.
  > The paragraph is kept verbatim above because it is the record of what was decided and why - and
  > because a corrected number silently substituted into a decision log is a log that no longer shows
  > what was decided. `docs/GAP-CLOSURE-DESIGN.md` W1 carries the current measurement, and what the
  > propagation turned out to need: the allowance is a **value** and belongs per request, while
  > *applying* it is **one mechanism** and belongs at the process seam - so the work is one change in
  > `core/process.ts` and a few lines per world, rather than eight copies of the rule.
- **Confining network egress anywhere.** Measured impossible on this runtime (3.2).
- **An MCP server (gap 5).** Deferred by decision 4 above.
- **`sim-mobile`.** Deferred by decision 6; recorded in section 7.

## 7. The deferrals this document is accountable for

| Deferred | Reason | What would close it |
|---|---|---|
| `sim-mobile` as a world | A mobile world's subject is a device farm, and its substitution would be a fourth kind of substitute with no criterion in this tree that needs it. The operator asked for "all sandbox environments we planned", so this is stated rather than dropped. | A contract whose criterion is about a device, a screen or an app bundle. |
| A real MCP server | Greenfield: zero occurrences of `mcp` in `core/**`. It cannot be built and verified in the same pass as W1 without one of the two being unverified. | Its own spec, with a Level-1/2/3 definition of levels so "Level-3" is a measurement rather than a slogan. |
| Self-acceptance for all eleven worlds | Decision 5. A self-acceptance run that needs eleven worlds is one nobody runs. | The subset landing first, then widening per world. |
