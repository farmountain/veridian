/**
 * The `container.*` validator family - the vocabulary an acceptance criterion uses to judge a container
 * runtime.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`ContainerObservationData`) and never starts a process, never reads
 * a build context, never opens the store and never sees an adapter. That is why the vocabulary lives in
 * `core/environment/container-observation.ts` rather than beside the substitute: `validators/*` may not
 * import `adapters/*`, so a validator here cannot know whether the runtime was real or stood in for - it
 * can be tested with no world running at all, and it can be re-read from a bundle a year later with
 * nothing installed.
 *
 * The names are therefore `container.*` and not `sim-container.*`. The criterion is about the runtime,
 * not about what stood in for it, and the substitution *is* recorded - in the reading's own `simulated`
 * field - because a verdict reached against a substitute has to say so where the verdict is, not in the
 * name of the vocabulary that reached it.
 *
 * ## The three records, and why the family mirrors the split
 *
 * A container reading keeps three kinds of fact apart, and the family keeps them apart too, because each
 * answers a different question with a different repair:
 *
 * - `container.image`, `container.tag`, `container.digest`, `container.label` and `container.env` read
 *   the **store** - what was built, and what the build declared. An image is the thing that is
 *   reproducible; a tag is what a container names it by.
 * - `container.state`, `container.alive`, `container.exitCode`, `container.command`, `container.user`,
 *   `container.mount`, `container.port`, `container.limit` and `container.health` read the **instance** -
 *   what one container is. `container.logs` and `container.stderr` read the **bytes it wrote**, which is
 *   a fourth thing again: a container that is gone still has its output.
 * - `container.call` and `container.probe` read the **action record** - what was asked of the runtime,
 *   and how that ended.
 *
 * The split matters most in one pair. `state` is what the world *recorded* and `alive` is what the
 * operating system *reported when the reading was taken*, and they can disagree: a container whose state
 * is `running` and whose process has already exited is the shape of a program that returned while
 * nothing was watching. A validator that merged the two would report one defect where there are two, and
 * would send the reader to the wrong one half the time. The same reasoning separates `logs` from
 * `stderr` (a program that printed an error to the wrong stream is a defect with its own repair) and
 * `owner`-style state facts from the *provenance* facts the store's readings carry.
 *
 * ## Status discipline
 *
 * The same branches as the other six families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, on a fact actually read from the world.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the world*: an absent image, a
 *   container that exited, output that does not contain what was expected.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at: a tag the store does not hold, a
 *   container that was never created, an exit code that does not exist yet because the process has not
 *   finished, a healthcheck nobody declared, an action the world never recorded.
 * - `ERROR` - the *criterion* is unusable (a target that is not a reference in this family's spelling, a
 *   name written for the wrong kind, a comparison against the wrong vocabulary) or the world arrived
 *   unreadable. Never `TEST_FAILURE`: a typo in a contract is not a defect in the application.
 *
 * ## The guards this world needs beyond the other families
 *
 * - **The verdict test is the engine's status vocabulary, not the presence of a `status` field.**
 *   {@link isAssertion} checks membership in `CRITERION_STATUSES` because `ContainerCallRecord` carries
 *   a `status` of its own - the exit status the *client* reported - and the obvious `"status" in value`
 *   test would therefore classify every recorded command as an assertion result. The provider family
 *   records the same defect from the same cause; here the collision is unavoidable rather than
 *   accidental, because a call record has to report a status and an assertion has to report a verdict,
 *   and both are called the same thing by two different specs.
 * - **A target is a reference in this family's spelling, and a name of the wrong kind is refused.** An
 *   image and a container are different objects with different fields, so answering a question about one
 *   with the other's reading is how a check for "the image is tagged" silently becomes a check on a
 *   running container. {@link resolveContainerRef} resolves both, and each validator refuses the kind it
 *   does not read by naming the validators that do.
 * - **A fact the reading disowns is not judged.** `ContainerPortReading` has no `reachable` field and
 *   `ContainerResourceReading.enforced` is computed rather than asserted. This family offers no
 *   comparison for either, and `container.port`'s subject line states in every message that it judged a
 *   mapping rather than a socket - so a criterion cannot be written that claims either.
 * - **An image is looked up by tag *or* by id, a container by name *or* by id.** A real CLI accepts both
 *   spellings and an operator who ran `docker ps -a --no-trunc` has an id in their hand. The lookup
 *   order is name first, so a container whose name happens to look like another container's id still
 *   answers the name.
 *
 * ## What this family deliberately does not judge
 *
 * Recorded rather than left implied, because a gap nobody wrote down is discovered as a bug:
 *
 * - **A pid, a creation timestamp and a duration.** They are facts about this machine at this moment
 *   rather than facts about the application, and the reading omits them for exactly that reason: M1
 *   compares the readings two runs wrote, so a reading carrying any of the three would make two runs of
 *   one unchanged program differ and the metric would report a difference the application never caused.
 * - **A container's or an image's derived id, an image's `sizeBytes`, its `layers` and its
 *   `architecture`, a container's `restartPolicy` and `workingDir`, an image's `exposedPorts` as a list,
 *   and a log's `runs`, `stdoutBytes` and `stderrBytes`.** Each is either a consequence of the
 *   substitution (`layers` is always one) or a declaration nothing in this world applies (`restartPolicy`
 *   is recorded by a world with no supervisor). `container.port` reports the exposed flag per mapping,
 *   which is the question a criterion actually asks of `EXPOSE`.
 * - **Anything about the substitution itself.** `simulated` is not a comparison target. A criterion that
 *   asserted `simulated` contains `cgroups` would be a contract about the substitute rather than about
 *   the software, and the field's job is to travel *with* a verdict rather than to be one.
 * - **Whether the application's own command was the right one to issue.** A record shows what was asked
 *   and how it ended; whether `docker build` was the right thing for this repository is a question about
 *   the application's design, which this product refuses to model.
 */

