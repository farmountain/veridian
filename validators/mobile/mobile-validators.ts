/**
 * The `mobile.*` validator family - the vocabulary an acceptance criterion uses to judge a handset.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`MobileObservationData`) and never starts a process, never opens a
 * bundle, never talks to a device and never sees an adapter. That is why the vocabulary lives in
 * `core/environment/mobile-observation.ts` rather than beside the substitute: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know whether the handset was real or stood in for - it
 * can be tested with no world running at all, and it can be re-read from a bundle a year later with
 * nothing installed.
 *
 * The names are therefore `mobile.*` and not `sim-mobile.*`. The criterion is about the handset, not
 * about what stood in for it, and the substitution *is* recorded - in the reading's own `simulated`
 * field - because a verdict reached against a substitute has to say so where the verdict is, not in the
 * name of the vocabulary that reached it.
 *
 * ## The four records, and why the family mirrors the split
 *
 * A mobile reading keeps four kinds of fact apart, and the family keeps them apart too, because each
 * answers a different question with a different repair:
 *
 * - `mobile.device`, `mobile.os`, `mobile.screen` and `mobile.orientation` read the **handset** - the
 *   thing the worlds stand in for, and the only four members of this family that name no target at all.
 * - `mobile.bundle` and `mobile.installed` read the **store** - what was installed, and what one bundle
 *   says about itself. They are deliberately two questions: `installed` asks what is on the device,
 *   `bundle` asks what one record holds. A world that answered both from one reading could not express
 *   "it is gone, and this is what it was".
 * - `mobile.permission`, `mobile.deeplink`, `mobile.notification` and `mobile.logs` read **what the
 *   application did while it ran** - the grants it holds, the routes it registered, what it posted and
 *   what it printed. Each is a different object with a different repair.
 * - `mobile.call` and `mobile.probe` read the **action record** - what was asked of the device, and how
 *   that ended.
 *
 * ## Status discipline
 *
 * The same branches as the other eleven families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the world*: a bundle in the wrong
 *   state, a grant that is `denied`, a notification that was never delivered, output that does not
 *   contain what was expected.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at: a bundle the device does not hold,
 *   a permission that bundle never declared, a deep link nothing registered, a notification position
 *   past the end of a bundle's list, a stream no launch ever wrote, an action the world never recorded.
 * - `ERROR` - the *criterion* is unusable (a target that is not a reference in this family's spelling, a
 *   URI where an id was wanted, a comparison against the wrong vocabulary) or the world arrived
 *   unreadable. Never `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * ## The limits this world states, carried into the value rather than beside it
 *
 * This world stands a handset in, and it says so in four of its renderings rather than in a paragraph
 * alone. The rule is `container.limit`'s and `container.port`'s, one family out: *a substitution that is
 * honest about its own boundary has to carry that honesty into the comparison, because dropping it turns
 * a true reading into a false claim.*
 *
 * - `mobile.screen` compares a string carrying `(rendered and never drawn)`. Without it a criterion
 *   pinning the geometry would be asserting a screen this world drew.
 * - `mobile.permission` compares a string carrying `(declared by the bundle, ...)` and `... never
 *   prompted for`. Without them a criterion would be asserting that a manifest declared a grant and that
 *   somebody consented, neither of which the reading observed.
 * - `mobile.deeplink` compares a string carrying `(opened N time(s), resolved, no bundle launched)`.
 *   Without it a criterion would be asserting that resolving a URI started a program.
 * - `mobile.notification` compares a string carrying `(queued, never delivered)`. Without it a criterion
 *   would be asserting that a push service carried something.
 * - `mobile.keychain` has the same shape - `(..., value not recorded)` - and is reachable through the
 *   reading's own keychain entries rather than through a validator of its own; see the last section.
 *
 * Every one of those parentheticals is *computed from fields*, never written as a constant, so a world
 * that did draw a screen or deliver a notification would say so and the comparison would follow it.
 *
 * ## The guards this world needs beyond the other families
 *
 * - **The verdict test is the engine's status vocabulary, not the presence of a `status` field.**
 *   {@link isAssertion} checks membership in `CRITERION_STATUSES` because `MobileCallRecord` carries a
 *   `status` of its own - the device's answer to the command - and the obvious `"status" in value` test
 *   would therefore classify every recorded command as an assertion result, so `mobile.call` would report
 *   a verdict it never reached. This is the third family in this tree to carry that collision by
 *   construction rather than by accident.
 * - **Five target grammars, and the *validator* chooses between them rather than the spelling.** A bundle
 *   id is an id, `<bundle>/<permission>` is a scope, `<bundle>#<position>` is an id and a position, a
 *   deep link is a whole URI, and an action name is a member of a closed vocabulary. Flattening them
 *   into one grammar would force every criterion to type a prefix its subject does not need - and would
 *   let a mistyped URI resolve as a bundle id. Each validator therefore resolves through the reader
 *   written for its own kind, and quotes the resolver's own reason when the target is refused.
 * - **A fact the reading disowns is not judged.** `MobileDeviceReading` records `boots` and a bundle
 *   records `launches`; neither is a comparison target here, because a count of how many times a
 *   substitute was asked to do something is a fact about the substitute's life rather than about the
 *   application.
 * - **The word `mobile.deeplink` is one word on purpose.** `acceptance.schema.json` matches a validator
 *   name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, which admits no hyphen at all - so `mobile.deep-link` is
 *   not merely unconventional, it is an acceptance contract that cannot be written. `container.exitcode`
 *   carries the same note for the same reason.
 *
 * ## What this family deliberately does not judge
 *
 * Recorded rather than left implied, because a gap nobody wrote down is discovered as a bug:
 *
 * - **Anything about the substitution itself.** `simulated` is not a comparison target. A criterion that
 *   asserted `simulated` contains `push-service` would be a contract about the substitute rather than
 *   about the software, and the field's job is to travel *with* a verdict rather than to be one.
 * - **A boot count, a launch count, a file count as a standalone question, a bundle's `dataDir`, its
 *   `command` and its `sizeBytes` in isolation.** Each is either a consequence of the substitution or a
 *   number no criterion can repair independently; `mobile.bundle` compares them as one record, which is
 *   the shape an operator reads.
 * - **A keychain entry's value.** The reading holds a digest and a byte count and never the secret -
 *   this document becomes `result.json`, `latest-failure.md` and an uploaded CI artefact. There is
 *   deliberately no `mobile.keychain` validator: the four questions a criterion could ask of an entry
 *   (was it written, how long, does a second write agree, what protection class) are answered by
 *   `mobile.call` with the target `keychain.set` and by the record `mobile.bundle` reads, and a
 *   thirteenth name here would have to invent a comparison against a field the reading refuses to
 *   publish. This is written down rather than left out, so the gap is a decision rather than an
 *   oversight.
 * - **Whether the application's own command was the right one to issue.** A record shows what was asked
 *   and how it ended; whether `bundle.install` was the right thing for this repository is a question
 *   about the application's design, which this product refuses to model.
 */

