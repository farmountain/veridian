# Veridian Cockpit

A thin client for Veridian inside VS Code: run a sandbox validation, see the verdict, open the
evidence. Veridian builds eleven reproducible sandbox worlds and decides whether the software works;
the agent stays external.

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
| Tests | `node --test` | 64 tests, 0 failing |
| Build | `npm run build` | `out/` - 6 files |
| Compiled artifact | `npm run smoke:out` | 15 checks, exit 0 |
| Packaged archive | `npm run package` | `veridian-cockpit.vsix` - 11 files, 24.39 KB |
| Archive contents | `npm run smoke:vsix` | 32 checks, exit 0 |
| All of the above but the archive | `npm run gate` | exit 0 |

**The editor floor is `^1.100.0`, and that is a fact about the entry point rather than a courtesy.**
`package.json` declares `"type": "module"`, so the compiled `out/host/activate.js` is an ES module -
and the Node.js extension host could not load one until VS Code 1.100. The floor used to say
`^1.94.0`, which would have let the extension install on six releases that cannot activate it.
`src/packaging.test.ts` reads the module format out of `tsconfig.json` and the floor out of the
manifest and fails if the first cannot be loaded by the second, so the two cannot drift apart again.

## Running it

There are **two install routes**, and both produce an extension this repository has actually built.

The first is a **development install**, which is what you want while working on either half:

```powershell
cd extension\vscode
npm install
npm run gate          # typecheck, test, build, and load the compiled extension
```

Then open this repository in VS Code and press **F5**. `.vscode/launch.json` carries the
`Veridian Cockpit` configuration; its `preLaunchTask` builds the extension first, because the
extension host loads `out/` and `out/` is generated. F5 opens an Extension Development Host with the
Cockpit active against whatever folder you open in it.

The second is a **`.vsix`**, which is what you want to hand to somebody else:

```powershell
cd extension\vscode
npm run package       # vsce package --no-dependencies --out veridian-cockpit.vsix
npm run smoke:vsix    # read the archive back and check what it holds
```

`veridian-cockpit.vsix` is written to this directory and is **not committed** - it is generated, like
`out/` and like the root `dist/`, and `.gitignore` says so. It carries `out/`, `package.json`, the
README, and the licence at the extension root; it does not carry `src/`, `scripts/`,
`tsconfig*.json`, `package-lock.json` or `node_modules/`. Those exclusions are not a `.vscodeignore`,
and deliberately: with a `files` field in the manifest, `vsce` includes *only* what is listed
(plus `package.json` and the README, which it always adds), and a `.vscodeignore` would **replace**
that rule rather than refine it. One mechanism, one answer - and `smoke:vsix` asserts the answer by
reading the archive instead of restating the manifest.

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

Four layers, because the extension has four execution surfaces - and the fourth is the one this
repository cannot reach at all:

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
   fail, naming the manifest as the cause. Its two dashboard checks were fixed and re-falsified in the
   same way. They used to wait a single turn of the loop for the refresh - which does not await itself -
   to land, and *one turn* is a statement about the machine's schedule rather than about the extension:
   the refresh awaits real `fs` I/O, so under load the turn ended before the read did and a healthy
   extension failed a check. The wait is now bounded and keyed on the condition (`settled`), rather than
   on a turn count, and the probe that shows it does work is to make the dashboard arrive one turn
   later: the bounded wait passes, the old fixed-turn wait fails both checks.
3. **The packaged archive** - `npm run smoke:vsix`. A `.vsix` is not `out/`: it is a zip that a
   third-party tool builds from an allowlist in the manifest, and every decision about what travels
   is made by that tool and by nothing in either tree. This is the same gap `smoke:out` closes for
   `out/` and the root's `smoke:dist` closes for `dist/`, one runtime further out. The script reads
   the zip's central directory by hand - no dependency was added to read it - and asserts that the
   entry point `main` names is inside, that the manifest *inside* the archive agrees with the
   manifest on disk field by field, that no source file, test file or installed dependency travelled
   with it, that the licence did and is byte-identical to the repository's, and that every compiled
   file it carries is the build's. Each of those was falsified rather than trusted: putting `src` in
   the allowlist fails both negative checks and exits 1; adding a byte to a compiled file *after*
   packaging fails the byte-identity check and exits 1; appending a line to the licence copy fails
   with `the licence in the archive is the repository's, byte for byte (1388 bytes)` and exits 1; and
   taking `LICENSE` out of the manifest's `files` produces the one failure worth reading twice -
   `vsce` prints `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`, packages **10** files, and
   **exits 0**, so nothing in the packaging step reports a problem. `smoke:vsix` is what fails
   (`the archive ships the licence it is redistributed under`, exit 1). That is the whole reason
   layer 3 exists beside the gate: the tool warns, and a warning is not a check.
4. **The editor** - **not covered here, and it cannot be.** `@types/vscode` is types only; there is no
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
   the editor integration has been observed. `smoke:vsix` inherits exactly the same caveat: it proves
   the archive holds the right bytes, and says nothing about whether VS Code accepts them.

## Layout

```
src/port.ts            The slice of the VS Code API the Cockpit uses, declared by hand.
src/bundle.ts          Reads a run bundle. Imports nothing from core/.
src/cli.ts             Locating and driving the CLI.
src/cockpit.ts         What each command does. No validation logic.
src/host/vscode-port.ts  The one place `vscode` is imported, besides activate.
src/host/activate.ts   The entry point `package.json`'s `main` names.
src/fake-port.ts       The recording double the tests drive. Excluded from the build.
src/packaging.test.ts  Holds the manifest against the build: the editor floor, the type floor,
                       the entry point's allowlist coverage, and the licence copy.
scripts/vscode-stub.mjs  The recording double for the compiled artifact.
scripts/smoke-out.mjs    Loads and activates `out/` without an editor.
scripts/smoke-vsix.mjs   Reads the packaged archive back, as a zip, without an editor.
LICENSE                A copy of the repository's, byte for byte. `vsce` looks for it *here*.
                       It is in the manifest's `files` because it would not travel otherwise.
out/                   GENERATED by `npm run build`. Never edited, never committed.
veridian-cockpit.vsix  GENERATED by `npm run package`. Never edited, never committed.
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
`out/` and nothing else that has to be resolved at activation time. What else travels with it - the
manifest, the README and the licence - travels because `vsce` puts it there, not because the
extension imports it.
