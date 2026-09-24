# Phase 05 -- The Cockpit twin surface

| | |
|---|---|
| **Status** | built -- `extension/vscode/src/twin.ts` reads the join and renders it, and AC-9 is held by reading that module's imports |
| **Depends on** | 02, 03, 04 (there is nothing to render until the join, the predicate and the document exist) -- all three built |
| **Source** | `docs/DIGITAL-TWIN-PLAN.md` S4 (W4); `extension/vscode/README.md` |
| **Touches** | `extension/vscode/src/**` and the manifest; **no** root-tree file |
| **Acceptance** | AC-9 of `docs/DIGITAL-TWIN-PLAN.md` S4 |

## Why this phase exists, and why it is deferred

The Cockpit is a **thin client over a stable local Core interface**, and the twin surface is the
thinnest client of all: it reads the ELI (phase 02) and shows it. `docs/DIGITAL-TWIN-PLAN.md` defers it
until phases 02 through 04 are green, and the reason is not scheduling -- it is that a surface built
over a join that does not exist yet can only be built over a *guess* about the join, and a guess about
a reading is the shape this repository refuses everywhere else.

The deferred position is also honest about cost. `extension/vscode/` is the **only** directory in the
repository with a build step, and it has two generated artifacts rather than one: `out/` (the extension
host is not Node's loader) and `veridian-cockpit-<version>.vsix` (packaged by a third-party tool from
an allowlist in the manifest). A surface change is a three-command gate, a repackage, and a readback.

## What is already true

- **`src/port.ts` declares by hand the slice of the editor API the Cockpit uses**, so every decision is
  testable without an editor. Only `src/host/vscode-port.ts` and `src/host/activate.ts` may import
  `vscode`, and `src/host-boundary.test.ts` holds that as an executable rule (falsified: prepending
  such an import to an ordinary test fails it, naming the cause and the remedy).
- **There is no runtime dependency**, and Playwright is not one of them -- which is why the archive is
  read back with `node:zlib` by hand rather than with a zip library.
- **The extension's gate is three commands**, not one: `npx tsc --noEmit`, `node --test` (92
  tests, 0 failing, `# suites` reads 0 because no test sits inside a `describe`), `npm run build`
  (`out/`, 7 files), `npm run smoke:out` (15 checks). `npm run package` and `npm run smoke:vsix` (35
  checks) are deliberately **outside** `gate`, because a packaging tool's output is not part of the
  source tree's contract.
- **`src/packaging.test.ts` holds six facts**, each a way the extension ships broken: the editor floor
  admits the module format the build emits, `@types/vscode` is not ahead of that floor, the manifest's
  `files` allowlist covers the entry point the manifest names, the licence copy is the repository's byte
  for byte, and the manifest names and allowlists the icon, which is the project's logo byte for byte.
- **`examples/vscode-cockpit` is the precedent for a surface that touches the artifact.** It stages the
  real compiled Cockpit into a substitute extension host and judges it with eleven criteria, it needs
  `npm run build` first, and it **refuses by name** when `out/` is absent rather than skipping -- *a
  skipped check reports a green suite*. It also found two real defects in `vscode-port.ts`, the one file
  a double of the editor API cannot falsify.

## What this phase does

1. **Read the join, render it, decide nothing.** The panel shows the ELI's rows. It contains no
   validation logic, no verdict logic and no metric computation -- a second implementation of a verdict
   in a client is a second answer to the question the run already answered.
2. **Extend the hand-declared port surface, not the editor import surface.** Any new editor capability
   goes into `src/port.ts` first; only `src/host/vscode-port.ts` implements it against the real API.
3. **Extend the manifest's contribution points deliberately**, then satisfy the manifest guards: the
   commands declared in `package.json` must equal the commands `activate()` registers (the
   `smoke:out` check asserts this), and the `files` allowlist must still cover everything that travels.
4. **Repackage and read the archive back.** `npm run package`, then `npm run smoke:vsix`, then read the
   attached asset's hash if a release is involved. `npm run package` succeeding says only that a file
   was written; it says nothing about whether the file is current, and this tree has already shipped a
   public version whose attached archive predated a repair.

## Acceptance criterion

- **AC-9** -- the surface reads the ELI and renders it. It imports no validation logic: asserted by
  reading the module's imports, not by reading the panel.
- `npm run gate` inside `extension/vscode` exits 0, `npm run smoke:out` exits 0, `npm run package`
  writes an archive, and `npm run smoke:vsix` exits 0.
- The registered commands equal the manifest's declared commands, and the archive's compiled files are
  byte-identical to the build's.

## Falsification probe

- **Independence.** Point the panel at a hand-built array instead of the ELI and expect the reading
  assertion to fail. A panel whose test supplies its own fixture proves the panel renders a fixture.
- **The boundary.** Add an `import ... from "vscode"` to an ordinary `src/**` module and expect
  `src/host-boundary.test.ts` to fail naming the file. This probe already exists in the tree and should
  be re-run, not re-invented.
- **Staleness.** Append a byte to `out/bundle.js` *after* packaging and expect `smoke:vsix` to fail
  *"every compiled file in the archive is byte-identical to the one on disk"*. This is the property that
  makes the archive a reading rather than a hope.

