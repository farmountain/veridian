---
name: "Add a Module"
description: "Scaffold a new module, endpoint, command, or component that follows the conventions already in this repository."
argument-hint: "What to add, e.g. 'a billing module' or 'a POST /users endpoint'"
agent: "agent"
---

# Add a module: ${input:what}

Add the module described below to this repository, matching existing conventions exactly.

**Requested:** ${input:what}

<!--
PREREQUISITE GUARD — do not skip.
Veridian is greenfield: the target layout is agreed (AGENTS.md → Layout) but no manifest and
no source exist yet. If there is still no manifest, there is no convention to match — anything
you generate will be superseded by the first real commit. In that case: STOP. Do not create the
module. Report the gap instead, and propose the smallest scaffolding that would make it possible.
-->

## Step 0 — Check the prerequisite, then the scope

Confirm a manifest exists (`package.json` — Veridian is TypeScript; `pyproject.toml`,
`Cargo.toml`, `go.mod` would mean the wrong stack was scaffolded). If none exists, stop and
report: *"No manifest yet — the module cannot match a convention that does not exist.
Recommended first step: <minimal scaffolding>."* Do not invent a layout.

Then check the request against `AGENTS.md` → **Hard scope boundary** and → **MVP scope**. If the
module is one of the excluded things (an adapter beyond `adapters/local-web/`, a goal compiler,
an MCP server, a CI/CD integration, a plugin system), **refuse and say why**, citing the boundary.
Building it is not a scope judgement call — it is the one thing this project has decided against.

## Step 1 — Load context

1. Read `AGENTS.md` — scope boundary, invariants, working agreements, Memory, environment rules.
2. Read `docs/PLAN.md` for the authoritative design of the area you are touching.
3. Query memory for prior decisions on this area (see `.github/skills/hipcortex-memory`).
   A past reversal here is the highest-value thing you can find; do not re-litigate it silently.
4. Read `AGENTS.md` → Layout to find the directory this module belongs in. The agreed homes are
   `core/{goal,acceptance,execution,validation,environment,evidence,run}/`, `adapters/local-web/`,
   `validators/playwright/`, `schemas/`, `extension/vscode/`, and `examples/shopping-cart/`.
   If the module fits none of them, that mismatch is a finding — report it before coding.

## Step 2 — Find the exemplar

**This is the step that determines whether the result is correct.** Do not design from first
principles. Locate the existing module most similar to the one requested and treat it as the
template:

- Where does it live, and what files does it consist of?
- How is it wired in — registered, exported, routed, injected? Find every registration point.
- What is its test file named and where does it sit?
- How do its errors surface, and how does it log?

Name the exemplar file you are copying in your final report. If no exemplar exists, say so —
that means you are setting the convention, and you should state the convention you chose.

## Step 3 — Implement

Create the module by mirroring the exemplar's structure:

- Same naming, file layout, and export style.
- Same error and logging idioms.
- Same test placement and naming (see `.github/instructions/tests.instructions.md`).
- Wire it into every registration point you found in Step 2 — a module that exists but is not
  reachable is not done.

Add nothing beyond what was requested. No speculative options, config flags, or abstractions
"for later". If you believe an extra piece is genuinely required, add it and call it out
explicitly in your report rather than slipping it in.

## Step 4 — Test

Add tests covering the happy path and at least one error path, following the exemplar's test
style. Use the runner the manifest defines — never a command you constructed yourself.

## Step 5 — Gate

Run the repository's real gates (typecheck, lint, test). Discover them from the manifest and
`AGENTS.md`. Report the actual command output.

If a gate fails and you cannot fix it within the scope of this change, stop and report the
failure rather than claiming completion.

## Step 6 — Record

Store the decision in memory (actor `Veridian`, per `AGENTS.md`): what was added, which
exemplar it followed, and any convention you established or departed from. If this module is
the first of its kind, that fact is worth recording — it is now the exemplar.

## Report

```text
Added:      <files created, one per line>
Exemplar:   <the existing module this mirrors, or "none — new convention established">
Wiring:     <registration points updated, or "none required">
Tests:      <what is covered>
Gate:       <the command run and its result>
Deviations: <anything beyond the request, or "none">
```
