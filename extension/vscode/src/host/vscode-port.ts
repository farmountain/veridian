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
      const disposable = vscode.commands.registerCommand(id, () => {
        // Never `void handler()`. A rejected promise here would be an unhandled rejection the
        // extension host reports as a crash, and the message an operator would see would name the
        // wrapper rather than the command that failed.
        void handler().catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Veridian ${id} failed: ${detail}`);
        });
      });
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
      void vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath)).then(
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