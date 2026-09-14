/**
 * The slice of the VS Code API the Cockpit uses, declared as a port.
 *
 * ## Why this file exists at all
 *
 * `PLAN.md` §30 asks for a Cockpit, and `AGENTS.md` is emphatic about what it must not become:
 * *"Do not make VS Code the architecture."* The mechanism is this file. Everything the extension
 * *does* lives in `cockpit.ts` and is written against `VscodePort`; exactly one file,
 * `host/vscode-port.ts`, imports the real `vscode` module. So the activation path - which commands
 * are registered, what each one runs, what it says when it fails - is exercised by `node --test`
 * with no editor anywhere, and the part that genuinely needs an editor host is one file, named.
 *
 * ## A port is a claim about agreement, so it is kept small
 *
 * This is a hand-written declaration of the API surface Veridian depends on, and a hand-written
 * declaration can drift from the thing it declares. Two rules keep that survivable: the surface is
 * *exactly* what the Cockpit calls (`grep` for a member that is never used and it should not be
 * here), and the members are the stable, decade-old core of the API - `registerCommand`,
 * `createOutputChannel`, `createStatusBarItem`, `showErrorMessage` - rather than anything recent
 * enough to move.
 */

/** A handle the extension must release when it is deactivated. */
export interface Disposable {
  dispose(): void;
}

/**
 * A channel the run's progress is written to.
 *
 * The CLI writes every log line to **stderr on purpose** (`cli/support.ts`): the run's result is a
 * file and stdout is the summary a caller reads, so progress chatter on stdout would make the one
 * machine-readable stream machine-unreadable. The Cockpit therefore streams the child's *stderr*
 * here and reads the verdict from the bundle, never from stdout.
 */
export interface OutputChannel {
  appendLine(line: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/** The dashboard item. `text` and `tooltip` are writable because that is how it is updated. */
export interface StatusBarItem {
  text: string;
  tooltip: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** A registration handle, returned by `registerCommand`. */
export interface CommandRegistration extends Disposable {
  readonly id: string;
}

/** Where the status bar item sits. Only these two are used. */
export type StatusBarAlignment = "left" | "right";

/**
 * Everything the Cockpit needs from the editor.
 *
 * Deliberately *not* included, because nothing calls it: terminals, webviews, file-system
 * watchers, diagnostics, quick picks. A Cockpit that owned a webview would be a second renderer of
 * the bundle, and the bundle already has one - the file.
 */
export interface VscodePort {
  /** The first workspace folder, absolute. `null` when no folder is open. */
  readonly workspaceRoot: string | null;

  /** The absolute path of the active file, or `null`. Used only to find a goal document. */
  activeFilePath(): string | null;

  /** Reads `veridian.*`. Narrowing is the caller's job, and that is intentional: a setting is a
   * string a human typed, so nothing may treat it as already-correct. */
  setting(key: string): unknown;

  registerCommand(id: string, handler: () => Promise<void>): CommandRegistration;

  createOutputChannel(name: string): OutputChannel;

  createStatusBarItem(alignment: StatusBarAlignment, priority: number): StatusBarItem;

  showInformationMessage(message: string): void;
  showErrorMessage(message: string): void;

  /** Reveals a file in the editor. Used for the evidence viewer. */
  openPath(absolutePath: string): void;

  /**
   * Hand something to the editor to dispose when the extension is deactivated.
   *
   * A method rather than a `Disposable[]` property on purpose. The host's real subscription list is
   * the extension context's, which this port may not expose - and an array property would have to be
   * faked with a `push` that reaches back into the context, which is the kind of cast that makes a
   * declared type stop describing anything.
   */
  keep(item: Disposable): void;
}