## What was measured, and one thing this phase got wrong about itself

The phase was built as `src/twin.ts` (the join and the rendering), three commands' worth of wiring in
`src/cockpit.ts` and `src/host/activate.ts`, one manifest contribution, and 20 new tests. Each figure
below is a command's output, re-taken after the last edit:

| Gate | Command | Before | After |
|---|---|---|---|
| Extension typecheck | `npx tsc --noEmit` | silent | silent |
| Extension tests | `node --test` | 72 | **92** |
| Build | `npm run build` | `out/`, 6 files | **7 files** |
| Compiled artifact | `npm run smoke:out` | 15 checks | 15 checks (**7 commands**) |
| Archive | `npm run package` | 12 files, 119.98 KB | **13 files, 125.09 KB** |
| Archive contents | `npm run smoke:vsix` | 35 checks | 35 checks (**7 compared**) |
| Root suite | `npm run gate` | 2625 / 438 / 0 | **2645 / 438 / 0** |

The sixth probe is worth keeping because it fired the *first* time only in the sense of exiting 1:

| Probe | Expectation | Result |
|---|---|---|
| **Staleness** - append a byte to `out/bundle.js` after packaging | `smoke:vsix` fails on byte-identity | `FAIL every compiled file in the archive is byte-identical to the one on disk`, exit 1; rebuilt -> exit 0 |
| **Boundary** - prepend `import * as vscode` to `src/twin.ts` | `host-boundary.test.ts` names the file | `not ok 2 - only the host binding imports vscode`, listing `twin.ts` |
| **Independence** - point the panel at a hand-built array | the reading assertions fail | 2 failures, exactly the two that assert the panel shows what it was handed |
| **AC-9 imports** - add `import type { CliSettings } from "./cli.ts"` | the import-list assertion names the specifier | `not ok 1`, printing `1: './cli.ts'` with the reason |
| **No verdict literal** - put `"PASS"` in `renderTwin` | the literal assertion fires | 2 failures, the named one first |
| **The subject pin** - change `metrics.ts`'s fallback `?` to `-` | the pin names the formula | `not ok 5 - the subject is the one M1 computes` |
| **The schema pin** - drop `goal_id` from `required` | the pin names the field | `not ok 3 - the schema requires the field the join keys on` |

**Two probes had to be re-aimed, and one of them is the reason this section exists.** The AC-9 import
probe was first written as *swap `./bundle.ts` for `./cli.ts`*, which reported `not ok 1 - src\twin.test.ts`
- a **file-level module crash**, not an assertion. It looked like a firing probe and was not one: the
guard never ran, so it was demonstrated by nothing. Re-aimed at *add a resolvable extra import*, the
module loads and the assertion fails printing the exact specifier. And the schema probe's first
version replaced a two-line `required` block that is in fact one line, so `Replace` returned the input
and the suite stayed green - **a probe that changes nothing reports the reverse of what happened.**
Both were caught by printing the change marker (`False`) rather than by reading the `# fail` count.

### The thing this phase got wrong about itself

**Its own `Touches` line says *no* root-tree file, and that is false of the work it prescribes.** A new
`src/` module adds a compiled file to `out/`, which moves a count printed in four root-tree documents
(`AGENTS.md`, `README.md`, `docs/BUILD-AND-TEST-COMMANDS.md` twice, `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`
twice), and 20 new tests move the suite total in four more. The line was written about *source logic* -
no root-tree module is read or changed - and it is true of that and false as written, which is the same
shape as the distribution ledger's split row that `AGENTS.md` records: **a row that hides two facts
hides both.** The counts were re-measured here rather than left for phase 11, because a count is
re-measured at the moment its document is touched.

## Guards that must still pass

| Guard | Holds |
|-------|-------|
| `extension/vscode/src/host-boundary.test.ts` | That only the two host files import `vscode` |
| `extension/vscode/src/packaging.test.ts` | The editor floor, the type floor, the allowlist and the licence copy |
| `scripts/smoke-out.mjs` | That the compiled entry point the manifest names activates twice and registers exactly the six declared commands |
| `scripts/smoke-vsix.mjs` | That the archive holds what it claims, including the readme byte for byte |
| `examples/vscode-cockpit` (demo) | That the *artifact* works, not just the suite -- and it refuses by name when `out/` is absent |

## Context budget

**Read:** `docs/DIGITAL-TWIN-PLAN.md` S4's W4 block; `extension/vscode/README.md`; `src/port.ts`.

**Do not read:** the root tree's world adapters. This phase touches the extension and the manifest, and
the join it renders is phase 02's output.

## Refusals

- **No validation logic in the client.** `extension/vscode/README.md` says what the extension is not:
  VS Code is not Veridian.
- **No new runtime dependency.** The archive is read back with `node:zlib` precisely because there is
  none, and adding one to render a table would be the tail wagging the dog.
- **No `.vsix` rebuild outside a release.** The archive is generated and ignored; the release is its
  only durable address, and attaching it to the tag is part of the release rather than a follow-up.
- **No formatter, no linter.** There is deliberately no `npm run format`, and `prettier` is not
  installed. Do not add one to "tidy" the new module.
