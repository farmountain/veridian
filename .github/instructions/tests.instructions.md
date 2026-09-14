---
name: "Test Conventions"
description: "Use when writing, modifying, running, or reviewing tests — test files, specs, fixtures, mocks, coverage, or test failures. Covers placement, naming, isolation, and the rule that no test framework or test command may be invented before a manifest exists."
applyTo:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/__tests__/**"
  - "**/tests/**"
  - "**/test/**"
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/conftest.py"
  - "**/*_test.go"
  - "**/*Test.java"
  - "**/*Tests.cs"
  - "**/*Tests.kt"
  - "**/spec/**"
---

# Test Conventions

> Veridian is greenfield but its stack is **settled**: TypeScript/Node.js with Playwright
> (`AGENTS.md` → Project). No *test runner* is chosen yet, so this file defines the
> **invariants** and defers every **mechanical** choice (runner, assertion library,
> command) to the manifest. Do not invent either kind of detail.

## First: two different things are both called "tests"

Do not conflate them. Confusing them is the most likely review finding in this repository.

| | Veridian's **own** tests | Veridian's **acceptance criteria** |
|---|---|---|
| What | Unit/integration tests of Veridian Core and the extension | A **product concept**: the contract a user writes to validate *their* application |
| Lives in | `tests/` (plus `*.test.ts` beside the code) | `examples/shopping-cart/acceptance.yaml`, and later `.veridian/goals/` |
| Asserted with | The JS/TS test runner from the manifest | `Validator` implementations in `validators/` |
| Result type | Test pass/fail | `ValidationResult` (`PASS\|FAIL\|ERROR\|SKIPPED\|INCONCLUSIVE` + evidence) |

This file governs the **left column only**. Rules below (isolation, determinism, doubles,
coverage) do not apply to `acceptance.yaml`, and an acceptance criterion is never "just a test"
— it carries evidence, an environment id and a run id, and `INCONCLUSIVE` is not `PASS`.

## Before writing the first Veridian test

There is no manifest yet. When one exists it will be `package.json`; check for it and for a
runner in `devDependencies`:

1. `package.json` → `test` script and a runner (`vitest` or `jest`) in `devDependencies`
2. otherwise `pyproject.toml` → `pytest` — only relevant to scratch tooling, not Veridian Core
3. otherwise `Cargo.toml` / `go.mod` — not applicable to Veridian's stack

If no manifest exists, **stop and report it** rather than creating a test file. A test file
with no runner is dead code, and a fabricated command is worse than no command. The correct
output in that situation is: *"No test runner is configured yet — add a manifest first."*

Run the tests only via the command the manifest defines (see `AGENTS.md` → Working agreements).

## Invariants

These hold regardless of framework and are the parts worth reviewing.

- **One behaviour per test.** If the test name needs "and", split it.
- **Test name states the expectation, not the method.** Prefer
  `rejects a token signed with the wrong key` over `test_verify_token_2`.
- **No shared mutable state between tests.** Fresh fixtures per test; a test that passes
  alone but fails in a suite is an ordering bug, not flakiness.
- **No ordering dependence.** Never rely on the order a runner happens to use.
- **Assert on values, not on log output.** Capturing stdout to assert is a smell — assert the
  return value or the thrown error.
- **Deterministic time and randomness.** Inject a clock and a seed; never call the real
  `now()` or an unseeded RNG in a test that asserts on a value.
- **No network in unit tests.** If a test needs HTTP, it is an integration test — mark it and
  keep it out of the default run.

Veridian-specific consequences of the above:

- **Never launch a real browser in a unit test.** Playwright is a *product adapter*
  (`validators/playwright/`). Test validators against recorded/faked observations; reserve real
  browser runs for a marked E2E suite.
- **Test the state machine exhaustively.** `core/execution/` is the one place where a wrong
  transition can produce a **false PASS** (MVP metric M3). Every edge, plus every terminal
  state, deserves a test.
- **Cover the failure taxonomy.** A validator that throws must classify as `VALIDATOR_ERROR`,
  not `TEST_FAILURE`. Assert the classification, not just that something failed.
- **Reset must be tested by contamination, not by call count.** Prove the observable state is
  clean (M4), never just that `reset()` was invoked.

## Structure

Arrange / Act / Assert, in that order, separated by blank lines when the test is longer than
a few lines. One Act per test — two calls to the unit under test usually means two tests.

```text
arrange   build the inputs and the system under test
act       exactly one call
assert    the single expected outcome
```

## Doubles

Prefer the real object. Reach for a double only when the real thing is slow, non-deterministic,
or crosses a process boundary.

Order of preference: **real** → **fake** (working in-memory implementation) → **stub** (canned
return) → **mock** (assertion on interaction). A mock that asserts *how many times* something
was called is usually testing the implementation, not the behaviour — assert the observable
outcome instead.

## Coverage

Coverage is a **diagnostic, not a target**. Delete a test that exists only to raise a number.
The tests worth writing are the ones that would fail if the behaviour regressed:

- the happy path
- each documented error path and boundary (empty, one, many, max, over-max)
- the specific bug you just fixed, as a permanent regression test

## When a test fails

Fix the code, or fix the test name/expectation if the *spec* was wrong — but state which one
and why. Never weaken an assertion to make a suite green without saying so explicitly, and
never delete a failing test to unblock a change. A skipped test is a `TODO` with a comment
saying what would make it runnable.
