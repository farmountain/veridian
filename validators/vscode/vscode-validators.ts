/**
 * The `vscode.*` validator family - the vocabulary an acceptance criterion uses to judge an extension
 * running in an extension host.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`VSCodeObservationData`) and never starts a host process, never
 * writes a shim, never spawns Node and never sees an adapter. That is why the vocabulary lives in
 * `core/environment/vscode-observation.ts` rather than beside the substitute: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know whether the host was real or stood in for - it
 * can be tested with no world running at all, and it can be re-read from a bundle a year later with
 * nothing installed.
 *
 * The names are therefore `vscode.*` and not `sim-vscode.*`. The criterion is about the extension, not
 * about what stood in for the editor, and the substitution *is* recorded - in the reading's own
 * `simulated` field - because a verdict reached against a substitute has to say so where the verdict is,
 * not in the name of the vocabulary that reached it.
 *
 * ## The four records, and why the family mirrors the split
 *
 * An extension-host reading keeps four kinds of fact apart, and the family keeps them apart too, because
 * each answers a different question with a different repair:
 *
 * - `vscode.host` reads the **world** - which host answered, and at which API version. The one validator
 *   here that judges a fact about the substitute rather than about the software, and it exists for the
 *   reason `container.runtime` and `os.principal` exist: a contract may legitimately pin what it was
 *   judged against, and the answer travels in the bundle so a later reader can check the claim.
 * - `vscode.identity`, `vscode.engine`, `vscode.activation` and `vscode.contribution` read the
 *   **install** - what was put into the host, whether the host admits it, and whether anything answered
 *   when it was asked to start. A manifest that names a module the editor floor cannot load is a defect
 *   in the extension's own packaging, not in its behaviour, and it is read here rather than inferred
 *   from a command that never ran.
 * - `vscode.command`, `vscode.invocation`, `vscode.setting`, `vscode.status`, `vscode.output`,
 *   `vscode.message`, `vscode.state`, `vscode.subscription`, `vscode.file` and `vscode.refusal` read the
 *   **run** - what the extension registered, what it read, what it wrote, what it said, and what it
 *   reached for that this world does not implement.
 * - `vscode.call` and `vscode.probe` read the **action record** - what was asked of the host, and how
 *   that ended, split by *who asked*. The application's own commands are not evidence about the
 *   extension, and this world is the only one where the third party that provisions it is a program the
 *   product is itself asked to run.
 *
 * The split matters most in one pair, and the pair is why the reading carries `runs`. `vscode.activation`
 * answers "did anything answer the event", and it is computed from a real host process per action, so
 * its `runs` figure is a count of host starts rather than a fact about the extension. The cumulative
 * surfaces beside it - `output`, `messages`, `subscriptions` - are a transcript **across** those runs.
 * A criterion that compared any of them to a literal list would be comparing them to a count of host
 * runs, so this family offers no comparison that reads a list as a fixed set: `output` is judged as the
 * text of one channel, `message` as what was said, and `subscription` as whether one handle was
 * released. *A verdict may only claim what its reading observed* - and what these readings observed is
 * a transcript, not a state.
 *
 * ## Status discipline
 *
 * The same branches as the other seven families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the world*: a command that is not
 *   registered, a floor this host does not admit, output that does not carry what was expected.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at: a command the reading does not hold,
 *   a channel the extension never created, a state key nothing was written under, an action the world
 *   never recorded, an API that was never refused.
 * - `ERROR` - the *criterion* is unusable (a target that is not a reference in this family's spelling, a
 *   command id the editor would not accept, a state reference naming a third store) or the world arrived
 *   unreadable. Never `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * ## The guards this world needs beyond the other families
 *
 * - **The verdict test is the engine's status vocabulary, not the presence of a `status` field.**
 *   {@link isAssertion} checks membership in `CRITERION_STATUSES` because `VSCodeCallRecord` carries a
 *   `status` of its own - the exit status the *client* reported - and the obvious `"status" in value`
 *   test would therefore classify every recorded command as an assertion result. The container and
 *   provider families record the same collision from the same cause.
 * - **A command id is the editor's grammar, not this file's neighbours'.** `resolveVSCodeCommandId`
 *   admits `cart.preview-json`; the *validator* naming rule next door would refuse every camel-case id.
 *   The resolver owns that rule and this family quotes its refusal rather than replacing it.
 * - **A setting's *source* is deliberately not a comparison target.** Which of the environment document,
 *   the manifest's default, or nothing answered for a key is a fact about the world's configuration, not
 *   about the extension - and the extension's own question is whether it read the value it was given, not
 *   who supplied it. The source is printed in the sentence a failure report quotes.
 * - **`simulated` is not a comparison target.** A criterion that asserted the reading names `cgroups` or
 *   `window` would be a contract about the substitute rather than about the software, and the field's job
 *   is to travel *with* a verdict rather than to be one. The same rule the container family records about
 *   its own `simulated` list.
 */