import {
  MOBILE_ACTION_RESULTS,
  MOBILE_OBSERVATION_KIND,
  bundleNamed,
  deepLinkFor,
  installedBundles,
  isMobileObservationData,
  logsOf,
  notificationAt,
  permissionFor,
  renderBundle,
  renderDeepLink,
  renderDevice,
  renderInstalled,
  renderLogs,
  renderNotification,
  renderOrientation,
  renderOs,
  renderPermission,
  renderScreen,
  resolveBundleTarget,
  resolveDeepLinkTarget,
  resolveNotificationTarget,
  resolveScopedTarget,
} from "../../core/environment/mobile-observation.ts";
import type {
  MobileBundleReading,
  MobileCallRecord,
  MobileObservationData,
} from "../../core/environment/mobile-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  compareText,
  compareWord,
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
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `mobile.deep-link` and `mobile.deepLink` are
 * both acceptance contracts that cannot be written at all. The thing a reader calls a deep link is judged
 * by a validator named `mobile.deeplink`.
 */
export const MOBILE_VALIDATOR_NAMES = {
  device: "mobile.device",
  os: "mobile.os",
  screen: "mobile.screen",
  orientation: "mobile.orientation",
  bundle: "mobile.bundle",
  installed: "mobile.installed",
  permission: "mobile.permission",
  deepLink: "mobile.deeplink",
  notification: "mobile.notification",
  logs: "mobile.logs",
  call: "mobile.call",
  probe: "mobile.probe",
} as const;

// ---- reading the document -------------------------------------------------------------------------

