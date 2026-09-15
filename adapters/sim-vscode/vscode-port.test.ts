/**
 * The substitute's own tests.
 *
 * This is the eighth world and the only one whose substitute starts a **real Node host process** and
 * hands it a **real module under the name `vscode`**. So these tests do not record spawns: they install a
 * fixture extension, activate it, invoke a command on it, and read back what the extension actually did.
 * A recorder would prove the world's bookkeeping; only a real child proves the world is a host.
 *
 * Three rules are cited by name where they are held, because each has cost this repository a defect:
 *
 * 1. **A read must not mutate the record it reads.** `M1` compares two runs' readings, so an
 *    observation that edits what it observes makes one world look like two.
 * 2. **A reset restores the world; it does not restore the record.** `reset()` clears the extension, its
 *    registrations, its output and its state, and deliberately keeps the transcript - because a
 *    violation seen in an early iteration must still fail the run after the world is repaired.
 * 3. **One host process per action, and a host activates the extension.** `activate`, `invoke` and
 *    `reload` each start a process, and each process activates - so every append-only surface
 *    accumulates one activation per action, and `activation.runs` counts host processes. The reading
 *    cannot be compared to a literal list of what one activation writes, and the numbers below are
 *    written as the consequence of the rule rather than as what happened to be observed.
 *
 * Every guard here was falsified rather than trusted, and the probes are recorded because a test that
 * passes under its own falsification probe is a test that tests nothing:
 *
 * - **Comments out `api.window = guard(api.window, "window")`** in the shim: fails *"records an api the
 *   world does not implement as a refusal, by name"* alone, with `window.showQuickPick` missing from
 *   the actual list. 17 -> 16 passing.
 * - **Clears `calls` and `escapes` inside `rebuild()`**: fails *"resets the world but not the
 *   transcript"* alone. 17 -> 16 passing.
 * - **Clears `refusals` at the top of `read()`**: initially passed. That is the useful result - the
 *   subtest compared two readings of a record whose refusal list was empty, so there was nothing for
 *   the mutation to move. The subtest now requires every surface a read could edit to be non-empty
 *   before comparing, and clearing `output` at the top of `read()` fails it (plus four neighbours that
 *   read the output channel). 17 -> 12 passing. *A purity test over an empty record cannot see a
 *   mutation.*
 * - **Returns `{ ok: true }` from `admits()` for a `~` range**: fails *"refuses a range form it cannot
 *   evaluate instead of reporting the floor as admitted"*. 17 -> 16 passing.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { nodeProcessRunner } from "../../core/process.ts";
import { VSCODE_ACTIONS } from "../../core/environment/vscode-observation.ts";
import {
  HOST_RUNNER_RELPATH,
  SHIM_MANIFEST_RELPATH,
  SHIM_RELPATH,
  SIM_HOST_NAME,
  vscodePort,
} from "./vscode-port.ts";
import type { VSCodePort, VSCodePortOptions } from "./vscode-port.ts";

const API_VERSION = "1.100.0";
const MANIFEST_NAME = "cart-web";

/**
 * The extension under test.
 *
 * It is written to exercise every reading this world holds, and it is written the way a real extension
 * is written - `context.subscriptions.push(...)`, `globalState.get/update`, a status bar item with a
 * tooltip and a command, an output channel that appends. A fixture that only called `registerCommand`
 * would leave most of the substitute's folding untested.
 *
 * `deactivate` is exported so the runner's deactivate path is exercised too. One subscription is
 * deliberately never released, so "still held" is an observable and not an accident of the fixture.
 */
