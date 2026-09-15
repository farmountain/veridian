/**
 * The one place `vscode` is imported.
 *
 * Every other file in `src/` is free of the editor, which is what lets `node --test` exercise the
 * whole activation path without one. This file is therefore the *entire* surface that cannot be
 * covered here, and it is deliberately the smallest file in the extension: each member is a direct
 * forwarding of one call, with no decision in it. Where a decision was needed - which goal, which
 * CLI, what an exit code means, whether to hide the dashboard - the decision lives in `cockpit.ts`,
 * `cli.ts` or `bundle.ts`, and is tested there.
 *
 * `@types/vscode` is the only dependency this file needs, and it is a types-only package: the
 * extension ships no runtime dependency at all, which matches a repository whose single runtime
 * dependency is `yaml`.
 */

import * as vscode from "vscode";

import type { CommandRegistration, Disposable, OutputChannel, StatusBarAlignment, StatusBarItem, VscodePort } from "../port.ts";

function alignment(value: StatusBarAlignment): vscode.StatusBarAlignment {
  return value === "left" ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
}

/**
 * `subscribe` is passed in rather than reached for, so this file does not know that the extension
 * context exists. `activate.ts` owns the context; this file owns the API shape.
 */
export function createVscodePort(
  subscribe: (item: Disposable) => void,
  activeFilePath: () => string | null,
): VscodePort {
  return {
    get workspaceRoot(): string | null {
      return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    },

    activeFilePath,

    setting(key: string): unknown {
      // One `get` with the full dotted key rather than a section-and-leaf pair: `veridian.cli` is how
      // the operator writes it in `settings.json`, and reading it the same way means the extension
      // and the settings file cannot disagree about what the key is called.
      return vscode.workspace.getConfiguration().get(key);
    },

    registerCommand(id: string, handler: () => Promise<void>): CommandRegistration {
      const disposable = vscode.commands.registerCommand(id, () =>
        // The promise is **returned**, never discarded with `void`. Two things depend on it and only
        // the first is about failure.
        //
        // The `.catch` is what stops a rejected handler becoming an unhandled rejection that the
        // extension host reports as a crash - one whose message would name this wrapper rather than
        // the command that failed.
        //
        // The `return` is what tells the caller that the command has not finished yet. A wrapper that
        // swallowed the promise would let `executeCommand` resolve the moment the handler *started*,
        // so any host that awaits a command and then tears the extension down abandons the handler
        // mid-flight - and the operator sees a command that did nothing rather than one that failed.
        handler().catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Veridian ${id} failed: ${detail}`);
        }),
      );
      return {
        id,
        dispose: (): void => {
          disposable.dispose();
        },
      };
    },

    createOutputChannel(name: string): OutputChannel {
      const channel = vscode.window.createOutputChannel(name);
      return {
        appendLine: (line: string): void => {
          channel.appendLine(line);
        },
        show: (preserveFocus?: boolean): void => {
          channel.show(preserveFocus);
        },
        dispose: (): void => {
          channel.dispose();
        },
      };
    },

    createStatusBarItem(side: StatusBarAlignment, priority: number): StatusBarItem {
      const item = vscode.window.createStatusBarItem(alignment(side), priority);
      return {
        get text(): string {
          return item.text;
        },
        set text(value: string) {
          item.text = value;
        },
        get tooltip(): string | undefined {
          // `StatusBarItem.tooltip` is `string | MarkdownString | undefined`. The Cockpit only ever
          // assigns a plain string, so the other branch is a narrowing rather than a policy - and
          // dropping it is right, because a tooltip rendered as Markdown would italicise the
          // asterisks in an operator's own failure message.
          const value = item.tooltip;
          return typeof value === "string" ? value : undefined;
        },
        set tooltip(value: string | undefined) {
          item.tooltip = value;
        },
        show: (): void => {
          item.show();
        },
        hide: (): void => {
          item.hide();
        },
        dispose: (): void => {
          item.dispose();
        },
      };
    },

    showInformationMessage(message: string): void {
      void vscode.window.showInformationMessage(message);
    },

    showErrorMessage(message: string): void {
      void vscode.window.showErrorMessage(message);
    },

    openPath(absolutePath: string): void {
      // `openTextDocument` is typed as always answering a thenable, and a real editor always does. A
      // host that does not implement the API may refuse it *by name* and answer `undefined` instead
      // of a rejected promise - this world's own substitute does exactly that - and calling `.then`
      // on that throws before either branch below can run, turning a viewer command into a crash the
      // operator reads as a failure of the command rather than of the host.
      //
      // So the answer is checked for the shape this code needs before it is used. A refusal is a
      // viewer command doing nothing, which is what the rejection branch already documents; a crash
      // is not.
      const opened: unknown = vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
      const thenable = opened as { then?: unknown } | null | undefined;
      if (thenable === null || thenable === undefined || typeof thenable.then !== "function") return;
      void (opened as PromiseLike<vscode.TextDocument>).then(
        (document) => vscode.window.showTextDocument(document, { preview: false }),
        // The file may not exist - a bundle can be deleted between the read and the reveal. An
        // editor that silently does nothing is the right behaviour for a *viewer* command; a modal
        // about a missing evidence file would interrupt the operator to tell them nothing useful.
        () => undefined,
      );
    },

    keep(item: Disposable): void {
      subscribe(item);
    },
  };
}