#!/usr/bin/env node
/**
 * env-probe - the application the `env-reality` contract starts and judges.
 *
 * ## The question, and why the world needed a field to ask it
 *
 * *What can the program this world starts actually see?* Every bundle before this one answered a
 * narrower question and read as though it had answered this one: `environment.json` carries `env`,
 * which is the world's **declaration** - the two names this contract's document sets - and a reader
 * who finds two names reasonably concludes the application could reach two. Measured through this
 * repository's own CLI on this machine, an application under a two-name declaration could reach
 * eighty-four names, five of them credential-shaped and all five populated.
 *
 * The reason was structural rather than a missing line. `core/process.ts` started every child as
 * `{ ...process.env, ...declared }`, so the operator's shell came with it - and confinement, which is
 * real and measured in three dimensions (reads, writes, children), did not cover the fourth.
 *
 * So the world gained `process.environment`, and this contract declares `declared`: the child gets the
 * document's `env` block and nothing else. Two halves are worth watching, and this program is one of
 * them:
 *
 *   the world's reading   `process.environment` - the crawl the runner took of the map it handed over
 *   the program's reading what THIS program counted for itself, printed below
 *
 * They are two instruments measuring one fact, which is why the contract judges both. A world whose
 * crawl said "no credentials" and an application whose own census said otherwise would be a world
 * reporting a boundary it did not have - and a contract that read only the world's half could not tell
 * the two apart.
 *
 * ## What this program may not do
 *
 * It may not print a value. Its subject is the environment, and the environment of a developer machine
 * holds live credentials, so every line below reports a **name or a count** - never a key's contents.
 * The rule is this repository's, not this example's: `core/environment/env-crawl.ts` makes the leak
 * unrepresentable in the type, and a program that printed a value would be reintroducing by hand the
 * defect that file exists to prevent. `probe:channel` is the one name checked, and it reports only
 * whether the variable is there.
 *
 * It may not read stdin: the adapter spawns every child with `stdio: ["ignore", "pipe", "pipe"]`, so a
 * prompt receives immediate EOF rather than a person.
 *
 * ## Exit codes
 *
 *   0   did what was asked
 *   2   the command line was unusable
 *
 * `2` rather than `1` because `1` is what an uncaught exception produces, and a criterion that could
 * not tell "you asked me something I cannot do" from "the program fell over" would report the second
 * as the first.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.env["VERIDIAN_PROCESS_ROOT"] ?? ".";
const REPORT_DIR = join(ROOT, "env");
const REPORT_FILE = join(REPORT_DIR, "reading.json");
const GOAL = "env-reality";

/** The one name this contract's document declares, checked by presence and never by value. */
const CHANNEL = "ENV_REALITY_CHANNEL";

/**
 * The credential screen this program applies to itself, and it is the same question the world's crawler
 * asks. Kept local rather than imported because a `run` step is a separate process and a separate
 * program: the value of judging both halves is that they are two instruments, and an instrument that
 * imported the other's classifier would be measuring with the thing it is measuring against.
 */
const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|PRIVATE/i;

function say(line) {
  process.stdout.write(`${line}\n`);
}

function warn(line) {
  process.stderr.write(`${line}\n`);
}

/** Count what this process can see. Names and figures leave; contents never do. */
function census() {
  const names = Object.keys(process.env).sort();
  return {
    visible: names.length,
    credential: names.filter((name) => CREDENTIAL_NAME.test(name)).length,
    populated: names.filter((name) => (process.env[name] ?? "") !== "").length,
    channel: process.env[CHANNEL] === undefined ? "absent" : "present",
  };
}

async function record(reading) {
  await mkdir(REPORT_DIR, { recursive: true });
  // The reading is written with no clock in it, so two censuses of an unchanged world are
  // byte-identical and a difference in them is a difference in the environment.
  await writeFile(REPORT_FILE, `${JSON.stringify(reading, null, 2)}\n`, "utf8");
}

const [, , command] = process.argv;

if (command === "census") {
  const reading = census();
  await record(reading);
  say("probe:ready");
  say(`probe:visible ${String(reading.visible)}`);
  say(`probe:credential ${String(reading.credential)}`);
  say(`probe:populated ${String(reading.populated)}`);
  say(`probe:channel ${reading.channel}`);
  say("probe:report written");
  say("probe:report-path env/reading.json");
} else if (command === "daemon") {
  say(`${GOAL} daemon ready`);
  // Hold open so the world's readiness gate has something to observe, and so `process.state` has a
  // running program to report. No child is started: this world's application is deliberately not
  // granted `--allow-child-process`, so a `spawn` here would be denied by the runtime rather than by
  // this program's own care.
  setInterval(() => {}, 1 << 30);
} else {
  warn(`unknown command ${String(command)}`);
  process.exitCode = 2;
}
