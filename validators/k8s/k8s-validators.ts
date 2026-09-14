/**
 * The `k8s.*` validator family - the vocabulary an acceptance criterion uses to judge a cluster.
 *
 * ## What a validator is allowed to know
 *
 * A validator reads one *document* (`K8sObservationData`) and never opens a socket, never talks to an
 * API server and never sees an adapter. That is why the vocabulary lives in
 * `core/environment/k8s-observation.ts` rather than beside the substitute control plane:
 * `validators/*` may not import `adapters/*`, so a validator here cannot know whether the cluster was
 * real, substituted or mocked, can be tested with no cluster running at all, and can be re-read from
 * a bundle a year later with nothing installed.
 *
 * The names are therefore `k8s.*` and not `sim-k8s.*`. The criterion is about the cluster, not about
 * which server answered - and the substitution *is* recorded, in the reading itself, because a
 * verdict reached against a substitute has to say so. Putting the adapter's name in the validator's
 * name would have made the substitution legible in exactly one place and made every contract written
 * against this family readable by no other cluster world.
 *
 * ## The two records, and why the family reads both
 *
 * A cluster reading keeps the *action* record apart from the *state* record (the vocabulary file says
 * why at length). The family mirrors that split rather than collapsing it, because the two answer
 * different questions and have different repairs:
 *
 * - `k8s.applied` reads `applied` - what a submission asked for, and what the server answered.
 *   A resource that existed before the run is not evidence that this run deployed anything, and a
 *   contract that only ever checked state could pass on an empty deploy step.
 * - `k8s.deployment`, `k8s.image`, `k8s.ready`, `k8s.pod` and `k8s.service` read state - what the
 *   cluster holds. A submission the server accepted and a rollout that never converged are different
 *   defects: the first is a missing object, the second is an object that is present and wrong.
 * - `k8s.event` reads the cluster's own narrative, which is the only place an operator learns *why* a
 *   rollout stopped. "0 of 3 ready" is a symptom; `Warning/Failed` naming the image is the cause.
 *
 * ## Status discipline
 *
 * The same branches as the other two families, chosen so that a wrong answer is never produced:
 *
 * - `PASS` - the comparison held, and the fact was actually read from the cluster.
 * - `FAIL` - the comparison did not hold. Reserved for facts about *the cluster*: a deployment that
 *   was never created, an image tag nothing built, replicas that never came ready.
 * - `INCONCLUSIVE` - nobody looked, or there was nothing to look at. No matching pod for a selector,
 *   a namespace the reading was never scoped to, a target the reading does not mention.
 * - `ERROR` - the *criterion* is unusable (a comparison that wants a submission result and got a
 *   number, a selector that does not parse) or the world arrived unreadable. Never `TEST_FAILURE`: a
 *   typo in a contract is not a defect in the application.
 *
 * ## The namespace guard
 *
 * Almost every validator here demands that the target's namespace is the namespace the reading was
 * scoped to, and refuses otherwise rather than reporting absence. A reading is a *view* of one
 * namespace, so an object missing from it may simply be somewhere nobody looked - and "the deployment
 * does not exist" is a false accusation with a repair that would send an agent to rewrite a manifest
 * that was never wrong. This is the one place in the family where a `null` is deliberately *not*
 * turned into a negative answer.
 */

import { K8S_APPLY_RESULTS, K8S_OBSERVATION_KIND, deploymentOf, isK8sObservationData, parseSelector, podsMatching, serviceOf, splitRef } from "../../core/environment/k8s-observation.ts";
import type { K8sApplyResult, K8sObservationData } from "../../core/environment/k8s-observation.ts";
import type { ComparisonKey } from "../../core/acceptance/plan.ts";
import type { Observation } from "../../core/environment/types.ts";
import {
  assertion,
  compareCounts,
  comparePresence,
  compareText,
  describe,
  judge,
  notDeclared,
  quote,
  unanswered,
  unusable,
} from "../../core/validation/assertions.ts";
import type { ComparisonOutcome } from "../../core/validation/assertions.ts";
import type { AssertionResult, Validator } from "../../core/validation/types.ts";

/**
 * The names, in one place.
 *
 * All lower case, and that is a contract rather than a taste: `acceptance.schema.json` matches a
 * validator name against `/^[a-z0-9]+(\.[a-z0-9]+)+$/`, so `k8s.readyReplicas` is not merely
 * unconventional - it is an acceptance contract that cannot be written at all. The database family
 * paid for this rule by writing its example; this family inherits it, which is the point of a rule
 * being written down at the place it was discovered.
 */
export const K8S_VALIDATOR_NAMES = {
  applied: "k8s.applied",
  deployment: "k8s.deployment",
  image: "k8s.image",
  ready: "k8s.ready",
  pod: "k8s.pod",
  service: "k8s.service",
  event: "k8s.event",
} as const;