import {
  CONTAINER_ACTION_RESULTS,
  CONTAINER_ACTIONS,
  CONTAINER_HEALTH_STATES,
  CONTAINER_OBSERVATION_KIND,
  CONTAINER_STATES,
  containerNamed,
  imageTagged,
  isContainerObservationData,
  logsOf,
  resolveContainerRef,
  containerRefSpelling,
  renderContainer,
  renderImage,
  renderLimit,
  renderMount,
  renderPort,
} from "../../core/environment/container-observation.ts";
import type {
  ContainerCallRecord,
  ContainerClient,
  ContainerImageReading,
  ContainerInstanceReading,
  ContainerObservationData,
  ContainerRef,
} from "../../core/environment/container-observation.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  compareTruth,
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
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `container.exitCode` is not merely
 * unconventional - it is an acceptance contract that cannot be written at all. The field a reading
 * spells `exitCode` is judged by a validator named `container.exitcode`.
 */
export const CONTAINER_VALIDATOR_NAMES = {
  runtime: "container.runtime",
  image: "container.image",
  tag: "container.tag",
  digest: "container.digest",
  label: "container.label",
  env: "container.env",
  state: "container.state",
  alive: "container.alive",
  exitCode: "container.exitcode",
  command: "container.command",
  user: "container.user",
  mount: "container.mount",
  port: "container.port",
  limit: "container.limit",
  health: "container.health",
  logs: "container.logs",
  stderr: "container.stderr",
  call: "container.call",
  probe: "container.probe",
} as const;

// ---- reading the document -------------------------------------------------------------------------

/**
 * Whether a value is an `AssertionResult`, judged against the engine's own status vocabulary.
 *
 * Deliberately *not* `"status" in value`, and the difference is not theoretical in this family:
 * `ContainerCallRecord` carries `status: number`, so the presence test classifies every recorded
 * command as an assertion result and `container.call` would report a verdict it never reached. The
 * provider family paid for this defect from its own `CloudCallRecord`; here the collision is structural,
 * because a call record has to report the client's status and an assertion has to report a verdict.
 */