/**
 * Whether a value is an `AssertionResult`, judged against the engine's own status vocabulary.
 *
 * Deliberately *not* `"status" in value`, and the difference is not theoretical in this family:
 * `MobileCallRecord` carries `status: number | string`, so the presence test classifies every recorded
 * command as an assertion result and `mobile.call` would report a verdict it never reached. The provider
 * and runtime families each paid for this defect from their own call records; here the collision is
 * structural, because a call record has to report the device's answer and an assertion has to report a
 * verdict, and two different specs call both of them a status.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  (CRITERION_STATUSES as readonly unknown[]).includes((value as { status?: unknown }).status);

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): MobileObservationData | AssertionResult {
  if (isMobileObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a mobile device ` +
      "document, so there is nothing to read. The adapter produced the reading, so this is a defect in " +
      "the environment rather than a handset the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * The resolver's own reason for refusing a target, quoted rather than replaced.
 *
 * The rule the four families before this one follow: the *resolver* knows why it refused - an empty
 * name, a bundle id carrying `/`, a position that is not a whole number, a URI with no scheme - and a
 * validator that wrote one message covering every reason would be naming a cause it never observed.
 */
const refusedTarget = (validator: string, target: string, reason: string): AssertionResult =>
  unusable(
    validator,
    target,
    `The target ${quote(target)} does not name anything this world holds: ${reason}.`,
  );

/** What the device holds, as one clause, so a "not there" message says what *is* there. */
function heldSpelling(document: MobileObservationData): string {
  if (document.bundles.length === 0) return "The device holds no bundles at all";
  return `The device holds ${document.bundles.map((bundle) => quote(bundle.id)).join(", ")}`;
}

/**
 * The bundle a target names, or the branch that says the reading does not hold one.
 *
 * `INCONCLUSIVE` rather than `FAIL`, and it hands the presence question to the validator that owns it.
 * "The bundle is not on the device" and "its version is wrong" are different defects, and only one of
 * them is worth repairing the manifest for.
 */
function bundleOf(
  validator: string,
  target: string | null,
  document: MobileObservationData,
  what: string,
): MobileBundleReading | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const resolved = resolveBundleTarget(target);
  if (resolved.kind === "refused") return refusedTarget(validator, target, resolved.reason);
  const found = bundleNamed(document, resolved.value);
  if (found !== null) return found;
  return unanswered(
    validator,
    resolved.value,
    `The device holds no bundle ${quote(resolved.value)}, so there is nothing to read. Whether it ` +
      `should is the question ${quote(MOBILE_VALIDATOR_NAMES.installed)} answers; this validator can ` +
      `only report that there was nothing to measure. ${heldSpelling(document)}.`,
  );
}

const compareResult = compareWord(MOBILE_ACTION_RESULTS, "a command's result");

/**
 * The whole call/probe body: one client's newest record of a target, or the reason there is none.
 *
 * Three distinguishable absences, kept apart because they lead to three different repairs:
 *
 * - the world holds no record for this target at all - the application never issued it, or the criterion
 *   never did;
 * - the world holds records for it and every one of them was issued by the **other** client, which is
 *   the sentence that stops a criterion earning its own pass with a request it made itself;
 * - the world holds a record whose `action` is `null`, which is a *command this world does not
 *   implement* - reached by matching `call.command`, because an unimplemented command has no action name
 *   to match. Reporting that as "nobody asked" would be an error naming a cause the record refutes.
 */
function callBy(
  validator: string,
  target: string | null,
  document: MobileObservationData,
  client: "provisioner" | "criterion",
  other: readonly [string, string],
): MobileCallRecord | AssertionResult {
  if (target === null) {
    return noTarget(
      validator,
      "an action name as the world records it (`bundle.install`, `permission.grant`), or a command " +
        "line the world does not implement",
    );
  }
  const mentioned = document.calls.filter(
    (call) => call.action === target || call.command === target,
  );
  if (mentioned.length === 0) {
    return unanswered(
      validator,
      target,
      `The world recorded no request naming ${quote(target)} from anybody, so there is nothing to ` +
        `read. ${quote(validator)} reads the ${client === "provisioner" ? "application's own" : "criterion's own"} ` +
        `requests; whether the command was ever issued at all is what this record would have said.`,
    );
  }
  const mine = mentioned.filter((call) => call.client === client).at(-1);
  if (mine === undefined) {
    const who = client === "provisioner" ? "application" : "criterion";
    return unanswered(
      validator,
      target,
      `The world holds no request naming ${quote(target)} that the ${who} made - the record names it ` +
        `only from ${quote(other[0])}'s side, asking for ${other[1]}. A request the criterion made ` +
        "cannot stand in for one the application did, or the reverse.",
    );
  }
  return mine;
}

