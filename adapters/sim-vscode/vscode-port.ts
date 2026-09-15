/**
 * The substitute for an extension host: a real Node process, really loading a real extension, against
 * a real `vscode` module that this world wrote - and no editor anywhere in the loop.
 *
 * ## What is real, and what is substituted
 *
 * Real, and each one is a thing this world could have faked and does not:
 *
 * - **The extension is a real child process.** `activate` and `invoke` start `process.execPath` and run
 *   the extension's own `main` as an ordinary child, through the same `ProcessRunner` the rest of
 *   Veridian uses. Every `require("vscode")` the extension performs resolves to a file this world wrote,
 *   and every call it makes to that file is recorded by the code that ran - not reconstructed afterwards
 *   by a host that looked at the outcome.
 * - **The install is a real copy.** `install` reads the application's manifest, refuses one it cannot
 *   read, and copies the application's directory into the sandbox's extension store. A repair to the
 *   application's `main` is therefore observable, because the next install copies the new bytes.
 * - **The engine floor is really evaluated.** `engines.vscode` is a range, and this world decides
 *   `admitted` or `refused` against the API version the document declared, naming both.
 * - **State really persists.** `globalState` written by one host run is handed to the next, so an
 *   extension that caches across activations is observable across activations.
 *
 * Substituted, from `VSCODE_SIMULATED_SURFACES`: the extension host itself, module resolution,
 * activation events, the command registry, the window, configuration and the workspace. There is no VS
 * Code, no extension host, no editor process and no editor download anywhere in the loop. The host is an
 * ordinary child of this process with the operator's own privileges.
 *
 * ## The two settled by the design rather than by the absence
 *
 * **`vscode.env` is refused by name, and so are `workspace.openTextDocument` and `workspace.findFiles`.**
 * The window, the configuration, the state stores, the command registry and the workspace *folder* are
 * things a host can answer, and this one does. `env.appName` is a fact about an installation - which
 * editor, which build, which machine - and this world has no installation, so it does not offer the
 * namespace; reading a file the editor has open requires an editor, and this world has no open document.
 * Each is recorded as a refusal naming the API, rather than answered with a plausible-looking empty
 * string, because an extension that fails loudly and a criterion that can read why is worth more than an
 * extension that succeeds against a world that is not there.
 *
 * ## Two parties, and why the transcript names both
 *
 * A command line arrives from the application's own provisioning program or from a criterion's `run`
 * step, and the two are not the same party: the application asking for something this world does not
 * answer is a fact about the application, while a criterion asking is a fact about the contract. Every
 * {@link VSCodeCallRecord} carries its client, and so does every invocation, so a reading can be quoted
 * without attributing it to whoever did not do it.
 *
 * ## Why the extension talks to this world through a file
 *
 * The generated `vscode` module appends one JSON line per API call, synchronously, and the world folds
 * those lines into its state after the host process has exited. Synchronous appends are deliberate: the
 * editor's API is synchronous in the extension - `createOutputChannel` returns an object,
 * `getConfiguration(...).get(...)` returns a value - and a shim that answered those with a promise would
 * be a different API from the one extensions are written against. The report is the inverse of the
 * channel `sim-posix`, `sim-os` and `sim-container` use: there the application prints commands *to* the
 * world, and here the world's own module writes down what the extension did.
 *
 * ## One host process per action, and the three things that follow from it
 *
 * There is no editor process to keep an extension resident in, so every action that needs the extension
 * to be *running* - `activate`, `invoke` and `reload` - starts this world's host, and a host activates
 * the extension, because activating is how a host learns an extension's commands. A criterion author has
 * to know what that makes true, so it is declared here rather than discovered:
 *
 * - `activation.runs` counts host processes, and therefore counts activations. `activate`, then two
 *   `invoke`s, then a `reload` is four runs.
 * - Surfaces the extension appends to - output channels, messages, invocations - are a cumulative
 *   transcript across those runs, and each run appends its own activation to them. A criterion that
 *   compares those surfaces to a literal list is comparing them to a count of host runs, which is a fact
 *   about this world and not about the extension; the questions they answer well are "does this appear"
 *   and "what is the newest one".
 * - Durable state is the one surface genuinely shared *between* processes, so it is the surface to read
 *   when the question is whether something persisted.
 *
 * `install` and `reload` clear the handle surfaces - the command registrations, the status items, the
 * subscriptions - because the process that held them has exited and a handle nobody can dispose is not a
 * leak the extension is committing. They clear `output` and `messages` on install, because the code that
 * said those things has been replaced, and keep them on reload, because a reload does not unsay them.
 * Durable state survives both, which is what the real store does.
 *
 * ## A read must not mutate
 *
 * `read()` writes nothing and advances nothing. It enumerates the workspace folder, which is a read of a
 * filesystem and not an edit of a record, and every counter it reports was advanced by the operation
 * that performed it.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

import {
  VSCODE_SIMULATED_SURFACES,
  isVSCodeAction,
} from "../../core/environment/vscode-observation.ts";
import type {
  VSCodeAction,
  VSCodeActivationReading,
  VSCodeCallRecord,
  VSCodeClient,
  VSCodeCommandReading,
  VSCodeContributionReading,
  VSCodeEngineReading,
  VSCodeFileReading,
  VSCodeIdentityReading,
  VSCodeInvocationReading,
  VSCodeMessageLevel,
  VSCodeMessageReading,
  VSCodeObservationData,
  VSCodeRefusalReading,
  VSCodeResult,
  VSCodeSettingReading,
  VSCodeSettingSource,
  VSCodeStateReading,
  VSCodeStateScope,
  VSCodeStatusReading,
  VSCodeSubscriptionKind,
  VSCodeSubscriptionReading,
} from "../../core/environment/vscode-observation.ts";
import { withDeadline } from "../../core/process.ts";
import type { ProcessHandle, ProcessRequest, ProcessRunner } from "../../core/process.ts";

/** The host identity this substitute answers as when a document declares no other. */
export const SIM_HOST_NAME = "veridian-vscode-sim";

/** How long one host run may take before the caller is told it did not finish. */
const DEFAULT_HOST_TIMEOUT_MS = 30_000;

/** Where an installed extension lands, relative to the sandbox. */
export const EXTENSIONS_DIRNAME = "extensions";

/** The single workspace folder this host exposes, relative to the sandbox. */
export const WORKSPACE_DIRNAME = "workspace";

/** The three files this world writes into a sandbox to be a host. */
export const HOST_RUNNER_RELPATH = "host/run-extension.mjs";
export const SHIM_RELPATH = "node_modules/vscode/index.js";
export const SHIM_MANIFEST_RELPATH = "node_modules/vscode/package.json";

/**
 * The `vscode` module an extension in this world resolves to.
 *
 * Written as source rather than imported, because it has to be resolvable **from the sandbox**: an
 * extension's `require("vscode")` walks up from its own directory to `<sandbox>/node_modules/vscode`,
 * which is exactly how the real editor injects the module. Nothing here is interpolated - the shim reads
 * its world from `globalThis.__veridianVscode`, which the runner sets before the extension is loaded - so
 * a repaired sandbox and a fresh one run byte-identical host code, and a reader can diff them.
 *
 * It is CommonJS with `module.exports.<name> = ` assignments on purpose. Node's static analysis of a
 * CommonJS module finds those, so an ESM extension's `import * as vscode from "vscode"` sees the named
 * namespaces rather than a bare `default`. The `Proxy` behind them is what makes an API this world does
 * not implement a *recorded refusal* rather than a `TypeError` with no evidence attached.
 */