const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" &&
  value !== null &&
  (CRITERION_STATUSES as readonly unknown[]).includes((value as { status?: unknown }).status);

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): ContainerObservationData | AssertionResult {
  if (isContainerObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a container runtime ` +
      "document, so there is nothing to read. The adapter produced the reading, so this is a defect in " +
      "the environment rather than a runtime the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * The reference a target names, or the resolver's own reason for refusing it.
 *
 * The refusal is quoted rather than replaced, on the rule the two system families before this one
 * follow: the *resolver* knows why it refused - an empty name, a name carrying `/`, a kind this family
 * does not hold - and a validator that wrote one message covering every reason would be naming a cause
 * it never observed.
 */
function refOf(
  validator: string,
  target: string | null,
  what: string,
): ContainerRef | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const resolved = resolveContainerRef(target);
  if (resolved.kind === "refused") {
    return unusable(
      validator,
      target,
      `The target ${quote(target)} does not name anything this world holds: ${resolved.reason}.`,
    );
  }
  return resolved.value;
}

/** The image a name identifies - by tag first, then by the id the store derived for it. */
function imageFor(document: ContainerObservationData, name: string): ContainerImageReading | null {
  return imageTagged(document, name) ?? document.images.find((image) => image.id === name) ?? null;
}

/** The store's contents as one clause, so a "not there" message says what *is* there. */
function storeSpelling(document: ContainerObservationData): string {
  if (document.images.length === 0) return "The store holds no images at all";
  const tags = document.images.flatMap((image) =>
    image.tags.length === 0 ? [`${image.id} (untagged)`] : image.tags,
  );
  return `The store holds ${tags.map(quote).join(", ")}`;
}

/**
 * The image a reference names, or the branch that says the reading does not hold one.
 *
 * `INCONCLUSIVE` rather than `FAIL`, and it hands the presence question to the validator that owns it,
 * which is the same shape `posix.file` uses when it finds no file. "The image is not there" and "its
 * digest is wrong" are different defects, and only one of them is worth repairing the build for.
 */
function imageOfReading(
  validator: string,
  ref: ContainerRef,
  document: ContainerObservationData,
): ContainerImageReading | AssertionResult {
  if (ref.kind !== "image") {
    return unusable(
      validator,
      containerRefSpelling(ref),
      `${quote(validator)} reads an image, and the target names a container. An image has a digest and ` +
        `a build context; a container has a state and an exit code, so the two are different objects ` +
        `rather than two spellings of one. Reading a container's fields here is what ` +
        `${quote(CONTAINER_VALIDATOR_NAMES.image)} and its neighbours are for.`,
    );
  }
  const found = imageFor(document, ref.name);
  if (found !== null) return found;
  return unanswered(
    validator,
    ref.name,
    `The store holds no image tagged ${quote(ref.name)}, so there is nothing to read. Whether it ` +
      `should is the question ${quote(CONTAINER_VALIDATOR_NAMES.image)} answers; this validator can ` +
      `only report that there was nothing to measure. ${storeSpelling(document)}.`,
  );
}

/**
 * The container a reference names, or the branch that says the reading does not hold one.
 *
 * The absence message points at the *action record* rather than at a presence validator, because this
 * family has none for containers and inventing one would report the absence twice. "The container is not
 * there" is answered by `container.call` with the target `container.create`: the record shows whether
 * the application ever asked for one, which is a fact about the application rather than about this
 * reading.
 */
function containerOfReading(
  validator: string,
  ref: ContainerRef,
  document: ContainerObservationData,
): ContainerInstanceReading | AssertionResult {
  if (ref.kind !== "container") {
    return unusable(
      validator,
      containerRefSpelling(ref),
      `${quote(validator)} reads a container, and the target names an image. A container has a state, ` +
        `a process and an exit code; an image has a digest and a build context. Reading the image's ` +
        `fields here would report on the wrong object, which is what ` +
        `${quote(CONTAINER_VALIDATOR_NAMES.image)} and its neighbours are for.`,
    );
  }
  const found = containerNamed(document, ref.name);
  if (found !== null) return found;
  const held = document.containers.map((container) => quote(container.name));
  return unanswered(
    validator,
    ref.name,
    `The reading holds no container ${quote(ref.name)}, so there is nothing to judge. This is the ` +
      "absence of a container rather than one that stopped: a container that ran and exited is read " +
      "here, and so is one whose process is still alive. Whether the application ever asked for one is " +
      `what ${quote(CONTAINER_VALIDATOR_NAMES.call)} reads, with the target ` +
      `\`container.create\`${held.length === 0 ? "; the reading holds no containers at all" : `; the reading holds ${held.join(", ")}`}.`,
  );
}

const imageRef = (
  validator: string,
  target: string | null,
  document: ContainerObservationData,
): ContainerImageReading | AssertionResult => {
  const ref = refOf(validator, target, "an image reference (`image/cart-web:1.0.0`)");
  if (isAssertion(ref)) return ref;
  return imageOfReading(validator, ref, document);
};

