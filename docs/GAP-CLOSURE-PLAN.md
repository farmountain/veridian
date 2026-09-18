# W2 `sim-mobile` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `writing-plans` conventions as executed here —
> every task names its files, its exact command and the output that command must produce, and every
> guard this change trips is falsified before it is trusted. Steps use checkbox (`- [ ]`) syntax.

**Goal:** land `sim-mobile` — the twelfth world and the last row `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`
still calls `planned` — so that every sandbox world this project planned exists, is registered, is
judged by its own validator family, and is executed by a demo the gate runs.

> **Status: executed, and the goal above is met.** `adapters/sim-mobile/`, `validators/mobile/`,
> `examples/sim-mobile/` and the `demo:mobile` script all exist, and the demo was measured green:
> `PASS (COMPLETED, 5 iteration(s))`, 25/25 criteria, exit 0, with the failing count descending
> `5 -> 4 -> 2 -> 1 -> 0`. The task list below is left as written rather than ticked box by box, because
> what a reader needs from it now is the *reason* each step exists — which is the part that does not
> go stale — and every figure it quotes was re-measured at the moment this banner was added.

**Architecture:** the proven `sim-*` shape, a fourth time. A **real** application child process is
started through `runToCompletion` with a **file allowance** and prints command vectors on its stdout;
`adapters/sim-mobile/mobile-port.ts` — already written, 49 tests over 14 suites — executes them
in process and holds device records. No emulator, no guest kernel, no device, no touch pipeline and
no outbound socket. `core/environment/mobile-observation.ts` — already written — is the reading
vocabulary; `validators/mobile/` judges it and never imports the adapter.

**Tech Stack:** TypeScript, Node 22 (`node --test`, `npx tsc --noEmit`), PowerShell 5.1, no build step
for the source tree.

---

## Why this plan exists and what it deliberately does not do