export const VSCODE_SHIM_SOURCE = `"use strict";
// The extension host this world stands in for. Every call is appended to a report the world folds into
// its reading. Nothing here reaches a network or an editor, because an extension's API is synchronous.
const { appendFileSync } = require("node:fs");

const world = globalThis.__veridianVscode;
if (!world) {
  throw new Error(
    "the vscode module was loaded outside a Veridian extension host: globalThis.__veridianVscode is unset",
  );
}

// var, not let: measured in this repository, the let form left the counter unreadable from the record
// function and every report line came back with an undefined operation name.
var seq = 0;
function record(op, result, value, reason) {
  seq += 1;
  appendFileSync(
    world.report,
    JSON.stringify({
      seq: seq,
      op: op,
      result: result,
      value: value === undefined ? null : value,
      reason: reason || null,
    }) + "\\n",
  );
}

const refuse = (api) => {
  record("api.refuse", "refused", { api: api }, "this host does not implement " + api);
};

// One handle per thing the extension is given, so "which of these did it release" is answerable. The
// flag is read by the runner at the end of the process, which is why it lives on the handle and not in
// a list the world could not observe.
function handle(kind, id) {
  const released = {
    __veridianDisposed: false,
    dispose() {
      if (released.__veridianDisposed) return;
      released.__veridianDisposed = true;
      record("subscription.dispose", "answered", { kind: kind, id: id });
    },
  };
  record("subscription.add", "answered", { kind: kind, id: id });
  return released;
}

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      const registration = handle("api", "EventEmitter.event");
      this._listeners.push({ listener: listener, registration: registration });
      return registration;
    };
  }
  fire(value) {
    for (const entry of this._listeners.slice()) entry.listener(value);
  }
  dispose() {
    for (const entry of this._listeners.slice()) entry.registration.dispose();
    this._listeners = [];
  }
}

const state = world.state;
const registrations = new Map();
const outputChannels = new Map();
let statusCounter = 0;

function statusItem(id, alignment, priority) {
  const released = handle("status", id);
  const item = {
    id: id,
    visible: false,
    disposed: false,
  };
  record("status.create", "answered", {
    id: id,
    // The editor's own enum, spelled out. A numeric alignment would make every failure report depend on
    // a reader knowing that 1 means left.
    alignment: alignment === 2 ? "right" : "left",
    priority: priority,
  });
  Object.defineProperty(item, "text", {
    get() {
      return this.__text === undefined ? "" : this.__text;
    },
    set(value) {
      this.__text = String(value);
      record("status.text", "answered", { id: id, text: this.__text });
    },
    enumerable: true,
  });
  Object.defineProperty(item, "tooltip", {
    get() {
      return this.__tooltip;
    },
    set(value) {
      this.__tooltip = value === undefined ? undefined : String(value);
      record("status.tooltip", "answered", {
        id: id,
        tooltip: value === undefined ? null : String(value),
      });
    },
    enumerable: true,
  });
  Object.defineProperty(item, "command", {
    get() {
      return this.__command;
    },
    set(value) {
      this.__command = value === undefined ? undefined : String(value);
      record("status.command", "answered", {
        id: id,
        command: value === undefined ? null : String(value),
      });
    },
    enumerable: true,
  });
  item.show = () => {
    item.visible = true;
    record("status.show", "answered", { id: id });
  };
  item.hide = () => {
    item.visible = false;
    record("status.hide", "answered", { id: id });
  };
  item.dispose = () => {
    item.disposed = true;
    released.dispose();
  };
  return item;
}

const commands = {
  registerCommand(id, handler) {
    if (registrations.has(id)) {
      record("command.register", "failed", { id: id }, "a handler is already registered for " + id);
      return handle("command", id);
    }
    registrations.set(id, handler);
    record("command.register", "answered", { id: id });
    const released = handle("command", id);
    const base = released.dispose;
    released.dispose = () => {
      if (released.__veridianDisposed) return;
      registrations.delete(id);
      base();
    };
    return released;
  },
  async executeCommand(id, ...args) {
    if (typeof id !== "string" || id === "") {
      record(
        "extension.invoke",
        "refused",
        { command: String(id), args: [] },
        "a command id is required",
      );
      throw new Error("a command id is required");
    }
    const registered = registrations.get(id);
    const shown = args.map((arg) =>
      typeof arg === "string" ? arg : JSON.stringify(arg === undefined ? null : arg),
    );
    record(
      "extension.invoke",
      registered ? "answered" : "absent",
      { command: id, args: shown },
      registered ? null : "no handler is registered for " + id,
    );
    if (!registered) throw new Error("command '" + id + "' not found");
    return await registered(...args);
  },
  getCommands() {
    return Array.from(registrations.keys());
  },
};

const window = {
  createStatusBarItem(alignment, priority) {
    statusCounter += 1;
    return statusItem("status#" + String(statusCounter), alignment, priority);
  },
  createOutputChannel(name) {
    const released = handle("output", name);
    const channel = {
      name: name,
      lines: [],
      shown: false,
      disposed: false,
      appendLine(line) {
        const shown = String(line);
        channel.lines.push(shown);
        record("output.append", "answered", { channel: name, line: shown });
      },
      append(line) {
        channel.appendLine(line);
      },
      replace(line) {
        channel.lines = [String(line)];
        record("output.append", "answered", { channel: name, line: String(line) });
      },
      clear() {
        channel.lines = [];
        record("output.clear", "answered", { channel: name });
      },
      show() {
        channel.shown = true;
        record("output.show", "answered", { channel: name });
      },
      hide() {
        channel.shown = false;
        record("output.hide", "answered", { channel: name });
      },
      dispose() {
        channel.disposed = true;
        released.dispose();
      },
    };
    outputChannels.set(name, channel);
    record("output.create", "answered", { channel: name });
    return channel;
  },
  showInformationMessage(message) {
    record("message.show", "answered", { level: "info", message: String(message) });
    return Promise.resolve(undefined);
  },
  showWarningMessage(message) {
    record("message.show", "answered", { level: "warning", message: String(message) });
    return Promise.resolve(undefined);
  },
  showErrorMessage(message) {
    record("message.show", "answered", { level: "error", message: String(message) });
    return Promise.resolve(undefined);
  },
  setStatusBarMessage() {
    return handle("api", "setStatusBarMessage");
  },
  activeTextEditor: undefined,
};

function configuration(section) {
  const full = (key) => (section ? section + "." + String(key) : String(key));
  return {
    get(key, fallback) {
      const name = key === undefined ? String(section) : full(key);
      const known = state.settings[name];
      if (known !== undefined) {
        record("setting.read", "answered", { key: name, value: known.value, source: known.source });
        return known.value === null ? fallback : known.value;
      }
      record("setting.read", "answered", {
        key: name,
        value: fallback === undefined || fallback === null ? null : String(fallback),
        source: "unset",
      });
      return fallback;
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(state.settings, full(key));
    },
    inspect(key) {
      const known = state.settings[full(key)];
      if (known === undefined) return undefined;
      return {
        key: full(key),
        defaultValue: known.source === "default" ? known.value : undefined,
        globalValue: known.source === "override" ? known.value : undefined,
      };
    },
    update(key, value) {
      const name = full(key);
      const shown =
        typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value);
      record("setting.write", "answered", { key: name, value: shown });
      return Promise.resolve();
    },
  };
}

function uriOf(path) {
  const text = String(path);
  return {
    scheme: "file",
    path: text,
    fsPath: text,
    toString: () => "file://" + text.split("\\\\").join("/"),
  };
}

const workspace = {
  getConfiguration: configuration,
  workspaceFolders: state.folders.map((folder, index) => ({
    uri: uriOf(folder),
    name: "workspace",
    index: index,
  })),
  // A subscription that fires nothing is honest here: this world holds no file watcher and no
  // configuration mutator, so the handle is real, disposable and never fires. Refusing it would break a
  // well-written extension at activation for no reason at all.
  onDidChangeConfiguration(listener) {
    return new EventEmitter().event(listener);
  },
  onDidSaveTextDocument(listener) {
    return new EventEmitter().event(listener);
  },
  onDidChangeTextDocument(listener) {
    return new EventEmitter().event(listener);
  },
  // Two APIs this world deliberately does not answer, each refused by name. An editor has open documents
  // and a file index; this world has a directory on disk and nothing watching it.
  openTextDocument() {
    refuse("workspace.openTextDocument");
    return undefined;
  },
  findFiles() {
    refuse("workspace.findFiles");
    return undefined;
  },
};

const api = {
  version: state.apiVersion,
  commands: commands,
  window: window,
  workspace: workspace,
  Uri: {
    file: uriOf,
    parse(text) {
      const full = String(text);
      const path = full.replace(/^file:\\/\\//, "");
      return {
        scheme: "file",
        path: path,
        fsPath: path,
        toString: () => full,
      };
    },
    joinPath(base, ...segments) {
      const head = base && base.fsPath ? base.fsPath : String(base);
      const joined = [head].concat(segments.map(String)).join("/").replace(/\\/{2,}/g, "/");
      return uriOf(joined);
    },
  },
  EventEmitter: EventEmitter,
  Disposable: {
    from() {
      const items = Array.prototype.slice.call(arguments);
      return {
        dispose() {
          for (const item of items) if (item && item.dispose) item.dispose();
        },
      };
    },
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = String(id);
    }
  },
};

// Anything this world does not implement is a *refusal on the record*, not a bare TypeError - and that
// has to hold at every level, not only the top one. A namespace left unguarded turns "this world has no
// showQuickPick" into a TypeError raised inside the extension, which lands in the log as the same
// sentence as a genuine bug in the extension: neither a criterion nor a reader could tell them apart.
function guard(target, prefix) {
  return new Proxy(target, {
    get(inner, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(inner, prop, receiver);
      // Three names the runtime asks about that an extension never does, so asking about them is not a
      // refusal. __esModule and then are the module loader's own questions; default is how a bare
      // "import vscode from vscode" reaches the same object.
      if (prop === "__esModule") return true;
      if (prop === "then") return undefined;
      if (prop === "default") return receiver;
      if (Object.prototype.hasOwnProperty.call(inner, prop)) {
        const value = Reflect.get(inner, prop, receiver);
        return typeof value === "function" ? value.bind(inner) : value;
      }
      refuse(prefix + "." + String(prop));
      return undefined;
    },
  });
}

// The namespaces are guarded as well, which is what makes the sentence above true rather than aspirational.
// The raw objects stay in scope because the world's own code reads them directly rather than through the
// API - the handler map exported at the bottom of this file is the live registration map.
api.commands = guard(api.commands, "commands");
api.window = guard(api.window, "window");
api.workspace = guard(api.workspace, "workspace");
api.Uri = guard(api.Uri, "Uri");

const refused = guard(api, "vscode");

module.exports = refused;
// Written out one by one rather than in a loop, because Node's static analysis of a CommonJS module
// finds these assignments and gives an ESM extension's "import * as vscode" the namespaces a real
// extension host would. A loop would leave every named import undefined.
module.exports.commands = api.commands;
module.exports.window = api.window;
module.exports.workspace = api.workspace;
module.exports.Uri = api.Uri;
module.exports.EventEmitter = api.EventEmitter;
module.exports.Disposable = api.Disposable;
module.exports.StatusBarAlignment = api.StatusBarAlignment;
module.exports.ConfigurationTarget = api.ConfigurationTarget;
module.exports.ExtensionMode = api.ExtensionMode;
module.exports.ThemeColor = api.ThemeColor;
module.exports.version = api.version;
module.exports.__veridian = { handlers: registrations, outputChannels: outputChannels };
`;