const containerRef = (
  validator: string,
  target: string | null,
  document: ContainerObservationData,
): ContainerInstanceReading | AssertionResult => {
  const ref = refOf(validator, target, "a container reference (`container/cart-web`)");
  if (isAssertion(ref)) return ref;
  return containerOfReading(validator, ref, document);
};

/**
 * The object a reference names, accepting either kind.
 *
 * Only the two validators that read a *declaration the image passes down to the container* use this -
 * labels and environment - and they use it because a container's record already carries the image's
 * entries merged with the command's. Asking about the image and asking about the container are then the
 * same question with the same answer, and refusing one of them would make a correct contract unwritable
 * for no reason a reader could recover from.
 */
function objectOfRef(
  validator: string,
  ref: ContainerRef,
  document: ContainerObservationData,
): ContainerImageReading | ContainerInstanceReading | AssertionResult {
  if (ref.kind === "image") return imageOfReading(validator, ref, document);
  return containerOfReading(validator, ref, document);
}

const objectRef = (
  validator: string,
  target: string | null,
  document: ContainerObservationData,
): ContainerImageReading | ContainerInstanceReading | AssertionResult => {
  const ref = refOf(
    validator,
    target,
    "an image or container reference (`image/cart-web:1.0.0`, `container/cart-web`)",
  );
  if (isAssertion(ref)) return ref;
  return objectOfRef(validator, ref, document);
};

// ---- comparisons against a closed vocabulary ------------------------------------------------------

const compareState = compareWord(CONTAINER_STATES, "a container's state");
const compareHealth = compareWord(CONTAINER_HEALTH_STATES, "a healthcheck's answer");
const compareCallResult = compareWord(CONTAINER_ACTION_RESULTS, "the result of a command");

// ---- spellings, so a failure report can quote what it judged ---------------------------------------

/** `K=V, K=V` in key order, or `(none)`. Sorted, because a map's insertion order is not a fact. */
function mapSpelling(map: Readonly<Record<string, string>>): string {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return "(none)";
  return keys.map((key) => `${key}=${map[key] ?? ""}`).join(", ");
}

const tagsSpelling = (image: ContainerImageReading): string =>
  image.tags.length === 0 ? "(untagged)" : image.tags.join(", ");

const mountsSpelling = (container: ContainerInstanceReading): string =>
  container.mounts.length === 0 ? "(none)" : container.mounts.map(renderMount).join("; ");

const portsSpelling = (container: ContainerInstanceReading): string =>
  container.ports.length === 0 ? "(none)" : container.ports.map(renderPort).join("; ");

// ---- the action record, split by who asked --------------------------------------------------------

/**
 * The newest record naming an action, issued by one client, or the branch that says why there is none.
 *
 * The **newest** is judged, for the same reason `posix.ran` judges the newest execution: the record is a
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
  document: ContainerObservationData,
  client: ContainerClient,
  other: readonly [name: string, described: string],
): ContainerCallRecord | AssertionResult {
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

// ---- the family -----------------------------------------------------------------------------------

/**
 * The runtime identity the environment document declared.
 *
 * The one validator here that judges a fact about the **world** rather than about the application, and
 * it exists for the reason `os.principal` exists: a contract may legitimately pin what it was judged
 * against. A criterion asserting `equals: "docker"` says "these criteria are about a Docker runtime",
 * and the answer travels in the bundle's own reading so a later reader can check the claim rather than
 * take it.
 *
 * It needs no target, because there is exactly one runtime per reading - the same shape `web.url` uses
 * for the one page a web run observes.
 */
const runtime: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.runtime,
  needsTarget: false,
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, runtime.name, null);
    if (isAssertion(document)) return document;
    return judge(
      runtime.name,
      null,
      `the runtime identity the environment document declared (${quote(document.runtime)} ` +
        `${document.version} standing in for ${document.os}/${document.architecture})`,
      document.runtime,
      raw,
      compareText,
    );
  },
};

/**
 * Whether the store holds an image for a reference.
 *
 * The most-asked question in the image half of the family and the one that decides whether any of the
 * others can be asked at all: a contract checking a digest, a tag or a label wants the image to exist
 * first, and a criterion that only checked the digest would report `INCONCLUSIVE` on a store with
 * nothing in it - correct, and less useful than the sentence "the store holds no image tagged X".
 *
 * The reference may be a tag (`cart-web:1.0.0`) or the id the store derived, because a real CLI accepts
 * both and an operator who ran `docker images --no-trunc` has an id in their hand.
 */