// ---- reading the document ------------------------------------------------------------------------

const isAssertion = (value: unknown): value is AssertionResult =>
  typeof value === "object" && value !== null && "status" in value;

function readDocument(
  observation: Observation,
  validator: string,
  target: string | null,
): K8sObservationData | AssertionResult {
  if (isK8sObservationData(observation.data)) return observation.data;
  return assertion(
    validator,
    target,
    "ERROR",
    observation.data,
    null,
    `The observation declares kind "${observation.kind}" but does not carry a cluster document, so ` +
      "there is nothing to read. The adapter produced the reading, so this is a defect in the " +
      "environment rather than a cluster the criterion failed against.",
    "ENVIRONMENT_FAILURE",
  );
}

const noTarget = (validator: string, what: string): AssertionResult =>
  unusable(validator, null, `This validator reads ${what}, and the criterion named no target.`);

const targetOf = (raw: Readonly<Record<string, unknown>>): string | null =>
  typeof raw["target"] === "string" ? raw["target"] : null;

/**
 * A `namespace/name` target, split, or an answer saying why it cannot be used.
 *
 * The namespace is *required* rather than defaulted, and the difference matters: `splitRef` refuses a
 * bare name, so a criterion that wrote `cart-web` is told to write `dev/cart-web` instead of being
 * silently pointed at whichever namespace the reading happened to hold.
 */
function namespaced(
  validator: string,
  target: string | null,
  what: string,
): { readonly namespace: string; readonly name: string } | AssertionResult {
  if (target === null) return noTarget(validator, what);
  const ref = splitRef(target);
  if (ref === null) {
    return unusable(
      validator,
      target,
      `A ${what} is named as \`namespace/name\`, and it received ${quote(target)}. The namespace is ` +
        "part of the name on purpose: a cluster is namespaced, and defaulting it would judge " +
        "whichever namespace happened to be in the reading.",
    );
  }
  return ref;
}

/**
 * The namespace guard.
 *
 * Refuses a target naming a namespace the reading was not scoped to, instead of reporting the object
 * absent. See the family's header note: "does not exist" and "was not looked for" are different
 * facts, and only one of them is a defect in the application.
 */
function inScope(
  validator: string,
  target: string,
  ref: { readonly namespace: string },
  document: K8sObservationData,
): AssertionResult | null {
  if (ref.namespace === document.namespace) return null;
  return unusable(
    validator,
    target,
    `The criterion names namespace ${quote(ref.namespace)}, and this reading is scoped to ` +
      `${quote(document.namespace)}. Nothing outside that namespace was read, so an object missing ` +
      "from this document is a fact about the reading rather than about the cluster - and reporting " +
      "it as absent would send a repair at a manifest that was never wrong.",
  );
}

// ---- `k8s.applied`'s comparison ----------------------------------------------------------------

/**
 * One submission result against one comparison.
 *
 * The expected value is checked against the closed vocabulary rather than treated as free text. A
 * criterion asking whether a submission `equals: "succeeded"` would otherwise be a comparison that is
 * always false, which reads as an application defect and is a misspelt word in a contract.
 */
function compareApplyResult(key: ComparisonKey, actual: string, expected: unknown): ComparisonOutcome {
  if (key !== "equals") return notDeclared(key, "equals");
  if (typeof expected !== "string" || !(K8S_APPLY_RESULTS as readonly string[]).includes(expected)) {
    return {
      kind: "unusable",
      message:
        `"equals" on a submission result wants one of ${K8S_APPLY_RESULTS.join(", ")}; it received ` +
        `${describe(expected)}.`,
    };
  }
  return { kind: "judged", holds: actual === expected, phrase: `to be ${expected}` };
}

// ---- the family ---------------------------------------------------------------------------------

/**
 * What the API server answered to a submission of `Kind/name`.
 *
 * The action record, and the one validator here that can fail while the cluster looks perfect - which
 * is exactly the false pass it exists to refuse. The `target` is `Kind/name` (`Deployment/cart-web`),
 * matched inside the run's own namespace: the object identity a submission is recorded under.
 *
 * When the same object was submitted more than once, the **newest** record is judged. `applied` is a
 * chronological log of requests, so the last entry is what the server thinks now - and a criterion
 * that judged the first would report a refusal that a later accepted submission had already fixed.
 */
