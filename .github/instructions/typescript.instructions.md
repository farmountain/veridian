---
name: "TypeScript Conventions"
description: "Use when writing, modifying, reviewing, or refactoring TypeScript source in Veridian Core, the adapters, the validators or the CLI. Covers the constraints the compiler enforces, the layering nothing enforces, the import and comment conventions the tree already follows, and the rule that no formatter or linter may be introduced."
applyTo:
  - "**/*.ts"
---

# TypeScript Conventions

This file governs **Veridian's own source**. `AGENTS.md` governs the project; the two do not
duplicate each other, so read that first and treat this as the language-level detail.

> **There is no build step.** Node 22 strips types and executes `.ts` directly from the source tree,
> so **the source tree is the program**. Nothing may introduce a step between the two. The one place
> this does not hold is `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which is why
> distribution is a clone — see `AGENTS.md` → `## Distribution`.

## What the compiler enforces — do not fight it

`tsconfig.json` is strict deliberately. These four flags change how you write ordinary code, and a
violation is a typecheck failure rather than a style debate:

- **`verbatimModuleSyntax`** — every type-only import needs the modifier. Prefer the inline form the
  tree uses: `import { failure, type Failure } from "../failure.ts";`
- **`erasableSyntaxOnly`** — the source must survive type *stripping*, so constructs that emit code
  are refused: no `enum`, no parameter properties (`constructor(private x: T)`), no `namespace`.
  Use a `const` array plus a derived union instead — `ROLLUP_GUARDS` and `RollupGuard` in
  `core/validation/rollup.ts` are the pattern to copy.
- **`noUncheckedIndexedAccess`** — indexing yields `T | undefined`. Write `arr[i] ?? fallback`, or
  narrow with an assertion before use. Code that indexes and assumes is a compile error.
- **`allowImportingTsExtensions`** — relative imports **carry the `.ts` extension**. An import
  without one is wrong, not merely unfashionable.

Also on: `strict`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`isolatedModules`, `noEmit`.

## What nothing enforces, so you must

**Layering is enforced by hand.** No tool checks it; a violation will typecheck cleanly and rot the
architecture quietly.

```
core/*        must NOT import adapters/*, validators/* or cli/*
validators/*  must NOT import adapters/*        # shared vocabulary -> core/environment/web-observation.ts
cli/*         is the ONLY layer that may import all three
core/clarification      is the lowest layer of all
```

`core/*` must also hold no dependency on a browser, a running process, or anything else that only
exists at run time. Veridian Core decides what a valid run *is*; the adapters witness it.

**Every string the program can print is ASCII.** This machine's console code page renders an em dash
as `鈥?`, so a message using one arrives as noise. This covers criterion messages, failure reasons,
`failure.md` contents, and **test titles**, because a test runner prints those too. It does not cover
markdown the repository ships, and it does not cover comments. When in doubt: if a console or a
report will show it, it is ASCII.

**Comments explain why, and this repository's comments are load-bearing.** A non-obvious decision
carries the defect that produced it, because the next reader's alternative is to "simplify" it back
into the bug. See `AGENTS.md` → `## Rules this build has paid for` for the register to write in. Do
not restate what the code plainly says; do state the condition that must hold, the failure mode you
are preventing, and the alternative you rejected.

## Import and declaration shape

The tree is consistent. Match it rather than importing a preference:

- **`.ts` extensions on every relative import** (compiler-enforced, repeated here because it is the
  most commonly forgotten).
- **A `const` arrow function for a small helper; `export function` for a module's real entry point.**
  See `kindForUnresolved` and `rollup` in `core/validation/rollup.ts`.
- **`interface` properties are `readonly`.** Arrays are `readonly T[]`, not `T[]`. A result type is
  a record, not a mutable object.
- **Explicit return types on exported functions.** Inference is fine inside a function body.
- **String-literal unions over enums** (`erasableSyntaxOnly` requires this, and it reads better).
- **`type` for unions and aliases, `interface` for object shapes.**
- **No barrel file unless it is a real boundary.** `core/*/index.ts` exists to narrow a layer's
  public surface. Do not add one to re-export everything.

## Errors and failure classification

- **Never collapse distinct failures into one message.** Veridian's own taxonomy exists for this:
  `TEST_FAILURE, ENVIRONMENT_FAILURE, VALIDATOR_ERROR, APPLICATION_ERROR, TIMEOUT, SECURITY_VIOLATION,
  INFRASTRUCTURE_FAILURE, RESET_FAILURE, UNKNOWN`. Use it; do not invent a parallel vocabulary.
- **`INCONCLUSIVE` is never `PASS`.** Do not write a truthiness check that happens to treat an
  undecided status as success.
- **An error message may only name a cause the reporter observed.** This is the most expensive rule
  in the repository — a client that discarded a response body and then asserted "unreachable" cost a
  full investigation of a server that was healthy. If you hold the evidence, report the evidence. If
  you hold a status code, do not report a cause.

## Do not add tooling

- **No formatter and no linter.** None is installed, the tree's format is hand-maintained and
  consistent, and a first `prettier --write` would touch nearly every file — burying the change that
  motivated it. `npm run format` was removed rather than left broken. If you believe one is needed,
  **ask**; do not install it.
- **Do not add a dependency to solve a local problem.** Runtime dependencies are counted in
  single digits on purpose. Playwright is deliberately *not* a dependency; it is a lazy, optional
  port so that a run without a browser still typechecks and still works.

## Before claiming a change is done

Run the gate and quote its real output — `npm run gate` (typecheck then the full suite), then
`npm run demo` if the change is anywhere near the execution path. A claim without the command's
output is an intention, not a result. `AGENTS.md` → `## Working agreements` has the platform traps
(PowerShell `;` not `&&`, `node --test` takes files not directories).