// ---- the handset ----------------------------------------------------------------------------------

/**
 * The device itself - the only four members of this family that name no target.
 *
 * `needsTarget: false` because there is exactly one device in a reading, which is what makes these
 * targetless rather than refusing to say which subject they read: a criterion about *which handset this
 * is* has nothing to disambiguate.
 */
const device: Validator = {
  name: MOBILE_VALIDATOR_NAMES.device,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.device, null);
    if (isAssertion(document)) return document;
    return judge(
      MOBILE_VALIDATOR_NAMES.device,
      null,
      `the device ${quote(document.state.id)} as this world describes it`,
      renderDevice(document.state),
      raw,
      compareText,
    );
  },
};

const os: Validator = {
  name: MOBILE_VALIDATOR_NAMES.os,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.os, null);
    if (isAssertion(document)) return document;
    return judge(
      MOBILE_VALIDATOR_NAMES.os,
      null,
      `the operating system ${quote(document.state.id)} reports, and the API level the world answers at`,
      renderOs(document.state, document.world.apiLevel),
      raw,
      compareText,
    );
  },
};

const screen: Validator = {
  name: MOBILE_VALIDATOR_NAMES.screen,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.screen, null);
    if (isAssertion(document)) return document;
    return judge(
      MOBILE_VALIDATOR_NAMES.screen,
      null,
      `the geometry the world resolved for ${quote(document.state.id)}, and whether anything drew on it`,
      renderScreen(document.state.screen),
      raw,
      compareText,
    );
  },
};

const orientation: Validator = {
  name: MOBILE_VALIDATOR_NAMES.orientation,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.orientation, null);
    if (isAssertion(document)) return document;
    return judge(
      MOBILE_VALIDATOR_NAMES.orientation,
      null,
      `the axis ${quote(document.state.id)} is held at, the rotation the world resolved and the lock`,
      renderOrientation(document.state.orientation),
      raw,
      compareText,
    );
  },
};

// ---- the store ------------------------------------------------------------------------------------

const bundle: Validator = {
  name: MOBILE_VALIDATOR_NAMES.bundle,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun: "bundle id as a reversed domain in lower case (`com.veridian.cart`)",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.bundle, target);
    if (isAssertion(document)) return document;
    const held = bundleOf(
      MOBILE_VALIDATOR_NAMES.bundle,
      target,
      document,
      "a bundle id (`com.veridian.cart`)",
    );
    if (isAssertion(held)) return held;
    return judge(
      MOBILE_VALIDATOR_NAMES.bundle,
      target,
      `what the device recorded about ${quote(held.id)}`,
      renderBundle(held),
      raw,
      compareText,
    );
  },
};

const installed: Validator = {
  name: MOBILE_VALIDATOR_NAMES.installed,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.installed, null);
    if (isAssertion(document)) return document;
    return judge(
      MOBILE_VALIDATOR_NAMES.installed,
      null,
      "the bundles the device holds, with the ones it has removed left out",
      renderInstalled(installedBundles(document)),
      raw,
      compareText,
    );
  },
};

// ---- what the application did while it ran ------------------------------------------------------

const permission: Validator = {
  name: MOBILE_VALIDATOR_NAMES.permission,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun: "permission target (`<bundle>/<permission>`, e.g. `com.veridian.cart/camera`)",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.permission, target);
    if (isAssertion(document)) return document;
    const what = "a permission target (`<bundle>/<permission>`, e.g. `com.veridian.cart/camera`)";
    if (target === null) return noTarget(MOBILE_VALIDATOR_NAMES.permission, what);
    const resolved = resolveScopedTarget(target, "permission");
    if (resolved.kind === "refused") {
      return refusedTarget(MOBILE_VALIDATOR_NAMES.permission, target, resolved.reason);
    }
    const { bundle: id, key } = resolved.value;
    const held = permissionFor(document, id, key);
    if (held === null) {
      const owner = bundleNamed(document, id);
      if (owner === null) {
        return unanswered(
          MOBILE_VALIDATOR_NAMES.permission,
          target,
          `The device holds no bundle ${quote(id)}, so there is no manifest to have declared ` +
            `${quote(key)}. ${heldSpelling(document)}.`,
        );
      }
      const declared =
        owner.permissions.length === 0
          ? "it declares no permissions at all"
          : `it declares ${owner.permissions.map((entry) => quote(entry.key)).join(", ")}`;
      return unanswered(
        MOBILE_VALIDATOR_NAMES.permission,
        target,
        `The bundle ${quote(id)} declares no permission this world addresses by ${quote(key)}: ` +
          `${declared}. A permission that was never declared and one that was declared and refused are ` +
          "different findings, so this reading reports only the first.",
      );
    }
    return judge(
      MOBILE_VALIDATOR_NAMES.permission,
      target,
      `what the device recorded about ${quote(held.name)} on ${quote(id)}`,
      renderPermission(held),
      raw,
      compareText,
    );
  },
};