const image: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.image,
  needsTarget: true,
  targetNoun: "image reference, as a tag or an id (`image/cart-web:1.0.0`)",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, image.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(image.name, targetOf(raw), "an image reference (`image/cart-web:1.0.0`)");
    if (isAssertion(ref)) return ref;
    if (ref.kind !== "image") {
      return unusable(
        image.name,
        containerRefSpelling(ref),
        `${quote(image.name)} asks whether the store holds an image, and the target names a container. ` +
          `A container's existence is a different question with a different repair - the application's ` +
          `own request is what ${quote(CONTAINER_VALIDATOR_NAMES.call)} reads - and the two are not ` +
          "two spellings of one.",
      );
    }
    const found = imageFor(document, ref.name);
    return judge(
      image.name,
      ref.name,
      `the store holding an image for ${quote(ref.name)}` +
        (found === null ? "" : ` (${renderImage(found)})`),
      found !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * The tags an image carries.
 *
 * Judged as one comma-separated spelling rather than as a list, because a target is a string and a
 * criterion needs one sentence: `contains: "latest"` asks whether the image was also tagged `latest`,
 * and `equals` asks for the whole set in order. The store keeps the order the commands produced, which
 * is a fact about the application's own two `tag` calls and not a fact about a map's iteration.
 */
const tag: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.tag,
  needsTarget: true,
  targetNoun: "image reference, as a tag or an id (`image/cart-web:1.0.0`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, tag.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(tag.name, targetOf(raw), "an image reference (`image/cart-web:1.0.0`)");
    if (isAssertion(ref)) return ref;
    const found = imageOfReading(tag.name, ref, document);
    if (isAssertion(found)) return found;
    return judge(
      tag.name,
      ref.name,
      `the tags on the image named ${quote(ref.name)}`,
      tagsSpelling(found),
      raw,
      compareText,
    );
  },
};

/**
 * The digest of the build context an image was built from.
 *
 * The question this exists for is the one a tag cannot answer: "this tag points at the code we just
 * built". A tag is a name anybody can move; the digest is computed from the files the world really read,
 * so a build that ran against a stale context produces a different digest from a build of the current
 * tree - which is a defect a contract can state and an operator can repair by rebuilding.
 *
 * It is a digest of the *context*, not of the image, and the distinction is deliberate: an image digest
 * would depend on how the world assigned layers, which is a property of the substitute.
 */
const digest: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.digest,
  needsTarget: true,
  targetNoun: "image reference, as a tag or an id (`image/cart-web:1.0.0`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, digest.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(digest.name, targetOf(raw), "an image reference (`image/cart-web:1.0.0`)");
    if (isAssertion(ref)) return ref;
    const found = imageOfReading(digest.name, ref, document);
    if (isAssertion(found)) return found;
    return judge(
      digest.name,
      ref.name,
      `the digest of the build context ${quote(ref.name)} was built from`,
      found.digest,
      raw,
      compareText,
    );
  },
};

/**
 * The labels on an image, or on a container once the image's own have been merged in.
 *
 * Accepts either kind because a container's record already carries the image's labels beside the ones
 * its command declared - so the two questions have the same answer and refusing one would make a correct
 * contract unwritable. The subject says which object was read, so a failure report never leaves a reader
 * guessing whether an inherited label or a declared one was judged.
 */
const label: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.label,
  needsTarget: true,
  targetNoun: "image or container reference (`image/cart-web:1.0.0`, `container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, label.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      label.name,
      targetOf(raw),
      "an image or container reference (`image/cart-web:1.0.0`, `container/cart-web`)",
    );
    if (isAssertion(ref)) return ref;
    const found = objectOfRef(label.name, ref, document);
    if (isAssertion(found)) return found;
    const which = ref.kind === "image" ? "image" : "container";
    return judge(
      label.name,
      containerRefSpelling(ref),
      `the labels on the ${which} named ${quote(ref.name)} ` +
        `(${ref.kind === "image" ? "as the build declared them" : "the image's own, plus any the command declared"})`,
      mapSpelling(found.labels),
      raw,
      compareText,
    );
  },
};

