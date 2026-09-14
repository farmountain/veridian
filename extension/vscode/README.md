# Veridian Cockpit

A thin client for Veridian inside VS Code: run a sandbox validation, see the verdict, open the
evidence.

**VS Code is not Veridian.** This extension is a *client* of Veridian Core, exactly as the CLI is. It
contains no validation logic, does not know what a validator is, and cannot decide whether anything
passed. It locates the CLI, runs it, reads the bundle the CLI wrote, and shows the operator what the
bundle says. Everything it displays was decided by the engine.

## Status

Built, typechecked, tested and compiled. Every figure below was measured in this repository, not
estimated:

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npx tsc --noEmit` | silent (exit 0) |
| Tests | `node --test` | 60 tests, 0 failing |
| Build | `npm run build` | `out/` - 6 files |
| Compiled artifact | `npm run smoke:out` | 14 checks, exit 0 |
| All of the above | `npm run gate` | exit 0 |

## Running it

There is **no `.vsix` route yet**, and that is a deliberate gap rather than an oversight: packaging
needs `@vscode/vsce`, which is not a dependency here and whose output has never been produced on this
machine. A packaging step nobody has run would be a claim, and this repository does not make those.
What exists and is exercised is the **development install**:

```powershell
cd extension\vscode
npm install
npm run gate          # typecheck, test, build, and load the compiled extension
```

Then open this repository in VS Code and press **F5**. `.vscode/launch.json` carries the
`Veridian Cockpit` configuration; its `preLaunchTask` builds the extension first, because the
extension host loads `out/` and `out/` is generated. F5 opens an Extension Development Host with the
Cockpit active against whatever folder you open in it.

## The commands

All six are in the `Veridian` category and appear in the command palette.

| Command | What it does |
|---------|--------------|
| `veridian.init` | Creates the state directory (`.veridian`) |
| `veridian.clarify` | Resolves the definition and shows the transcript |
| `veridian.validate` | Runs a validation against the goal |
| `veridian.metrics` | Measures M1..M5 over the runs on disk |
| `veridian.showResult` | Opens the last verdict in the editor |
| `veridian.openFailure` | Opens the last failure report |

`validate` and `clarify` need a goal; the extension looks for a configured `veridian.goal`, then for
an open `goal.yaml`/`goal.yml`, and refuses with a message naming the problem if neither exists. It
never invents a goal. `showResult` and `openFailure` never error: an operator asking to see a report
that does not exist yet gets told that, not a failure.

The dashboard sits in the status bar and reads `Veridian: PASS (3 criteria, iteration 3)`,
`Veridian: FAIL (1 failed, 0 undecided, iteration 2)`, or `Veridian: no run yet`. A run that ended
`INCONCLUSIVE` says so, in those words, because `INCONCLUSIVE` is not a pass.

## The settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `veridian.cli` | `""` | An explicit CLI entry point. Empty means locate it. |
| `veridian.goal` | `""` | An explicit goal document. Empty means look for `goal.yaml`. |
| `veridian.stateDir` | `".veridian"` | Where the run bundle lives. |
| `veridian.browser` | `"auto"` | Passed as `--browser`. `none` makes every browser observation `INCONCLUSIVE`. |

Locating the CLI tries the checkout first (`cli/veridian.ts`) and the installed package second
(`node_modules/veridian/dist/cli/veridian.js`), then falls back to `npx --no-install veridian`. That
order is why this extension works against a Veridian checkout - the common case while both are being
developed - without a global install, and against a published Veridian without a checkout.

The state directory is resolved to an absolute path before it is handed to the CLI *or* read by the
extension, so the file the CLI writes and the file the dashboard reads cannot be two different files
even if the child process's working directory changes.

## How this is tested, and what that does not cover

Three layers, because the extension has three execution surfaces:

1. **The decisions** - `src/*.test.ts`, run by `node --test` with no editor. That is why `src/port.ts`
   exists: the VS Code API surface the Cockpit uses is declared there by hand, so
   `src/cockpit.test.ts` can drive every command against a recording double and assert the messages,
   the status bar text, which flags reach the CLI and which paths are opened. `src/host-boundary.test.ts`
   holds the boundary itself: only the two host files may import `vscode`, and no test may import them.
2. **The compiled artifact** - `npm run smoke:out`. `node --test` runs `.ts`; the extension host runs
   `out/*.js`, and nothing else here covers those files. This script resolves the manifest's `main`,
   aliases `vscode` to `scripts/vscode-stub.mjs`, loads the real compiled entry point, calls
   `activate`, and asserts that the commands it registers are exactly the six the manifest declares.
   It was falsified rather than trusted: pointing `main` at a path the build does not produce makes it
   fail, naming the manifest as the cause.
3. **The editor** - **not covered here, and it cannot be.** `@types/vscode` is types only; there is no
   `vscode` module to import in a Node process. The following are exercised *only* by a real VS Code
   test host, which this repository does not yet have:
   - `src/host/vscode-port.ts` and `src/host/activate.ts` running against the real API;
   - the command palette, keybindings and menus, which are the editor's contribution and not the
     extension's;
   - the status bar's actual rendering, its prioritisation against other items, and its tooltip;
   - workspace trust, multi-root workspaces, and a workspace whose folder is a UNC path;
   - the exact behaviour of `openTextDocument` on a file deleted between the read and the reveal.

   `scripts/vscode-stub.mjs` is a **recording double, not a simulation**: it implements what the
   Cockpit calls and records what happened. A green `smoke:out` is a *required* condition for this
   extension to work, not a sufficient one, and nothing in this repository should be read as claiming
   the editor integration has been observed.

## Layout

```
src/port.ts            The slice of the VS Code API the Cockpit uses, declared by hand.
src/bundle.ts          Reads a run bundle. Imports nothing from core/.
src/cli.ts             Locating and driving the CLI.
src/cockpit.ts         What each command does. No validation logic.
src/host/vscode-port.ts  The one place `vscode` is imported, besides activate.
src/host/activate.ts   The entry point `package.json`'s `main` names.
src/fake-port.ts       The recording double the tests drive. Excluded from the build.
scripts/vscode-stub.mjs  The recording double for the compiled artifact.
scripts/smoke-out.mjs    Loads and activates `out/` without an editor.
out/                   GENERATED by `npm run build`. Never edited, never committed.
```

## Why this is the one directory with a build step

Node 22 strips types and runs `.ts` directly, which is how `node cli/veridian.ts` works and why there
is no build step between Veridian's source and its program. **The VS Code extension host is not
Node's loader** - it loads JavaScript - so this artifact must be compiled, exactly as the npm package
must be for the related reason recorded in `AGENTS.md`. Two runtimes, two rules; each file obeys the
one it runs under. `tsconfig.json` here is `noEmit` (typecheck only) and `tsconfig.build.json` adds
`outDir`, `rootDir` and `rewriteRelativeImportExtensions`, which is what turns the tree's `.ts` import
specifiers into `.js`.

This extension has **no runtime dependencies**. `@types/vscode` is types only; the extension ships
`out/` and nothing else.
