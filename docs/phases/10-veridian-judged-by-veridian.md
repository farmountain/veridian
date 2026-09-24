# Phase 10 -- Veridian judged by Veridian

| | |
|---|---|
| **Status** | **built** -- and this phase is its second route, `npm run acceptance:ladder` |
| **Depends on** | 01 |
| **Source** | `docs/IMPLEMENTATION-PLAN.md` S5 and step 9 of its execution order; `AGENTS.md` |
| **Touches** | `acceptance/ladder/**`; `docs/phases/10-*`; `package.json` only if a new route is declared |
| **Acceptance** | the command line as a **product** is judged by the `local-process` world with no repair, run twice |

## Why this phase exists

`docs/IMPLEMENTATION-PLAN.md` S5 and step 9 of its execution order call for
`acceptance/veridian-mvp.yaml` -- Veridian judged by its own tool. **It could not be written inside the
MVP**, and the finding was recorded rather than the attempt quietly dropped: at the time, the only
registered adapter was `local-web` and all eight registered validators were browser observations, so a
contract about a CLI would have made every criterion `INCONCLUSIVE` and exited 2 -- the same defect as
`--browser none` on the canonical demo.

**That reason is spent, and the directory is what says so rather than a paragraph claiming it.** Twelve
adapters are registered, eleven of them need no browser, and `local-process` is precisely the
non-browser world that made a contract about a program expressible. So the first half of this phase is
**done**: `acceptance/veridian-mvp.yaml` is written, its seven criteria are judged by the
`local-process` world, and `npm run acceptance` runs it -- measured, run 1 and run 2 both
`PASS (COMPLETED, 1 iteration(s))`, 7/7.

This phase is the **second** route, `npm run acceptance:ladder`, and the thing it judges is different in
kind. The first route judges the command line as a *product*. The second judges a *run* as a **witness**:
each of its four criteria issues its own `veridian validate` against `acceptance/ladder/fixtures/`, then
reads that **nested run's own** `latest-result.json` for the rung each gap reached, the reason a
resolution deferred, the origin it was raised from, and the rungs attempted. Measured: `PASS (COMPLETED,
1 iteration(s))` 4/4, about 21 s wall for both passes.

## What is already true

- **The self-acceptance contract runs TWICE inside one invocation**, and the second run is the check.
  `scripts/acceptance.mjs` requires both to be `PASS` and exits 1 naming the cause when they disagree,
  because a single run on a fresh checkout would pass over a world that never rebuilt at all. Falsified:
  blowing away `#rebuild` gives `run 1: exit 0 - PASS / run 2: exit 1 - FAIL`, with `AC-002` and
  `AC-003` each naming the exit code of a command that answered 3.
- **It is deliberately not a `demo:*` script**, and the prefix would have been a lie: a demo shows a
  defect found and repaired, this contract has `maxIterations: 1` and is observed once with
  `--no-repair`, because the application under it is the CLI itself and there is nothing to repair.
  Borrowing the prefix would have enrolled it in three checks a false statement satisfies -- helpful
  context for anyone tempted to "tidy" the naming.
- **`tests/demo-rosters.test.ts` holds a roster of its own for it** across the four places that name it:
  the manifest, `README.md`, `AGENTS.md` and the CI workflow. Its workflow reader accepts **both**
  spellings -- `run: |` followed by bare command lines, and an inline `run:` scalar -- because the first
  version matched only one and failed against a **correctly** running command.
- **The step's position is a claim held by a check, not a comment.** The self-acceptance step must sit
  **above** the demo loop, because every run in that job writes the same `.veridian/latest-result.json`
  and the upload step carries the whole of `.veridian/` -- so the reading a reader opens first is
  whichever run wrote that file last. Falsified 2/2: moving it below the loop fails *"runs it before the
  demo loop, so the artifact's newest reading is the Cockpit's"*, and deleting it fails *"is run by a CI
  job, rather than only described by one"*.
- **It has no `*-demo.test.ts` of its own**, and the asymmetry is deliberate. The demo suites hold
  properties of a defect table -- the `correct` block present exactly once in the shipped program, the
  criterion a defect is filed against, the progression the table predicts -- and a contract with no
  defects has none of those. What matters here is held by **executing** it, which the CI job does.