import {
  VSCODE_ACTIONS,
  VSCODE_ENGINE_RESULTS,
  VSCODE_OBSERVATION_KIND,
  VSCODE_RESULTS,
  isVSCodeObservationData,
  renderActivation,
  renderCommand,
  renderEngine,
  renderExtension,
  renderFile,
  renderInvocation,
  renderMessage,
  renderOutput,
  renderRefusal,
  renderSetting,
  renderState,
  renderStatus,
  renderSubscription,
  resolveVSCodeChannelName,
  resolveVSCodeCommandId,
  resolveVSCodeFilePath,
  resolveVSCodeSettingKey,
  resolveVSCodeStateRef,
  resolveVSCodeStatusId,
  vscodeCommand,
  vscodeContributionsAt,
  vscodeFile,
  vscodeLastInvocation,
  vscodeOutputChannel,
  vscodeRefusedApi,
  vscodeSetting,
  vscodeStateOf,
  vscodeStateValue,
  vscodeStatusItem,
} from "../../core/environment/vscode-observation.ts";
import type {
  VSCodeCallRecord,
  VSCodeClient,
  VSCodeObservationData,
  VSCodeTargetResult,
} from "../../core/environment/vscode-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  compareWord,
  describe,
  judge,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import { CRITERION_STATUSES } from "../../core/validation/types.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so a name carrying a capital letter is not
 * merely unconventional - it is an acceptance contract that cannot be written at all. The field a
 * reading spells `apiVersion` is judged by a validator named `vscode.engine`, and the one it spells
 * `exitCode` - if this world had one - would be judged by `vscode.exitcode`.
 */
export const VSCODE_VALIDATOR_NAMES = {
  host: "vscode.host",
  identity: "vscode.identity",
  engine: "vscode.engine",
  activation: "vscode.activation",
  contribution: "vscode.contribution",
  command: "vscode.command",
  invocation: "vscode.invocation",
  setting: "vscode.setting",
  status: "vscode.status",
  output: "vscode.output",
  message: "vscode.message",
  state: "vscode.state",
  subscription: "vscode.subscription",
  file: "vscode.file",
  refusal: "vscode.refusal",
  call: "vscode.call",
  probe: "vscode.probe",
} as const;

// ---- reading the document -------------------------------------------------------------------------

/**
 * Whether a value is an `AssertionResult`, judged against the engine's own status vocabulary.
 *
 * Deliberately *not* `"status" in value`, and the difference is not theoretical here: `VSCodeCallRecord`
 * carries `status: number`, so the presence test classifies every recorded command as an assertion
 * result and `vscode.call` would report a verdict it never reached.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  (CRITERION_STATUSES as readonly unknown[]).includes((value as { status?: unknown }).status);

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): VSCodeObservationData | AssertionResult {
  if (isVSCodeObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry an extension-host ` +
      "document, so there is nothing to read. The adapter produced the reading, so this is a defect in " +
      "the environment rather than an extension the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * A resolved target, or the resolver's own reason for refusing it.
 *
 * The refusal is quoted rather than replaced, on the rule every family before this one follows: the
 * *resolver* knows why it refused - an empty command id, a setting key without a dot, a state reference
 * naming a third store - and a validator that wrote one message covering every reason would be naming a
 * cause it never observed.
 */
function resolvedTarget<T>(
  validator: string,
  target: string | null,
  what: string,
  resolve: (spelled: string) => VSCodeTargetResult<T>,
): T | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const resolved = resolve(target);
  if (resolved.kind === "refused") {
    return unusable(validator, target, `The target ${quote(target)} is not read here: ${resolved.reason}.`);
  }
  return resolved.value;
}

/** The messages this world showed, as one spelling, so a report can quote what was said. */
function messagesSpelling(document: VSCodeObservationData): string {
  if (document.messages.length === 0) return "(no messages were shown)";
  return document.messages.map(renderMessage).join("; ");
}

/** The lines one channel holds, or the branch that says it holds none. */
function outputSpelling(document: VSCodeObservationData, channel: string): string | null {
  const found = vscodeOutputChannel(document, channel);
  if (found === null) return null;
  return found.lines.length === 0 ? "(nothing was written to it)" : found.lines.join("\n");
}

/** The channels this world holds, so a "not there" message says what *is* there. */
function channelsSpelling(document: VSCodeObservationData): string {
  if (document.output.length === 0) return "The extension created no output channels at all";
  return `The extension created ${document.output.map((entry) => quote(entry.channel)).join(", ")}`;
}

