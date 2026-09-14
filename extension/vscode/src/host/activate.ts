/**
 * The extension's entry point - the file `package.json`'s `main` names.
 *
 * ## Why this is compiled and the rest of Veridian is not
 *
 * Node 22 strips types and runs `.ts` directly, which is how `node cli/veridian.ts` works and why
 * the repository has no build step between its source and its program. **The VS Code extension host
 * is not Node's loader** - it loads JavaScript - so this one artifact must be compiled, exactly as
 * the npm package must be compiled for the related reason recorded in `AGENTS.md` (`node_modules`
 * refuses type stripping). Two runtimes, two rules, and each names the one it obeys.
 *
 * `out/` is generated, never edited, and never committed, on the same principle as `dist/`.
 *
 * ## What activation does
 *
 * Four statements: bind the port, build the Cockpit, register the commands, paint the dashboard.
 * Every decision those imply was made elsewhere. This file exists to prove that the extension can be
 * *assembled*, and it is the only file `node --test` cannot reach - see `extension/vscode/README.md`
 * for what that costs and how it is covered instead.
 */

import * as vscode from "vscode";

import { readLastSummary } from "../bundle.ts";
import { systemRunner } from "../cli.ts";
import { createCockpit } from "../cockpit.ts";
import { createVscodePort } from "./vscode-port.ts";
import { existsSync } from "node:fs";

/** Run on activation. Returns nothing: the state that matters lives in the run bundle, not here. */
export function activate(context: vscode.ExtensionContext): void {
  const port = createVscodePort(
    (item) => {
      context.subscriptions.push(item);
    },
    // Read on demand rather than captured: the active editor at activation time is rarely the one
    // the operator means when they invoke the command.
    () => vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
  );

  const cockpit = createCockpit({
    port,
    runner: systemRunner(),
    exists: (path) => existsSync(path),
    summarise: readLastSummary,
  });

  cockpit.registerAll();

  // Not awaited, and its failure is not reported: activation must complete whether or not a previous
  // run left a readable bundle. `refresh` writes what it found to the dashboard, and a dashboard
  // that says "no run yet" is the correct state for a workspace Veridian has never run in.
  void cockpit.refresh();
}

/** Nothing to release: the context disposes everything the Cockpit handed it. */
export function deactivate(): void {
  /* nothing held outside `context.subscriptions` */
}