const deepLink: Validator = {
  name: MOBILE_VALIDATOR_NAMES.deepLink,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun: "deep link as a whole URI (`veridian://cart/item`)",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.deepLink, target);
    if (isAssertion(document)) return document;
    if (target === null) {
      return noTarget(MOBILE_VALIDATOR_NAMES.deepLink, "a deep link as a whole URI (`veridian://cart/item`)");
    }
    const resolved = resolveDeepLinkTarget(target);
    if (resolved.kind === "refused") {
      return refusedTarget(MOBILE_VALIDATOR_NAMES.deepLink, target, resolved.reason);
    }
    const held = deepLinkFor(document, resolved.value);
    if (held === null) {
      return unanswered(
        MOBILE_VALIDATOR_NAMES.deepLink,
        target,
        `No bundle in this reading registered a link answering ${quote(resolved.value)}, so there is ` +
          "nothing to read. A link is matched with its scheme and its host exactly and its path by " +
          "prefix, so a bundle that registered a shorter path would have answered this; that none did " +
          "is the finding.",
      );
    }
    return judge(
      MOBILE_VALIDATOR_NAMES.deepLink,
      target,
      `the route ${quote(`${held.scheme}://${held.host}${held.path}`)} and what resolving it did`,
      renderDeepLink(held),
      raw,
      compareText,
    );
  },
};

const notification: Validator = {
  name: MOBILE_VALIDATOR_NAMES.notification,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun: "notification target (`<bundle>#<position>`, e.g. `com.veridian.cart#1`)",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.notification, target);
    if (isAssertion(document)) return document;
    const what = "a notification target (`<bundle>#<position>`, e.g. `com.veridian.cart#1`)";
    if (target === null) return noTarget(MOBILE_VALIDATOR_NAMES.notification, what);
    const resolved = resolveNotificationTarget(target);
    if (resolved.kind === "refused") {
      return refusedTarget(MOBILE_VALIDATOR_NAMES.notification, target, resolved.reason);
    }
    const { bundle: id, index } = resolved.value;
    const held = notificationAt(document, id, index);
    if (held === null) {
      const mine = document.notifications.filter((entry) => entry.bundle === id);
      if (mine.length === 0) {
        return unanswered(
          MOBILE_VALIDATOR_NAMES.notification,
          target,
          `The bundle ${quote(id)} posted no notification, so there is no position ${String(index)} to ` +
            `read. Whether it should have is a question about the application; this reading can only ` +
            "report that nothing was posted.",
        );
      }
      return unanswered(
        MOBILE_VALIDATOR_NAMES.notification,
        target,
        `The bundle ${quote(id)} posted ${String(mine.length)} notification(s), so position ` +
          `${String(index)} is past the end of its list. The position is 1-based and counted within ` +
          "this bundle's own notifications, not the device's.",
      );
    }
    return judge(
      MOBILE_VALIDATOR_NAMES.notification,
      target,
      `the notification ${quote(held.id)} and whether anything carried it`,
      renderNotification(held),
      raw,
      compareText,
    );
  },
};

