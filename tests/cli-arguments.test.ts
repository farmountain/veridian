import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMANDS,
  DEFAULT_GOAL_PATH,
  DEFAULT_MEMORY_URL,
  DEFAULT_STATE_DIR,
  SWITCH_FLAGS,
  USAGE,
  VALUE_FLAGS,
  UsageError,
  applyBrowserChoice,
  parseArguments,
} from "../cli/arguments.ts";
import type { CliArguments } from "../cli/arguments.ts";
import type { EnvironmentPlan } from "../core/environment/types.ts";

/**
 * The command line, as a contract.
 *
 * `cli/veridian.ts` is a bin whose last statement runs `main()`, so every rule it enforces about
 * arguments would otherwise only be checkable by spawning a process and reading its exit code. Those
 * rules are the CLI's public surface �?which flags exist, which contradict each other, what a missing
 * value does �?and they are exactly the kind of thing that rots silently.
 *
 * Two of the cases below are not stylistic. `--repair` swallowing the remainder of the line is the
 * reason the usage text says it must come last; if the parser ever started trying to find where the
 * repair command ends, a repair script that legitimately takes a `--goal` argument would be parsed as
 * *two* commands. And every rejection is asserted to be a `UsageError` rather than a bare `Error`,
 * because that type is what makes `main()` print the usage text and exit `3` instead of crashing with
 * a stack trace.
 */

function parse(...argv: readonly string[]): CliArguments {
  return parseArguments(argv);
}

function rejects(...argv: readonly string[]): string {
  try {
    parseArguments(argv);
  } catch (error) {
    assert.ok(error instanceof UsageError, `expected a UsageError, received ${String(error)}`);
    return error.message;
  }
  assert.fail(`expected ${JSON.stringify(argv)} to be rejected`);
}

/** A resolved environment plan with only the browser policy varying. */
function environmentPlan(browserEnabled: boolean): EnvironmentPlan {
  return {
    adapter: "local-web",
    app: "./app",
    appPath: "D:/repo/examples/shopping-cart/app",
    env: {},
    dependencyInstall: null,
    start: { command: "node", args: ["serve.mjs"], readyPattern: null },
    url: "http://127.0.0.1:4173/",
    api: null,
    databasePath: null,
    cluster: null,
    posix: null,
    os: null,
    cloud: null,
    container: null,
    vscode: null,
    process: null,
    data: null,
    health: { path: "/", expectStatus: 200, timeoutMs: 15000, intervalMs: 250, readyPattern: null },
    reset: { strategy: "snapshot-restore", command: null },
    browser: { enabled: browserEnabled, viewport: null, locale: null, timezoneId: null },
    boundary: { network: "deny", allow: [], filesystemWrite: "deny" },
  };
}

describe("parseArguments: dispatch and defaults", () => {
  it("defaults to the help command when there is no command", () => {
    // Not an error: `veridian` on its own should explain itself, not complain.
    assert.equal(parse().command, "help");
  });

  it("accepts every declared command", () => {
    for (const command of ["validate", "clarify", "init", "metrics", "help"] as const) {
      assert.equal(parse(command).command, command);
    }
  });

  it("fills in the documented defaults for a bare validate", () => {
    const parsed = parse("validate");

    assert.deepEqual(
      {
        goalPath: parsed.goalPath,
        stateDir: parsed.stateDir,
        browser: parsed.browser,
        repair: parsed.repair,
        noRepair: parsed.noRepair,
        memoryUrl: parsed.memoryUrl,
        noMemory: parsed.noMemory,
        noSelfPrompt: parsed.noSelfPrompt,
        headed: parsed.headed,
        force: parsed.force,
        defects: parsed.defects,
        logLevel: parsed.logLevel,
      },
      {
        goalPath: DEFAULT_GOAL_PATH,
        stateDir: DEFAULT_STATE_DIR,
        browser: "auto",
        repair: null,
        noRepair: false,
        memoryUrl: null,
        noMemory: false,
        noSelfPrompt: false,
        headed: false,
        force: false,
        defects: [],
        logLevel: "info",
      },
    );
  });

  it("reads options before, after, and between other options", () => {
    const parsed = parse("--goal", "g.yaml", "validate", "--headed");

    assert.equal(parsed.command, "validate");
    assert.equal(parsed.goalPath, "g.yaml");
    assert.equal(parsed.headed, true);
  });

  it("treats -h as a request for help", () => {
    assert.equal(parse("-h").command, "help");
  });
});

