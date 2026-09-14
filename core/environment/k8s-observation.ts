/**
 * The vocabulary a cluster adapter and a cluster validator share.
 *
 * It lives here, beside `web-observation.ts` and `db-observation.ts`, for the reason those two state:
 * `validators/*` may not import `adapters/*`. A validator that read the adapter's own types could not
 * be tested without a cluster running, and would have to be rewritten the day the substitute control
 * plane changed shape.
 *
 * ## What this document is, and what it is not
 *
 * It is a **reading of a cluster**, taken over the cluster's own API. It is not a claim about
 * Kubernetes. A world that stands a substitute API server in front of an application has judged the
 * application against *that* server, and `simulated` below is where the substitution is written down
 * so the claim never has to be inferred.
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 sets three conditions a simulated world must satisfy.
 * This file is condition 3 - *the substitution is declared* - expressed as a field rather than as a
 * paragraph in a README, because a declaration nobody can read from the bundle is not a declaration.
 *
 * ## The three things a cluster reading keeps apart
 *
 * 1. `applied` - what the application's own code *asked for*, recorded from the API server's own
 *    request log. This is the action record. Without it, a criterion could pass because a resource
 *    existed, with no evidence that the run's own deploy step is what put it there.
 * 2. `deployments` / `pods` / `services` / `events` - what the cluster *holds*, read back over the
 *    API. This is the state record.
 * 3. `simulated` - which surfaces were substituted. This is the reach of the claim.
 *
 * Collapsing (1) into (2) is the common shortcut and it is a false pass with a longer name: a
 * resource that was already in the cluster before the run is not evidence that this run deployed
 * anything.
 */

/** Adapter-defined observation kind. Validators declare the kind they understand. */
export const K8S_OBSERVATION_KIND = "k8s.cluster";

/**
 * The cluster surfaces a simulated world substitutes, named in every reading.
 *
 * The API server itself is deliberately **not** on this list, because it is not substituted: it is a
 * real HTTP server the application really connects to and really speaks a JSON API to. What stands in
 * is everything behind it - nobody schedules pods, nobody pulls an image, nobody reconciles desired
 * state. Those are the words below, and each one is a thing a real cluster does that this world does
 * not.
 *
 * `cri` is the container runtime interface: the substitute decides whether an image exists rather
 * than asking a runtime to pull it. That substitution is what makes `ImagePullBackOff` reproducible
 * offline - and it is a *faithful* substitution, because a real cluster fails this way for exactly
 * this reason when a tag was never pushed.
 */
export const K8S_SIMULATED_SURFACES = [
  "scheduler",
  "kubelet",
  "cri",
  "etcd",
  "cni",
  "admission",
  "ingress",
] as const;

export type K8sSimulatedSurface = (typeof K8S_SIMULATED_SURFACES)[number];

/** How the API server answered one `apply`. Recorded per request, not summarised. */
export const K8S_APPLY_RESULTS = ["created", "configured", "unchanged", "rejected"] as const;
export type K8sApplyResult = (typeof K8S_APPLY_RESULTS)[number];

/**
 * One object something asked this cluster to hold.
 *
 * `source` names where the submission came from, and it is a *recorded fact* rather than a
 * decoration: the manifest file's path when a criterion's `apply` step made the request, or the
 * API server's own identification of the request (`POST /apis/apps/v1/namespaces/dev/deployments`)
 * when the application's own deploy tool made it. The two are kept apart because they are different
 * claims about the same cluster - "Veridian asked for this" and "the software under test asked for
 * this" - and a reader who could not tell them apart would trace a failure to the wrong file.
 *
 * `result` is the API server's own answer rather than the client's opinion of it. A `rejected`
 * submission is recorded rather than thrown, because an application's deploy tool noticing a refusal
 * may be exactly what a criterion is checking - and an adapter that swallowed the refusal would let
 * that criterion pass on a request the cluster never accepted.
 */
export interface K8sApplyRecord {
  readonly source: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
  readonly result: K8sApplyResult;
  /** The API server's stated reason when it refused, or `null`. Never invented by the reading. */
  readonly reason: string | null;
}

/** One condition, as the substitute control plane reports it. The wording is the API's, not ours. */
export interface K8sCondition {
  readonly type: string;
  readonly status: string;
  readonly reason: string;
  readonly message: string;
}