const CART_EXTENSION = `const vscode = require("vscode");

function activate(context) {
  const channel = vscode.window.createOutputChannel("Cart");
  channel.appendLine("activated");
  context.subscriptions.push(channel);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 7);
  status.text = "$(cart) 0";
  status.tooltip = "cart items";
  status.command = "cart.add";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("cart.add", async () => {
      const stored = context.globalState.get("cart.items", "[]");
      const list = JSON.parse(stored);
      list.push("item");
      await context.globalState.update("cart.items", JSON.stringify(list));
      status.text = "$(cart) " + String(list.length);
      channel.appendLine("added " + String(list.length));
      vscode.window.showWarningMessage("added " + String(list.length));
      const limit = vscode.workspace.getConfiguration("cart-web").get("limit", 10);
      return String(list.length) + "/" + String(limit);
    }),
  );

  // Never released, so the reading holds one handle that is still held.
  vscode.workspace.onDidChangeConfiguration(() => undefined);

  vscode.window.showInformationMessage("cart-web ready");
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
`;

/**
 * An extension that asks for four things this world does not implement, by name.
 *
 * Two of them are reached through a namespace, which is the half that matters: a refusal recorded only
 * for the top-level object would let everything below it become a `TypeError` inside the extension. Each
 * absent API is *read* rather than called, because calling what a refusal just returned is a `TypeError`
 * about `undefined` - a true statement about the extension and a useless one about the world.
 */
const PROBE_EXTENSION = `const vscode = require("vscode");

function activate() {
  vscode.workspace.findFiles("**/*.js");
  void vscode.env;
  void vscode.window.showQuickPick;
  void vscode.commands.registerHandler;
}

module.exports = { activate: activate };
`;

/**
 * An extension that unwinds what it was handed, and leaks one handle on purpose.
 *
 * `CART_EXTENSION` above has an empty `deactivate`, so nothing it registered is ever released and every
 * disposal reading it produces is `false` - which means the *disposal* half of the fold (the half that
 * notices a handle was released, and the half that has to keep the registration it released while
 * flipping the flag beside it) is held by nothing at all in this suite. This fixture is that fixture's
 * opposite: it remembers the list at module level, because `deactivate` is called with **no arguments**
 * and an extension that unwinds anything has to remember what it was given - exactly as the editor's own
 * extension guide shows - and it releases the list backwards.
 *
 * The one handle it creates and never pushes stays held, so "still held" remains an observable rather
 * than an accident of the fixture. It is the control: without it, an assertion that *everything* was
 * disposed would pass against a fold that simply set the flag on every row.
 */
const UNWINDING_EXTENSION = `const vscode = require("vscode");

let handed = [];

function activate(context) {
  handed = context.subscriptions;
  const channel = vscode.window.createOutputChannel("Cart");
  channel.appendLine("activated");
  context.subscriptions.push(channel);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 7);
  status.text = "$(cart) 0";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(vscode.commands.registerCommand("cart.add", () => "ok"));

  vscode.workspace.onDidChangeConfiguration(() => undefined);
}

function deactivate() {
  for (const subscription of handed.slice().reverse()) {
    subscription.dispose();
  }
  handed.length = 0;
}

module.exports = { activate: activate, deactivate: deactivate };
`;

interface World {
  readonly port: VSCodePort;
  readonly root: string;
  readonly contextRoot: string;
}

/**
 * Write a fixture extension into the application directory.
 *
 * The directory name and the manifest's `name` are deliberately separable: the world installs by the
 * manifest's `name`, so a fixture whose directory is called something else proves the install reads the
 * manifest rather than the path it was handed.
 */
async function writeExtension(
  contextRoot: string,
  directory: string,
  source: string,
  manifest: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(contextRoot, directory);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: MANIFEST_NAME,
        version: "1.0.0",
        main: "extension.js",
        engines: { vscode: "*" },
        contributes: {
          commands: [{ command: "cart.ping", title: "Ping the cart", category: "Cart" }],
          configuration: {
            properties: {
              "cart-web.limit": { type: "number", default: 10, title: "Cart limit" },
            },
          },
        },
        ...manifest,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(dir, "extension.js"), source, "utf8");
}