/**
 * The program this world runs to be a host.
 *
 * It is the world's own file and not the application's, because the host *is* the substitute. It hands
 * the generated module the world's state, loads the extension's real `main`, calls `activate`, optionally
 * invokes one command, and calls `deactivate`. The extension's code runs for real in between.
 *
 * A failed load or a failed activation is reported as `extension.activate / failed` with the message, and
 * the process exits non-zero - so a criterion reads *why* from the reading rather than inferring it from
 * an exit code, and a reader of the bundle holds the same sentence a developer would have seen.
 */
export const HOST_RUNNER_SOURCE = `import { createRequire } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const report = process.env.VERIDIAN_VSCODE_REPORT;
const bootstrap = JSON.parse(readFileSync(process.env.VERIDIAN_VSCODE_BOOTSTRAP, "utf8"));
const extensionDir = process.env.VERIDIAN_VSCODE_EXTENSION_DIR;
const task = process.env.VERIDIAN_VSCODE_TASK || "activate";
const event = process.env.VERIDIAN_VSCODE_EVENT || "*";

globalThis.__veridianVscode = { state: bootstrap, report: report, extensionDir: extensionDir };

let seq = 0;
function note(op, result, value, reason) {
  seq += 1;
  appendFileSync(
    report,
    JSON.stringify({
      seq: seq,
      op: op,
      result: result,
      value: value === undefined ? null : value,
      reason: reason || null,
    }) + "\\n",
  );
}

const require = createRequire(join(extensionDir, "package.json"));
const vscode = require("vscode");
const manifest = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const state = globalThis.__veridianVscode.state;

const mementoOf = (scope) => {
  const values = {};
  for (const key of Object.keys(state.state[scope] || {})) values[key] = state.state[scope][key];
  return {
    get(key, fallback) {
      const has = Object.prototype.hasOwnProperty.call(values, key);
      const value = has ? values[key] : fallback;
      note("state.read", "answered", {
        scope: scope,
        key: key,
        value: value === undefined || value === null ? null : String(value),
      });
      return value;
    },
    update(key, value) {
      if (value === undefined || value === null) delete values[key];
      else values[key] = value;
      note("state.update", "answered", {
        scope: scope,
        key: key,
        value: value === undefined || value === null ? null : String(value),
      });
      return Promise.resolve();
    },
    keys() {
      return Object.keys(values);
    },
  };
};

const subscriptions = [];
const context = {
  subscriptions: subscriptions,
  extensionPath: extensionDir,
  extensionUri: vscode.Uri.file(extensionDir),
  globalState: mementoOf("global"),
  workspaceState: mementoOf("workspace"),
  extensionMode: vscode.ExtensionMode.Production,
  storageUri: vscode.Uri.file(join(extensionDir, ".storage")),
  asAbsolutePath: (relative) => join(extensionDir, String(relative)),
};

const failureOf = (error) => String(error && error.message ? error.message : error);

try {
  const loaded =
    manifest.type === "module"
      ? await import(pathToFileURL(join(extensionDir, manifest.main)).href)
      : require(join(extensionDir, manifest.main));
  if (typeof loaded.activate !== "function") {
    note(
      "extension.activate",
      "failed",
      { event: event },
      "the module the manifest names exports no activate function",
    );
    process.exitCode = 1;
  } else {
    await loaded.activate(context);
    note("extension.activate", "answered", { event: event });

    if (task.indexOf("invoke:") === 0) {
      const rest = task.slice("invoke:".length);
      const separator = rest.indexOf("::");
      const id = separator === -1 ? rest : rest.slice(0, separator);
      const args = separator === -1 ? [] : JSON.parse(rest.slice(separator + 2));
      const shown = args.map((arg) => String(arg));
      if (!vscode.__veridian.handlers.has(id)) {
        note(
          "host.invoke",
          "absent",
          { command: id, args: shown },
          "no handler is registered for " + id,
        );
        process.exitCode = 1;
      } else {
        try {
          await vscode.commands.executeCommand(id, ...args);
          note("host.invoke", "answered", { command: id, args: shown });
        } catch (error) {
          note("host.invoke", "failed", { command: id, args: shown }, failureOf(error));
          process.exitCode = 1;
        }
      }
    }

    if (typeof loaded.deactivate === "function") {
      try {
        await loaded.deactivate();
        note("extension.deactivate", "answered", {});
      } catch (error) {
        note("extension.deactivate", "failed", {}, failureOf(error));
      }
    }
  }
} catch (error) {
  note("extension.activate", "failed", { event: event }, failureOf(error));
  process.exitCode = 1;
}

let held = 0;
for (const subscription of subscriptions) {
  if (!(subscription && subscription.__veridianDisposed)) held += 1;
}
note("host.done", "answered", { held: held });
process.exit(process.exitCode || 0);
`;

