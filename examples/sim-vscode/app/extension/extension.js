// The extension under test: an ordinary CommonJS VS Code extension, written the way an extension is
// written on a machine that has VS Code on it.
//
// Nothing here knows it is being tested. It reads `vscode` the way an extension reads it - through a
// module this world resolves in place of the editor's - and it is loaded by `require`, because
// `engines.vscode` is the floor for the *host* and the host here is Node. The extension is the input
// the demo edits: every reading this world produces is derived from this file on every run, so a
// defect is injected *here* and never into a generated copy.

const vscode = require("vscode");

const CHANNEL = "Cart";
const ITEMS_KEY = "cart.items";
const LIMIT_KEY = "limit";
const LIMIT_FALLBACK = 10;

// The handles `activate` was given a place to keep. `deactivate` takes no arguments - the editor calls
// it with none - so an extension that unwinds anything has to remember what it was handed, exactly as
// the editor's own extension guide shows.
let subscriptions = [];

/** Every item the extension has been asked to keep, or none if the store holds something unexpected. */
function itemLabelOf(stored) {
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function activate(context) {
  subscriptions = context.subscriptions;
  const channel = vscode.window.createOutputChannel(CHANNEL);
  channel.appendLine("activated (cart-web 1.0.0)");

  // The host's own name is metadata rather than a dependency: an editor tells an extension where it is
  // running, and an extension notes it when it is there and carries on when it is not. This world does
  // not implement `vscode.env`, and reading it is refused *on the record* rather than thrown, so the
  // extension keeps working and the refusal is an observation a criterion can read. Nothing below
  // depends on the answer, which is what makes the guard below honest rather than a wish.
  if (typeof vscode.env === "object" && vscode.env !== null && typeof vscode.env.appName === "string") {
    channel.appendLine("host " + vscode.env.appName);
  }

  context.subscriptions.push(channel);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 7);
  status.text = "$(cart) " + String(itemLabelOf(context.globalState.get(ITEMS_KEY, "[]")).length);
  status.tooltip = "items in the cart";
  status.command = "cart.add";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("cart.add", async (label) => {
      const items = itemLabelOf(context.globalState.get(ITEMS_KEY, "[]"));
      items.push(String(label));
      await context.globalState.update(ITEMS_KEY, JSON.stringify(items));
      status.text = "$(cart) " + String(items.length);
      channel.appendLine("added " + String(items.length));
      const limit = vscode.workspace.getConfiguration("cart-web").get(LIMIT_KEY, LIMIT_FALLBACK);
      vscode.window.showWarningMessage("cart " + String(items.length) + " of " + String(limit));
      return String(items.length) + "/" + String(limit);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cart.preview-json", () =>
      JSON.stringify(itemLabelOf(context.globalState.get(ITEMS_KEY, "[]"))),
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(() => channel.appendLine("settings changed")),
  );

  vscode.window.showInformationMessage("cart-web ready");
}

function deactivate() {
  // Every handle above was handed to the context, so unwinding is that list read backwards. An
  // extension that skips this leaks its registrations for as long as the host lives, which is what
  // `vscode.subscription` reads and what a criterion about it can fail on.
  for (const subscription of subscriptions.slice().reverse()) {
    subscription.dispose();
  }
  subscriptions.length = 0;
}

module.exports = { activate: activate, deactivate: deactivate };
