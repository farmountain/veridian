# Veridian - Shipping It, and Growing the Worlds It Can Judge

This document answers a request that arrived after the MVP shipped: *implement npm, VS Code
extension and Docker install routes, and implement every sandbox environment we planned.*

It exists because the honest answer is not "yes, all of it now". It is a plan with a measured
starting point, a phased order, an acceptance test per phase, and a named blocker wherever a phase
cannot be proven on the machine it must be proven on.

Read it as the successor to `docs/IMPLEMENTATION-PLAN.md` - that document covers what was built for
the MVP, this one covers what comes after it.

---

## 1. The request, decomposed

| # | Asked for | Status before this work | Source of the plan |
|---|-----------|-------------------------|--------------------|
| 1 | npm install route | Declined at ship time | this doc, Phase A1 |
| 2 | Docker install route | Never attempted | this doc, Phase A2 |
| 3 | VS Code extension | Specified, not built | `PLAN.md` §30, this doc, Phase B |
| 4 | Database environment | Roadmap "Later" | `PLAN.md` §38, this doc, Phase C |
| 5 | Linux / Kali / Windows / macOS | Roadmap Tier 2-3 | blocked, §5 |
| 6 | Kubernetes, cloud, data platform | Roadmap Tier 4-5 | blocked, §5 |

Nothing in this list is forbidden. `PLAN.md` §3 forbids Veridian becoming a *Kubernetes management
platform*, a *cloud deployment platform*, a *CI/CD platform*; it explicitly permits integrating with
all of them. An adapter that deploys the application under test into an existing cluster and judges
it is integration. A control plane that manages clusters is competition. Every phase below is on the
integration side of that line, and that is the test each one has to pass.

`PLAN.md` §55 additionally gates Kubernetes, VM orchestration, cloud and distributed execution out of
the *four-week MVP*. The MVP is now complete (`v0.1.0`), so that gate has expired on its own terms -
but it expired into "next", not into "now", because of the finding in §2.

---

## 2. The finding that decides the order

The request also said *implement with validation/testing*. So before planning any adapter, this
machine was probed for the isolation mechanism each adapter would need:

```
docker                   NOT INSTALLED
kubectl                  NOT INSTALLED
vagrant / qemu           NOT INSTALLED
sqlite3 / psql           NOT on PATH
wsl                      present (podman-machine-default)
node / git / code        present
```

This is decisive, and it is the same rule the repository has already paid for twice:

> *"A platform CI claims to cover, but has never run, is a platform that does not pass."*
> *"A guard no code path can trip is not a guard."* - `AGENTS.md`

An adapter for a Kubernetes cluster, a Windows VM or a macOS host cannot be executed here. Writing
one anyway would produce a file that references an interface, asserts nothing, and passes no test -
which is *a guard no code path can trip* with a name that says otherwise. That is worse than not
having it, because a reader would believe it.