/**
 * The environment an image declares, or a container's effective environment.
 *
 * A separate validator from `container.label` for the same reason `os.environment` is separate from the
 * other registry entries: a missing variable and a missing label are different defects with different
 * repairs, and a criterion asserting the sandbox path reached the container's environment must not be
 * satisfiable by a label that happens to hold the same text.
 */
const env: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.env,
  needsTarget: true,
  targetNoun: "image or container reference (`image/cart-web:1.0.0`, `container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, env.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const ref = refOf(
      env.name,
      targetOf(raw),
      "an image or container reference (`image/cart-web:1.0.0`, `container/cart-web`)",
    );
    if (isAssertion(ref)) return ref;
    const found = objectOfRef(env.name, ref, document);
    if (isAssertion(found)) return found;
    const which = ref.kind === "image" ? "image" : "container";
    return judge(
      env.name,
      containerRefSpelling(ref),
      `the environment of the ${which} named ${quote(ref.name)} ` +
        `(${ref.kind === "image" ? "as the build declared it" : "the image's own, plus any the command declared"})`,
      mapSpelling(found.env),
      raw,
      compareText,
    );
  },
};

/**
 * A container's recorded state.
 *
 * The *record*, and deliberately not the process: whether the process is really alive is
 * `container.alive`, a separate observation taken from the operating system when the reading was made.
 * They can disagree, and reporting one when the criterion asked the other would hide the disagreement
 * that is the most useful thing this pair can show.
 */
const state: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.state,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, state.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(state.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      state.name,
      found.name,
      `the state the world recorded for ${quote(found.name)} (${renderContainer(found)})`,
      found.state,
      raw,
      compareState,
    );
  },
};

/**
 * Whether a container's process is really running.
 *
 * Observed rather than recorded, which is why it is its own validator rather than a second comparison on
 * `container.state`: a container whose record says `running` and whose process has already returned is
 * precisely the defect this pair exists to make visible, and a validator that derived one from the other
 * could never see it.
 */
const alive: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.alive,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, alive.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(alive.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      alive.name,
      found.name,
      `whether the process of ${quote(found.name)} was still running when the reading was taken ` +
        `(recorded state ${found.state})`,
      found.alive,
      raw,
      compareTruth,
    );
  },
};

/**
 * The code the container's process exited with.
 *
 * `INCONCLUSIVE` while the process has not finished, because there is no answer yet and `0` would be a
 * fabrication. A criterion that asks this of a still-running container is asking a question whose answer
 * does not exist, and the refusal names the two validators that do answer the question it probably
 * meant.
 */
const exitCode: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.exitCode,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, exitCode.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(exitCode.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    if (found.exitCode === null) {
      return unanswered(
        exitCode.name,
        found.name,
        `The process of ${quote(found.name)} has not finished, so there is no exit code to judge. ` +
          "Reported as inconclusive rather than as anything else, because a fabricated `0` here would " +
          "let a criterion bless a program that is still running - and the question a criterion can ask " +
          `now is ${quote(CONTAINER_VALIDATOR_NAMES.state)} or ` +
          `${quote(CONTAINER_VALIDATOR_NAMES.alive)}.`,
      );
    }
    return judge(
      exitCode.name,
      found.name,
      `the code the process of ${quote(found.name)} exited with`,
      found.exitCode,
      raw,
      compareCounts,
    );
  },
};

/** The command a container runs, joined with single spaces so a criterion has one string to compare. */
const command: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.command,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, command.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(command.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      command.name,
      found.name,
      `the command ${quote(found.name)} runs`,
      found.command.join(" "),
      raw,
      compareText,
    );
  },
};

/**
 * The account a container declares its process runs as.
 *
 * The subject line carries the limitation in the same sentence as the fact, and it does so in every
 * message including a passing one's absence: this world **records** the account and never switches to
 * it, because changing accounts on the host that is doing the judging is the one thing a substitute must
 * not do to the machine that is judging. A criterion here judges what the application declared - which
 * is a real contract about a hardening requirement - and the field's own documentation says so too.
 */
const user: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.user,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, user.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(user.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      user.name,
      found.name,
      `the account ${quote(found.name)} declares its process runs as (a record this world does not ` +
        "apply, because switching accounts on the host that judges is what a substitute must not do)",
      found.user,
      raw,
      compareText,
    );
  },
};