describe("parseArguments: value flags", () => {
  it("accepts a separated and an inline value for every value flag", () => {
    const separated = parse(
      "validate",
      "--goal",
      "a.yaml",
      "--state-dir",
      "state",
      "--browser",
      "none",
      "--memory",
      "http://host:1234",
      "--log-level",
      "warn",
    );
    assert.equal(separated.goalPath, "a.yaml");
    assert.equal(separated.stateDir, "state");
    assert.equal(separated.browser, "none");
    assert.equal(separated.memoryUrl, "http://host:1234");
    assert.equal(separated.logLevel, "warn");

    const inline = parse(
      "validate",
      "--goal=a.yaml",
      "--state-dir=state",
      "--browser=none",
      "--memory=http://host:1234",
      "--log-level=warn",
    );
    assert.deepEqual(inline, separated);
  });

  it("keeps a value that happens to look like a path or a URL intact", () => {
    // The parser must not normalise, resolve, or trim these. Resolving `--goal` against the process
    // cwd here would make the flag mean something different from what the caller typed.
    const parsed = parse("validate", "--goal=./examples/../goal.yaml", "--memory=https://x/y?z=1");

    assert.equal(parsed.goalPath, "./examples/../goal.yaml");
    assert.equal(parsed.memoryUrl, "https://x/y?z=1");
  });

  it("rejects a value flag with nothing after it", () => {
    assert.match(rejects("validate", "--goal"), /--goal needs a value/);
  });

  it("refuses to eat the next option as a value", () => {
    // `--goal --state-dir x` is a mistake in the caller's line, and silently setting the goal path to
    // the literal string "--state-dir" would produce a confusing file-not-found much later.
    assert.match(rejects("validate", "--goal", "--state-dir", "x"), /--goal needs a value/);
  });

  it("rejects an unknown choice for --browser", () => {
    assert.match(rejects("validate", "--browser", "chrome"), /--browser must be auto, playwright or none/);
  });

  it("rejects an unknown choice for --log-level", () => {
    assert.match(rejects("validate", "--log-level", "loud"), /--log-level must be debug, info or warn/);
  });

  it("rejects a value attached to a switch", () => {
    assert.match(rejects("validate", "--headed=true"), /--headed does not take a value/);
  });
});

describe("parseArguments: logging verbosity", () => {
  it("maps --verbose and --quiet onto explicit levels", () => {
    assert.equal(parse("validate", "--verbose").logLevel, "debug");
    assert.equal(parse("validate", "--quiet").logLevel, "warn");
  });

  it("lets --log-level win over the shorthand flags", () => {
    // One way to say a thing. If both appear the explicit flag is the more specific statement.
    assert.equal(parse("validate", "--quiet", "--log-level", "debug").logLevel, "debug");
  });
});