- **The route was observed on a runner and found a real defect.** Its first execution printed
  `run 1: exit 1 - FAIL (MAX_ITERATIONS, 1 iteration(s))` because a `cli/` extraction had silently
  dropped a `logger.info` the contract's `AC-006` asserted. The suite stayed green at **2531 tests
  before and after** -- a log line an operator watches is a behaviour, and a behaviour needs an
  assertion somewhere that runs.

## What this phase does

1. **Extend the ladder fixtures to cover a rung the tree has not yet witnessed.** The self-prompting
   rung is the newest, and a rung is only real if a run reaches it: the phase adds fixtures whose gaps
   are shaped so that each rung is reached **or** refused, and asserts the rung recorded -- not the rung
   intended.
2. **Keep the nested-run reading honest.** Each criterion reads the *nested* `latest-result.json`, which
   means the outer contract's evidence is a file a **different run** wrote. Two runs in one sandbox is
   exactly where an inherited world hides, so the fixtures write to a directory that is a **sibling of
   the sandbox** and never to `.veridian/`, so they cannot contend for the single-slot summary.
3. **Add no new declared route without adding it to all four rosters.** A new script is a roster entry in
   `package.json`, `README.md`, `AGENTS.md` and `.github/workflows/ci.yml`, and the fourth is the one
   nobody reads -- the workflow ran seven demos while the manifest declared thirteen, and the build was
   green because a job that runs seven of thirteen demos passes.

## Acceptance criterion

- `npm run acceptance` exits 0 with **both** runs `PASS (COMPLETED, 1 iteration(s))`, 7/7.
- `npm run acceptance:ladder` exits 0 with both passes `PASS (COMPLETED, 1 iteration(s))`, 4/4, and each
  criterion's evidence is the **nested** run's own result file.
- Any rung the ladder is expected to reach is asserted **from the recorded rung**, and a fixture that
  reaches no rung is `INCONCLUSIVE` rather than silently passing.
- Every route named in the manifest appears in all four rosters, in full.

## Falsification probe

- **Blow away `#rebuild` and run twice.** Expect `run 1: exit 0 - PASS / run 2: exit 1 - FAIL`. This is
  the probe that proves the double invocation is a check rather than a duplicate.
- **Move the self-acceptance step below the demo loop.** Expect the roster guard's ordering assertion to
  fail naming the Cockpit.
- **Point a ladder criterion at its own outer run's result file instead of the nested one.** Expect the
  criterion to read a rung no fixture reached. This is the probe that keeps an inner witness from being
  answered by the outer run.
- **Delete one of the four roster mentions.** Run each of the four in turn and expect the failure to name
  that place and no other -- the four-route probe was falsified 4/4 when it was written.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `tests/demo-rosters.test.ts` | The four rosters, twelve `it` blocks over three `describe` blocks, and the ordering claim |
| `tests/definition-resolution.test.ts` | That a gap's path names a place that may not exist yet while its container must |
| the `worlds` CI job | That all twelve browserless demos run, each named in the log by its own `##[group]` marker |
| `scripts/acceptance.mjs` | The two-run check itself |

## Context budget

**Read:** `acceptance/acceptance.yaml`; `acceptance/environment.yaml`; `scripts/acceptance.mjs`; the
`acceptance/ladder/` fixtures the change touches.

**Do not read:** `docs/GAP-CLOSURE-PLAN.md`. It is the checklist for a world, and this phase adds no
world.

## Refusals

- **Do not put these under a `demo:*` prefix.** The prefix is enrolled in three checks a false statement
  satisfies, and this contract has no defects to repair.
- **Do not give it a `*-demo.test.ts`.** There is no defect table to hold, and a test asserting a defect
  table's properties over a table with no defects is a test that cannot fail.
- **Do not write to `.veridian/` from a fixture.** The summary is single-slot; a second writer silently
  changes which run a reader opens.
- **Do not assert the rung the fixture was *designed* to reach.** Assert the recorded one.