/**
 * The directories a container was given.
 *
 * Judged as one semicolon-separated spelling of every mount, because the question a contract asks is
 * almost always about the *set* - "the context is mounted read-only", "the source directory is there" -
 * and each line carries the field that makes a bind mount more than a name: whether the world could
 * really see the source. A criterion reading `source absent` is reading a start that was refused for the
 * real reason.
 */
const mount: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.mount,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, mount.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(mount.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      mount.name,
      found.name,
      `the directories ${quote(found.name)} was given (a bind mount's source is really tested, a ` +
        "volume is created by the world)",
      mountsSpelling(found),
      raw,
      compareText,
    );
  },
};

/**
 * The ports a container's mappings name.
 *
 * The one validator in this family whose subject line has to state a **refusal**, and it states it in
 * every message: this world binds nothing, so a published port is a mapping in a record and not a
 * socket. `ContainerPortReading` carries no `reachable` field for exactly that reason, and a criterion
 * that could ask about reachability would be a criterion claiming a measurement nobody took. What a
 * criterion *can* judge is the mapping, the protocol, and whether the image declared the port with
 * `EXPOSE` - which is the question behind almost every published-port requirement.
 */
const port: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.port,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, port.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(port.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      port.name,
      found.name,
      `the port mappings of ${quote(found.name)} (mappings, not sockets - this world opens no port, so ` +
        "what is judged is the mapping and whether the image exposed it)",
      portsSpelling(found),
      raw,
      compareText,
    );
  },
};

/**
 * The resource limits a container declared.
 *
 * Judged as the world's own rendering, which carries the phrase that keeps this honest: a world with no
 * cgroup reports `(declared, not enforced)`, and a criterion that read only the numbers would be reading
 * a limit nothing applied. The rendering is a function of what the application declared and of the
 * world's own enforcement, so the same validator will report a different sentence on the day a
 * substitution really installs a cgroup - without this file changing.
 */
const limit: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.limit,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals", "contains", "matches"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, limit.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(limit.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    return judge(
      limit.name,
      found.name,
      `the resources ${quote(found.name)} declared`,
      renderLimit(found.resources),
      raw,
      compareText,
    );
  },
};

/**
 * What a container's healthcheck answered.
 *
 * A container that declared no healthcheck is `INCONCLUSIVE` rather than `FAIL` or `unhealthy`, and the
 * refusal says why in the terms of the repair: a program nobody asked to answer a check has not failed
 * one, so reporting `unhealthy` would send an agent to repair an application that was never asked to
 * answer. `none` is a member of the state vocabulary for the *record's* benefit; a reading with no
 * healthcheck at all is the absence of a record, which is this branch.
 */
const health: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.health,
  needsTarget: true,
  targetNoun: "container reference (`container/cart-web`)",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, health.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const found = containerRef(health.name, targetOf(raw), document);
    if (isAssertion(found)) return found;
    const declared = found.health;
    if (declared === null) {
      return unanswered(
        health.name,
        found.name,
        `${quote(found.name)} declares no healthcheck, so there is nothing to judge. A container ` +
          "nobody asked to be checked has not failed a check, and reporting one here would send an " +
          `agent to repair an application that was never asked to answer. Whether its process is ` +
          `running is what ${quote(CONTAINER_VALIDATOR_NAMES.alive)} reads.`,
      );
    }
    return judge(
      health.name,
      found.name,
      `the answer of the healthcheck ${quote(found.name)} declared ` +
        `(${declared.command.join(" ")}, ${String(declared.attempts)} attempt(s))`,
      declared.state,
      raw,
      compareHealth,
    );
  },
};

/**
 * The bytes a container wrote, one stream at a time.
 *
 * `container.logs` reads stdout and `container.stderr` reads stderr, as two validators rather than one,
 * because "the program printed its result to the wrong stream" is a real defect with its own repair and
 * a criterion asserting a *contains* against a concatenation could be satisfied by the wrong stream's
 * text. The count of runs and the byte counts are available in the reading and are not judged here: they
 * are properties of how many times the container was started, and a criterion asserting them would be
 * describing the iteration rather than the program.
 *
 * A record the world stopped keeping is reported as what it is, in the subject line, so a criterion that
 * compares for equality against a truncated prefix fails instead of quietly matching the beginning.
 */