/** The subscriptions this world holds, so a "not there" message says what *is* there. */
function subscriptionsSpelling(document: VSCodeObservationData): string {
  if (document.subscriptions.length === 0) {
    return "The host was handed no handles at all, so nothing was released and nothing is still held";
  }
  const held = document.subscriptions.filter((entry) => !entry.disposed).length;
  return (
    `The host was handed ${String(document.subscriptions.length)} ` +
    `${document.subscriptions.length === 1 ? "handle" : "handles"}, ` +
    `${String(held)} of which ${held === 1 ? "is" : "are"} still held`
  );
}

/** The values one store holds, so a "not there" message says what *is* there. */
function stateSpelling(document: VSCodeObservationData, scope: "global" | "workspace"): string {
  const entries = vscodeStateOf(document, scope);
  const store = scope === "global" ? "globalState" : "workspaceState";
  if (entries.length === 0) return `${store} holds nothing at all`;
  return `${store} holds ${entries.map((entry) => quote(entry.key)).join(", ")}`;
}

// ---- the action record, split by who asked --------------------------------------------------------

/**
 * The newest record naming an action, issued by one client, or the branch that says why there is none.
 *
 * The **newest** is judged, for the same reason `container.call` judges the newest: the record is a
 * chronological log, and an action the world refused on an early iteration and performed after a repair
 * is an action that works now. The reading is per-observation, so the earlier iteration's record is
 * judged by the earlier iteration's criterion.
 *
 * Three absences, three sentences, because they are three different situations: nothing named the target
 * at all; only somebody else issued it; and - the case that makes the `action: null` design worthwhile -
 * the world does not implement the command, so its record carries the command line and no action name.
 * A target therefore matches either an action name or a command line, which is the only way a contract
 * can assert that the world refused something it does not serve.
 */
function callBy(
  validator: string,
  target: string,
  document: VSCodeObservationData,
  client: VSCodeClient,
  other: readonly [name: string, described: string],
): VSCodeCallRecord | AssertionResult {
  const matches = document.calls.filter((call) => call.action === target || call.command === target);
  if (matches.length === 0) {
    const known = [...new Set(document.calls.map((call) => call.action ?? call.command))];
    const held = known.length === 0 ? "no commands at all" : known.map(quote).join(", ");
    return unanswered(
      validator,
      target,
      `The world recorded no command naming ${quote(target)} at all, so there is nothing to judge. ` +
        "This is the absence of a record rather than a command that failed: a command that ran and " +
        "exited non-zero is judged here, and so is a command the world refused. The record holds " +
        `${held}.`,
    );
  }
  const mine = matches.filter((call) => call.client === client);
  const last = mine[mine.length - 1];
  if (last === undefined) {
    const issued = [...new Set(matches.map((call) => call.client))].join(", ");
    return unanswered(
      validator,
      target,
      `Every recorded command naming ${quote(target)} was issued by ${issued}, and this validator ` +
        `reads only the commands issued by ${client}. Those are different questions with different ` +
        `validators - ${quote(other[0])} is the one that reads the commands issued by ${other[1]} - ` +
        "and a criterion's own command is not evidence about the application.",
    );
  }
  return last;
}

// ---- comparisons against a closed vocabulary -----------------------------------------------------

const compareEngineResult = compareWord(VSCODE_ENGINE_RESULTS, "whether this host admits the floor");
const compareInvocationResult = compareWord(VSCODE_RESULTS, "how an invocation ended");
const compareCallResult = compareWord(VSCODE_RESULTS, "the result of a command");

// ---- the family -----------------------------------------------------------------------------------

/**
 * The host identity the environment document declared.
 *
 * The one validator here that judges a fact about the **world**. A criterion asserting
 * `equals: "veridian-vscode-sim"` says "these criteria are about that host", and the answer travels in
 * the bundle's own reading so a later reader can check the claim rather than take it. The API version
 * and the sandbox are printed in the sentence a failure report quotes, because both are facts about this
 * machine's copy of the world rather than about the extension.
 *
 * It needs no target, because there is exactly one host per reading - the same shape `container.runtime`
 * uses for the one runtime a run observed.
 */
const host: Validator = {
  name: VSCODE_VALIDATOR_NAMES.host,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, host.name, null);
    if (isAssertion(document)) return document;
    return judge(
      host.name,
      null,
      `the host identity the environment document declared (${quote(document.host)} answering as API ` +
        `${document.apiVersion}, holding its sandbox at ${quote(document.sandbox)})`,
      document.host,
      raw,
      compareText,
    );
  },
};