interface Outcome {
  readonly result: VSCodeResult;
  readonly status: number;
  readonly reason?: string | null;
  readonly resource?: string | null;
}

const answered = (resource: string | null = null): Outcome => ({
  result: "answered",
  status: 0,
  resource,
});
const absent = (reason: string, resource: string | null = null): Outcome => ({
  result: "absent",
  status: 1,
  reason,
  resource,
});
const refused = (reason: string, resource: string | null = null): Outcome => ({
  result: "refused",
  status: 1,
  reason,
  resource,
});
const failed = (reason: string, resource: string | null = null): Outcome => ({
  result: "failed",
  status: 1,
  reason,
  resource,
});

export interface VSCodeExecRequest {
  /** The command line, as the application or a criterion spelled it. It joins the record verbatim. */
  readonly argv: readonly string[];
  readonly client: VSCodeClient;
}

export interface VSCodePortOptions {
  /** Host path of the sandbox. The installed extension, the workspace folder and the host live here. */
  readonly root: string;
  /**
   * The directory the application's own process runs in, as this machine spells it.
   *
   * A host path named by a command - the manifest an `install` names - resolves against this, because
   * that is the directory a real client would have resolved it against. It is not the io root, and
   * conflating the two is the defect `core/assets.ts` exists to remove.
   */
  readonly contextRoot: string;
  /** The host identity the environment document declared. */
  readonly host: string;
  /** The API version this world answers as. The engine floor is judged against it. */
  readonly apiVersion: string;
  /** The activation event the document declared, or `null` for `"*"`. */
  readonly activationEvent: string | null;
  /** Configuration overrides the document declared, before any command sets another. */
  readonly settings: Readonly<Record<string, string>>;
  /** How the world starts a host. Real children, through the same runner the rest of Veridian uses. */
  readonly processes: ProcessRunner;
  /** How long one host run may take. */
  readonly timeoutMs?: number;
}

export interface VSCodePort {
  /** Build the sandbox: the workspace folder, the extension store and the generated host. */
  prepare(): Promise<void>;
  /**
   * Begin a new world.
   *
   * Any running host process is stopped, the sandbox is removed and rebuilt, and the installed
   * extension, its registrations, its output, its messages and its state are gone - because a reset
   * restores the world.
   *
   * The **call record survives**, for the reason the four worlds before this one record: `calls` is the
   * transcript of what the run asked for, and clearing it would destroy the evidence of a violation by
   * the act of repairing the world it happened in.
   */
  reset(): Promise<void>;
  /** Perform one command line. Always answers with the record it filed. */
  exec(request: VSCodeExecRequest): Promise<VSCodeCallRecord>;
  /** The reading. Pure: writes nothing, advances nothing, starts nothing. */
  read(): Promise<VSCodeObservationData>;
  /**
   * Every command this world refused because it named a place outside it, with who named it.
   *
   * Recorded by the one predicate that decides the question, so the adapter can report the application's
   * escapes as the safety events they are without holding a second copy of the boundary rule.
   */
  escapes(): readonly VSCodeEscape[];
  /** Stop a host process that is still running. Never removes the sandbox. */
  stop(): Promise<void>;
}

/** One command this world refused because it named a place outside it. */
export interface VSCodeEscape {
  readonly client: VSCodeClient;
  /** The argument as the command spelled it - the only spelling a reader can compare with the command. */
  readonly spelled: string;
}

/** One line the generated `vscode` module wrote down. */
interface ReportLine {
  readonly seq: number;
  readonly op: string;
  readonly result: string;
  readonly value: Record<string, unknown> | null;
  readonly reason: string | null;
}

interface ManifestRecord {
  readonly name: string;
  readonly publisher: string | null;
  readonly version: string;
  readonly displayName: string | null;
  readonly main: string;
}

interface StatusRecord {
  id: string;
  text: string;
  tooltip: string | null;
  command: string | null;
  visible: boolean;
  alignment: string;
}

interface SubscriptionRecord {
  kind: VSCodeSubscriptionKind;
  id: string;
  disposed: boolean;
}

interface HandlerInput {
  readonly flags: ReadonlyMap<string, string>;
  readonly rest: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const tail = (value: string, limit = 400): string => {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`;
};

/**
 * A version, as three numbers.
 *
 * `null` for anything that is not `x.y.z`, which is what lets the engine floor be *refused* rather than
 * guessed at: a range this world cannot read is a range it will not answer for.
 */
function parseVersion(spelled: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(spelled.trim());
  if (match === null) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return [Number(major), Number(minor), Number(patch)];
}

const compare = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => {
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
};

/**
 * Whether a host at `apiVersion` satisfies the range a manifest declared.
 *
 * The forms this world implements are the ones a manifest actually uses - `*`, a caret range, a `>=`
 * floor - plus an exact version. Anything else is refused with the range quoted, because a floor
 * silently treated as satisfied is the one wrong answer here that nobody can find later: the extension
 * would activate on an engine it never supported and every criterion would read `PASS`.
 */
function admits(
  range: string,
  apiVersion: readonly [number, number, number],
): { readonly ok: boolean; readonly reason: string | null } {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return { ok: true, reason: null };
  if (trimmed.startsWith("^")) {
    const floor = parseVersion(trimmed.slice(1));
    if (floor === null) {
      return { ok: false, reason: `\`${trimmed}\` is not a caret range this world can read` };
    }
    const ceiling: readonly [number, number, number] =
      floor[0] === 0 ? [0, floor[1] + 1, 0] : [floor[0] + 1, 0, 0];
    return { ok: compare(apiVersion, floor) >= 0 && compare(apiVersion, ceiling) < 0, reason: null };
  }
  if (trimmed.startsWith(">=")) {
    const floor = parseVersion(trimmed.slice(2));
    if (floor === null) {
      return { ok: false, reason: `\`${trimmed}\` is not a ">=" floor this world can read` };
    }
    return { ok: compare(apiVersion, floor) >= 0, reason: null };
  }
  const exact = parseVersion(trimmed);
  if (exact === null) {
    return {
      ok: false,
      reason:
        `\`${trimmed}\` is a range form this world does not implement; it reads "*", "^x.y.z", ` +
        '"\\>=x.y.z" and an exact x.y.z, and it will not report a floor as admitted when it could not ' +
        "evaluate it",
    };
  }
  return { ok: compare(apiVersion, exact) === 0, reason: null };
}