const logs: Validator = {
  name: MOBILE_VALIDATOR_NAMES.logs,
  needsTarget: true,
  comparisons: ["equals", "contains", "matches"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun: "bundle id as a reversed domain in lower case (`com.veridian.cart`)",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.logs, target);
    if (isAssertion(document)) return document;
    const what = "a bundle id (`com.veridian.cart`)";
    if (target === null) return noTarget(MOBILE_VALIDATOR_NAMES.logs, what);
    const resolved = resolveBundleTarget(target);
    if (resolved.kind === "refused") {
      return refusedTarget(MOBILE_VALIDATOR_NAMES.logs, target, resolved.reason);
    }
    const held = logsOf(document, resolved.value);
    if (held === null) {
      return unanswered(
        MOBILE_VALIDATOR_NAMES.logs,
        target,
        `The world recorded no stream for ${quote(resolved.value)} at all, so there is nothing to ` +
          "read. A bundle that ran and wrote nothing has a record whose two streams are empty; a " +
          `bundle that never launched has none, and this is that second case. Whether it launched is ` +
          `what ${quote(MOBILE_VALIDATOR_NAMES.call)} reads, with the target \`bundle.launch\`.`,
      );
    }
    return judge(
      MOBILE_VALIDATOR_NAMES.logs,
      target,
      `what ${quote(held.bundle)} wrote and how much of it the world kept`,
      renderLogs(held),
      raw,
      compareText,
    );
  },
};

// ---- the action record --------------------------------------------------------------------------

/**
 * The request the **application** made, and how the device answered it.
 *
 * The target is either an action name as the world records it (`bundle.install`) or a whole command
 * line the world does not implement, which is why the reader matches both fields rather than one. A
 * command this world refuses has no action name, and a criterion about the refusal has to be able to
 * name the command it issued - the `data.call` and `container.call` precedent, one family out.
 */
const call: Validator = {
  name: MOBILE_VALIDATOR_NAMES.call,
  needsTarget: true,
  comparisons: ["equals"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun:
    "action name as the world records it (`bundle.install`, `permission.grant`), or a command line " +
    "the world does not implement",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.call, target);
    if (isAssertion(document)) return document;
    const found = callBy(MOBILE_VALIDATOR_NAMES.call, target, document, "provisioner", [
      MOBILE_VALIDATOR_NAMES.probe,
      "the criterion",
    ]);
    if (isAssertion(found)) return found;
    const reason = found.reason === null ? "" : `, and the reason it gave was ${quote(found.reason)}`;
    return judge(
      MOBILE_VALIDATOR_NAMES.call,
      target,
      `the application's own request ${quote(found.command)} - the newest one this world recorded` +
        reason,
      found.result,
      raw,
      compareResult,
    );
  },
};

/**
 * The request the **criterion itself** made, and how the device answered it.
 *
 * A separate validator rather than a qualifier on `mobile.call`, and the two invert where a reader
 * expects it: `mobile.call` reads what the *application* asked and `mobile.probe` what the *criterion*
 * asked. Judging either through the other would let a run pass on the strength of its own questions -
 * which is the false pass this whole product exists to refuse - and it is why a contract cannot earn a
 * `refused` by issuing the command itself and reading the answer through `mobile.call`.
 */
const probe: Validator = {
  name: MOBILE_VALIDATOR_NAMES.probe,
  needsTarget: true,
  comparisons: ["equals"],
  observationKind: MOBILE_OBSERVATION_KIND,
  targetNoun:
    "action name as the world records it (`device.info`, `logs.read`), or a command line the world " +
    "does not implement",
  validate(raw, observation) {
    const target = targetOf(raw);
    const document = readDocument(observation, MOBILE_VALIDATOR_NAMES.probe, target);
    if (isAssertion(document)) return document;
    const found = callBy(MOBILE_VALIDATOR_NAMES.probe, target, document, "criterion", [
      MOBILE_VALIDATOR_NAMES.call,
      "the application",
    ]);
    if (isAssertion(found)) return found;
    const reason = found.reason === null ? "" : `, and the reason it gave was ${quote(found.reason)}`;
    return judge(
      MOBILE_VALIDATOR_NAMES.probe,
      target,
      `the criterion's own request ${quote(found.command)} - the newest one this world recorded` +
        reason,
      found.result,
      raw,
      compareResult,
    );
  },
};

/**
 * Every member, in reader order: the handset, the store, what the application did, then the record.
 *
 * Frozen, because a registry reading this list must not be able to edit the family's vocabulary as a
 * side effect of reading it.
 */
export const MOBILE_VALIDATORS: readonly Validator[] = Object.freeze([
  device,
  os,
  screen,
  orientation,
  bundle,
  installed,
  permission,
  deepLink,
  notification,
  logs,
  call,
  probe,
]);

/** A fresh array, so a registry can own its list without the family exporting a mutable global. */
export function mobileValidators(): Validator[] {
  return [...MOBILE_VALIDATORS];
}