/**
 * The extension this world has installed, as its own manifest declares it.
 *
 * Judged as the reading's own rendering - `cart-web 1.0.0, entry "extension.js"` - rather than as one
 * field, because a criterion asking what was installed is asking about the identity and the version
 * together, and a target is one string. `contains: "cart-web 1.0.0"` is the natural spelling and
 * `equals` asks for the whole line, which is what `container.tag` does with an image's tag list.
 *
 * It is the sibling of `vscode.engine` rather than a duplicate of it: a manifest can be installed and
 * refused, in which case this validator reports what the manifest said and `vscode.engine` reports that
 * the host would not take it.
 */
const identity: Validator = {
  name: VSCODE_VALIDATOR_NAMES.identity,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, identity.name, null);
    if (isAssertion(document)) return document;
    return judge(
      identity.name,
      null,
      "the extension this world holds, as its own manifest declares it",
      renderExtension(document.extension),
      raw,
      compareText,
    );
  },
};

/**
 * Whether this host admits the `engines.vscode` floor the extension declared.
 *
 * Computed when the extension was installed, never asserted, and this validator judges the *answer*
 * rather than re-deriving it - the range grammar lives in the substitute, so a second implementation
 * here would be a second answer to one question.
 *
 * `admitted` and `refused` are a closed vocabulary, so a criterion spelling a third word is reported as
 * a contract that cannot be read rather than as a comparison that is always false. That distinction is
 * the dangerous one: an always-false comparison is indistinguishable from an application defect and
 * sends an agent to repair working code.
 *
 * A world holding no extension reports `refused` with `declared: null`, which is the honest answer -
 * nothing declared a floor, so nothing was admitted - and the reason travels in the sentence.
 */
const engine: Validator = {
  name: VSCODE_VALIDATOR_NAMES.engine,
  needsTarget: false,
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, engine.name, null);
    if (isAssertion(document)) return document;
    return judge(
      engine.name,
      null,
      `the extension's declared engine floor against this host (${renderEngine(document.engine)})`,
      document.engine.result,
      raw,
      compareEngineResult,
    );
  },
};

/**
 * Whether anything answered the activation event, and what the host did when it tried.
 *
 * The extension's `activate` ran in a real Node process; `activated` is what that process reported, and
 * an `activate` that threw comes back as `activated: false` with the error in the sentence rather than
 * as a failure of this world. `runs` counts host starts - one per acting observation - and is printed
 * rather than judged, because it is a fact about this world's design rather than about the extension.
 *
 * `equals` accepts `true`, `false`, `"present"` and `"absent"`, on the same rule `web.element` follows:
 * "the extension activated" is a sentence an author writes, and `equals: true` is how it is spelled.
 */
const activation: Validator = {
  name: VSCODE_VALIDATOR_NAMES.activation,
  needsTarget: false,
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, activation.name, null);
    if (isAssertion(document)) return document;
    return judge(
      activation.name,
      null,
      `whether this host started the extension (${renderActivation(document.activation)})`,
      document.activation.activated,
      raw,
      comparePresence,
    );
  },
};

/**
 * The contribution points a manifest declares one id under.
 *
 * Judged as `point "title"` per declaration, joined by `; `, so one comparison answers both halves of
 * the question a criterion actually asks: `contains: "commands"` asks whether the id reaches the
 * palette, and `contains: "Add an item"` asks what the palette calls it. `(not declared)` is the
 * spelling for an id no contribution point names, which is a `FAIL` against `equals` and a `PASS`
 * against `contains: "commands"` only if the id is really there - which is the property a contract
 * wants.
 *
 * The target is the contribution **id** rather than a `point/id` pair, because an id declared under two
 * points is one fact about the manifest with two answers, and a reference grammar would force a
 * criterion to ask half of it.
 */
const contribution: Validator = {
  name: VSCODE_VALIDATOR_NAMES.contribution,
  needsTarget: true,
  targetNoun: "contribution id as the manifest declares it (`cart.add`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, contribution.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(contribution.name, "a contribution id as the manifest declares it (`cart.add`)");
    }
    const entries = collectContributions(document, target);
    const spelled =
      entries.length === 0
        ? "(not declared)"
        : entries
            .map((entry) => `${entry.point} ${entry.title === null ? "(no title)" : describe(entry.title)}`)
            .join("; ");
    return judge(
      contribution.name,
      target,
      `what the manifest contributes under the id ${quote(target)}`,
      spelled,
      raw,
      compareText,
    );
  },
};

/**
 * Every contribution entry naming one id.
 *
 * The reading's lookup is by point, so the id-first question is answered by collecting across the
 * points the reading declares rather than by adding a second lookup beside the first - one fact, one
 * place to read it.
 */
function collectContributions(
  document: VSCodeObservationData,
  id: string,
): readonly { readonly point: string; readonly title: string | null }[] {
  const points = [...new Set(document.contributions.map((entry) => entry.point))].sort();
  return points.flatMap((point) =>
    vscodeContributionsAt(document, point)
      .filter((entry) => entry.id === id)
      .map((entry) => ({ point: entry.point, title: entry.title })),
  );
}