export interface K8sDeploymentReading {
  readonly namespace: string;
  readonly name: string;
  /** The container image in `spec.template`. Recorded because a wrong tag is the classic defect. */
  readonly image: string;
  /** `spec.replicas` - what was asked for. */
  readonly replicas: number;
  /** `status.readyReplicas` - what is actually serving. The two are different facts. */
  readonly readyReplicas: number;
  readonly availableReplicas: number;
  /** `metadata.generation` against `status.observedGeneration`: has the controller seen this spec? */
  readonly generation: number;
  readonly observedGeneration: number;
  readonly revision: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly conditions: readonly K8sCondition[];
}

export const K8S_POD_PHASES = ["Pending", "Running", "Succeeded", "Failed", "Unknown"] as const;
export type K8sPodPhase = (typeof K8S_POD_PHASES)[number];

export interface K8sPodReading {
  readonly namespace: string;
  readonly name: string;
  /** The owning deployment, or `null` for a pod nothing owns. */
  readonly deployment: string | null;
  /** The node the scheduler *would* have chosen, or `null` while it is unscheduled. */
  readonly node: string | null;
  readonly phase: K8sPodPhase;
  readonly ready: boolean;
  readonly restarts: number;
  readonly image: string;
  readonly labels: Readonly<Record<string, string>>;
  /** Why the pod is not ready, in the substitute's own words. `null` when it is. */
  readonly reason: string | null;
}

export interface K8sServicePort {
  readonly name: string;
  readonly port: number;
  readonly targetPort: number;
  readonly protocol: string;
}

export interface K8sServiceReading {
  readonly namespace: string;
  readonly name: string;
  readonly type: string;
  /** `null` while the substitute has not assigned one - which is a real, observable state. */
  readonly clusterIP: string | null;
  readonly ports: readonly K8sServicePort[];
  readonly selector: Readonly<Record<string, string>>;
}

/**
 * One event.
 *
 * Events are the cluster's own narrative, and they are how a human diagnoses a rollout that never
 * finished. A reading that kept only the *state* would say "0 of 3 pods ready" and leave the reader
 * to guess; `Warning/Failed` with the image name says why.
 */
export interface K8sEventReading {
  readonly namespace: string;
  readonly type: "Normal" | "Warning";
  readonly reason: string;
  readonly message: string;
  readonly objectKind: string;
  readonly objectName: string;
  readonly count: number;
}

