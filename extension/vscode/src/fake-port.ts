/**
 * A `VscodePort` that records instead of rendering.
 *
 * This is what makes the activation path testable without an editor: the same `createCockpit` and
 * `registerAll` the extension host calls are driven here, and the assertions are about what the
 * Cockpit *said* and *ran* rather than about pixels. It is shipped in `out/` only because the build
 * config compiles `src/`; it is excluded from the build by `tsconfig.build.json`.
 */

import type {
  CommandRegistration,
  Disposable,
  OutputChannel,
  StatusBarAlignment,
  StatusBarItem,
  VscodePort,
} from "./port.ts";

/** One command the Cockpit registered, with the handler so a test can invoke it. */
export interface RecordedCommand {
  readonly id: string;
  readonly invoke: () => Promise<void>;
  disposed: boolean;
}

export interface FakePort extends VscodePort {
  readonly commands: RecordedCommand[];
  /** Every line written to the output channel, in order. */
  readonly lines: string[];
  readonly information: string[];
  readonly errors: string[];
  readonly opened: string[];
  /** What the dashboard currently shows, or `null` when hidden. */
  readonly statusText: string | null;
  readonly statusTooltip: string | undefined;
  /** Everything handed to the host for disposal. */
  readonly kept: Disposable[];
  invoke(id: string): Promise<void>;
  registerCount(): number;
}

export interface FakePortOptions {
  readonly root?: string | null;
  readonly activeFile?: string | null;
  readonly settings?: Readonly<Record<string, unknown>>;
}

export function createFakePort(options: FakePortOptions = {}): FakePort {
  const commands: RecordedCommand[] = [];
  const lines: string[] = [];
  const information: string[] = [];
  const errors: string[] = [];
  const opened: string[] = [];
  const kept: Disposable[] = [];

  let statusText: string | null = null;
  let statusTooltip: string | undefined;
  let registrations = 0;

  const root = options.root === undefined ? "D:/ws" : options.root;
  const activeFile = options.activeFile ?? null;
  const settings = options.settings ?? {};

  const output: OutputChannel = {
    appendLine: (line: string): void => {
      lines.push(line);
    },
    show: (): void => {
      /* no viewport to reveal */
    },
    dispose: (): void => {
      /* nothing held */
    },
  };

  const status: StatusBarItem = {
    get text(): string {
      return statusText ?? "";
    },
    set text(value: string) {
      statusText = value;
    },
    get tooltip(): string | undefined {
      return statusTooltip;
    },
    set tooltip(value: string | undefined) {
      statusTooltip = value;
    },
    show: (): void => {
      /* already visible by default */
    },
    hide: (): void => {
      statusText = null;
      statusTooltip = undefined;
    },
    dispose: (): void => {
      /* nothing held */
    },
  };

  const port: FakePort = {
    get workspaceRoot(): string | null {
      return root;
    },
    activeFilePath: (): string | null => activeFile,
    setting: (key: string): unknown => settings[key],
    registerCommand: (id: string, handler: () => Promise<void>): CommandRegistration => {
      registrations += 1;
      const record: RecordedCommand = { id, invoke: handler, disposed: false };
      commands.push(record);
      return {
        id,
        dispose: (): void => {
          record.disposed = true;
        },
      };
    },
    createOutputChannel: (): OutputChannel => output,
    createStatusBarItem: (_side: StatusBarAlignment, _priority: number): StatusBarItem => status,
    showInformationMessage: (message: string): void => {
      information.push(message);
    },
    showErrorMessage: (message: string): void => {
      errors.push(message);
    },
    openPath: (absolutePath: string): void => {
      opened.push(absolutePath);
    },
    keep: (item: Disposable): void => {
      kept.push(item);
    },

    commands,
    lines,
    information,
    errors,
    opened,
    get statusText(): string | null {
      return statusText;
    },
    get statusTooltip(): string | undefined {
      return statusTooltip;
    },
    kept,
    async invoke(id: string): Promise<void> {
      const found = commands.find((command) => command.id === id);
      if (found === undefined) throw new Error(`no command registered as "${id}"`);
      await found.invoke();
    },
    registerCount: (): number => registrations,
  };

  return port;
}