/**
 * Whether a command is registered with the host, and where it came from.
 *
 * The most-asked question in the run half of the family: a command declared in the manifest and never
 * registered is the shape of an `activate` that returned early, and a command registered and not
 * declared is the shape of one a user can never reach. The subject carries both - `renderCommand`
 * prints `registered`, `declared in the manifest` and `disposed`, plus the title - so a failure report
 * says which of the two went wrong rather than only that the answer was `false`.
 *
 * A command the reading does not hold is `INCONCLUSIVE` naming `vscode.contribution`: whether the
 * manifest declares it at all is a different question with a different repair, and reporting "not
 * registered" for a command nothing ever declared would send an agent to the registration code for a
 * defect in the manifest.
 */
const command: Validator = {
  name: VSCODE_VALIDATOR_NAMES.command,
  needsTarget: true,
  targetNoun: "command id as the editor spells it (`cart.add`, `cart.preview-json`)",
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, command.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const id = resolvedTarget(
      command.name,
      targetOf(raw),
      "a command id as the editor spells it (`cart.add`)",
      resolveVSCodeCommandId,
    );
    if (isAssertion(id)) return id;
    const found = vscodeCommand(document, id);
    if (found === null) {
      const held = document.commands.map((entry) => quote(entry.id));
      return unanswered(
        command.name,
        id,
        `The host holds no command ${quote(id)}, so there is nothing to judge. Whether the manifest ` +
          `declares it at all is a different question with a different repair, and it is what ` +
          `${quote(VSCODE_VALIDATOR_NAMES.contribution)} reads. The host holds ` +
          `${held.length === 0 ? "no commands at all" : held.join(", ")}.`,
      );
    }
    return judge(
      command.name,
      id,
      `whether the host holds a registration for ${renderCommand(found)}`,
      found.registered,
      raw,
      comparePresence,
    );
  },
};

/**
 * How the newest invocation of a command ended.
 *
 * The newest, not the first, for the reason `container.call` gives: an invocation the host answered
 * `absent` on an early iteration and `answered` after a repair is a command that works now, and each
 * iteration is judged by its own reading.
 *
 * `answered`, `absent`, `refused` and `failed` are four different repairs - the command ran, no
 * registration existed for it, the world declined to serve the request, and the command itself threw -
 * so the vocabulary is closed and a criterion spelling a fifth word is a contract that cannot be read.
 *
 * **By whom is printed rather than judged.** An invocation is one event with one result, and this
 * validator reads the newest of them whoever asked. A contract that must distinguish the parties reads
 * `vscode.call` or `vscode.probe`, which are split by client because the action record is where the
 * reading keeps the parties apart.
 */
const invocation: Validator = {
  name: VSCODE_VALIDATOR_NAMES.invocation,
  needsTarget: true,
  targetNoun: "command id as the editor spells it (`cart.add`)",
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, invocation.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const id = resolvedTarget(
      invocation.name,
      targetOf(raw),
      "a command id as the editor spells it (`cart.add`)",
      resolveVSCodeCommandId,
    );
    if (isAssertion(id)) return id;
    const found = vscodeLastInvocation(document, id);
    if (found === null) {
      const held = document.invocations.map((entry) => quote(entry.command));
      return unanswered(
        invocation.name,
        id,
        `Nothing invoked ${quote(id)} in this world, so there is nothing to judge. An invocation this ` +
          "host answered, and one it reported as absent, both appear here; a command that was never " +
          "asked for does not. The reading holds " +
          `${held.length === 0 ? "no invocations at all" : held.join(", ")}.`,
      );
    }
    return judge(
      invocation.name,
      id,
      `how the newest invocation of ${quote(id)} ended (${renderInvocation(found)})`,
      found.result,
      raw,
      compareInvocationResult,
    );
  },
};

/**
 * The value the extension read from its configuration.
 *
 * Judged against the value, with the *source* printed in the sentence rather than offered as a
 * comparison: which of the environment document, the manifest's default, or nothing supplied a value is
 * a fact about this world's configuration, and the extension's own question is whether it read what it
 * was given.
 *
 * A key the extension never read is `INCONCLUSIVE` rather than `FAIL`. "The extension read the wrong
 * limit" and "the extension never read a limit" are different defects with different repairs, and the
 * second is an absence of an observation rather than a wrong one.
 */