/**
 * Split a command line into the flags this register understands and everything else.
 *
 * `--event <value>` and `--<name>=<value>` are the two spellings, and a flag's *value* is never an
 * operand - the defect `sim-posix`'s `adduser` paid for, where "the words that do not start with `-`"
 * made `--home /var/lib/cart-web` create an account named `/var/lib/cart-web`.
 */
function splitFlags(argv: readonly string[]): {
  readonly flags: ReadonlyMap<string, string>;
  readonly rest: readonly string[];
} {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token.startsWith("--") && token.includes("=")) {
      const at = token.indexOf("=");
      flags.set(token.slice(2, at), token.slice(at + 1));
      continue;
    }
    if (token === "--event") {
      const value = argv[index + 1];
      if (value !== undefined) flags.set("event", value);
      index += 1;
      continue;
    }
    rest.push(token);
  }
  return { flags, rest };
}

const subscriptionKind = (value: string | null): VSCodeSubscriptionKind =>
  value === "command" || value === "status" || value === "output" ? value : "api";

export function vscodePort(options: VSCodePortOptions): VSCodePort {
  const { root, contextRoot, host, apiVersion, activationEvent, processes } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_TIMEOUT_MS;

  const extensionsRoot = join(root, EXTENSIONS_DIRNAME);
  const workspaceRoot = join(root, WORKSPACE_DIRNAME);
  const shimDir = join(root, "node_modules", "vscode");

  let manifest: ManifestRecord | null = null;
  let overrides = new Map<string, string>();
  let defaults = new Map<string, string>();
  let contributions: readonly VSCodeContributionReading[] = [];
  let engine: VSCodeEngineReading = {
    declared: null,
    apiVersion,
    result: "refused",
    reason: "no extension has been installed into this world",
  };
  const registrations = new Map<string, { registered: boolean; disposed: boolean }>();
  const invocations: VSCodeInvocationReading[] = [];
  const status = new Map<string, StatusRecord>();
  const output = new Map<string, { lines: string[]; shown: boolean }>();
  const messages: VSCodeMessageReading[] = [];
  const settingsRead = new Map<string, VSCodeSettingReading>();
  const state = new Map<VSCodeStateScope, Map<string, string | null>>();
  const subscriptions: SubscriptionRecord[] = [];
  const refusals: VSCodeRefusalReading[] = [];
  const calls: VSCodeCallRecord[] = [];
  const escapes: VSCodeEscape[] = [];
  let activation: VSCodeActivationReading = {
    event: activationEvent ?? "*",
    activated: false,
    error: null,
    runs: 0,
  };

  let currentClient: VSCodeClient = "criterion";
  let running: ProcessHandle | null = null;

  /** The declared defaults, the document's overrides and what the extension actually read, merged. */
  const settingsOf = (): readonly VSCodeSettingReading[] => {
    const keys = new Set<string>([...defaults.keys(), ...overrides.keys(), ...settingsRead.keys()]);
    return [...keys].sort().map((key) => {
      if (overrides.has(key)) {
        return { key, value: overrides.get(key) ?? null, source: "override" as VSCodeSettingSource };
      }
      if (defaults.has(key)) {
        return { key, value: defaults.get(key) ?? null, source: "default" as VSCodeSettingSource };
      }
      return settingsRead.get(key) ?? { key, value: null, source: "unset" as VSCodeSettingSource };
    });
  };

  /**
   * Resolve a host path named by a command.
   *
   * The containment rule is this world's boundary, and it is checked rather than assumed: a path must
   * resolve inside the application's own directory or inside the sandbox. A refusal is recorded here, in
   * the one place that decides it, so the adapter can report the application's escapes without holding a
   * second copy of the rule - two implementations of one rule disagree the first time a world arrives
   * that only one of them was written for.
   */
  const resolveHostPath = (
    spelled: string,
  ): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string } => {
    const absolute = isAbsolute(spelled) ? spelled : resolvePath(contextRoot, spelled);
    const inside = (base: string): boolean => {
      const resolved = resolvePath(base);
      const prefix = resolved.endsWith(sep) ? resolved : resolved + sep;
      return absolute === resolved || absolute.startsWith(prefix);
    };
    if (!inside(contextRoot) && !inside(root)) {
      escapes.push({ client: currentClient, spelled });
      return {
        ok: false,
        reason:
          `\`${spelled}\` resolves to ${absolute}, which is outside the application directory ` +
          `(${resolvePath(contextRoot)}) and outside this world's sandbox (${resolvePath(root)}). A ` +
          "host path in a command may name either of those and nothing else",
      };
    }
    return { ok: true, path: absolute };
  };

  const installedDirOf = (name: string): string => join(extensionsRoot, name);

  /**
   * Build the sandbox, and begin a new world.
   *
   * `prepare()` and `reset()` share this one implementation on purpose. `sim-posix` paid for two: its
   * `prepare()` made directories without clearing, so the *next* run's first iteration read a file the
   * previous run had left behind and two criteria reported `PASS` on someone else's artifact.
   */
  const rebuild = async (): Promise<void> => {
    await rm(root, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(extensionsRoot, { recursive: true });
    await mkdir(join(root, "host"), { recursive: true });
    await mkdir(shimDir, { recursive: true });
    await writeFile(join(root, HOST_RUNNER_RELPATH), HOST_RUNNER_SOURCE, "utf8");
    await writeFile(join(root, SHIM_RELPATH), VSCODE_SHIM_SOURCE, "utf8");
    await writeFile(
      join(root, SHIM_MANIFEST_RELPATH),
      `${JSON.stringify({ name: "vscode", version: apiVersion, main: "index.js" }, null, 2)}\n`,
      "utf8",
    );

    manifest = null;
    overrides = new Map<string, string>();
    for (const [key, value] of Object.entries(options.settings)) overrides.set(key, value);
    defaults = new Map<string, string>();
    contributions = [];
    engine = {
      declared: null,
      apiVersion,
      result: "refused",
      reason: "no extension has been installed into this world",
    };
    registrations.clear();
    invocations.length = 0;
    status.clear();
    output.clear();
    messages.length = 0;
    settingsRead.clear();
    state.clear();
    subscriptions.length = 0;
    refusals.length = 0;
    activation = { event: activationEvent ?? "*", activated: false, error: null, runs: 0 };
  };

  /** Fold one host run's report into this world's state. The only writer of most of the readings. */
  const fold = (lines: readonly ReportLine[]): void => {
    for (const line of lines) {
      const value = line.value ?? {};
      switch (line.op) {
        case "extension.activate": {
          activation = {
            event: text(value["event"]) ?? activation.event,
            activated: line.result === "answered",
            error: line.result === "answered" ? null : line.reason,
            runs: activation.runs,
          };
          break;
        }
        case "extension.invoke":
        case "host.invoke": {
          invocations.push({
            command: text(value["command"]) ?? "",
            client: line.op === "host.invoke" ? "criterion" : "extension",
            args: Array.isArray(value["args"]) ? value["args"].map((arg) => String(arg)) : [],
            result:
              line.result === "answered" ? "answered" : line.result === "absent" ? "absent" : "failed",
            reason: line.reason,
          });
          break;
        }
        case "command.register": {
          if (line.result !== "answered") break;
          const id = text(value["id"]) ?? "";
          registrations.set(id, { registered: true, disposed: false });
          break;
        }
        case "output.create": {
          const channel = text(value["channel"]) ?? "";
          if (!output.has(channel)) output.set(channel, { lines: [], shown: false });
          break;
        }
        case "output.append": {
          const channel = text(value["channel"]) ?? "";
          const entry = output.get(channel) ?? { lines: [], shown: false };
          entry.lines.push(text(value["line"]) ?? "");
          output.set(channel, entry);
          break;
        }
        case "output.show": {
          const channel = text(value["channel"]) ?? "";
          const entry = output.get(channel) ?? { lines: [], shown: false };
          entry.shown = true;
          output.set(channel, entry);
          break;
        }
        case "output.hide": {
          const entry = output.get(text(value["channel"]) ?? "");
          if (entry !== undefined) entry.shown = false;
          break;
        }
        case "output.clear": {
          const channel = text(value["channel"]) ?? "";
          const entry = output.get(channel) ?? { lines: [], shown: false };
          entry.lines = [];
          output.set(channel, entry);
          break;
        }
        case "status.create": {
          const id = text(value["id"]) ?? "";
          if (!status.has(id)) {
            status.set(id, {
              id,
              text: "",
              tooltip: null,
              command: null,
              visible: false,
              alignment: text(value["alignment"]) ?? "left",
            });
          }
          break;
        }
        case "status.text":
        case "status.tooltip":
        case "status.command":
        case "status.show":
        case "status.hide": {
          const entry = status.get(text(value["id"]) ?? "");
          if (entry === undefined) break;
          if (line.op === "status.text") entry.text = text(value["text"]) ?? "";
          if (line.op === "status.tooltip") entry.tooltip = text(value["tooltip"]);
          if (line.op === "status.command") entry.command = text(value["command"]);
          if (line.op === "status.show") entry.visible = true;
          if (line.op === "status.hide") entry.visible = false;
          break;
        }
        case "message.show": {
          messages.push({
            level: (text(value["level"]) ?? "info") as VSCodeMessageLevel,
            message: text(value["message"]) ?? "",
          });
          break;
        }
        case "setting.read": {
          const key = text(value["key"]) ?? "";
          settingsRead.set(key, {
            key,
            value: text(value["value"]),
            source: (text(value["source"]) ?? "unset") as VSCodeSettingSource,
          });
          break;
        }
        case "setting.write": {
          const key = text(value["key"]) ?? "";
          const written = text(value["value"]);
          if (written === null) overrides.delete(key);
          else overrides.set(key, written);
          break;
        }
        case "state.read":
        case "state.update": {
          const scope = (text(value["scope"]) ?? "global") as VSCodeStateScope;
          const key = text(value["key"]) ?? "";
          const stored = text(value["value"]);
          const store = state.get(scope) ?? new Map<string, string | null>();
          if (line.op === "state.update") {
            if (stored === null) store.delete(key);
            else store.set(key, stored);
            state.set(scope, store);
          } else if (!store.has(key)) {
            store.set(key, stored);
            state.set(scope, store);
          }
          break;
        }
        case "subscription.add": {
          if (line.result !== "answered") break;
          subscriptions.push({
            kind: subscriptionKind(text(value["kind"])),
            id: text(value["id"]) ?? "",
            disposed: false,
          });
          break;
        }
        case "subscription.dispose": {
          const id = text(value["id"]) ?? "";
          const kind = subscriptionKind(text(value["kind"]));
          for (const entry of subscriptions) {
            if (entry.id === id && entry.kind === kind) entry.disposed = true;
          }
          // A command handle's disposal *deletes the registration*, and the world only learns that from
          // this line. Without this the command reading's `disposed` flag could never be true, which
          // would make a field a reader sees in every failure report a value that is false by
          // construction - the shape this repository has already paid for twice.
          if (kind === "command") {
            const held = registrations.get(id);
            if (held !== undefined) registrations.set(id, { registered: held.registered, disposed: true });
          }
          break;
        }
        case "api.refuse": {
          refusals.push({
            api: text(value["api"]) ?? "vscode",
            client: "extension",
            reason: line.reason ?? "this host does not implement it",
          });
          break;
        }
        case "extension.deactivate":
        case "host.done": {
          break;
        }
        default: {
          // An operation this world does not fold is *not* silently dropped: it is recorded as a refusal,
          // which is the field that says this world was asked for something it does not hold. The reason
          // names only what the world observed - that it does not fold the operation.
          refusals.push({
            api: `report.${line.op}`,
            client: "extension",
            reason: `the generated host reported \`${line.op}\`, which this world does not fold`,
          });
          break;
        }
      }
    }
  };

  /**
   * Run one host process and fold what it wrote down.
   *
   * The bootstrap is a file rather than an environment variable because the state an extension is handed
   * is unbounded in principle and an environment block is not; the report is a file for the same reason,
   * and because a synchronous append is what lets the generated module answer the extension's synchronous
   * API without a promise in the middle of it.
   */
  const runHost = async (task: string, event: string): Promise<void> => {
    if (manifest === null) throw new Error("no extension has been installed into this world");
    const installed = manifest;
    const runNumber = activation.runs + 1;
    const reportPath = join(root, "host", `run-${String(runNumber)}.jsonl`);
    await writeFile(reportPath, "", "utf8");

    const extensionDir = installedDirOf(installed.name);
    const bootstrap = {
      apiVersion,
      host,
      settings: Object.fromEntries(
        settingsOf().map((setting) => [
          setting.key,
          { value: setting.value, source: setting.source },
        ]),
      ),
      folders: [workspaceRoot],
      state: {
        global: Object.fromEntries(state.get("global") ?? []),
        workspace: Object.fromEntries(state.get("workspace") ?? []),
      },
    };
    await writeFile(join(root, "bootstrap.json"), `${JSON.stringify(bootstrap, null, 2)}\n`, "utf8");

    activation = { event, activated: false, error: null, runs: runNumber };

    const request: ProcessRequest = {
      command: process.execPath,
      args: [join(root, HOST_RUNNER_RELPATH)],
      cwd: extensionDir,
      env: {
        VERIDIAN_VSCODE_REPORT: reportPath,
        VERIDIAN_VSCODE_BOOTSTRAP: join(root, "bootstrap.json"),
        VERIDIAN_VSCODE_EXTENSION_DIR: extensionDir,
        VERIDIAN_VSCODE_TASK: task,
        VERIDIAN_VSCODE_EVENT: event,
        VERIDIAN_VSCODE_ROOT: root,
      },
    };

    // The handle is kept for exactly as long as the child lives: a host process that outlived the
    // observation that started it would still hold a sandbox this world is about to rebuild, and
    // `stop()` is the only thing that can end it. The deadline itself is `core/process`'s, not a second
    // copy of it here.
    const handle = processes.run(request);
    running = handle;
    let code: number | null = null;
    let timedOut = false;
    let streams = "";
    try {
      const result = await withDeadline(handle, timeoutMs);
      code = result.code;
      timedOut = result.timedOut;
      streams = `${result.stdout}\n${result.stderr}`;
    } finally {
      running = null;
    }

    let raw = "";
    try {
      raw = await readFile(reportPath, "utf8");
    } catch {
      raw = "";
    }
    const lines: ReportLine[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      lines.push({
        seq: typeof parsed["seq"] === "number" ? parsed["seq"] : lines.length + 1,
        op: text(parsed["op"]) ?? "unknown",
        result: text(parsed["result"]) ?? "failed",
        value: isRecord(parsed["value"]) ? parsed["value"] : null,
        reason: text(parsed["reason"]),
      });
    }
    fold(lines);

    if (lines.length === 0) {
      const detail = tail(streams);
      activation = {
        event,
        activated: false,
        error:
          `the host process wrote no report: it exited with code ${String(code)}` +
          `${timedOut ? ` after ${String(timeoutMs)} ms` : ""}${detail === "" ? "" : ` - ${detail}`}`,
        runs: runNumber,
      };
      return;
    }
    if (!activation.activated && activation.error === null) {
      activation = {
        event,
        activated: false,
        error:
          `the host process reported ${String(lines.length)} operations and none of them was an ` +
          "activation, so this world has nothing to read about whether the extension started",
        runs: runNumber,
      };
    }
  };

  const HANDLERS: Record<VSCodeAction, (input: HandlerInput) => Promise<Outcome>> = {
    install: async (input) => {
      const spelled = input.rest[0] ?? "package.json";
      const resolved = resolveHostPath(spelled);
      if (!resolved.ok) return refused(resolved.reason, spelled);

      let raw: string;
      try {
        raw = await readFile(resolved.path, "utf8");
      } catch (error) {
        return absent(
          `there is no readable manifest at ${resolved.path}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          spelled,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return failed(
          `${resolved.path} is not JSON, so this world cannot read the extension it declares: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          spelled,
        );
      }
      if (!isRecord(parsed)) return failed(`${resolved.path} is not a JSON object`, spelled);

      const name = text(parsed["name"]);
      const version = text(parsed["version"]);
      const main = text(parsed["main"]);
      // Three named refusals rather than one "the manifest is invalid", because each names the one field
      // that is missing and each sends the reader to a different line of their own file. The guard is
      // written as the disjunction rather than as a computed `problem`, so the three values are narrowed
      // for every statement after it.
      if (name === null || version === null || main === null) {
        const problem =
          name === null
            ? "the manifest declares no `name`, which is what a host installs an extension under"
            : version === null
              ? "the manifest declares no `version`"
              : "the manifest declares no `main`, so this host has no entry point to load";
        return failed(`${resolved.path} is not a manifest this world can install: ${problem}`, name);
      }

      const manifestDir = resolvePath(resolved.path, "..");
      const entry = isAbsolute(main) ? main : resolvePath(manifestDir, main);
      const prefix = manifestDir.endsWith(sep) ? manifestDir : manifestDir + sep;
      if (entry !== manifestDir && !entry.startsWith(prefix)) {
        return failed(
          `the manifest's \`main\` is \`${main}\`, which resolves to ${entry} - outside the directory ` +
            `the manifest itself sits in (${manifestDir}), so this world will not load it`,
          name,
        );
      }
      try {
        await stat(entry);
      } catch {
        return failed(
          `the manifest names \`${main}\` as its entry point and there is no file at ${entry}, so this ` +
            "host has nothing to load",
          name,
        );
      }

      const api = parseVersion(apiVersion);
      if (api === null) {
        return failed(
          `this world answers as API version \`${apiVersion}\`, which is not a version this world can ` +
            "compare an engine floor against",
          name,
        );
      }
      const range = isRecord(parsed["engines"]) ? text(parsed["engines"]["vscode"]) : null;
      const verdict = range === null ? { ok: true, reason: null } : admits(range, api);
      engine = {
        declared: range,
        apiVersion,
        result: verdict.ok ? "admitted" : "refused",
        reason: verdict.reason,
      };
      if (!verdict.ok) {
        return failed(
          `the manifest requires \`engines.vscode: ${range}\` and this host answers as ${apiVersion}` +
            `${verdict.reason === null ? "" : ` - ${verdict.reason}`}`,
          name,
        );
      }

      const destination = installedDirOf(name);
      await rm(destination, { recursive: true, force: true });
      if (manifestDir !== resolvePath(destination)) {
        await cp(manifestDir, destination, { recursive: true });
      }

      manifest = {
        name,
        publisher: text(parsed["publisher"]),
        version,
        displayName: text(parsed["displayName"]),
        main,
      };

      const declared: VSCodeContributionReading[] = [];
      const contributes = isRecord(parsed["contributes"]) ? parsed["contributes"] : {};
      const commandEntries = Array.isArray(contributes["commands"]) ? contributes["commands"] : [];
      for (const item of commandEntries) {
        if (!isRecord(item)) continue;
        const command = text(item["command"]);
        if (command === null) continue;
        declared.push({ point: "commands", id: command, title: text(item["title"]) });
      }
      const activationEvents = Array.isArray(contributes["activationEvents"])
        ? contributes["activationEvents"]
        : [];
      for (const item of activationEvents) {
        if (typeof item !== "string") continue;
        declared.push({ point: "activationEvents", id: item, title: null });
      }
      const configuration = isRecord(contributes["configuration"])
        ? contributes["configuration"]
        : {};
      const properties = isRecord(configuration["properties"]) ? configuration["properties"] : {};
      const declaredDefaults = new Map<string, string>();
      for (const key of Object.keys(properties)) {
        const property = properties[key];
        declared.push({
          point: "configuration",
          id: key,
          title: isRecord(property) ? text(property["title"]) : null,
        });
        const fallback = isRecord(property) ? property["default"] : undefined;
        if (fallback !== undefined && fallback !== null) declaredDefaults.set(key, String(fallback));
      }
      defaults = declaredDefaults;
      contributions = declared;

      // An install re-establishes the world: a registration from a previous install describes code that
      // has been replaced, and keeping it would let a criterion read a command the new copy never made.
      // Durable state is deliberately *kept*, because `globalState` outliving a reinstall is what the
      // real store does, and an extension caching across versions is a real behaviour worth observing.
      registrations.clear();
      invocations.length = 0;
      status.clear();
      output.clear();
      messages.length = 0;
      settingsRead.clear();
      subscriptions.length = 0;
      refusals.length = 0;
      activation = { event: activationEvent ?? "*", activated: false, error: null, runs: 0 };
      return answered(name);
    },

    activate: async (input) => {
      if (manifest === null) {
        return absent("no extension has been installed into this world; run `install` first", null);
      }
      const event = input.flags.get("event") ?? activationEvent ?? "*";
      await runHost("activate", event);
      return activation.activated
        ? answered(manifest.name)
        : failed(
            `the extension did not activate: ${activation.error ?? "no reason was reported"}`,
            manifest.name,
          );
    },

    invoke: async (input) => {
      if (manifest === null) {
        return absent("no extension has been installed into this world; run `install` first", null);
      }
      const command = input.rest[0];
      if (command === undefined) {
        return refused("`invoke` needs a command id, and this one names none", null);
      }
      const known =
        registrations.get(command)?.registered === true ||
        contributions.some((entry) => entry.point === "commands" && entry.id === command);
      if (!known) {
        invocations.push({
          command,
          client: currentClient,
          args: input.rest.slice(1),
          result: "absent",
          reason: "this world holds no command with that id, neither registered nor declared",
        });
        return absent(
          `\`${command}\` is neither registered by the extension nor declared in its manifest, so this ` +
            "world has nothing to invoke",
          command,
        );
      }
      const args = input.rest.slice(1);
      await runHost(
        args.length === 0 ? `invoke:${command}` : `invoke:${command}::${JSON.stringify(args)}`,
        activationEvent ?? "*",
      );
      const last = invocations[invocations.length - 1];
      if (last === undefined || last.client !== "criterion") {
        return failed(
          `the host ran and reported no invocation of \`${command}\`, so this world cannot say what it ` +
            "did",
          command,
        );
      }
      return last.result === "answered"
        ? answered(command)
        : failed(last.reason ?? `\`${command}\` did not answer`, command);
    },

    configure: async (input) => {
      const key = input.rest[0];
      const value = input.rest[1];
      if (key === undefined || value === undefined) {
        return refused(
          "`configure` needs a key and a value, and this one names fewer than two",
          key ?? null,
        );
      }
      overrides.set(key, value);
      return answered(key);
    },

    unconfigure: async (input) => {
      const key = input.rest[0];
      if (key === undefined) return refused("`unconfigure` needs a key, and this one names none", null);
      if (!overrides.has(key)) {
        return absent(`\`${key}\` has no override in this world, so there is nothing to remove`, key);
      }
      overrides.delete(key);
      return answered(key);
    },

    reveal: async (input) => {
      const channel = input.rest[0];
      if (channel === undefined) {
        return refused("`reveal` needs an output channel name, and this one names none", null);
      }
      const entry = output.get(channel);
      if (entry === undefined) {
        return absent(
          `this world holds no output channel named \`${channel}\`; an extension creates its channels ` +
            "when it activates",
          channel,
        );
      }
      entry.shown = true;
      return answered(channel);
    },

    /**
     * Restart the host: every handle the extension was given is released before the next run.
     *
     * The distinction from `activate` is real rather than decorative. A reload re-establishes the API
     * surface, so a command only the previous run registered is gone; output, messages, invocations and
     * durable state are *not* cleared, because those are the transcript of what an extension said and a
     * reload does not unsay it.
     */
    reload: async (input) => {
      if (manifest === null) {
        return absent("no extension has been installed into this world; run `install` first", null);
      }
      registrations.clear();
      status.clear();
      subscriptions.length = 0;
      const event = input.flags.get("event") ?? activationEvent ?? "*";
      await runHost("activate", event);
      return activation.activated
        ? answered(manifest.name)
        : failed(
            `the extension did not activate: ${activation.error ?? "no reason was reported"}`,
            manifest.name,
          );
    },
  };

  return {
    async prepare(): Promise<void> {
      await rebuild();
    },

    async reset(): Promise<void> {
      await rebuild();
    },

    async exec(request: VSCodeExecRequest): Promise<VSCodeCallRecord> {
      const argv = request.argv;
      const word = (argv[0] ?? "").toLowerCase();
      const action = isVSCodeAction(word) ? word : null;
      const command = argv.join(" ");
      const subject = argv[1] ?? null;

      let outcome: Outcome;
      const previousClient = currentClient;
      currentClient = request.client;
      try {
        if (action === null) {
          outcome = refused(
            `\`${command}\` normalises to no action this world's register holds. It answers install, ` +
              "activate, invoke, configure, unconfigure, reveal, reload",
            subject,
          );
        } else {
          outcome = await HANDLERS[action](splitFlags(argv.slice(1)));
        }
      } catch (error) {
        outcome = failed(
          `this world threw while performing \`${action ?? word}\`: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          subject,
        );
      } finally {
        currentClient = previousClient;
      }

      const record: VSCodeCallRecord = {
        action,
        client: request.client,
        command,
        resource: outcome.resource ?? null,
        result: outcome.result,
        status: outcome.status,
        reason: outcome.reason ?? null,
      };
      calls.push(record);
      return record;
    },

    async read(): Promise<VSCodeObservationData> {
      const files: VSCodeFileReading[] = [];
      const walk = async (directory: string, prefix: string): Promise<void> => {
        let entries: readonly { name: string; isDirectory(): boolean; isFile(): boolean }[];
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        const ordered = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of ordered) {
          const child = join(directory, entry.name);
          const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            await walk(child, path);
            continue;
          }
          if (!entry.isFile()) continue;
          try {
            files.push({ path, bytes: (await stat(child)).size, readable: true });
          } catch {
            files.push({ path, bytes: 0, readable: false });
          }
        }
      };
      await walk(workspaceRoot, "");

      const declaredCommands = new Set(
        contributions.filter((entry) => entry.point === "commands").map((entry) => entry.id),
      );
      const commandIds = new Set<string>([...declaredCommands, ...registrations.keys()]);
      const commands: VSCodeCommandReading[] = [...commandIds].sort().map((id) => ({
        id,
        registered: registrations.get(id)?.registered === true,
        title:
          contributions.find((entry) => entry.point === "commands" && entry.id === id)?.title ?? null,
        declared: declaredCommands.has(id),
        disposed: registrations.get(id)?.disposed === true,
      }));

      const extension: VSCodeIdentityReading = {
        name: manifest?.name ?? "",
        publisher: manifest?.publisher ?? null,
        version: manifest?.version ?? "",
        displayName: manifest?.displayName ?? null,
        main: manifest?.main ?? "",
      };

      const subscriptions_: VSCodeSubscriptionReading[] = subscriptions.map((entry) => ({
        kind: entry.kind,
        id: entry.id,
        disposed: entry.disposed,
      }));

      const state_: VSCodeStateReading[] = [];
      for (const scope of ["global", "workspace"] as const) {
        const store = state.get(scope);
        if (store === undefined) continue;
        for (const key of [...store.keys()].sort()) {
          state_.push({ scope, key, value: store.get(key) ?? null });
        }
      }

      const statusItems: VSCodeStatusReading[] = [...status.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((entry) => ({
          id: entry.id,
          text: entry.text,
          tooltip: entry.tooltip,
          command: entry.command,
          visible: entry.visible,
          alignment: entry.alignment,
        }));

      return {
        host,
        apiVersion,
        sandbox: resolvePath(root),
        extension,
        engine,
        activation,
        simulated: VSCODE_SIMULATED_SURFACES,
        contributions,
        commands,
        invocations: [...invocations],
        settings: settingsOf(),
        status: statusItems,
        output: [...output.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([channel, entry]) => ({ channel, lines: [...entry.lines], shown: entry.shown })),
        messages: [...messages],
        state: state_,
        subscriptions: subscriptions_,
        files,
        refusals: [...refusals],
        calls: [...calls],
      };
    },

    escapes(): readonly VSCodeEscape[] {
      return [...escapes];
    },

    async stop(): Promise<void> {
      const handle = running;
      if (handle === null) return;
      await handle.stop();
      running = null;
    },
  };
}