describe("parseArguments: the repair command", () => {
  it("takes everything after --repair as the command", () => {
    const parsed = parse("validate", "--repair", "node", "repair.mjs", "--flag", "value");

    assert.deepEqual(parsed.repair, ["node", "repair.mjs", "--flag", "value"]);
  });

  it("does not let the repair command's own flags leak into the CLI's own options", () => {
    // The property behind "must be the last option": a repair script is entitled to its own --goal.
    const parsed = parse("validate", "--repair", "python", "fix.py", "--goal", "other.yaml");

    assert.equal(parsed.goalPath, DEFAULT_GOAL_PATH);
    assert.deepEqual(parsed.repair, ["python", "fix.py", "--goal", "other.yaml"]);
  });

  it("rejects --repair with no command at all", () => {
    assert.match(rejects("validate", "--repair"), /--repair needs a command/);
  });

  it("rejects --repair that swallowed only the conflicting switch", () => {
    // `--repair` consumes the rest unconditionally, so this is *not* the conflict case: there is a
    // command, and it happens to be named like a switch. Asserted so the ordering is recorded �?the
    // conflict check below only fires when --no-repair was seen *before* --repair.
    const parsed = parse("validate", "--repair", "--no-repair");
    assert.deepEqual(parsed.repair, ["--no-repair"]);
    assert.equal(parsed.noRepair, false);
  });

  it("rejects asking for repair and no repair at once", () => {
    assert.match(
      rejects("validate", "--no-repair", "--repair", "node", "repair.mjs"),
      /opposite things/,
    );
  });

  it("records --no-repair on its own", () => {
    const parsed = parse("validate", "--no-repair");

    assert.equal(parsed.noRepair, true);
    assert.equal(parsed.repair, null);
  });
});

describe("parseArguments: the self-prompt rung", () => {
  it("leaves rung 4 installed by default and records --no-self-prompt", () => {
    // On by default is the decision, not an accident: the rung is bounded by its own caps, so
    // leaving it on cannot become a loop, and an operator who wants it off has to say so.
    assert.equal(parse("validate").noSelfPrompt, false);
    assert.equal(parse("validate", "--no-self-prompt").noSelfPrompt, true);
  });

  it("keeps --no-self-prompt independent of the switches it sits beside", () => {
    // The one conflict the parser enforces is `--no-repair` against `--repair`. Neither this switch
    // nor `--no-memory` contradicts anything, and asserting the pair here records that - a reader who
    // assumes every `--no-*` flag participates in a conflict check would be wrong three times.
    const parsed = parse("validate", "--no-repair", "--no-memory", "--no-self-prompt");

    assert.equal(parsed.noSelfPrompt, true);
    assert.equal(parsed.noMemory, true);
    assert.equal(parsed.noRepair, true);
  });

  it("rejects a value attached to --no-self-prompt", () => {
    assert.match(rejects("validate", "--no-self-prompt=yes"), /--no-self-prompt does not take a value/);
  });
});

describe("parseArguments: rejection of unusable lines", () => {
  it("rejects an unknown long option", () => {
    assert.match(rejects("validate", "--bogus"), /unknown option "--bogus"/);
  });

  it("rejects an unknown short option", () => {
    assert.match(rejects("validate", "-z"), /unknown option "-z"/);
  });

  it("rejects an unknown command", () => {
    assert.match(rejects("deploy"), /unknown command "deploy"/);
  });

  it("names the options when given a stray positional argument", () => {
    // The likely mistake is `veridian validate goal.yaml`, so the message has to point at --goal.
    const message = rejects("validate", "goal.yaml");
    assert.match(message, /unexpected argument: goal\.yaml/);
    assert.match(message, /--goal/);
  });

  it("pluralises the stray-argument message", () => {
    assert.match(rejects("validate", "a", "b"), /unexpected arguments: a b/);
  });

  it("treats a lone dash as a positional, not an option", () => {
    // `-` is conventionally stdin. It is not an option, so it lands in the positional slot and fails
    // as an unknown command rather than as an unknown flag.
    assert.match(rejects("-"), /unknown command "-"/);
  });
});