const setting: Validator = {
  name: VSCODE_VALIDATOR_NAMES.setting,
  needsTarget: true,
  targetNoun: "settings key as the manifest declares it (`cart-web.limit`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, setting.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const key = resolvedTarget(
      setting.name,
      targetOf(raw),
      "a settings key as the manifest declares it (`cart-web.limit`)",
      resolveVSCodeSettingKey,
    );
    if (isAssertion(key)) return key;
    const found = vscodeSetting(document, key);
    if (found === null) {
      const held = document.settings.map((entry) => quote(entry.key));
      return unanswered(
        setting.name,
        key,
        `The extension never read the setting ${quote(key)}, so there is nothing to judge. This is ` +
          `the absence of a read rather than a value read wrongly. The reading holds ` +
          `${held.length === 0 ? "no settings reads at all" : held.join(", ")}.`,
      );
    }
    return judge(
      setting.name,
      key,
      `the value the extension read for (${renderSetting(found)})`,
      found.value === null ? "(nothing)" : found.value,
      raw,
      compareText,
    );
  },
};

/**
 * What a status bar item says.
 *
 * Judged against the item's `text`, with visibility, alignment, tooltip and the command it runs printed
 * in the sentence. `text` is what a user reads and what an extension gets wrong, so it is the fact worth
 * comparing; the rest is the context that tells a reader whether the item was ever on screen.
 *
 * An item the reading does not hold is `INCONCLUSIVE`: an extension can create a status item and never
 * call `show()`, and an item that was created and hidden is read here rather than being indistinguishable
 * from one that was never created.
 */
const status: Validator = {
  name: VSCODE_VALIDATOR_NAMES.status,
  needsTarget: true,
  targetNoun: "status bar id the extension created it with (`cart.status`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, status.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const id = resolvedTarget(
      status.name,
      targetOf(raw),
      "a status bar id the extension created it with (`cart.status`)",
      resolveVSCodeStatusId,
    );
    if (isAssertion(id)) return id;
    const found = vscodeStatusItem(document, id);
    if (found === null) {
      const held = document.status.map((entry) => quote(entry.id));
      return unanswered(
        status.name,
        id,
        `The extension created no status bar item ${quote(id)}, so there is nothing to judge. An item ` +
          "it created and never showed still appears here, with `hidden`, so this is the absence of an " +
          `item rather than one that is off screen. The reading holds ` +
          `${held.length === 0 ? "no status items at all" : held.join(", ")}.`,
      );
    }
    return judge(
      status.name,
      id,
      `what the status bar item says (${renderStatus(found)})`,
      found.text,
      raw,
      compareText,
    );
  },
};

/**
 * Everything one output channel holds.
 *
 * Judged as the channel's lines joined by newlines, so `contains` asks whether a line was written and
 * `equals` asks for the whole transcript in the order it was written. The line count and whether anybody
 * looked at the channel are printed in the sentence, because "the extension wrote the right thing to a
 * channel nobody ever opened" is a different defect from the same text in a channel a user saw.
 *
 * The transcript is cumulative across host runs - one host process per action, each of which activates
 * the extension - so the count grows with the run's own actions rather than being a fixed number. A
 * criterion should ask whether a line is *there*, or what the newest one is, and never that a channel
 * holds exactly N lines: that would be a contract about how many times this world started a host.
 */
const output: Validator = {
  name: VSCODE_VALIDATOR_NAMES.output,
  needsTarget: true,
  targetNoun: "output channel name the extension created it with (`Cart`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, output.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const channel = resolvedTarget(
      output.name,
      targetOf(raw),
      "an output channel name the extension created it with (`Cart`)",
      resolveVSCodeChannelName,
    );
    if (isAssertion(channel)) return channel;
    const spelled = outputSpelling(document, channel);
    if (spelled === null) {
      return unanswered(
        output.name,
        channel,
        `The extension created no output channel ${quote(channel)}, so there is nothing to judge. ` +
          `${channelsSpelling(document)}.`,
      );
    }
    const found = vscodeOutputChannel(document, channel);
    const subject = found === null ? quote(channel) : `what the channel holds (${renderOutput(found)})`;
    return judge(output.name, channel, subject, spelled, raw, compareText);
  },
};

/**
 * What the extension told a user who does not exist.
 *
 * No target, because the question is what was said rather than about which object: the reading is one
 * list of `level: message` renderings joined by `; `, and `contains: "warning: added 1"` is the sentence
 * a criterion writes. An extension that showed nothing yields `(no messages were shown)`, which is a
 * `FAIL` against any `contains` and the honest answer.
 *
 * The list is cumulative across host runs, on the same rule the output channels follow, so a criterion
 * asserting the *whole* list would be asserting how many hosts this world started.
 */
const message: Validator = {
  name: VSCODE_VALIDATOR_NAMES.message,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, message.name, null);
    if (isAssertion(document)) return document;
    return judge(
      message.name,
      null,
      "what the extension told a user, as the host recorded it",
      messagesSpelling(document),
      raw,
      compareText,
    );
  },
};

