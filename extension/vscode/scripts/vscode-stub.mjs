/**
 * The smallest `vscode` module the Cockpit actually uses.
 *
 * ## Why this exists
 *
 * `src/host/vscode-port.ts` and `src/host/activate.ts` are the two files that import the editor, and
 * therefore the two files `node --test` cannot reach: the extension host is not available to a plain
 * Node process. Left there, that would mean the *compiled artifact* - the thing an operator installs
 * and the only part of this extension that is not covered by `src/*.test.ts` - would be verified by
 * nothing, which is the same unverified claim `npm run smoke:dist` exists to refuse for the npm
 * package.
 *
 * This file is the substitute for the editor. It is deliberately a *recording* double: every member
 * the Cockpit calls is implemented, and every mutation it makes is kept so the driver can look at
 * what activation actually did. It is not a mock in the "assert these calls happened in this order"
 * sense - the driver asserts the extension's observable outcome, not its call sequence.
 *
 * ## What it is not
 *
 * It is not a simulation of VS Code, and the difference matters. A real editor contributes
 * everything this file leaves out: keybindings, the command palette, the workspace trust model, the
 * status bar's actual rendering. A pass here proves the extension *loads and activates*; it does not
 * prove the editor integrates it the way an operator will see. That bound is recorded rather than
 * papered over - see `src/host-boundary.test.ts` for the other half of the boundary.
 */

/** What activation did, for the driver to inspect. */
export const state = {
  commands: new Map(),
  outputChannels: [],
  outputLines: [],
  statusBarItems: [],
  information: [],
  errors: [],
  opened: [],
  disposed: [],
};

/** A workspace root, or `null` for a window with no folder open. Set by the driver. */
export const environment = {
  root: null,
  settings: {},
};

/** Clear everything between activations, so a second activation is not read as a first. */
export function reset() {
  state.commands.clear();
  state.outputChannels.length = 0;
  state.outputLines.length = 0;
  state.statusBarItems.length = 0;
  state.information.length = 0;
  state.errors.length = 0;
  state.opened.length = 0;
  state.disposed.length = 0;
}

class Disposable {
  constructor(label) {
    this.label = label;
  }
  dispose() {
    state.disposed.push(this.label);
  }
}

/** A recorded promise, so a driver can flush what the Cockpit fired and did not await. */
function recorded(collection, value) {
  collection.push(value);
  return Promise.resolve(undefined);
}

export const StatusBarAlignment = { Left: 1, Right: 2 };

export const Uri = {
  file(path) {
    return { fsPath: path };
  },
};

export const commands = {
  registerCommand(id, handler) {
    state.commands.set(id, handler);
    return new Disposable(`command:${id}`);
  },
};

export const window = {
  createOutputChannel(name) {
    const channel = { name, appendLine: (line) => state.outputLines.push(line) };
    channel.show = () => {};
    channel.dispose = () => state.disposed.push(`channel:${name}`);
    state.outputChannels.push(channel);
    return channel;
  },

  createStatusBarItem(alignment, priority) {
    const item = { text: "", tooltip: undefined, alignment, priority, shown: false, hidden: false };
    item.show = () => {
      item.shown = true;
      item.hidden = false;
    };
    item.hide = () => {
      item.hidden = true;
      item.shown = false;
    };
    item.dispose = () => state.disposed.push("status-bar");
    state.statusBarItems.push(item);
    return item;
  },

  get activeTextEditor() {
    return undefined;
  },

  showInformationMessage(message) {
    return recorded(state.information, message);
  },

  showErrorMessage(message) {
    return recorded(state.errors, message);
  },

  showTextDocument(document) {
    state.opened.push(document.uri.fsPath);
    return Promise.resolve(document);
  },
};

export const workspace = {
  get workspaceFolders() {
    return environment.root === null ? undefined : [{ uri: { fsPath: environment.root } }];
  },

  getConfiguration() {
    return {
      get(key) {
        return environment.settings[key];
      },
    };
  },

  openTextDocument(uri) {
    return Promise.resolve({ uri });
  },
};