So the rule that orders this plan is: **a phase is built when it can be proven, not when it can be
written.** Where a phase needs infrastructure, either the phase moves to where the infrastructure
exists (Phase A2 uses CI's Docker, which GitHub Actions has), or the phase is recorded as blocked
with the blocker named (§5).

---

## 3. The self-prompting protocol, applied to this program

The ambiguity protocol from `core/clarification/` applies to planning as much as to a contract, so
the questions that gated this plan are recorded with their resolution and the rung they resolved on.

| Question | Rung | Resolution |
|----------|------|------------|
| Does "implement everything" mean breadth of stubs or depth of working adapters? | **deferred to a rule, not a guess** | Depth. The repository's own standard is that an unverifiable artifact is a false claim. A stub adapter is unverifiable by construction. |
| Is Kubernetes in scope at all? | **derived** | In scope as an adapter, out of scope as a management platform - `PLAN.md` §3 draws the line and it is not ambiguous. |
| Can npm packaging be done without reversing a recorded decision? | **derived** | No. `IMPLEMENTATION-PLAN.md` §8 records the registry path as *declined*. The request reverses it, so the document must be corrected in the same pass (`AGENTS.md` requires it). |
| Does adding a build step contradict "there is no build step"? | **answered, narrowly** | It changes the sentence rather than breaking it. Development still runs `.ts` directly; only the *distributed* artifact is compiled. Both facts are now stated, in the places that state them. |
| Is a VS Code extension a "sandbox environment"? | **inferred** | No - it is a UI. `PLAN.md` §30 and §47 put it in the UI column, and "VS Code != Veridian". Treated as Phase B, a client, not an adapter. A *separate* idea - an adapter for validating VS Code extensions - is recorded in §5 as a real, unblocked future adapter rather than silently merged into this one. |
| How many rounds may Phase A take before stopping? | **defaulted** | Two fix rounds per gate failure, then record and stop. Same bounded-exit rule the run loop uses. |

No question required the user, because each one resolved on a rung below `answered`: either a rule
already written down settled it, or the class of question was answered once by a decision that
outlives it. That is the ladder working as designed - `ASK` is for gaps no rule reaches.

---

## 4. Phases

### Phase A1 - npm install route (built here)

The design is not new; `AGENTS.md` `## Distribution` already specified it while declining it, which
makes this the lowest-uncertainty phase in the list.

- Compile `cli/`, `core/`, `adapters/`, `validators/` to `dist/` with `tsc -p tsconfig.build.json`,
  `rewriteRelativeImportExtensions` turning the `.ts` import specifiers into `.js`.
- Copy the non-code assets (`schemas/`) into `dist/`, because `SCHEMA_URIS` are package-relative.
- Resolve those assets from the *module's* location, not the process's, so `veridian` works from any
  working directory. This was the second, independent reason the registry path was declined: today
  `loadSchemaSet(nodeIo())` roots at `process.cwd()`, so an installed CLI looks for its own schemas
  in the caller's directory.
- `files` allowlist, `bin`, `publishConfig`, and `prepublishOnly` as the gate that keeps a package
  which cannot work from being published by accident - replacing the blunter `private: true` guard.

**Acceptance:** `npm run build` succeeds; the built CLI answers `help` with exit 0 **from a working
directory that is not the package**; the schemas load under `dist/`; `npm pack` produces a tarball
that installs into a clean directory and runs. Verified in CI, because the failure mode this phase
exists to prevent is a `dist/*.js` that no test touches.

**Exit:** two fix rounds, then record.

### Phase A2 - Docker install route (built here)

A `Dockerfile` plus a CI job that builds the image and runs the CLI inside it. Docker is unavailable
on the development machine and available on `ubuntu-latest`, so the verification happens where the
runtime exists. A Dockerfile added without that job would be exactly the claim-without-a-check this
document is arguing against.

**Acceptance:** `docker build` succeeds in CI and `docker run --rm <image> help` exits 0.

**Exit:** if the image cannot be built in CI within two rounds, the Dockerfile is reverted rather than
shipped unrun.

### Phase B - the VS Code Cockpit

`PLAN.md` §30: sidebar, goal and acceptance editors, environment status, run and reset, history, a
PASS/FAIL dashboard, an evidence viewer. It stays thin - `VS Code != Veridian` - and drives Core
through the same interface the CLI does.

Ordering note: this is deliberately *after* A, not because A is more valuable but because B needs a
stable way to locate and start Core, and A1 is what makes Core locatable from outside its own
directory tree.

**Acceptance:** the extension compiles; a Core-facing session test runs headless; the activation path
is exercised under a VS Code test host, and whatever cannot be exercised that way is named in the
document rather than described as working.

### Phase C - the second adapter: `local-db`

This is the phase that tests the architecture rather than adding a feature.

`PLAN.md` §35 claims new environments can be added *without modifying the core*. That claim currently
rests on a sample size of one adapter, which is not evidence. A SQLite adapter - `node:sqlite` ships
inside Node 22, so it needs no server, no install and no container - makes it falsifiable offline:

- `core/` must not change beyond registering the adapter name.
- A new validator family (`db.schema`, `db.rowCount`, `db.value`) must be addable without touching
  `core/validation`.
- M1, M4 and M5 must hold for a database world exactly as they hold for a web one.

If that forces changes in `core/`, the claim in §35 is wrong and §35 gets corrected. Either outcome
is a result; only silence is not.

**Acceptance:** a contract against a seeded SQLite database passes and fails for the right reasons;
`core/` diff is limited to registration; the M-metrics report the same shape as the web run.

### Phase D - the rest of Tier 1

`local-api` and `local-process` (`PLAN.md` §36 Tier 1). Both need only a child process and an HTTP
client, so both are verifiable here. Each is a repeat of Phase C's procedure, which is the point:
after the second one, the third is mechanical, and *that* is what confirms the architecture.

---

## 5. Blocked, with the blocker named

These are not deferred for lack of interest. Each names the thing that would unblock it, so that
"blocked" is a fact with a dependency rather than a shrug.

| Environment | Blocker |
|-------------|---------|
| Containerised environments (Docker/Podman *as a world*) | No container runtime on this machine. The Dockerfile in Phase A2 is a *distribution* route and does not need one; an adapter that starts and resets containers does. |
| Linux VM, Kali Linux | No VM tooling (`qemu`, `vagrant`, Hyper-V) and no WSL distro besides the Podman machine. |
| Windows VM, macOS VM | Same, plus macOS guests are licensed only on Apple hardware. A Windows VM adapter written on Windows but never booted is the unverifiable claim this plan exists to refuse. |
| Kubernetes | No `kubectl` and no cluster. Also the point where the §3 line is easiest to cross: an adapter deploys into a namespace, it does not manage the cluster. |
| Cloud (AWS / Azure / GCP) | No credentials, no CLI, and a cost model that makes an unattended test run a bad idea. |
| Data platform (Kafka, Spark, Hadoop, Airflow) | No runtime for any of them. `PLAN.md` §39 already marks this "not MVP". |
| Mobile (Android / iOS) | No SDK, no emulator, no device. |
| VS Code extension host *as an environment* | A real future adapter - validate a `.vsix` by launching it in an extension host - and genuinely distinct from Phase B. Listed here because it was folded into the request; it is not blocked, it is simply Phase B-adjacent and out of order. |

---

## 6. What this plan deliberately does not do

- **No stub adapters.** A file implementing `EnvironmentAdapter` whose methods return empty
  observations is worse than no file: it makes the adapter list look complete while every criterion
  against it is `INCONCLUSIVE`. The `unsupported` value in `BoundaryEnforcement` exists so a world
  can report what it *cannot* hold - it is not a licence to report nothing at all.
- **No speculative abstraction while adding Phase C.** The adapter interface already admits a second
  implementation; if it does not, that is the finding, and the fix is a change to the interface with
  a second caller to justify it - not a framework.
- **No publishing.** This document makes the package publishable. Running `npm publish` is the
  maintainer's decision, not an agent's, and the name is theirs to claim.

---

## 7. What was built, and what was measured rather than assumed

Phase A1 is implemented. Phase A2's files exist and have never executed, and that distinction is
recorded here rather than blurred, because it is the distinction this whole document is about.

| Step | Status | Evidence |
|------|--------|----------|
| `tsconfig.build.json` emits `dist/` | **done** | 62 files; first line of `dist/cli/veridian.js` is `#!/usr/bin/env node` |
| `.ts` import specifiers rewritten to `.js` | **done** | `dist/cli/veridian.js` holds `import { assetsRoot } from "../core/assets.js";` |
| `schemas/` carried into `dist/` | **done** | `copy-assets: schemas/ -> dist/schemas/`; all 6 present |
| Asset root resolved from the module | **done** | `core/assets.ts`; `tests/assets.test.ts` holds both halves |
| `package.json` packaging | **done** | `files: ["dist"]`, `bin.veridian`, `prepublishOnly`, `prepare` |
| Gate stays green | **done** | `378 tests / 74 suites / 0 fail`, exit 0 |
| Smoke test exists **and discriminates** | **done** | falsified by reverting the asset root in the built `.js`: `FAIL ... exits 2, not 3`, exit 1 |
| `npm pack` -> clean install -> run | **done** | 65 files, 124.5 kB; `npx veridian help` exit 0; a browserless validate exit 2 with schemas resolved from `node_modules` |
| `Dockerfile` + `image` CI job | **written, unrun** | This machine has no container runtime. An unwatched CI job is a claim, not a record. |
| `dist` CI job (`smoke:dist` + pack/install round trip) | **written, unrun** | Same reason: it has to run before it can be cited. |

**The falsification is the part worth keeping.** The smoke test asserts exit 2 rather than 0 because 0
would mean a browserless run passed, which it must never do, and rather than "not 3" because 3 is the
interesting failure: it is the define phase failing, which is exactly what a mis-rooted asset does.
Then the claim was checked by breaking it - the built `.js` was rewritten back to
`loadSchemaSet(nodeIo())` on purpose, and the check failed with
`schema "schemas/goal.schema.json" could not be read` and exit 3. A check that has only ever passed is
indistinguishable from a check that cannot fail.

That run also surfaced a real defect, which is the reason to keep doing this: the error message said
the contracts *"live in the repository"* - addressed to a user who has no repository. It now names the
directory it actually looked in. *An error message may only name a cause the reporter observed.*