export interface K8sObservationData {
  /**
   * The API server the application actually talked to.
   *
   * Recorded because the first question asked of any cluster result is *which* cluster, and a
   * substitute answering on `127.0.0.1` must be visibly a substitute rather than an unnamed one.
   */
  readonly apiServer: string;
  /** The cluster name the environment document declared. */
  readonly cluster: string;
  /** The namespace this run was scoped to. Every reading below is from it. */
  readonly namespace: string;
  /** The substituted surfaces, from the closed vocabulary above. */
  readonly simulated: readonly K8sSimulatedSurface[];
  readonly applied: readonly K8sApplyRecord[];
  readonly deployments: readonly K8sDeploymentReading[];
  readonly pods: readonly K8sPodReading[];
  readonly services: readonly K8sServiceReading[];
  readonly events: readonly K8sEventReading[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isCondition = (value: unknown): value is K8sCondition =>
  isRecord(value) &&
  typeof value["type"] === "string" &&
  typeof value["status"] === "string" &&
  typeof value["reason"] === "string" &&
  typeof value["message"] === "string";

const isApply = (value: unknown): value is K8sApplyRecord =>
  isRecord(value) &&
  typeof value["source"] === "string" &&
  typeof value["kind"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["namespace"] === "string" &&
  typeof value["result"] === "string" &&
  (value["reason"] === null || typeof value["reason"] === "string");

const isDeployment = (value: unknown): value is K8sDeploymentReading =>
  isRecord(value) &&
  typeof value["namespace"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["image"] === "string" &&
  typeof value["replicas"] === "number" &&
  typeof value["readyReplicas"] === "number" &&
  typeof value["availableReplicas"] === "number" &&
  typeof value["generation"] === "number" &&
  typeof value["observedGeneration"] === "number" &&
  typeof value["revision"] === "number" &&
  isStringMap(value["labels"]) &&
  Array.isArray(value["conditions"]) &&
  value["conditions"].every(isCondition);

const isPod = (value: unknown): value is K8sPodReading =>
  isRecord(value) &&
  typeof value["namespace"] === "string" &&
  typeof value["name"] === "string" &&
  (value["deployment"] === null || typeof value["deployment"] === "string") &&
  (value["node"] === null || typeof value["node"] === "string") &&
  typeof value["phase"] === "string" &&
  typeof value["ready"] === "boolean" &&
  typeof value["restarts"] === "number" &&
  typeof value["image"] === "string" &&
  isStringMap(value["labels"]) &&
  (value["reason"] === null || typeof value["reason"] === "string");

const isPort = (value: unknown): value is K8sServicePort =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["port"] === "number" &&
  typeof value["targetPort"] === "number" &&
  typeof value["protocol"] === "string";

const isService = (value: unknown): value is K8sServiceReading =>
  isRecord(value) &&
  typeof value["namespace"] === "string" &&
  typeof value["name"] === "string" &&
  typeof value["type"] === "string" &&
  (value["clusterIP"] === null || typeof value["clusterIP"] === "string") &&
  Array.isArray(value["ports"]) &&
  value["ports"].every(isPort) &&
  isStringMap(value["selector"]);

const isEvent = (value: unknown): value is K8sEventReading =>
  isRecord(value) &&
  typeof value["namespace"] === "string" &&
  typeof value["type"] === "string" &&
  typeof value["reason"] === "string" &&
  typeof value["message"] === "string" &&
  typeof value["objectKind"] === "string" &&
  typeof value["objectName"] === "string" &&
  typeof value["count"] === "number";

/**
 * A structural check, not a schema validation.
 *
 * It answers "can this be read as a cluster document", and that answer is what separates a validator
 * judging a world from a validator reporting that the world arrived unreadable. Those are different
 * verdicts with different repairs.
 */
export function isK8sObservationData(value: unknown): value is K8sObservationData {
  if (!isRecord(value)) return false;
  if (typeof value["apiServer"] !== "string") return false;
  if (typeof value["cluster"] !== "string") return false;
  if (typeof value["namespace"] !== "string") return false;
  if (!isStringArray(value["simulated"])) return false;
  if (!Array.isArray(value["applied"]) || !value["applied"].every(isApply)) return false;
  if (!Array.isArray(value["deployments"]) || !value["deployments"].every(isDeployment)) return false;
  if (!Array.isArray(value["pods"]) || !value["pods"].every(isPod)) return false;
  if (!Array.isArray(value["services"]) || !value["services"].every(isService)) return false;
  return Array.isArray(value["events"]) && value["events"].every(isEvent);
}

/**
 * A `namespace/name` reference, split. `null` when the target is not written that way.
 *
 * A named function rather than two `indexOf` calls at each call site, because three validators ask
 * the same question and the day the spelling changes it must change once. A bare name without a
 * namespace is refused rather than defaulted: a cluster is namespaced, and defaulting would make a
 * criterion silently judge a different namespace from the one the run used.
 */
export function splitRef(target: string): { readonly namespace: string; readonly name: string } | null {
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) return null;
  return { namespace: target.slice(0, slash), name: target.slice(slash + 1) };
}

/** The named deployment, or `null`. Absence is an ordinary answer, not an error. */
export function deploymentOf(data: K8sObservationData, namespace: string, name: string): K8sDeploymentReading | null {
  return data.deployments.find((entry) => entry.namespace === namespace && entry.name === name) ?? null;
}

/** The named service, or `null`. */
export function serviceOf(data: K8sObservationData, namespace: string, name: string): K8sServiceReading | null {
  return data.services.find((entry) => entry.namespace === namespace && entry.name === name) ?? null;
}

/**
 * A label selector, parsed from `app=cart,tier=web`.
 *
 * Refused rather than guessed when malformed: a selector that silently matched nothing would report
 * "0 pods ready", which is indistinguishable from a rollout that genuinely failed - and the two have
 * different repairs. The caller turns the `null` into an unusable-expectation error.
 */
export function parseSelector(selector: string): Readonly<Record<string, string>> | null {
  const pairs = selector.split(",").filter((entry) => entry.trim() !== "");
  if (pairs.length === 0) return null;
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const equals = pair.indexOf("=");
    if (equals <= 0 || equals === pair.length - 1) return null;
    const key = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (key === "" || value === "") return null;
    result[key] = value;
  }
  return result;
}

/** Every pod in the namespace whose labels contain every pair of `selector`. */
export function podsMatching(
  data: K8sObservationData,
  namespace: string,
  selector: Readonly<Record<string, string>>,
): readonly K8sPodReading[] {
  return data.pods.filter(
    (pod) =>
      pod.namespace === namespace &&
      Object.entries(selector).every(([key, value]) => pod.labels[key] === value),
  );
}

/** Every `Warning` event in the namespace with the given reason, in the order the cluster reported them. */
export function warningsFor(data: K8sObservationData, namespace: string, reason: string): readonly K8sEventReading[] {
  return data.events.filter(
    (event) => event.namespace === namespace && event.type === "Warning" && event.reason === reason,
  );
}