const applied: Validator = {
  name: K8S_VALIDATOR_NAMES.applied,
  needsTarget: true,
  targetNoun: "submitted object, written `Kind/name`",
  comparisons: ["equals"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, applied.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(applied.name, "an object written `Kind/name`");

    const slash = target.indexOf("/");
    if (slash <= 0 || slash === target.length - 1) {
      return unusable(
        applied.name,
        target,
        `A submitted object is written \`Kind/name\`, and it received ${quote(target)}. The kind is ` +
          "part of the name on purpose: a Deployment and a Service may share a name, and a criterion " +
          "that named only the name would be judged against whichever the reader reached first.",
      );
    }
    const kind = target.slice(0, slash);
    const name = target.slice(slash + 1);

    const matches = document.applied.filter(
      (record) => record.namespace === document.namespace && record.kind === kind && record.name === name,
    );
    const last = matches[matches.length - 1];
    if (last === undefined) {
      return unanswered(
        applied.name,
        target,
        `No submission of ${quote(target)} appears in this reading's ` +
          `${String(document.applied.length)} recorded ` +
          `${document.applied.length === 1 ? "submission" : "submissions"}, so there is no answer to ` +
          "compare. A deploy step that never ran and a deploy step the server refused are different " +
          "defects, and `k8s.applied` can only report the second - this is the first.",
      );
    }
    return judge(applied.name, target, `the submission of ${quote(target)}`, last.result, raw, compareApplyResult);
  },
};