function logValidator(
  validator: string,
  noun: string,
  stream: (log: { readonly stdout: string; readonly stderr: string }) => string,
): Validator {
  return {
    name: validator,
    needsTarget: true,
    targetNoun: "container reference (`container/cart-web`)",
    comparisons: ["equals", "contains", "matches"],
    observationKind: CONTAINER_OBSERVATION_KIND,
    validate(raw, observation) {
      const document = readDocument(observation, validator, targetOf(raw));
      if (isAssertion(document)) return document;
      const found = containerRef(validator, targetOf(raw), document);
      if (isAssertion(found)) return found;
      const log = logsOf(document, found.name);
      if (log === null) {
        return unanswered(
          validator,
          found.name,
          `The world recorded no ${noun} for ${quote(found.name)} at all, so there is nothing to ` +
            "judge. " +
            "This is the absence of a stream rather than an empty one: a container that ran without " +
            "writing anything has a record whose stream is empty, which `equals: \"\"` asks about. " +
            `Whether it ever ran is what ${quote(CONTAINER_VALIDATOR_NAMES.state)} and ` +
            `${quote(CONTAINER_VALIDATOR_NAMES.alive)} read.`,
        );
      }
      return judge(
        validator,
        found.name,
        `${noun} of ${quote(found.name)}` +
          (log.truncated
            ? " (the world stopped keeping bytes, so this is a prefix of what it wrote)"
            : ""),
        stream(log),
        raw,
        compareText,
      );
    },
  };
}

const logs = logValidator(CONTAINER_VALIDATOR_NAMES.logs, "stdout", (log) => log.stdout);

const stderr = logValidator(CONTAINER_VALIDATOR_NAMES.stderr, "stderr", (log) => log.stderr);

/**
 * How the application's own command to the runtime ended.
 *
 * The reader of provisioning: a build, a create, a start. `answered` is the pass, and the three other
 * results are different repairs - `failed` is the container's own defect (its process exited non-zero,
 * which is the *container's* exit code and not the client's), `refused` is the world declining to serve
 * the request (a command it does not implement, a bind source that is not there), and `absent` is the
 * request being served and the resource not existing.
 *
 * The target is an action name **or** a command line. The second is what makes the `action: null` record
 * reachable: a command this world does not implement has no action name to be keyed by, so a contract
 * could otherwise never observe that the world refused it - which is the observation a contract about a
 * substitute most needs to be able to make.
 */
const call: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.call,
  needsTarget: true,
  targetNoun:
    "action name as the world records it (`image.build`, `container.start`), or a command line the world does not implement",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, call.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        call.name,
        `an action name (one of ${CONTAINER_ACTIONS.map((action) => quote(action)).join(", ")})`,
      );
    }
    const found = callBy(call.name, target, document, "provisioner", [
      CONTAINER_VALIDATOR_NAMES.probe,
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
 * How the criterion's *own* command to the runtime ended.
 *
 * A separate validator, not a qualifier on `container.call`, and the separation is the point: a
 * criterion that issued a command is asking what the *world* did, not what the application did. The
 * contracts this exists for are containment and honesty - a criterion that runs a command naming a path
 * outside the world and asserts `equals: "refused"`, or one that asks the world for something it does
 * not implement and asserts the same. Judging either through `container.call` would let a run pass on
 * the strength of the run's own questions, which is the false pass this whole product exists to refuse.
 */
const probe: Validator = {
  name: CONTAINER_VALIDATOR_NAMES.probe,
  needsTarget: true,
  targetNoun: "action name, or a command line, as the criterion named it",
  comparisons: ["equals"],
  observationKind: CONTAINER_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, probe.name, targetOf(raw));
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) {
      return noTarget(
        probe.name,
        `an action name (one of ${CONTAINER_ACTIONS.map((action) => quote(action)).join(", ")})`,
      );
    }
    const found = callBy(probe.name, target, document, "criterion", [
      CONTAINER_VALIDATOR_NAMES.call,
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
export const CONTAINER_VALIDATORS: readonly Validator[] = Object.freeze([
  runtime,
  image,
  tag,
  digest,
  label,
  env,
  state,
  alive,
  exitCode,
  command,
  user,
  mount,
  port,
  limit,
  health,
  logs,
  stderr,
  call,
  probe,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function containerValidators(): Validator[] {
  return [...CONTAINER_VALIDATORS];
}