`docs/GAP-CLOSURE-DESIGN.md` §4 carries seven work items. **W1, W3, W4, W5 and W7 have landed**
(measured: eleven worlds declare `confinement` and answer `filesystemWrite: enforced`; the
`IMPLEMENTATION-PLAN.md` §1 table has its Status column and `tests/implementation-plan-status.test.ts`
holds it; `tests/package-manifest.test.ts` holds the Playwright optional peer;
`acceptance/ladder/` + `scripts/ladder.mjs` + `tests/runtime-report-slices.test.ts` exist; §11 records
W7's falsified premise). **W6 is design-only by design** — §5 says in as many words: *no stub adapter,
and no MCP server.* What remains buildable is **W2**, and this plan is scoped to it plus the guards it
trips.

It does **not**: add a step kind, add a second implementation of the confinement rule, redesign the
clarification mechanism (§5 — *"It is implemented and it is correct; W5 proves it rather than
redesigning it"*), build an `IsolationPort`, or write an MCP server.

### Deviations from the `writing-plans` defaults, recorded

1. **Location.** The skill's default is `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`. `docs/` in
   this repository is **flat** — six files, no subdirectory, measured — and `AGENTS.md`'s documentation
   index is flat with it. Creating the first `docs/` subdirectory would make gap 4 (documentation
   currency) true again in the same pass that closes it. The skill explicitly permits this:
   *"(User preferences for plan location override this default)"*. The plan is therefore a sibling of
   the design it executes: `docs/GAP-CLOSURE-PLAN.md`, with one added index row in `AGENTS.md`.
2. **Template code is cited by anchor, not re-pasted.** `sim-mobile-environment.ts` is roughly 700
   lines whose shape is `adapters/sim-posix/sim-posix-environment.ts`; `validators/mobile/` is roughly
   12 validators whose shape is `validators/data/data-validators.ts`. The no-placeholder rule exists to
   forbid "TBD", not to require a second copy of a file already in the tree — and `AGENTS.md` records
   three separate defects caused by one rule written twice. Each such step therefore names the exact
   template, the exact export names and the exact test assertions, and its verification step is the
   test, not a review of prose.

### Substitution log (the operator was unavailable)

| # | Question | Answer taken | Reasoning |
|---|---|---|---|
| S7 | Scope, given W1/W3/W4/W5/W7 have landed | **Build W2; record W6 unchanged; no reconciliation narrative.** | Behaviour is identical under every reading of the request for everything *buildable*; the difference was only how much prose accompanies it, and a section restating records already in the tree is the overbuilding the request's own governing principles forbid. |
| S8 | `mobile` block field set | **`{ device, platform, root }`, required.** | Exactly the three facts the substitute's own `MobilePortOptions` needs beyond `processes` (`device`, `platform`, `root`) — read out of the port, not invented. `apiLevel` is deliberately **not** a document field because `SIM_DEVICE_API_LEVEL` is a constant of the substitute, the same way `SIM_DEVICE_NAME` and `SIM_DEVICE_VERSION` are. |
| S9 | `MOBILE_ENV` names | **Four, mirroring `CONTAINER_ENV`.** | `mobilePort()` takes `root` *and* `contextRoot` — the same two-name split `sim-container` documents (*"a program that had only one of the two names could not tell which one it was holding"*). |
| S10 | Refresh the §2.6 census table | **No — leave it, as §9 already does.** | §2.6 states it is *a reading at `da4831e`* and §9 carries the replacement figures. Editing a dated reading to match today would destroy the record that made it useful. |

---

## File Structure

**Created:**

```
adapters/sim-mobile/
  sim-mobile-environment.ts   the adapter. ~700 lines, modelled on sim-posix-environment.ts.
  index.ts                    the front door: SimMobileEnvironment, MOBILE_ENV, MOBILE_WORKSPACE.
validators/mobile/
  index.ts                    front door: MOBILE_VALIDATORS, MOBILE_VALIDATOR_NAMES, mobileValidators.
  mobile-validators.ts        the twelve validators. Judges mobile-observation.ts only.
  mobile-validators.test.ts   the family's own suite, roster + malformed + each status.
examples/sim-mobile/
  goal.yaml  acceptance.yaml  environment.yaml
  app/                        the provisioner and the application tree.
  defects.ts  repair.ts  demo.ts  source.ts
tests/sim-mobile-environment.test.ts   the adapter's own suite.
tests/sim-mobile-demo.test.ts          the defect table's properties.
```

**Modified (twelve additive places, each measured):**

| # | File | Anchor |
|---|---|---|
| 1 | `schemas/environment.schema.json` | new `mobile` block, after the `data` block, before `health` |
| 2 | `core/environment/types.ts` | optional document spelling beside `:382`; `MobilePlan` beside `:843`; plan field beside `:592` |
| 3 | `core/environment/load.ts` | `readMobile` beside `readData:628`; one line at the construction site `:773` |
| 4 | `core/clarification/detect.ts` | tenth `hasNoHttp` clause, nine at `:262-272` |
| 5 | `cli/worlds.ts` | import beside `:1-12`; `WORLDS` entry |
| 6 | `cli/validators.ts` | import beside `:12-22`; spread beside `:38-48` |
| 7 | `package.json` | `demo:mobile` beside `:42-54` |
| 8 | `.github/workflows/ci.yml` | the `for world in` list at `:207` |
| 9 | `README.md` | quickstart fence + layout block roster |
| 10 | `AGENTS.md` | `Running things:` block + layout row + doc index row |
| 11 | `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` | world table row `:769` -> `built`; demo section |
| 12 | `docs/IMPLEMENTATION-PLAN.md` | row `:49` Mobile device-farm -> `landed` |

**Six guards that will fail until the world supplies what they read** — each verified, each is
evidence the guard works rather than an obstacle: `tests/readme-rosters.test.ts` (auto-discovers a
twelfth family), `tests/simulated-surfaces.test.ts` (three extension points), `tests/environment-gaps.test.ts`
(two directions), `tests/implementation-plan-status.test.ts` (row `:49`), `tests/boundary-roster.test.ts`
(the register cross-check), `tests/demo-rosters.test.ts` (the four-place roster).

---

## Task 0: Baseline, before anything moves

- [ ] **Step 1: Record the tree's own state.**

```powershell
npx tsc --noEmit; Write-Output "tsc exit=$LASTEXITCODE"
node --test 2>&1 | Select-String -Pattern "^# (tests|suites|pass|fail)"
```

Expected: `tsc exit=0` and `# tests 2370`, `# suites 391`, `# pass 2370`, `# fail 0`. **If either
figure differs, stop** — a baseline that is already red cannot tell a new failure from an old one.

- [ ] **Step 2: Record the two superseded figures this change will move.**

```powershell
Select-String -Path README.md,AGENTS.md -Pattern "2370|2298|391" | Select-Object -First 20
```

Expected: the counts appear in `README.md`'s quickstart and in `AGENTS.md`'s status block. Task 11
re-measures them by **running** the suite, never by arithmetic — `AGENTS.md` records five movements of
this figure and the reason each had to be measured.

---

## Task 1: The environment block — schema, plan type, loader

**Files:**
- Modify: `schemas/environment.schema.json` (new block, after `data`, before `health` at `:158`)
- Modify: `core/environment/types.ts` (document spelling, `MobilePlan`, plan field)
- Modify: `core/environment/load.ts` (`readMobile`, construction site)
- Create: `tests/sim-mobile-environment.test.ts` (the loader half only, in this task)

- [ ] **Step 1: Write the failing test first.**

In `tests/sim-mobile-environment.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeEnvironment } from "../core/environment/load.ts";
import { loadSchemaSet } from "../core/schema/registry.ts";
import { memoryIo } from "../core/io.ts";

const SOURCE = { path: "environment.yaml", directory: "." } as never;

function environment(body: Readonly<Record<string, unknown>>): unknown {
  const schemas = loadSchemaSet(memoryIo());
  return finalizeEnvironment(
    { adapter: "sim-mobile", app: "app", start: { command: "node", args: ["provision.mjs"] }, ...body },
    schemas, SOURCE, { networkPolicy: "deny", networkAllowList: [], filesystemWrite: "workspace" } as never,
  );
}

describe("the mobile block", () => {
  it("resolves a declared device, platform and sandbox into the plan", () => {
    const plan = environment({ mobile: { device: "sim-cart-device", platform: "android", root: "device" } }) as never as
      { mobile: { device: string; platform: string; root: string } };
    assert.equal(plan.mobile.device, "sim-cart-device");
    assert.equal(plan.mobile.platform, "android");
    assert.equal(plan.mobile.root.length > 0, true, "a declared sandbox resolves to a path this machine can open");
  });

  it("refuses a platform this world does not stand in for, by naming the list", () => {
    assert.throws(
      () => environment({ mobile: { device: "d", platform: "ios", root: "device" } }),
      /android/,
      "the refusal names MOBILE_PLATFORMS rather than accepting a label nothing acts on",
    );
  });

  it("is null when the document declares no mobile block", () => {
    const plan = environment({}) as never as { mobile: unknown };
    assert.equal(plan.mobile, null);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```powershell
node --test tests/sim-mobile-environment.test.ts
```

Expected: FAIL — the schema rejects `mobile` with `additionalProperties`, and `plan.mobile` is
`undefined`.

- [ ] **Step 3: Add the schema block.**

In `schemas/environment.schema.json`, immediately after the closing brace of the `data` block:

```json
"mobile": {
  "type": ["object", "null"],
  "description": "A device world. A world declaring `mobile` has no url, no cluster, no posix, no os, no cloud, no container, no vscode, no process and no data - exactly as a container world has no mobile.",
  "properties": {
    "device": {
      "type": "string",
      "minLength": 1,
      "description": "The declared device identity, such as `sim-cart-device`. The serial is derived from it rather than stated, because a serial is an identity this world invents."
    },
    "platform": {
      "type": "string",
      "enum": ["android"],
      "description": "The platform the device reports. A list with one member, so a second platform is declared rather than added quietly; a document naming another is refused by a sentence naming this list."
    },
    "root": {
      "type": "string",
      "minLength": 1,
      "description": "The sandbox this world owns, relative to the environment file unless absolute. Everything a command writes lives under here and nowhere else."
    }
  },
  "required": ["device", "platform", "root"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Add the plan type.**

In `core/environment/types.ts`, beside the other world blocks on the document shape (near `:382`),
add the optional spelling; beside `DataPlan` at `:843`, add the plan; beside `:592`, add the field.
Import `MobilePlatform` from `./mobile-observation.ts` — this is legal and is what `:739` already does
for `ContainerPlatform`:

```ts
/**
 * The eleventh world block, and the tenth of the same field.
 *
 * `platform` is narrowed to the observation module's own list rather than accepted as a string, on the
 * same rule `:739` applies to `ContainerPlatform`: it is a value the world acts on, so a label the
 * world cannot stand in for is refused where the operator's document is in hand rather than at the
 * first command.
 */
export interface MobilePlan {
  readonly device: string;
  readonly platform: MobilePlatform;
  /** The sandbox, as this machine spells it. Resolved by the loader, like `appPath`. */
  readonly root: string;
}
```

- [ ] **Step 5: Add `readMobile` to the loader.**

In `core/environment/load.ts`, beside `readData`, and `import { MOBILE_PLATFORMS } from "./mobile-observation.ts";`
beside the existing `CONTAINER_PLATFORMS` import at `:6`. Follow `readContainer`'s shape exactly for
the `platform` validation — its message names the list, in the manner of `load.ts:441`:

```ts
function readMobile(raw: unknown, appPath: string): MobilePlan | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    throw defect("$.mobile", "mobile must be an object naming the device this world stands in for, " +
      "the platform it reports, and the sandbox it owns");
  }
  const device = asString(raw["device"]).trim();
  if (device === "") {
    throw defect("$.mobile.device",
      "the mobile declaration names no device. Every reading this world produces says which device " +
        "it came from, and a device identity is the only thing that answers it - the sandbox path " +
        "cannot, because the same path serves whichever run happens to hold it.");
  }
  const platform = asString(raw["platform"]).trim();
  if (!(MOBILE_PLATFORMS as readonly string[]).includes(platform)) {
    throw defect("$.mobile.platform",
      `this world stands in for ${MOBILE_PLATFORMS.join(" and ")} devices, and the document names ` +
        `${JSON.stringify(platform)}. The platform is a value this world acts on rather than a label, ` +
        "so a platform it does not stand in for is refused here, where the operator's own document is " +
        "in hand, rather than answered with a substitute that silently is not what was asked for.");
  }
  const root = asString(raw["root"]).trim();
  if (root === "") {
    throw defect("$.mobile.root",
      "the mobile declaration names no sandbox. A substitute that has no directory of its own has " +
        "nowhere to install a bundle, and every path a command resolves would be resolved against " +
        "whatever the process happened to be started in.");
  }
  return { device, platform: platform as MobilePlatform, root: resolveSibling({ path: "app", directory: appPath }, root) };
}
```

and at the construction site, after `data: readData(raw["data"]),` at `:773`:

```ts
    mobile: readMobile(raw["mobile"], appPath),
```

> **Note the `resolveSibling` base.** Adjust it to whichever helper the neighbouring readers use for a
> path declared in the environment document — the exact call is a one-line read of `readContainer`
> (`load.ts:412-472`) and must match it, because `AGENTS.md` records a doubled-path defect from exactly
> this seam being resolved twice.

- [ ] **Step 6: Run the test and watch it pass.**

```powershell
node --test tests/sim-mobile-environment.test.ts
```

Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 7: Falsify the refusal.**

Temporarily replace the `MOBILE_PLATFORMS` test with `if (false)`. Run Step 6. Expected: the
`ios` subtest FAILS. Restore the line. **A refusal no input can reach is not a refusal.**

- [ ] **Step 8: Typecheck.**

```powershell
npx tsc --noEmit; Write-Output "tsc exit=$LASTEXITCODE"
```

Expected: `tsc exit=0`.

---

## Task 2: The detector must not ask a device world for a URL

**Files:**
- Modify: `core/clarification/detect.ts` (tenth clause at `:262-272`)
- Modify: `tests/environment-gaps.test.ts` (`NO_HTTP_KEYS` at `:175`; both derived assertions)

**Order is load-bearing.** `AGENTS.md`: *"read the code first, then the test - because the code is the
thing that was right."* The code gains its clause first; the test follows.

- [ ] **Step 1: Add the tenth clause to `hasNoHttp`.**

```ts
    !isMissing(environment.process) ||
    !isMissing(environment.data) ||
    !isMissing(environment.mobile));
```

- [ ] **Step 2: Run the two guard suites and watch them fail.**

```powershell
node --test tests/environment-gaps.test.ts
```

Expected: FAIL — `sim-mobile` is asked `/url` ("was asked /url, and it has no address"), and the
`covered` set no longer matches the nine-world list the test derives.

- [ ] **Step 3: Extend the test, both halves.**

`NO_HTTP_KEYS` at `:175` gains `"mobile"`. The `covered` expectation gains `"sim-mobile"` (sorted
position: after `"sim-k8s"`). `socketWorlds` stays `["local-api", "local-web"]` — the derivation
excludes `sim-mobile` automatically once the key is present, which is the assertion proving the
exclusion is derived rather than omitted.

- [ ] **Step 4: Run it green.**

```powershell
node --test tests/environment-gaps.test.ts
```

Expected: `# fail 0`.

- [ ] **Step 5: Falsify each half independently.**

Delete the detector's tenth clause, leaving the test's tenth key. Run. Expected: FAIL with *"sim-mobile
(sim-mobile) was asked /url, and it has no address"*. Restore. Then delete the test's tenth key,
leaving the detector's clause. Run. Expected: FAIL with *"one registered world per no-HTTP shape, and
the register no longer names them all"*. Restore both, byte for byte.

> The detector clause alone cannot be falsified until `cli/worlds.ts` declares the world (Task 5), so
> run this step **after** Task 5 if the second half reports a pass for the wrong reason.

---

## Task 3: The adapter

**Files:**
- Create: `adapters/sim-mobile/sim-mobile-environment.ts`
- Create: `adapters/sim-mobile/index.ts`
- Modify: `tests/sim-mobile-environment.test.ts` (the adapter half)

- [ ] **Step 1: Read the template, in full, before writing anything.**

```
adapters/sim-posix/sim-posix-environment.ts        (~756 lines - the shape to copy)
adapters/sim-container/sim-container-environment.ts (the two-name env split, :85 and :712-715)
```

- [ ] **Step 2: Write the adapter, modelling `sim-posix-environment.ts` member for member.**

Required members, none optional, because `EnvironmentAdapter` declares them:

| Member | What it does here |
|---|---|
| `create()` | resolve the sandbox root, `mobilePort({ root, contextRoot: plan.appPath, device, platform, processes, confinement })` |
| `start()` | readiness only — this world starts no long-lived service; it prepares the device |
| `deploy()` | `#provisionApplication()`: spawn `start.command`/`start.args` through `runToCompletion` with the `MOBILE_ENV` table and the confinement allowance |
| `execute()` | perform one command vector through the port |
| `observe()` | `port.read()` into `{ kind: "mobile.device", data }` |
| `probe()` | the world's liveness — the device answers `device.ping` |
| `snapshot()` / `restore()` | **refuse by name**, as `sim-posix` and `sim-vscode` do |
| `reset()` | `port.reset()` — rebuilds the world and **keeps the call record and escapes**, per the port's own doc block |
| `stop()` | stop the child; **leave the sandbox** so a bundle can still quote it |
| `destroy()` | remove the sandbox |
| `boundaries()` | `{ network, filesystemWrite: this.#confinement?.applied === true ? "enforced" : "unsupported", crossings }` |

The three refusal constants, each naming the world and the remedy in the established shape:

```ts
const MISSING_MOBILE = "this world has no `mobile` declaration, and the sim-mobile adapter stands in " +
  "for a device - add `mobile: { device, platform, root }` to the environment document, or use an " +
  "adapter whose world is a process on a port";
const MISSING_START_COMMAND = "this world declares no `start.command`, and the sim-mobile adapter " +
  "will not judge a device it did not let the application provision - a device holding whatever an " +
  "earlier run left on it is not the device this contract describes";
const NO_SNAPSHOT = "this world will not photograph itself, and the reason is not an absence: a " +
  "device world holds live child processes and a call record that grows while the run works. " +
  "`restart` rebuilds the sandbox and lets the application provision it again, which is what this " +
  "world can honestly promise";
```

And the seam field, with the comment `sim-container` carries at `:130-140`:

```ts
/**
 * What the **runner** answered about the file allowance this world asked for.
 *
 * Read off the result rather than recomputed here, and that distinction is the whole of the seam:
 * this adapter states *what the world allows*, and only the runner knows what it actually applied.
 */
#confinement: ConfinementResult | null = null;
```

- [ ] **Step 3: Add `MOBILE_ENV` and the front door.**

```ts
export const MOBILE_ENV = {
  sandbox: "VERIDIAN_MOBILE_SANDBOX",     // the world's store as this machine spells it
  workspace: "VERIDIAN_MOBILE_WORKSPACE", // the device path the application's own tree appears at
  device: "VERIDIAN_MOBILE_DEVICE",
  platform: "VERIDIAN_MOBILE_PLATFORM",
} as const;
export const MOBILE_WORKSPACE = "/data/local/tmp/workspace";
```

`adapters/sim-mobile/index.ts` re-exports `SimMobileEnvironment`, `MOBILE_ENV`, `MOBILE_WORKSPACE` —
the shape of `adapters/sim-container/index.ts:16`.

- [ ] **Step 4: Write the adapter's tests, then run them.**

Cover, at minimum: `boundaries().filesystemWrite === "enforced"` after a real provisioning run;
`snapshot()` refuses with `NO_SNAPSHOT`; a reset keeps the call record; `observe()` returns
`kind === "mobile.device"`; `device` and `platform` reach the child through `MOBILE_ENV`.

```powershell
node --test tests/sim-mobile-environment.test.ts
```

Expected: `# fail 0`.

- [ ] **Step 5: Falsify the boundary claim.**

Remove `confinement` from the provisioning request. Re-run. Expected: exactly one named subtest FAILS
and `filesystemWrite` reads `unsupported`. Restore. **"A guard that has never been broken is a guard
nobody has watched work."**

---

## Task 4: The validator family

**Files:**
- Create: `validators/mobile/mobile-validators.ts`
- Create: `validators/mobile/index.ts`
- Create: `validators/mobile/mobile-validators.test.ts`

- [ ] **Step 1: Write the family's twelve validators.**

`device`, `os`, `screen`, `orientation`, `bundle`, `installed`, `permission`, `deeplink`,
`notification`, `logs`, `call`, `probe`. Judge `core/environment/mobile-observation.ts` only — never
import `adapters/*`. Each declares its own `targetNoun` so the clarification ladder asks "which bundle"
rather than "which element".

Model the file on `validators/data/data-validators.ts`, and export the roster constant:

```ts
export const MOBILE_VALIDATOR_NAMES = {
  device: "mobile.device",
  os: "mobile.os",
  screen: "mobile.screen",
  orientation: "mobile.orientation",
  bundle: "mobile.bundle",
  installed: "mobile.installed",
  permission: "mobile.permission",
  deeplink: "mobile.deeplink",
  notification: "mobile.notification",
  logs: "mobile.logs",
  call: "mobile.call",
  probe: "mobile.probe",
} as const;
```

**`deeplink` is spelled without a hyphen, and this plan first spelled it with one.** The roster above
read `deep-link` and `"mobile.deep-link"`, which `acceptance.schema.json` cannot express: it matches a
validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, whose character class admits no hyphen at all, so
that spelling named a criterion no document could ever be written for. It was found while writing the
family's own suite, which now pins `MOBILE_VALIDATOR_NAMES.deepLink` to `"mobile.deeplink"` and carries
the reason at the name.

**The two limits-bearing validators must carry the limit into the value they compare**, exactly as
`container.limit` compares `(declared, not enforced)`. `mobile.screen` compares a rendering that carries
`(recorded, not drawn)`; `mobile.permission` carries `(declared, not prompted)`. A value that omitted
them would say a screen was drawn and a permission was prompted.

- [ ] **Step 2: Write `validators/mobile/index.ts` as a 13-line front door.**

Copy `validators/data/index.ts` verbatim in shape:

```ts
export { MOBILE_VALIDATORS, MOBILE_VALIDATOR_NAMES, mobileValidators } from "./mobile-validators.ts";
```

The doc block states what it does **not** re-export (the substitute), for the reason the other ten
families keep the same door closed.

- [ ] **Step 3: Write the family's suite and run it.**

```powershell
node --test validators/mobile/mobile-validators.test.ts
```

Expected: `# fail 0`. Assert the **roster** first — `registry.names()` against the twelve the module
exports — because that assertion is what caught `db.query` being named in three documents while no
source file mentioned it.

- [ ] **Step 4: Falsify.**

Replace the numeric branch of one comparison with a single text comparison. Re-run. Expected: at least
four named subtests fail, each naming a different property. Restore.

---

## Task 5: Register the world and the family

**Files:**
- Modify: `cli/worlds.ts` (import; `WORLDS` entry)
- Modify: `cli/validators.ts` (import at `:12-22`; spread at `:38-48`)
- Modify: `tests/boundary-roster.test.ts` (only if the walk needs it — see Step 4)

- [ ] **Step 1: Add the `WORLDS` entry.**

```ts
  {
    kind: "sim-mobile",
    summary: "a device world: the application provisions a substitute device and is judged on the " +
      "bundles, permissions, deep links and logs that device holds - no emulator, no guest kernel " +
      "and no hardware anywhere in the loop",
    requires: [
      { field: "mobile.device", reason: "a device has an identity, and a reading says which device it came from" },
      { field: "mobile.platform", reason: "the platform decides which command vocabulary answers" },
      { field: "mobile.root", reason: "the sandbox this world owns, refused rather than defaulted" },
    ],
    build: (context) => { /* destructure and construct, as the neighbours do */ },
  },
```

The `requires` fields are resolved as **pointers**, not literal keys — `AGENTS.md` records the defect
where `cluster.name` was looked for as a key with a dot in its name and three blocking gaps were raised
for values sitting in the file.

- [ ] **Step 2: Add the family to `cli/validators.ts`.**

Import `mobileValidators` beside the other eleven, and spread it in `allValidators()`. The file's own
doc block states the rule: *"a family implemented under `validators/` and never spread here is a family
no run can judge with."*

- [ ] **Step 3: Run the register guard.**

```powershell
node --test tests/boundary-roster.test.ts
```

Expected: `# fail 0`. If it fails, read the failure before editing — the walk selects its population
by the `implements EnvironmentAdapter` needle (`:124`, `:204`), so `sim-mobile-environment.ts` entered
it the moment Task 3 landed and the cross-check at `:220-221` requires the `WORLDS` entry to exist.

- [ ] **Step 4: Re-derive the roster's `confines` question if needed.**

`tests/boundary-roster.test.ts`'s `confines` derivation must read the world's **own answer**
(`boundaries().filesystemWrite`) rather than looking for a `confineChild` call, because after W1 the
mechanism lives in the runner. Confirm it already does; if it does not, this is the edit.

- [ ] **Step 5: Falsify the cross-check.**

Remove the `WORLDS` entry, keeping the adapter. Run. Expected: FAIL naming `sim-mobile`. Restore.

---

## Task 6: The example world

**Files:** Create all eight entries of `examples/sim-mobile/`.

- [ ] **Step 1: Confirm the directory contract.**

```powershell
Get-ChildItem examples/sim-container | Select-Object Name
```

Expected, exactly: `acceptance.yaml`, `app`, `defects.ts`, `demo.ts`, `environment.yaml`, `goal.yaml`,
`repair.ts`, `source.ts`. `sim-mobile` reproduces this set.

- [ ] **Step 2: Write `goal.yaml`, `environment.yaml`, `acceptance.yaml`.**

`environment.yaml` declares `adapter: sim-mobile`, `mobile: { device, platform, root }`, `app`,
`start`, `reset.strategy`, and the boundary limits. **`acceptance.yaml` must carry `goal_id`** — a
contract without one sets `goalId: null`, which makes the cross-goal contradiction guard's live branch
unreachable. That defect was found once already, in `examples/sim-os/acceptance.yaml`.

- [ ] **Step 3: Write the app, then the defect table.**

The application is a Node program that prints command vectors on its stdout; the substitute executes
them. **Four defects, controls before a headline:** D2, D3 and D4 each read by exactly **one** criterion,
so a reader watches one edit move one reading; then D1 moves **several** at once, because it is a single
true fact with several true consequences. That is the `sim-container` lesson verbatim: *a defect table
whose entries all move many criteria has no control in it.*

Every block in `defects.ts` must be re-expressed through `inStyle(block, newlineOf(program))` —
`examples/defect-text.ts` is the one implementation of that rule, and it exists because two demos
injecting defects is two chances to teach it differently.

- [ ] **Step 4: Write `repair.ts`, `demo.ts`, `source.ts`.**

Model on `examples/sim-container/`. The repair agent walks the defect table in array order (the
`repair.ts` rule), so the failing count descends monotonically. The narration asserts the counts the
run itself produces — never a figure written into the demo by hand.

- [ ] **Step 5: Run the demo.**

```powershell
node examples/sim-mobile/demo.ts; Write-Output "exit=$LASTEXITCODE"
```

Expected: `PASS (COMPLETED, N iteration(s))`, all criteria green, `exit=0`.

- [ ] **Step 6: Run it twice, and compare the two progressions.**

A first run that passes and a second that fails is the signature of a **world a run inherited rather
than built** — the `sim-posix` defect that produced a false `PASS` with two criteria reading another
run's file. `prepare()` and `reset()` must be one implementation. If the two run count if
`#rebuild()` is not shared.

- [ ] **Step 7: Write `tests/sim-mobile-demo.test.ts` and falsify it.**

Hold: the `correct` block occurs **exactly once** in the shipped program, and the defeated form
**zero** times, both counted through `occurrences(program, inStyle(block, newlineOf(program)))`. Assert
also that each defect's `criterionId` names a criterion that really moves when the defect is applied —
filed against one that cannot move is the `D4`/`AC-006` defect. Falsify by filing a defect against a
criterion no defect claims; the named subtest must fail.

---

## Task 7: The four-place roster plus the world row

**Files:**
- Modify: `package.json` (a `demo:mobile` script beside `:42-54`)
- Modify: `.github/workflows/ci.yml` (the `for world in` list at `:207`)
- Modify: `README.md` (quickstart fence; layout block roster)
- Modify: `AGENTS.md` (`Running things:` block; layout row; doc index row)
- Modify: `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` (world table row `:769` -> `built`; a demo section)

- [ ] **Step 1: Add the script.**

```json
"demo:mobile": "node examples/sim-mobile/demo.ts",
```

- [ ] **Step 2: Add the world to the CI loop.**

```yaml
for world in db k8s posix os cloud container vscode api local-process data cockpit mobile; do
```

`tests/demo-rosters.test.ts` reads this loop's own world list and unions it with the demos named
literally, discarding any match containing `$`. A world dropped from the loop is a demo no CI job runs
— and four demos were once declared, shipped and documented while nothing executed them.

- [ ] **Step 3: Add the two command blocks.**

`AGENTS.md`'s `Running things:` block and `README.md`'s quickstart fence, both. **Order is not
asserted** by the guard, but both blocks are read, and a command omitted from one is the fourth
recorded occurrence of *a roster that omits a command a reader was promised*.

- [ ] **Step 4: Print the family's roster in `README.md` in full, one name per token.**

`tests/readme-rosters.test.ts` now calls `discoverValidatorFamilies()`, so creating
`validators/mobile/index.ts` makes the family discovered automatically and the guard fails until
`README.md`'s layout block prints `mobile.device, mobile.os, mobile.screen, mobile.orientation,
mobile.bundle, mobile.installed, mobile.permission, mobile.deeplink, mobile.notification, mobile.logs,
mobile.call, mobile.probe` — each matching `/^[a-z0-9]+(\.[a-z0-9]+)+$/`. **Do not use a shorthand**
(`console`/`network`): that is exactly how `web.visible` came to be named by no document at all.

- [ ] **Step 5: Add the layout rows.**

An `adapters/sim-mobile/` row, a `validators/mobile/` row and an `examples/sim-mobile/` row in
`AGENTS.md`'s layout block, and the demo paragraph in `docs/DISTRIBUTION-AND-ENVIRONMENTS.md`. Move the
world table's `sim-mobile` Status cell from `planned` to `**built**, see §7`.

- [ ] **Step 6: Run the roster guards.**

```powershell
node --test tests/demo-rosters.test.ts tests/readme-rosters.test.ts
```

Expected: `# fail 0`.

- [ ] **Step 7: Falsify, one place at a time.**

Delete `demo:mobile` from each of the four places in turn — the manifest, `README.md`, `AGENTS.md`, the
workflow — and confirm each run fails naming **that place and no other**. Restore byte for byte. Then
delete `mobile.probe` from the README's roster and confirm the readme guard names it.

---

## Task 8: The surfaces guard

**Files:**
- Modify: `tests/simulated-surfaces.test.ts` (three extension points, together)
- Modify: `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` (the row's Simulated cell)

- [ ] **Step 1: Extend all three places in one edit.**

The import of `MOBILE_SIMULATED_SURFACES` from `core/environment/mobile-observation.ts`; its `DECLARED`
entry; the document's row with its `Simulated` cell printing the constant's **nine** members verbatim
(`device`, `emulator`, `touch-os`, `display`, `input`, `sandbox`, `keychain-service`, `app-store`,
`push-service`). The row's `Status` cell must already read `**built**` from Task 7.

A loop over a correct list passes for the **wrong** reason right up until a member is missing, and the
second question — *a world the document calls built may not print a backticked surface no constant
declares* — only becomes exercisable for a real world when one becomes built.

- [ ] **Step 2: Run it.**

```powershell
node --test tests/simulated-surfaces.test.ts
```

Expected: `# fail 0`.

- [ ] **Step 3: Falsify.**

Delete `input` from the document row. Expected: FAIL naming it. Restore. Then invent a member
(`` `gpu` ``) into the row. Expected: FAIL naming the invented surface. Restore.

---

## Task 9: The status table's deferred row

**Files:**
- Modify: `docs/IMPLEMENTATION-PLAN.md` (row `:49`, Mobile device-farm)

- [ ] **Step 1: Watch the guard fail first.**

```powershell
node --test tests/implementation-plan-status.test.ts
```

Expected: FAIL — row `:49` says **deferred** while a directory its `why` cell names is now sitting in
the tree. This is the guard working: *"a directory this row names is in the tree."*

- [ ] **Step 2: Move the row.**

The Mobile device-farm row moves to **landed** with the measurement that says so, in the manner of the
Kubernetes and Cloud rows: a `sim-mobile` world, six defects, a passing demo, and no emulator, guest
kernel or hardware anywhere in the loop. Do **not** touch the VM/guest-kernel row — that remains
genuinely deferred and is W6's subject.

- [ ] **Step 3: Run it green.**

```powershell
node --test tests/implementation-plan-status.test.ts
```

Expected: `# fail 0`.

- [ ] **Step 4: Falsify.**

Revert row `:49` to `deferred`. Expected: exactly the third assertion fails. Restore.

---

## Task 10: Prove the clarification mechanism rather than redesign it

**Files:**
- Modify: `tests/runtime-report-slices.test.ts` or add a sibling guard (whichever already reads the
  ambiguity register — read it first and extend, do not duplicate)

This task adds **no mechanism**. `docs/GAP-CLOSURE-DESIGN.md` §5 forbids designing what §2.1-§2.4
measure as already implemented.

- [ ] **Step 1: Read what W5 already holds.**

```
acceptance/ladder/acceptance.yaml
scripts/ladder.mjs
tests/runtime-report-slices.test.ts
```

- [ ] **Step 2: Add the three register assertions, if they are not already there.**

Every `AMBIGUITY_ORIGINS` member reaches a detector in **exactly one** of `allDetectors()` /
`runtimeDetectors()`; every `RUNGS` member is reachable in order; every `DEFER_REASONS` member is
producible. Derive each from the registers, never from a list written beside them.

- [ ] **Step 3: Assert the bound that is the exit.**

`maxSelfPromptRoundsPerAmbiguity` is checked *before* each attempt, so the worst case is a bound already
reached rather than one over. Assert with a port that never resolves, so exhaustion yields
`via: "deferred"` and the run reports `ABORTED` — an unbounded self-prompting loop is the one failure
mode this system may not have.

- [ ] **Step 4: Run, then falsify.**

```powershell
node --test tests/runtime-report-slices.test.ts
```

Then move the per-run cap check *below* the increment and confirm the subtest that names the property
fails, naming it. Restore.

> **Probe discipline this repository paid for four times:** decide each file's line ending from the
> file about to be edited and print what you detected; patch, run, **then** restore (never restore
> first); scrape failing subtests with `^\s*`, not at column zero; and require every declared test title
> to appear in the scraped failing names, because a verdict computed from a reason string the coverage
> never reaches reports the reverse of what happened.

---

## Task 11: The gate, the counts, and the record

- [ ] **Step 1: Run the whole gate.**

```powershell
npx tsc --noEmit; Write-Output "tsc exit=$LASTEXITCODE"
node --test 2>&1 | Select-String -Pattern "^# (tests|suites|pass|fail)"
```

Expected: `tsc exit=0`; `# fail 0`; tests and suites **higher** than Task 0's figures.

- [ ] **Step 2: Re-measure the counts in prose, by running — never by arithmetic.**

Update the figures in `README.md`'s quickstart and `AGENTS.md`'s status block with the numbers Step 1
printed. Then measure the Cockpit's own contribution separately, in `extension/vscode`:

```powershell
cd extension/vscode; node --test 2>&1 | Select-String -Pattern "^# (tests|pass|fail)"; cd ../..
```

and prove the nesting rather than assuming it: search the root run's output for a test title that
exists only in the Cockpit and confirm it appears **twice**. *A decomposition is an arithmetic claim
about two measurements, and it is only as good as the evidence that its two halves are nested rather
than disjoint.*

- [ ] **Step 3: Run every demo this change touched, and the self-acceptance route.**

```powershell
npm run demo:mobile; Write-Output "exit=$LASTEXITCODE"
npm run demo:container; Write-Output "exit=$LASTEXITCODE"
npm run acceptance; Write-Output "exit=$LASTEXITCODE"
```

Expected: `exit=0` three times.

- [ ] **Step 4: Record the change.**

`AGENTS.md` gains, in the layout block and in the rules section: the `sim-mobile` row; the finding that
`core/environment/load.ts` is a **twelfth** additive place a new world must touch (the earlier census
did not count it); and one new rule entry if a defect is found whose generalisation is not already
recorded. Do **not** add a rule the tree already states — `AGENTS.md` holds 40+ and a restatement is
the duplication it warns about.

- [ ] **Step 5: Write the decisions to HipCortex.**

The MCP tools are disabled by the user, so recall and writes go over HTTP
(`POST /memory/add`), and **the disablement is reported** rather than silently skipped. Record: the
scope decision (S7), the three W2 design decisions (S8/S9/S10), the twelfth-place finding, and the
measured outcome of every falsification probe. Actor `Veridian`.

- [ ] **Step 6: Do not commit** unless asked. The tree already holds one large uncommitted change and
no instruction to commit exists.

---

## Self-review of this plan

- **Every additive place is measured, not recalled.** Twelve places, each with a file and an anchor,
  and the twelfth (`load.ts`) is one an earlier census missed — it was found by grepping for the
  reader functions rather than by reading a list, which is the only way it could have been found.
- **Every guard this change trips is named, its failure is expected, and the reason it is expected is
  written down.** A guard that fails until a world supplies what it reads is the guard working.
- **No step writes prose a measurement already carries.** §5's prohibition is honoured: the
  clarification mechanism is proven (Task 10), not redesigned.
- **Two deviations from the skill's defaults are recorded with their reasoning**, and neither is a
  placeholder: the location is a measured convention, and the code-citation rule replaces duplication of
  a template file with a precise pointer to it.

**Known ambiguity, stated rather than hidden:** Task 1 Step 5's `resolveSibling` base and Task 3's
per-member adapter bodies are specified by reference to a neighbouring file rather than by inlined
code, so the implementer must read two files before writing. That is deliberate — re-pasting them would
create the second copy of a rule this repository has paid for three times — but it is the one place
where this plan expects a reader to open the tree.

**User review gate:** pending the operator's return. The operator was unavailable for the third
recorded time, so every decision above was taken under `docs/GAP-CLOSURE-DESIGN.md` §1.1's
recorded-substitution discipline and is auditable by its reasoning rather than only by its result.