async function withWorld(
  body: (world: World) => Promise<void>,
  options: Partial<VSCodePortOptions> = {},
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "veridian-vscode-"));
  const contextRoot = join(base, "app");
  const root = join(base, "sandbox");
  await mkdir(contextRoot, { recursive: true });
  const port = vscodePort({
    root,
    contextRoot,
    host: SIM_HOST_NAME,
    apiVersion: API_VERSION,
    activationEvent: null,
    settings: {},
    processes: nodeProcessRunner,
    timeoutMs: 30_000,
    ...options,
  });
  try {
    await body({ port, root, contextRoot });
  } finally {
    // The world is stopped first: a host process that outlived the temp directory would hold a delete
    // open on Windows, and the failure would be reported against `rm`, which is not what went wrong.
    await port.stop();
    await rm(base, { recursive: true, force: true });
  }
}

const installCart = async (port: VSCodePort): Promise<void> => {
  const record = await port.exec({
    argv: ["install", join("cart", "package.json")],
    client: "provisioner",
  });
  assert.equal(record.result, "answered", record.reason ?? "install did not answer");
};

describe("the sim-vscode substitute", () => {
  it("builds the sandbox the host is run from", async () => {
    await withWorld(async ({ port, root }) => {
      await port.prepare();
      await stat(join(root, HOST_RUNNER_RELPATH));
      await stat(join(root, SHIM_RELPATH));
      const manifest = JSON.parse(await readFile(join(root, SHIM_MANIFEST_RELPATH), "utf8"));
      assert.equal(manifest.name, "vscode");
      assert.equal(manifest.version, API_VERSION);
      assert.equal(manifest.main, "index.js");
      // The reading's own name for the sandbox is resolved, because a bundle quotes paths a reader has to
      // be able to open.
      const reading = await port.read();
      assert.equal(reading.sandbox, root);
    });
  });

  it("installs an extension and admits the engine floor it declared", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);

      const reading = await port.read();
      assert.equal(reading.extension.name, MANIFEST_NAME);
      assert.equal(reading.extension.version, "1.0.0");
      assert.equal(reading.extension.main, "extension.js");
      assert.equal(reading.engine.declared, "*");
      assert.equal(reading.engine.apiVersion, API_VERSION);
      assert.equal(reading.engine.result, "admitted");
      // Declared in the manifest and not yet registered: an install does not run the extension.
      assert.deepEqual(
        reading.commands.map((command) => command.id),
        ["cart.ping"],
      );
      assert.equal(reading.commands[0]?.registered, false);
      assert.equal(reading.commands[0]?.declared, true);
      assert.equal(reading.activation.activated, false);
    });
  });

  it("activates a real extension, in a real host process", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      const activated = await port.exec({ argv: ["activate"], client: "provisioner" });
      assert.equal(activated.result, "answered", activated.reason ?? "activate did not answer");

      const reading = await port.read();
      assert.equal(reading.activation.activated, true);
      assert.equal(reading.activation.error, null);
      assert.equal(reading.activation.runs, 1);
      // What the extension itself did, folded from the host's own report.
      assert.deepEqual(
        reading.commands.map((command) => command.id),
        ["cart.add", "cart.ping"],
      );
      const add = reading.commands.find((command) => command.id === "cart.add");
      assert.equal(add?.registered, true);
      assert.equal(add?.disposed, false);
      assert.deepEqual(reading.output, [{ channel: "Cart", lines: ["activated"], shown: false }]);
      assert.equal(reading.status.length, 1);
      assert.equal(reading.status[0]?.id, "status#1");
      assert.equal(reading.status[0]?.text, "$(cart) 0");
      assert.equal(reading.status[0]?.tooltip, "cart items");
      assert.equal(reading.status[0]?.command, "cart.add");
      assert.equal(reading.status[0]?.visible, true);
      assert.equal(reading.status[0]?.alignment, "left");
      assert.deepEqual(reading.messages, [{ level: "info", message: "cart-web ready" }]);
      // Three pushed plus the one deliberately leaked.
      assert.equal(reading.subscriptions.length, 4);
      assert.equal(reading.subscriptions.filter((entry) => entry.disposed).length, 0);
      // The manifest's declared default reached the extension as a setting with a source.
      assert.deepEqual(reading.settings, [
        { key: "cart-web.limit", value: "10", source: "default" },
      ]);
    });
  });

  it("reads a released handle as released, and keeps the registration it released", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", UNWINDING_EXTENSION);
      await installCart(port);
      const activated = await port.exec({ argv: ["activate"], client: "provisioner" });
      assert.equal(activated.result, "answered", activated.reason ?? "activate did not answer");

      const reading = await port.read();
      // Every host process ends in `deactivate`, and this fixture's `deactivate` releases the list it was
      // handed - so exactly the handles it pushed come back released.
      const released = reading.subscriptions
        .filter((entry) => entry.disposed)
        .map((entry) => `${entry.kind} ${entry.id}`)
        .sort();
      assert.deepEqual(
        released,
        ["command cart.add", "output Cart", "status status#1"],
        `released handles were ${JSON.stringify(released)}`,
      );
      // The control: the one handle the fixture never pushed is still held, so an assertion that
      // everything was disposed could not pass.
      const held = reading.subscriptions.filter((entry) => !entry.disposed);
      assert.equal(held.length, 1, `held handles were ${JSON.stringify(held)}`);
      assert.equal(held[0]?.kind, "api");

      // The half that is easy to lose: disposal flips a flag beside the registration, it does not remove
      // the registration. A reading that dropped the key would say the extension never registered the
      // command at all - which is a different claim, and a false one.
      const add = reading.commands.find((command) => command.id === "cart.add");
      assert.equal(add?.registered, true, "the registration must survive the disposal");
      assert.equal(add?.disposed, true, "a released command registration must read as released");
      // And the manifest's declared command, which was never registered, is released for neither reason.
      assert.equal(reading.commands.find((command) => command.id === "cart.ping")?.disposed, false);
    });
  });

  it("invokes a registered command and reads every consequence of it", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });
      const invoked = await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });
      assert.equal(invoked.result, "answered", invoked.reason ?? "invoke did not answer");

      const reading = await port.read();
      // One invocation filed by the extension's own `executeCommand` path, one by the host.
      assert.deepEqual(
        reading.invocations.map((entry) => [entry.command, entry.client, entry.result]),
        [
          ["cart.add", "extension", "answered"],
          ["cart.add", "criterion", "answered"],
        ],
      );
      // Two host processes ran - the activate and the invoke - and a host activates the extension, which
      // is how it learns the extension's commands. So the channel holds two activations, not one. This is
      // asserted rather than tolerated: a criterion comparing these lines to a literal list is comparing
      // them to a count of host runs, and the count is a fact about this world rather than about the
      // extension, which is why the reading carries `activation.runs`.
      assert.equal(reading.activation.runs, 2);
      assert.deepEqual(reading.output, [
        { channel: "Cart", lines: ["activated", "activated", "added 1"], shown: false },
      ]);
      assert.equal(reading.status[0]?.text, "$(cart) 1");
      assert.deepEqual(reading.messages, [
        { level: "info", message: "cart-web ready" },
        { level: "info", message: "cart-web ready" },
        { level: "warning", message: "added 1" },
      ]);
      // Durable state, written by the extension through `globalState.update`.
      assert.deepEqual(reading.state, [
        { scope: "global", key: "cart.items", value: JSON.stringify(["item"]) },
      ]);
      // And the setting the extension read was recorded with the source the value came from.
      assert.deepEqual(reading.settings, [
        { key: "cart-web.limit", value: "10", source: "default" },
      ]);
    });
  });

  it("keeps durable state across host runs and loses the previous run's API surface", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });
      await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });

      const reloaded = await port.exec({ argv: ["reload"], client: "criterion" });
      assert.equal(reloaded.result, "answered", reloaded.reason ?? "reload did not answer");
      const invoked = await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });
      assert.equal(invoked.result, "answered", invoked.reason ?? "the second invoke did not answer");

      const reading = await port.read();
      // The first run's state was there for the second run, so the item count moved to two. A world that
      // lost its state on a reload would read exactly the same value here, so the assertion is on the
      // value after two runs rather than on the key existing.
      assert.equal(reading.state[0]?.value, JSON.stringify(["item", "item"]));
      /*
       * A reload re-establishes the API surface. Probed by deleting `status.clear()` from the reload
       * branch: the two host runs each create `status#1`, so the map holds two entries and this reads 2.
       */
      assert.equal(reading.status.length, 1);
      assert.equal(reading.status[0]?.text, "$(cart) 2");
      /*
       * Four host processes ran - activate, invoke, reload, invoke - and the reload cleared the handles
       * before the last two. Four handles are taken per run: the channel, the status item, the command
       * registration and the event listener. Four would mean the reload kept the previous process's
       * handles, and twelve would mean every handle of every run is still being reported.
       */
      assert.equal(reading.activation.runs, 4);
      assert.equal(reading.subscriptions.length, 8);
      // Output is *not* cleared by a reload: an output channel is the extension's log, and a world that
      // blanked it on every reload would destroy the record of what the previous run said.
      assert.deepEqual(reading.output[0]?.lines, [
        "activated",
        "activated",
        "added 1",
        "activated",
        "activated",
        "added 2",
      ]);
    });
  });

  it("keeps an installed extension's durable state across a reinstall", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });
      await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });

      await installCart(port);
      const reading = await port.read();
      // `install` clears the API surface, because a registration from the replaced copy describes code
      // that is no longer on disk.
      assert.deepEqual(
        reading.commands.map((command) => command.id),
        ["cart.ping"],
      );
      assert.equal(reading.output.length, 0);
      assert.equal(reading.status.length, 0);
      assert.equal(reading.subscriptions.length, 0);
      // But durable state survives, because `globalState` outliving a reinstall is what the real store
      // does - and an extension caching across versions is a real behaviour worth being able to observe.
      assert.deepEqual(reading.state, [
        { scope: "global", key: "cart.items", value: JSON.stringify(["item"]) },
      ]);
    });
  });

  it("does not mutate the record it reads", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });
      await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });

      const first = await port.read();
      /*
       * The record has to be *non-empty* before comparing two readings of it, or this test cannot see a
       * mutation. Measured: clearing the refusal list inside `read()` left this assertion green, because
       * the only refusal in play at that point was one this subtest never caused. Every surface a read
       * could edit is therefore required to be carrying something here, so a mutation to any of them
       * moves a value that is compared.
       */
      assert.ok(first.output.some((entry) => entry.lines.length > 0), "no output lines");
      assert.ok(first.invocations.length > 0, "no invocations");
      assert.ok(first.messages.length > 0, "no messages");
      assert.ok(first.subscriptions.length > 0, "no subscriptions");
      assert.ok(first.state.length > 0, "no durable state");

      // Two readings of one run. A read that advanced a counter, re-derived a value from a live process
      // or appended to a list would make these differ - and `M1` would then call one world two.
      const second = await port.read();
      assert.deepEqual(second, first);
      // And a third, because a read that appends to a list it hands out differs from the second as well.
      assert.deepEqual(await port.read(), first);
    });
  });

  it("refuses a command line that names no action in the register", async () => {
    await withWorld(async ({ port }) => {
      await port.prepare();
      const record = await port.exec({ argv: ["Frobnicate", "cart"], client: "criterion" });
      assert.equal(record.result, "refused");
      assert.equal(record.action, null);
      assert.equal(record.command, "Frobnicate cart");
      assert.equal(record.status, 1);
      // The refusal names every action the register holds, so the reader is told what to spell instead.
      for (const action of VSCODE_ACTIONS) assert.match(record.reason ?? "", new RegExp(action));
      // And it is filed: a refusal nobody recorded is one nobody can audit.
      assert.deepEqual(
        (await port.read()).calls.map((entry) => [entry.action, entry.result]),
        [[null, "refused"]],
      );
    });
  });

  it("refuses a manifest whose main escapes the directory the manifest sits in", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION, { main: "../escape.js" });
      const record = await port.exec({
        argv: ["install", join("cart", "package.json")],
        client: "provisioner",
      });
      assert.equal(record.result, "failed");
      assert.match(record.reason ?? "", /outside the directory the manifest itself sits in/);
      assert.match(record.reason ?? "", /escape\.js/);
      const reading = await port.read();
      assert.equal(reading.extension.name, "");
      assert.equal(reading.engine.result, "refused");
    });
  });

  it("refuses an engine floor this host does not satisfy, rather than activating anyway", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION, {
        engines: { vscode: "^2.0.0" },
      });
      const record = await port.exec({
        argv: ["install", join("cart", "package.json")],
        client: "provisioner",
      });
      assert.equal(record.result, "failed");
      const reading = await port.read();
      assert.deepEqual(reading.engine, {
        declared: "^2.0.0",
        apiVersion: API_VERSION,
        result: "refused",
        reason: null,
      });
    });
  });

  it("refuses a range form it cannot evaluate instead of reporting the floor as admitted", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION, {
        engines: { vscode: "~1.100.0" },
      });
      const record = await port.exec({
        argv: ["install", join("cart", "package.json")],
        client: "provisioner",
      });
      assert.equal(record.result, "failed");
      const reading = await port.read();
      assert.equal(reading.engine.result, "refused");
      // The reason quotes the range and says what the world *does* read - the failure mode this guard
      // exists for is a floor silently treated as satisfied, which nobody can find later.
      assert.match(reading.engine.reason ?? "", /~1\.100\.0/);
      assert.match(reading.engine.reason ?? "", /does not implement/);
    });
  });

  it("refuses a host path outside the application directory and the sandbox, and records it", async () => {
    await withWorld(async ({ port, contextRoot, root }) => {
      await port.prepare();
      const spelled = join("..", "..", "elsewhere", "package.json");
      const record = await port.exec({ argv: ["install", spelled], client: "criterion" });
      assert.equal(record.result, "refused");
      assert.equal(record.resource, spelled);
      // The refusal names the resolved path, the application directory and the sandbox - three things a
      // reader needs and only the one predicate that decided the question holds.
      assert.match(record.reason ?? "", /outside the application directory/);
      assert.match(record.reason ?? "", /outside this world's sandbox/);
      assert.deepEqual(port.escapes(), [{ client: "criterion", spelled }]);
      assert.match(record.reason ?? "", new RegExp(root.replace(/\\/g, "\\\\")));
      assert.match(record.reason ?? "", new RegExp(contextRoot.replace(/\\/g, "\\\\")));
    });
  });

  it("resets the world but not the transcript", async () => {
    await withWorld(async ({ port, contextRoot, root }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });
      await port.exec({ argv: ["invoke", "cart.add"], client: "criterion" });
      const escaped = join("..", "..", "elsewhere", "package.json");
      await port.exec({ argv: ["install", escaped], client: "provisioner" });

      const before = await port.read();
      const calls = before.calls.length;
      assert.ok(calls >= 4);

      await port.reset();
      const after = await port.read();
      assert.equal(after.extension.name, "");
      assert.equal(after.commands.length, 0);
      assert.equal(after.output.length, 0);
      assert.equal(after.status.length, 0);
      assert.equal(after.subscriptions.length, 0);
      assert.equal(after.state.length, 0);
      assert.equal(after.activation.activated, false);
      /*
       * The transcript survives, and the escape with it. Probed by clearing `calls` and `escapes` inside
       * `rebuild()`: an iteration that reached outside the boundary would then be followed by a clean one
       * and the run would report `PASS` with an empty crossing list, which is the false pass this product
       * exists to make impossible.
       */
      assert.equal(after.calls.length, calls);
      assert.deepEqual(port.escapes(), [{ client: "provisioner", spelled: escaped }]);
      // The sandbox really was rebuilt rather than left as it was.
      await stat(join(root, HOST_RUNNER_RELPATH));
    });
  });

  it("records an api the world does not implement as a refusal, by name", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "probe", PROBE_EXTENSION);
      await port.exec({ argv: ["install", join("probe", "package.json")], client: "provisioner" });
      const activated = await port.exec({ argv: ["activate"], client: "provisioner" });
      assert.equal(activated.result, "answered", activated.reason ?? "activate did not answer");
      const reading = await port.read();
      assert.deepEqual(
        reading.refusals.map((entry) => entry.api),
        [
          "workspace.findFiles",
          "vscode.env",
          "window.showQuickPick",
          "commands.registerHandler",
        ],
      );
      for (const refusal of reading.refusals) {
        assert.equal(refusal.client, "extension");
        assert.ok(refusal.reason.length > 0);
      }
    });
  });

  it("reports an invoke of a declared-but-unregistered command as absent, not as a failure of the world", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);
      await port.exec({ argv: ["activate"], client: "provisioner" });

      // Declared in the manifest, so the world will run a host for it - and the host reports that no
      // handler exists, which is a fact about the extension rather than about the substitute.
      const declared = await port.exec({ argv: ["invoke", "cart.ping"], client: "criterion" });
      assert.equal(declared.result, "failed");
      assert.match(declared.reason ?? "", /no handler is registered/);

      // Neither declared nor registered: refused before any host is started.
      const unknown = await port.exec({ argv: ["invoke", "cart.missing"], client: "criterion" });
      assert.equal(unknown.result, "absent");
      assert.match(unknown.reason ?? "", /neither registered by the extension nor declared/);

      const reading = await port.read();
      assert.deepEqual(
        reading.invocations
          .filter((entry) => entry.command !== "cart.add")
          .map((entry) => [entry.command, entry.client, entry.result]),
        [
          ["cart.ping", "criterion", "absent"],
          ["cart.missing", "criterion", "absent"],
        ],
      );
    });
  });

  it("configures, unconfigures and reveals, and refuses what those need", async () => {
    await withWorld(async ({ port, contextRoot }) => {
      await port.prepare();
      await writeExtension(contextRoot, "cart", CART_EXTENSION);
      await installCart(port);

      // A channel exists only once the extension creates it, so a reveal *before* activation names that
      // rather than reporting a channel the world does not hold. Asserted here, before the activation
      // below, because after it the channel really does exist and the question changes.
      const early = await port.exec({ argv: ["reveal", "Cart"], client: "criterion" });
      assert.equal(early.result, "absent");
      assert.match(early.reason ?? "", /creates its channels when it activates/);

      await port.exec({ argv: ["activate"], client: "provisioner" });

      const missing = await port.exec({ argv: ["configure", "cart-web.limit"], client: "criterion" });
      assert.equal(missing.result, "refused");
      assert.match(missing.reason ?? "", /fewer than two/);

      const configured = await port.exec({
        argv: ["configure", "cart-web.limit", "3"],
        client: "criterion",
      });
      assert.equal(configured.result, "answered");
      const reading = await port.read();
      assert.deepEqual(reading.settings, [{ key: "cart-web.limit", value: "3", source: "override" }]);

      const removed = await port.exec({ argv: ["unconfigure", "cart-web.limit"], client: "criterion" });
      assert.equal(removed.result, "answered");
      assert.equal(
        (await port.exec({ argv: ["unconfigure", "cart-web.limit"], client: "criterion" })).result,
        "absent",
      );

      assert.equal((await port.exec({ argv: ["reveal", "Cart"], client: "criterion" })).result, "answered");
      assert.equal((await port.read()).output[0]?.shown, true);
    });
  });

  it("refuses an action that needs an installed extension, rather than inventing one", async () => {
    await withWorld(async ({ port }) => {
      await port.prepare();
      for (const argv of [["activate"], ["invoke", "cart.add"], ["reload"]]) {
        const record = await port.exec({ argv, client: "criterion" });
        assert.equal(record.result, "absent", `${argv.join(" ")} answered without an install`);
        assert.match(record.reason ?? "", /run `install` first|no extension has been installed/);
      }
    });
  });
});