describe("parseArguments: the metrics command", () => {
  it("takes a comma-separated list of defect criteria", () => {
    // Ground truth for M2 and M3. The bundle records what was observed, never what was intended, so
    // this cannot be derived from the run - an operator has to state which criteria a known defect
    // was expected to break, or the metric is unmeasurable and must say so.
    const parsed = parse("metrics", "--defects", "AC-001, AC-003");

    assert.equal(parsed.command, "metrics");
    assert.deepEqual(parsed.defects, ["AC-001", "AC-003"], "ids are trimmed, not passed through raw");
  });

  it("reads an empty list as no expectation rather than as one blank criterion", () => {
    assert.deepEqual(parse("metrics", "--defects", "").defects, []);
    assert.deepEqual(parse("metrics", "--defects", " , ").defects, []);
  });

  it("leaves the list empty when the flag is absent, so nothing is silently expected", () => {
    assert.deepEqual(parse("metrics").defects, []);
  });

  it("survives a round trip through the parser unchanged", () => {
    const parsed = parse("--defects=AC-002", "metrics", "--state-dir", ".veridian");

    assert.equal(parsed.command, "metrics");
    assert.deepEqual(parsed.defects, ["AC-002"]);
    assert.equal(parsed.stateDir, ".veridian");
  });
});

describe("applyBrowserChoice: the run's actual world", () => {
  it("turns the browser off in the plan, not merely in the object it builds", () => {
    const plan = environmentPlan(true);

    const actual = applyBrowserChoice(plan, "none");

    assert.equal(actual.browser.enabled, false, "--browser none must reach the plan the adapter sees");
    // The rest of the plan is the document's, untouched: the flag is about the browser and nothing else.
    assert.equal(actual.url, plan.url);
    assert.deepEqual(actual.start, plan.start);
  });

  it("turns the browser on in the plan when the document did not ask for one", () => {
    // The mirror case, and the reason the derivation is a function rather than a one-way switch:
    // `--browser playwright` over a browserless environment has to *add* the browser, or the run
    // records a world it is not using.
    assert.equal(applyBrowserChoice(environmentPlan(false), "playwright").browser.enabled, true);
  });

  it("leaves the document's own answer alone under auto, which is what auto means", () => {
    assert.equal(applyBrowserChoice(environmentPlan(true), "auto").browser.enabled, true);
    assert.equal(applyBrowserChoice(environmentPlan(false), "auto").browser.enabled, false);
  });

  it("returns the same plan when nothing changes, so a run's inputs are not needlessly copied", () => {
    const plan = environmentPlan(true);

    assert.equal(applyBrowserChoice(plan, "playwright"), plan);
    assert.equal(applyBrowserChoice(plan, "auto"), plan);
  });
});

describe("usage text", () => {
  it("interpolates the real defaults instead of restating them", () => {
    assert.match(USAGE, new RegExp(DEFAULT_GOAL_PATH));
    assert.match(USAGE, new RegExp(DEFAULT_STATE_DIR));
    assert.match(USAGE, new RegExp(DEFAULT_MEMORY_URL.replace(/[.]/g, "\\.")));
  });

  it("documents every command the parser accepts", () => {
    // Iterated from the register rather than from a copy of it, for the reason the two flag guards
    // below give: a recalled list cannot notice a member the code has and the document does not.
    assert.ok(COMMANDS.size > 0, "the command register is empty, so this guard cannot see a missing one");
    for (const command of COMMANDS) {
      assert.match(USAGE, new RegExp(`veridian ${command}`));
    }
  });

  it("names every flag the parser accepts", () => {
    // The usage text is the only place an operator learns a flag exists: the parser dispatches on
    // these two sets and the help text is prose, so a flag added to one and not the other is
    // undiscoverable and unremarkable in either file read on its own.
    for (const name of [...VALUE_FLAGS, ...SWITCH_FLAGS]) {
      assert.ok(USAGE.includes(`--${name}`), `usage text never names --${name}`);
    }
  });

  it("documents every exit code `main` can return", () => {
    for (const code of ["  0  ", "  1  ", "  2  ", "  3  "]) {
      assert.ok(USAGE.includes(code), `usage text does not explain exit code ${code.trim()}`);
    }
    assert.match(USAGE, /INCONCLUSIVE/);
  });

  it("warns that --repair must come last", () => {
    assert.match(USAGE, /Must be the last/);
  });
});