/**
 * The value stored under one key in one store.
 *
 * The target is `<global|workspace>/<key>` rather than a bare key, because this world has two stores and
 * an extension may use the same key in both - "the value stored under `cart.items`" is not a question
 * this world can answer. The reading's own resolver owns that grammar and this validator quotes its
 * refusal.
 *
 * Durable state is the one surface genuinely shared between host processes, which is why it is the
 * surface to read when the question is persistence and why it survives both an install and a reload.
 */
const state: Validator = {
  name: VSCODE_VALIDATOR_NAMES.state,
  needsTarget: true,
  targetNoun: 'a store and a key, as "<global|workspace>/<key>"',
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, state.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = resolvedTarget(
      state.name,
      targetOf(raw),
      'a store and a key, as "<global|workspace>/<key>"',
      resolveVSCodeStateRef,
    );
    if (isAssertion(ref)) return ref;
    const found = vscodeStateValue(document, ref.scope, ref.key);
    if (found === null) {
      return unanswered(
        state.name,
        targetOf(raw),
        `Nothing was written under ${quote(ref.key)} in that store, so there is no value to judge. ` +
          `${stateSpelling(document, ref.scope)}.`,
      );
    }
    return judge(
      state.name,
      targetOf(raw),
      `the value stored under ${renderState(found)}`,
      found.value === null ? "(nothing)" : found.value,
      raw,
      compareText,
    );
  },
};

/**
 * Whether one handle the host was given was released.
 *
 * `equals: false` is the leak check an extension's `deactivate` owes: a handle still held after the
 * extension was reloaded is a registration that outlived the code that made it. The kind is printed in
 * the sentence because "a command is still registered" and "an output channel is still open" are
 * different leaks with different repairs, and the reading keeps them apart rather than folding them into
 * one spelling.
 */
const subscription: Validator = {
  name: VSCODE_VALIDATOR_NAMES.subscription,
  needsTarget: true,
  targetNoun: "the id of a handle the extension was given (`cart.add`)",
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, subscription.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(subscription.name, "the id of a handle the extension was given (`cart.add`)");
    }
    const found = document.subscriptions.find((entry) => entry.id === target) ?? null;
    if (found === null) {
      return unanswered(
        subscription.name,
        target,
        `The host was never handed a handle with the id ${quote(target)}, so there is nothing to ` +
          `judge. Only handles an extension hands to the context appear here; a listener it creates and ` +
          `never pushes is invisible to this reading, and that is the world's own limit rather than a ` +
          `fact about the extension. ${subscriptionsSpelling(document)}.`,
      );
    }
    return judge(
      subscription.name,
      target,
      `whether the handle was released (${renderSubscription(found)})`,
      found.disposed,
      raw,
      comparePresence,
    );
  },
};

/**
 * How large a file in the workspace is.
 *
 * The workspace folder is the one directory a criterion can see files in, and `bytes` is the fact worth
 * comparing: "the extension wrote a report" is `atLeast: 1` and "and it wrote the right one" is a size a
 * contract can pin. Reading the *contents* is what `posix.contents` and `os.contents` do for their
 * worlds and it is deliberately absent here: this world's reading lists what the extension touched, and
 * a validator that re-read the bytes would be reading this machine rather than the reading.
 *
 * A path the reading does not hold is `INCONCLUSIVE`. The reading's own resolver refuses a backslash, a
 * root and a `..` segment, so a criterion cannot step out of the workspace folder by naming a path.
 */
const file: Validator = {
  name: VSCODE_VALIDATOR_NAMES.file,
  needsTarget: true,
  targetNoun: "a path relative to the workspace folder, with forward slashes (`report.json`)",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, file.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const path = resolvedTarget(
      file.name,
      targetOf(raw),
      "a path relative to the workspace folder, with forward slashes (`report.json`)",
      resolveVSCodeFilePath,
    );
    if (isAssertion(path)) return path;
    const found = vscodeFile(document, path);
    if (found === null) {
      const held = document.files.map((entry) => quote(entry.path));
      return unanswered(
        file.name,
        path,
        `The workspace holds no file ${quote(path)}, so there is nothing to measure. This is the ` +
          `absence of a file rather than an empty one. The reading holds ` +
          `${held.length === 0 ? "no files at all" : held.join(", ")}.`,
      );
    }
    return judge(
      file.name,
      path,
      `the size of the file the extension touched (${renderFile(found)})`,
      found.bytes,
      raw,
      compareCounts,
    );
  },
};