const deployment: Validator = {
  name: K8S_VALIDATOR_NAMES.deployment,
  needsTarget: true,
  targetNoun: "deployment, written `namespace/name`",
  comparisons: ["equals"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, deployment.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const ref = namespaced(deployment.name, target, "deployment");
    if (isAssertion(ref)) return ref;
    const scoped = inScope(deployment.name, target ?? "", ref, document);
    if (scoped !== null) return scoped;
    return judge(
      deployment.name,
      target,
      `the deployment ${quote(ref.name)} in namespace ${quote(ref.namespace)}`,
      deploymentOf(document, ref.namespace, ref.name) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * The container image the deployment *asks for*.
 *
 * Compared as text rather than as a tag, because the interesting failures are all prefix-shaped: a
 * build that stamped `:latest` where the manifest named `:1.4.0`, a registry host that moved, a
 * digest that no longer matches. And it is the spec, not the runtime: a deployment whose pods are
 * stuck pulling an image still *asks for* that image, which is why this validator can pass while
 * `k8s.ready` fails - and the pair of them says "the manifest is right and nothing built it", which is
 * a different repair from "the manifest named the wrong tag".
 */
const image: Validator = {
  name: K8S_VALIDATOR_NAMES.image,
  needsTarget: true,
  targetNoun: "deployment, written `namespace/name`",
  comparisons: ["equals", "contains", "matches"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, image.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const ref = namespaced(image.name, target, "deployment");
    if (isAssertion(ref)) return ref;
    const scoped = inScope(image.name, target ?? "", ref, document);
    if (scoped !== null) return scoped;

    const found = deploymentOf(document, ref.namespace, ref.name);
    if (found === null) {
      return unanswered(
        image.name,
        target,
        `The cluster holds no deployment ${quote(ref.name)} in namespace ${quote(ref.namespace)}, so ` +
          "there is no image to read. Whether the deployment should exist is a question for " +
          "`k8s.deployment`; this validator can only report that there was nothing to measure.",
      );
    }
    return judge(
      image.name,
      target,
      `the image of the deployment ${quote(ref.name)}`,
      found.image,
      raw,
      compareText,
    );
  },
};

/**
 * How many replicas are actually **ready**.
 *
 * `status.readyReplicas`, not `spec.replicas`. The two are different facts and the gap between them
 * is where every rollout failure lives: a deployment asking for three replicas and serving none is
 * `replicas: 3` and `readyReplicas: 0`, and a contract that checked only the spec would report a
 * healthy cluster that was serving nothing.
 */
const ready: Validator = {
  name: K8S_VALIDATOR_NAMES.ready,
  needsTarget: true,
  targetNoun: "deployment, written `namespace/name`",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, ready.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const ref = namespaced(ready.name, target, "deployment");
    if (isAssertion(ref)) return ref;
    const scoped = inScope(ready.name, target ?? "", ref, document);
    if (scoped !== null) return scoped;

    const found = deploymentOf(document, ref.namespace, ref.name);
    if (found === null) {
      return unanswered(
        ready.name,
        target,
        `The cluster holds no deployment ${quote(ref.name)} in namespace ${quote(ref.namespace)}, so ` +
          "there is no replica status to read. A deployment that was never created and a rollout that " +
          "never converged are different defects, and this is the first - `k8s.deployment` is the " +
          "validator that reports it.",
      );
    }
    return judge(
      ready.name,
      target,
      `the number of ready replicas of ${quote(ref.name)}`,
      found.readyReplicas,
      raw,
      compareCounts,
    );
  },
};

/**
 * How many pods matching a label selector are **ready**.
 *
 * The target is a selector (`app=cart`) rather than a pod name, and deliberately: a pod's name
 * carries a hash the criterion cannot predict, so a validator that demanded one could only ever be
 * used against a pod a previous reading happened to name. A selector is what an operator actually
 * has.
 *
 * `INCONCLUSIVE` when nothing matches, rather than the vacuous pass that "every matching pod is
 * ready" would give: a selector that matched nothing and a selector that matched three healthy pods
 * are different worlds, and reporting the first as satisfied is the shape of false pass this family
 * exists to refuse. A selector that does not parse is refused too, because "0 pods ready" from a
 * misspelt selector is indistinguishable from a rollout that genuinely failed.
 */
const pod: Validator = {
  name: K8S_VALIDATOR_NAMES.pod,
  needsTarget: true,
  targetNoun: "label selector, written `key=value`",
  comparisons: ["equals", "atLeast", "atMost"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, pod.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(pod.name, "a label selector");

    const selector = parseSelector(target);
    if (selector === null) {
      return unusable(
        pod.name,
        target,
        `A label selector is written \`key=value\` and may list several separated by commas; it ` +
          `received ${quote(target)}. A selector that matched nothing because it was malformed would ` +
          "report zero ready pods, which is indistinguishable from a rollout that genuinely failed.",
      );
    }
    const matches = podsMatching(document, document.namespace, selector);
    if (matches.length === 0) {
      return unanswered(
        pod.name,
        target,
        `No pod in namespace ${quote(document.namespace)} carries ${quote(target)}. A selector that ` +
          "matched nothing has nothing to count, and reporting it as zero ready pods would accuse a " +
          "rollout of failing when the criterion may simply be reading the wrong labels.",
      );
    }
    const readyCount = matches.filter((entry) => entry.ready).length;
    return judge(
      pod.name,
      target,
      `the number of ready pods matching ${quote(target)}`,
      readyCount,
      raw,
      compareCounts,
    );
  },
};

const service: Validator = {
  name: K8S_VALIDATOR_NAMES.service,
  needsTarget: true,
  targetNoun: "service, written `namespace/name`",
  comparisons: ["equals"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, service.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    const ref = namespaced(service.name, target, "service");
    if (isAssertion(ref)) return ref;
    const scoped = inScope(service.name, target ?? "", ref, document);
    if (scoped !== null) return scoped;
    return judge(
      service.name,
      target,
      `the service ${quote(ref.name)} in namespace ${quote(ref.namespace)}`,
      serviceOf(document, ref.namespace, ref.name) !== null,
      raw,
      comparePresence,
    );
  },
};

/**
 * Whether the cluster said anything *with a given reason*.
 *
 * The target is an event reason (`Failed`, `ScalingReplicaSet`, `Scheduled`), which is the one part
 * of an event a criterion can name: the message carries an image tag and a node name that change, and
 * the reason is the vocabulary the cluster itself uses.
 *
 * This is the validator that reads the cluster's narrative, and it is the one a human would use. A
 * repaired manifest makes `Warning/Failed` stop appearing, and the *absence* of the event is the
 * evidence that the repair worked - which is why `equals: absent` is as much a check as
 * `equals: present`, and why both are read from the log rather than from the pod's phase.
 */
const event: Validator = {
  name: K8S_VALIDATOR_NAMES.event,
  needsTarget: true,
  targetNoun: "event reason",
  comparisons: ["equals"],
  observationKind: K8S_OBSERVATION_KIND,
  validate(raw, observation) {
    const document = readDocument(observation, event.name, null);
    if (isAssertion(document)) return document;
    const target = targetOf(raw);
    if (target === null) return noTarget(event.name, "an event reason");

    // Any type, not only `Warning`: the cluster's own vocabulary puts `ScalingReplicaSet` and
    // `Scheduled` under `Normal`, and a criterion asking whether the controller scaled anything is
    // asking about the narrative rather than about a complaint. Reading warnings only would have made
    // half the vocabulary unwritable for a reason that is about event types, not about this validator.
    const matches = document.events.filter(
      (entry) => entry.namespace === document.namespace && entry.reason === target,
    );
    return judge(
      event.name,
      target,
      `an event with reason ${quote(target)} in namespace ${quote(document.namespace)}`,
      matches.length > 0,
      raw,
      comparePresence,
    );
  },
};

/** The whole family, in the order a reader would look for it. */
export const K8S_VALIDATORS: readonly Validator[] = Object.freeze([
  applied,
  deployment,
  image,
  ready,
  pod,
  service,
  event,
]);

/** A fresh array of the same validators, for a registry that wants to own its list. */
export function k8sValidators(): Validator[] {
  return [...K8S_VALIDATORS];
}