/**
 * The API this world does not implement, and why it refused it.
 *
 * `vscode.env`, `workspace.openTextDocument` and `workspace.findFiles` are deliberately absent from the
 * substitute, and a bare `undefined` would make the extension's call throw a `TypeError` that reads like
 * a bug in the extension. So the substitute refuses **by name** and records what it refused, which makes
 * "the extension reaches for an API this world does not offer" an observation rather than a crash.
 *
 * Judged against the *reason*, because "it was refused" is the same sentence for every cause and the
 * cause is what a reader needs. A criterion asserting `contains: "not implemented"` checks the world's
 * own answer; `equals` on the whole reason pins the spelling, which is what a contract about the
 * substitute should do when it wants to be exact.
 *
 * An API that was never refused is `INCONCLUSIVE`. The reading records refusals, not successful API
 * uses, so "there is no record of a refusal" is not evidence that the extension avoided the API - and
 * reporting it as a `PASS` would be a verdict this reading cannot justify.
 */
const refusal: Validator = {
  name: VSCODE_VALIDATOR_NAMES.refusal,
  needsTarget: true,
  targetNoun: "an API this world does not implement, as the host spells it (`vscode.env`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, refusal.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        refusal.name,
        "an API this world does not implement, as the host spells it (`vscode.env`)",
      );
    }
    const found = vscodeRefusedApi(document, target);
    if (found === null) {
      const held = [...new Set(document.refusals.map((entry) => entry.api))];
      return unanswered(
        refusal.name,
        target,
        `Nothing in this world was refused for asking for ${quote(target)}, so there is nothing to ` +
          "judge. This reading records refusals and not successful uses, so the absence of a record is " +
          "not evidence that the extension avoided the API - it is the absence of an observation, which " +
          "is a different thing from a clean one. " +
          (held.length === 0
            ? "This world refused nothing at all"
            : `This world refused ${held.map(quote).join(", ")}`),
      );
    }
    return judge(
      refusal.name,
      target,
      `why this world refused the API (${renderRefusal(found)})`,
      found.reason,
      raw,
      compareText,
    );
  },
};

/**
 * How the newest command the **application** issued to this world ended.
 *
 * The target is an action name or a command line. The second is what makes the `action: null` record
 * reachable: a command this world does not implement has no action name to be keyed by, so a contract
 * could otherwise never observe that the world refused it.
 *
 * The client is the *provisioner* - the program the world was asked to run, which installs the extension
 * and activates it. Its commands are issued by code that is not the extension under test, so this
 * validator is the one that asks "did the application do what it was supposed to do", which is a
 * different question from "does the extension work".
 */
const call: Validator = {
  name: VSCODE_VALIDATOR_NAMES.call,
  needsTarget: true,
  targetNoun:
    "action name as the world records it (`install`, `activate`), or a command line the world does not implement",
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, call.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        call.name,
        `an action name (one of ${VSCODE_ACTIONS.map((action) => quote(action)).join(", ")})`,
      );
    }
    const found = callBy(call.name, target, document, "provisioner", [
      VSCODE_VALIDATOR_NAMES.probe,
      "the criterion",
    ]);
    if (isAssertion(found)) return found;
    return judge(
      call.name,
      target,
      `the result of the newest command naming ${quote(target)} that the application issued` +
        (found.action === null
          ? " (this world does not implement it, so the record carries the command line rather than an action name)"
          : ` (${describe(found.command)})`),
      found.result,
      raw,
      compareCallResult,
    );
  },
};

/**
 * How the criterion's *own* command to this world ended.
 *
 * A separate validator, not a qualifier on `vscode.call`, and the separation is the point: a criterion
 * that issued a command is asking what the *world* did, not what the application did. Judging either
 * through the other would let a run pass on the strength of the run's own questions, which is the false
 * pass this whole product exists to refuse.
 */
const probe: Validator = {
  name: VSCODE_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "action name, or a command line, as the criterion named it",
  comparisons: ["equals"],
  observationKind: VSCODE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        probe.name,
        `an action name (one of ${VSCODE_ACTIONS.map((action) => quote(action)).join(", ")})`,
      );
    }
    const found = callBy(probe.name, target, document, "criterion", [
      VSCODE_VALIDATOR_NAMES.call,
      "the application",
    ]);
    if (isAssertion(found)) return found;
    return judge(
      probe.name,
      target,
      `the result of the newest command naming ${quote(target)} that the criterion issued` +
        ` (${describe(found.command)})`,
      found.result,
      raw,
      compareCallResult,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const VSCODE_VALIDATORS: readonly Validator[] = Object.freeze([
  host,
  identity,
  engine,
  activation,
  contribution,
  command,
  invocation,
  setting,
  status,
  output,
  message,
  state,
  subscription,
  file,
  refusal,
  call,
  probe,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function vscodeValidators(): Validator[] {
  return [...VSCODE_VALIDATORS];
}
