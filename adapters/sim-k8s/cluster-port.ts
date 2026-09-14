/**
 * The substitute control plane: a real HTTP server the application really talks to.
 *
 * ## Why this is not a stub, and what makes it a *simulated* world rather than a fake one
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` §5 sets three conditions, and this file is where the first
 * two are met:
 *
 * 1. **The application executes for real.** The deploy tool this world runs is the application's own
 *    code in a real child process, and it reaches this server over a real TCP socket with a real
 *    HTTP client. Nothing is intercepted and nothing is monkey-patched. If its request is malformed,
 *    it gets a real `422` from a real server, exactly as it would from a cluster.
 * 2. **The interfaces are real.** The routes below are the Kubernetes API's own paths
 *    (`/apis/apps/v1/namespaces/<ns>/deployments`), the objects are the API's own objects, and the
 *    refusals carry the API's own `Status` shape. An application that works against this server
 *    works against a cluster for every request it made here - which is a narrower claim than "it
 *    works on Kubernetes", and the narrower claim is the true one.
 *
 * What is **not** real is everything *behind* the API, and that is what
 * `K8S_SIMULATED_SURFACES` names: nobody schedules pods, nobody reconciles, nobody pulls an image.
 * The substitution is declared in every reading rather than left to be inferred, because a world
 * that quietly answers for a cluster is the failure this whole product exists to prevent - not
 * because the answer is wrong, but because nobody could tell it was a substitute.
 *
 * ## The failure this models is a real one
 *
 * The substitute registry holds **exactly the images the application's own build produced**, read
 * from `cluster.imagesPath`. A manifest naming a tag that was never built therefore fails with
 * `ImagePullBackOff`, which is what a real cluster does for exactly this reason. That property
 * matters more than any amount of fidelity in the scheduler: the world reproduces a *genuine*
 * Kubernetes failure mode offline, instead of a knob somebody set to make a demo go red.
 *
 * ## Determinism
 *
 * Pod names are derived from the deployment's name and revision with a stable hash, listings are
 * sorted by name, and events are merged by identity with an incremented count. Nothing here reads
 * the clock or a random source. A run repeated must produce the same reading, because "the same code
 * gave the same result twice" (M1) is measured over exactly these documents, and a world that
 * shuffled its own output would make that measurement meaningless.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { K8S_SIMULATED_SURFACES } from "../../core/environment/k8s-observation.ts";
import type {
  K8sApplyRecord,
  K8sApplyResult,
  K8sCondition,
  K8sDeploymentReading,
  K8sEventReading,
  K8sPodPhase,
  K8sPodReading,
  K8sServicePort,
  K8sServiceReading,
} from "../../core/environment/k8s-observation.ts";

/** Everything readable about the cluster, scoped to one namespace. */
export interface ClusterSnapshot {
  readonly deployments: readonly K8sDeploymentReading[];
  readonly pods: readonly K8sPodReading[];
  readonly services: readonly K8sServiceReading[];
  readonly events: readonly K8sEventReading[];
}

/**
 * The cluster.
 *
 * The adapter talks to this and never to `node:http`, on the same rule `local-db` follows with its
 * database port: the transport is the port's business, and an adapter that knew about sockets would
 * have to be rewritten to be tested without one.
 */
export interface ClusterPort {
  /** Bind the declared address and return the URL actually bound. Throws on `EADDRINUSE`. */
  listen(address: { readonly host: string; readonly port: number }): Promise<string>;
  close(): Promise<void>;
  /** Every object the application's own code asked this cluster to hold, in request order. */
  applies(): readonly K8sApplyRecord[];
  /** Read the cluster. Sorted, so two readings of one state are byte-identical. */
  snapshot(namespace: string): ClusterSnapshot;
  /** Empty the cluster. Called by `reset()`. */
  clear(): void;
  /**
   * The cluster's stored objects as JSON, for `snapshot()`.
   *
   * The *stored* objects rather than the derived readings, and that distinction is the reason a
   * cluster snapshot can be restored at all: `readyReplicas`, a pod's phase and an event's count are
   * conclusions this server reaches from the objects plus the registry. Storing conclusions and
   * restoring them would freeze one reading of the registry into the world's state, so a snapshot
   * taken before a rebuild would restore a cluster that still believed in the old image.
   *
   * The action record (`applies()`) is deliberately **not** included, for the same reason the adapter
   * never clears its boundary crossings: a snapshot restores the world, it does not restore the
   * record of what the run did to it.
   */
  dump(): string;
  /** Replace the cluster's stored objects. Throws when the document is not a cluster state. */
  load(state: string): void;
  /**
   * Submit one object, the way {@link ClusterPort.applies} records it.
   *
   * This is how a criterion's `apply` step reaches the cluster: through the port, in process, on the
   * same rule `local-db` follows with `sql`. The application's *own* deploy tool reaches it over the
   * socket instead, and both produce the same objects in the same store - which is why a criterion
   * can judge a deployment the application created and a deployment the criterion created without
   * the reading caring which was which. `source` is what keeps the two apart in the record.
   */
  submit(namespace: string, object: unknown, source: string): K8sApplyRecord;
}

// ---- stored objects ------------------------------------------------------------------------------

interface StoredDeployment {
  readonly namespace: string;
  readonly name: string;
  readonly image: string;
  readonly replicas: number;
  readonly revision: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly templateLabels: Readonly<Record<string, string>>;
}

interface StoredService {
  readonly namespace: string;
  readonly name: string;
  readonly type: string;
  readonly clusterIP: string | null;
  readonly ports: readonly K8sServicePort[];
  readonly selector: Readonly<Record<string, string>>;
}

/** A refusal from the API, in the API's own `Status` shape. */
interface Refusal {
  readonly code: number;
  readonly reason: string;
  readonly message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The resource names each API group serves, so a request for a resource that does not exist and a
 * request using a method that is not supported can be answered differently.
 *
 * Kubernetes groups its objects the same way - `Deployment` under `apps/v1`, `Service`, `Pod` and
 * `Event` under the core `v1` - and the split is reproduced rather than flattened because a client
 * that has built a path for the wrong group has a different repair from one that used the wrong verb.
 */
const SERVED_RESOURCES: Readonly<Record<"apps" | "core", readonly string[]>> = Object.freeze({
  apps: Object.freeze(["deployments"]),
  core: Object.freeze(["pods", "services", "events"]),
});

const stringMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(([, entry]) => typeof entry === "string");
  return Object.fromEntries(entries) as Record<string, string>;
};

/**
 * A stable eight-character hash. FNV-1a, chosen because it is short enough to read and has no
 * dependency; nothing here needs cryptographic strength, and the only property required is that the
 * same input always produces the same output across runs and platforms.
 */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The image registry, read from the application's own build output.
 *
 * Read on every reconcile rather than captured once at construction, for two reasons that are both
 * real: the build runs *after* the port is constructed (the adapter constructs the world, then
 * builds it), and re-reading means a manifest applied, rebuilt and applied again in one run sees the
 * registry as it was at the second apply. A cached registry would have made the second apply report
 * a world the first one left behind.
 *
 * An unreadable or absent directory is an *empty* registry, not an error. The consequence is stated
 * where it lands: every deployment's pods go to `Pending` with an image-pull failure, which is the
 * correct reading of a cluster whose images were never built.
 */
function readRegistry(directory: string): ReadonlySet<string> {
  const images = new Set<string>();
  let entries: readonly string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return images;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, entry), "utf8"));
      if (isRecord(parsed) && typeof parsed["image"] === "string" && parsed["image"] !== "") {
        images.add(parsed["image"]);
      }
    } catch {
      // A marker file the build left half-written is not a reason to invent an image. Skipping it
      // makes the deployment that needed it fail visibly, which is the honest reading.
      continue;
    }
  }
  return images;
}

/**
 * The `metadata.name` a submitted object declares, or the empty string.
 *
 * The empty string is a real outcome here rather than a defensive default: a manifest with no name
 * is refused by {@link HttpCluster.#validate} with the API's own `Invalid` status, and the refusal is
 * what the caller acts on. This function only answers "which stored object should the response
 * describe", and for a nameless submission there is none.
 */
function submittedName(body: unknown): string {
  if (!isRecord(body)) return "";
  const metadata = body["metadata"];
  if (!isRecord(metadata)) return "";
  const name = metadata["name"];
  return typeof name === "string" ? name : "";
}

// ---- the server ----------------------------------------------------------------------------------

class HttpCluster implements ClusterPort {
  readonly #registryDirectory: string;
  readonly #deployments = new Map<string, StoredDeployment>();
  readonly #services = new Map<string, StoredService>();
  readonly #events = new Map<string, K8sEventReading>();
  readonly #applied: K8sApplyRecord[] = [];
  readonly #server: Server;
  #bound: string | null = null;

  constructor(registryDirectory: string) {
    this.#registryDirectory = registryDirectory;
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  async listen(address: { readonly host: string; readonly port: number }): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once("error", onError);
      this.#server.listen(address.port, address.host, () => {
        this.#server.off("error", onError);
        resolve();
      });
    });
    const bound = this.#server.address();
    if (bound === null || typeof bound === "string") {
      throw new Error("the substitute API server bound to an address it cannot describe");
    }
    this.#bound = `http://${address.host}:${String(bound.port)}`;
    return this.#bound;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      this.#server.closeAllConnections();
    });
    this.#bound = null;
  }

  applies(): readonly K8sApplyRecord[] {
    return [...this.#applied];
  }

  /**
   * Submit one object and record what the API server did with it.
   *
   * The refusal is returned in the record rather than thrown: a rejected apply is an *observation*
   * of this world, and a criterion may be built on one.
   */
  submit(namespace: string, object: unknown, source: string): K8sApplyRecord {
    const before = this.#applied.length;
    this.#object(namespace, object, source);
    const record = this.#applied[before];
    if (record !== undefined) return record;
    // Unreachable in practice: `#object` records exactly one entry on every path. Kept as an
    // explicit failure rather than a non-null assertion, so a future path that forgets to record is
    // a named error instead of a silently missing row in a bundle.
    throw new Error(`the substitute API server answered a submit to ${namespace} without recording it`);
  }

  #object(namespace: string, object: unknown, source: string): Refusal | null {
    const kind = isRecord(object) ? object["kind"] : undefined;
    if (kind === "Deployment") return this.#submitDeployment(namespace, null, object, source);
    if (kind === "Service") return this.#submitService(namespace, null, object, source);
    const refusal: Refusal = {
      code: 422,
      reason: "Invalid",
      message:
        `this server serves Deployment and Service objects, and received kind ` +
        `${JSON.stringify(kind)}`,
    };
    this.#applied.push({
      source,
      kind: typeof kind === "string" ? kind : "<unknown>",
      name: "<unknown>",
      namespace,
      result: "rejected",
      reason: `${refusal.reason}: ${refusal.message}`,
    });
    return refusal;
  }

  clear(): void {
    this.#deployments.clear();
    this.#services.clear();
    this.#events.clear();
  }

  dump(): string {
    return JSON.stringify({
      kind: "ClusterState",
      version: 1,
      deployments: [...this.#deployments.values()],
      services: [...this.#services.values()],
      events: [...this.#events.values()],
    });
  }

  load(state: string): void {
    const parsed: unknown = JSON.parse(state);
    if (!isRecord(parsed) || parsed["kind"] !== "ClusterState") {
      throw new Error("the snapshot is not a cluster state document");
    }
    const deployments = Array.isArray(parsed["deployments"]) ? parsed["deployments"] : [];
    const services = Array.isArray(parsed["services"]) ? parsed["services"] : [];
    const events = Array.isArray(parsed["events"]) ? parsed["events"] : [];
    this.clear();
    for (const entry of deployments) {
      if (!isRecord(entry)) continue;
      const namespace = entry["namespace"];
      const name = entry["name"];
      if (typeof namespace !== "string" || typeof name !== "string") continue;
      this.#deployments.set(`${namespace}/${name}`, {
        namespace,
        name,
        image: typeof entry["image"] === "string" ? entry["image"] : "",
        replicas: typeof entry["replicas"] === "number" ? entry["replicas"] : 1,
        revision: typeof entry["revision"] === "number" ? entry["revision"] : 1,
        labels: stringMap(entry["labels"]),
        templateLabels: stringMap(entry["templateLabels"]),
      });
    }
    for (const entry of services) {
      if (!isRecord(entry)) continue;
      const namespace = entry["namespace"];
      const name = entry["name"];
      if (typeof namespace !== "string" || typeof name !== "string") continue;
      this.#services.set(`${namespace}/${name}`, {
        namespace,
        name,
        type: typeof entry["type"] === "string" ? entry["type"] : "ClusterIP",
        clusterIP: typeof entry["clusterIP"] === "string" ? entry["clusterIP"] : null,
        ports: Array.isArray(entry["ports"]) ? (entry["ports"] as K8sServicePort[]) : [],
        selector: stringMap(entry["selector"]),
      });
    }
    for (const entry of events) {
      if (!isRecord(entry)) continue;
      const namespace = entry["namespace"];
      const reason = entry["reason"];
      const objectKind = entry["objectKind"];
      const objectName = entry["objectName"];
      if (
        typeof namespace !== "string" ||
        typeof reason !== "string" ||
        typeof objectKind !== "string" ||
        typeof objectName !== "string"
      ) {
        continue;
      }
      this.#events.set(`${namespace}|${String(entry["type"])}|${reason}|${objectKind}|${objectName}`, {
        namespace,
        type: entry["type"] === "Warning" ? "Warning" : "Normal",
        reason,
        message: typeof entry["message"] === "string" ? entry["message"] : "",
        objectKind,
        objectName,
        count: typeof entry["count"] === "number" ? entry["count"] : 1,
      });
    }
  }

  snapshot(namespace: string): ClusterSnapshot {
    const registry = readRegistry(this.#registryDirectory);
    const pods = this.#podsIn(namespace, registry);
    return {
      deployments: [...this.#deployments.values()]
        .filter((entry) => entry.namespace === namespace)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => this.#deployment(entry, pods)),
      pods: [...pods].sort((left, right) => left.name.localeCompare(right.name)),
      services: [...this.#services.values()]
        .filter((entry) => entry.namespace === namespace)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({ ...entry, ports: [...entry.ports] })),
      events: [...this.#events.values()]
        .filter((entry) => entry.namespace === namespace)
        .sort((left, right) => left.reason.localeCompare(right.reason) || left.objectName.localeCompare(right.objectName)),
    };
  }

  // ---- what the substitute planner, scheduler, kubelet and runtime would have produced -----------

  /**
   * The pods the deployment would own, and whether each one is actually serving.
   *
   * This is the whole of the substitute data plane: one readiness decision, made on one fact - does
   * the image exist in the registry the application's own build produced. Everything else (a node
   * name, a phase, a restart count, a reason) follows from that decision, which is why the decision
   * comes first and the rest is derived. A `Pending` pod is one the kubelet could not start, and
   * that is a different reading from a `Running` pod that is merely not ready - the two are the
   * classic pair `ImagePullBackOff` and a failing readiness probe, and a world that collapsed them
   * would send the reader to the wrong repair.
   *
   * **Derivation only. This method must never write.** An earlier shape had it record the pod events
   * on the way out, which made a *read* mutate the record: the first `snapshot()` in a run wrote
   * `count: 1` for a pod event and the second wrote `count: 2`, so two readings of one cluster
   * disagreed about it - and M1, which compares exactly these documents, would have called the same
   * cluster two different worlds. A real cluster records those events when its controller acts, not
   * when a client looks; {@link HttpCluster.#reconcile} is where acting happens.
   */
  #podsIn(namespace: string, registry: ReadonlySet<string>): readonly K8sPodReading[] {
    const pods: K8sPodReading[] = [];
    for (const deployment of [...this.#deployments.values()].filter((entry) => entry.namespace === namespace)) {
      const hash = stableHash(`${deployment.name}-${String(deployment.revision)}`);
      const pulled = registry.has(deployment.image);
      for (let index = 0; index < deployment.replicas; index += 1) {
        const name = `${deployment.name}-${hash}-${String(index)}`;
        const labels = { ...deployment.templateLabels, "pod-template-hash": hash };
        const phase: K8sPodPhase = pulled ? "Running" : "Pending";
        pods.push({
          namespace,
          name,
          deployment: deployment.name,
          node: pulled ? "sim-node-01" : null,
          phase,
          ready: pulled,
          restarts: 0,
          image: deployment.image,
          labels,
          reason: pulled ? null : "ImagePullBackOff",
        });
      }
    }
    return pods;
  }

  /**
   * Act on the desired state: derive the pods and write down what the substitute controller did.
   *
   * Called once per accepted submission and nowhere else, which is what makes the event log a record
   * of the run rather than of how many times somebody read it.
   */
  #reconcile(namespace: string): void {
    const registry = readRegistry(this.#registryDirectory);
    const pods = this.#podsIn(namespace, registry);
    for (const deployment of [...this.#deployments.values()].filter((entry) => entry.namespace === namespace)) {
      const hash = stableHash(`${deployment.name}-${String(deployment.revision)}`);
      const owned = pods.filter((pod) => pod.deployment === deployment.name);
      for (const pod of owned) {
        this.#recordEvent(namespace, {
          type: pod.ready ? "Normal" : "Warning",
          reason: pod.ready ? "Scheduled" : "Failed",
          message: pod.ready
            ? `Successfully assigned ${namespace}/${pod.name} to sim-node-01`
            : `Failed to pull image "${deployment.image}": no such image in the registry this world's build produced`,
          objectKind: "Pod",
          objectName: pod.name,
        });
      }
      this.#recordEvent(namespace, {
        type: "Normal",
        reason: "ScalingReplicaSet",
        message: `Scaled up replica set ${deployment.name}-${hash} to ${String(deployment.replicas)}`,
        objectKind: "Deployment",
        objectName: deployment.name,
      });
    }
  }

  #deployment(stored: StoredDeployment, pods: readonly K8sPodReading[]): K8sDeploymentReading {
    const owned = pods.filter((pod) => pod.namespace === stored.namespace && pod.deployment === stored.name);
    const ready = owned.filter((pod) => pod.ready).length;
    const complete = ready === stored.replicas;
    const conditions: readonly K8sCondition[] = [
      {
        type: "Available",
        status: complete ? "True" : "False",
        reason: complete ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable",
        message: complete
          ? `Deployment has minimum availability.`
          : `Deployment does not have minimum availability.`,
      },
      {
        type: "Progressing",
        status: "True",
        reason: complete ? "NewReplicaSetAvailable" : "ReplicaSetUpdated",
        message: complete
          ? `ReplicaSet "${stored.name}-${stableHash(`${stored.name}-${String(stored.revision)}`)}" has successfully progressed.`
          : `ReplicaSet "${stored.name}-${stableHash(`${stored.name}-${String(stored.revision)}`)}" is progressing.`,
      },
    ];
    return {
      namespace: stored.namespace,
      name: stored.name,
      image: stored.image,
      replicas: stored.replicas,
      readyReplicas: ready,
      availableReplicas: ready,
      generation: stored.revision,
      observedGeneration: stored.revision,
      revision: stored.revision,
      labels: { ...stored.labels },
      conditions,
    };
  }

  /**
   * Merge an event into the log by identity, incrementing `count`.
   *
   * Kubernetes does the same, and reproducing it is not decoration: a naive append would make the
   * event list grow with every reconcile, so two runs that applied the same manifests a different
   * number of times would produce different readings of the same state. Counting by identity keeps
   * the *set* of events a function of the objects, and the count a function of how many times state
   * was asserted - both of which are facts about the run rather than about how long it took.
   */
  #recordEvent(
    namespace: string,
    event: Omit<K8sEventReading, "namespace" | "count">,
  ): void {
    const key = `${namespace}|${event.type}|${event.reason}|${event.objectKind}|${event.objectName}`;
    const existing = this.#events.get(key);
    this.#events.set(key, {
      namespace,
      ...event,
      count: existing === undefined ? 1 : existing.count + 1,
    });
  }

  // ---- the API ---------------------------------------------------------------------------------

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://cluster.invalid");
    const segments = url.pathname.split("/").filter((segment) => segment !== "");

    try {
      if (segments.length === 1 && segments[0] === "version") {
        this.#json(response, 200, {
          major: "1",
          minor: "31",
          gitVersion: "v1.31.0+veridian.simulated",
          simulated: K8S_SIMULATED_SURFACES,
        });
        return;
      }

      const body = method === "POST" || method === "PUT" ? await this.#readBody(request) : null;
      // The source recorded for a submission that did not come from an `apply` step. It is what the
      // server itself observed - the method and the path - rather than a guess at which file the
      // client read, which a server cannot know. A reader comparing it against a manifest path in
      // the same bundle can tell "the software under test asked for this" from "a criterion did".
      const source = `${method} ${url.pathname}`;
      const route = this.#route(segments);
      if (route === null) {
        this.#status(response, 404, "NotFound", `the requested resource ${url.pathname} was not found`);
        return;
      }
      const { namespace, resource, name, apps } = route;
      // A resource this server does not serve is a 404, not a 405. The earlier shape fell through to
      // the method branch and answered `GET is not supported for /apis/apps/v1/namespaces/dev/configmaps`
      // - a message naming a cause the server had not observed, since `GET` was supported and the
      // *resource* was the thing missing. It sends the reader to check their HTTP method. The real
      // API answers 404 for an unknown resource and 405 for an unsupported method on a known one, and
      // the two are answered by two different conditions here for that reason.
      if (!SERVED_RESOURCES[apps ? "apps" : "core"].includes(resource)) {
        this.#status(
          response,
          404,
          "NotFound",
          `the requested resource ${url.pathname} was not found; this server serves ` +
            `Deployment objects under /apis/apps/v1 and Pod, Service and Event objects under /api/v1`,
        );
        return;
      }
      if (!apps && resource === "pods" && method === "GET") {
        this.#json(response, 200, { kind: "PodList", items: this.snapshot(namespace).pods });
        return;
      }
      if (!apps && resource === "services") {
        if (method === "GET") {
          this.#json(response, 200, { kind: "ServiceList", items: this.snapshot(namespace).services });
          return;
        }
        if (method === "POST" || method === "PUT") {
          const refusal = this.#submitService(namespace, name, body, source);
          if (refusal !== null) {
            this.#status(response, refusal.code, refusal.reason, refusal.message);
            return;
          }
          this.#json(response, 201, this.#stored("services", namespace, submittedName(body)));
          return;
        }
      }
      if (!apps && resource === "events" && method === "GET") {
        this.#json(response, 200, { kind: "EventList", items: this.snapshot(namespace).events });
        return;
      }
      if (apps && resource === "deployments") {
        if (method === "GET" && name === null) {
          this.#json(response, 200, { kind: "DeploymentList", items: this.snapshot(namespace).deployments });
          return;
        }
        if (method === "GET" && name !== null) {
          const found = this.snapshot(namespace).deployments.find((entry) => entry.name === name);
          if (found === undefined) {
            this.#status(response, 404, "NotFound", `deployments.apps "${name}" not found`);
            return;
          }
          this.#json(response, 200, found);
          return;
        }
        if (method === "POST" || method === "PUT") {
          const refusal = this.#submitDeployment(namespace, method === "PUT" ? name : null, body, source);
          if (refusal !== null) {
            this.#status(response, refusal.code, refusal.reason, refusal.message);
            return;
          }
          this.#json(response, 201, this.#stored("deployments", namespace, submittedName(body)));
          return;
        }
      }
      this.#status(response, 405, "MethodNotAllowed", `${method} is not supported for ${url.pathname}`);
    } catch (error) {
      this.#status(
        response,
        500,
        "InternalError",
        `the substitute API server failed to answer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #route(
    segments: readonly string[],
  ): {
    readonly namespace: string;
    readonly resource: string;
    readonly name: string | null;
    readonly apps: boolean;
  } | null {
    // `/apis/apps/v1/namespaces/<ns>/<resource>[/<name>]` and `/api/v1/namespaces/<ns>/<resource>`
    if (segments[0] === "apis" && segments[1] === "apps" && segments[3] === "namespaces") {
      const namespace = segments[4];
      const resource = segments[5];
      if (namespace === undefined || resource === undefined) return null;
      const name = segments.length >= 7 && segments[6] !== undefined ? segments[6] : null;
      return { namespace, resource, name, apps: true };
    }
    if (segments[0] === "api" && segments[2] === "namespaces") {
      const namespace = segments[3];
      const resource = segments[4];
      if (namespace === undefined || resource === undefined) return null;
      const name = segments.length >= 6 && segments[5] !== undefined ? segments[5] : null;
      return { namespace, resource, name, apps: false };
    }
    return null;
  }

  /**
   * The name the submitted object declares for itself.
   *
   * Read from the body rather than the URL, because a `POST` to a collection has no name in its path
   * and the name is the object's own field - exactly as the real API has it.
   */
  #stored(kind: "deployments" | "services", namespace: string, name: string): unknown {
    const readings: readonly { readonly name: string; readonly namespace: string }[] =
      kind === "deployments"
        ? [...this.#deployments.values()]
        : [...this.#services.values()];
    return readings.find((entry) => entry.namespace === namespace && entry.name === name) ?? {};
  }

  async #readBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.trim() === "") return {};
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Store a deployment, or say why not.
   *
   * The refusals are the API's own: a namespace that does not match the URL, a `kind` this server
   * does not serve, a `spec.replicas` that is not a non-negative integer, a missing image. Each is
   * recorded in `#applied` with `result: "rejected"`, because a criterion's whole point may be that
   * the application's deploy tool is supposed to notice a refusal - and an adapter that swallowed it
   * would let that criterion pass on a request the cluster never accepted.
   */
  #submitDeployment(
    namespace: string,
    pathName: string | null,
    body: unknown,
    source: string,
  ): Refusal | null {
    const object = isRecord(body) ? body : null;
    const metadata = object !== null && isRecord(object["metadata"]) ? object["metadata"] : {};
    const spec = object !== null && isRecord(object["spec"]) ? object["spec"] : {};
    const template = isRecord(spec["template"]) ? spec["template"] : {};
    const podSpec = isRecord(template["spec"]) ? template["spec"] : {};
    const containers = Array.isArray(podSpec["containers"]) ? podSpec["containers"] : [];
    const first = isRecord(containers[0]) ? containers[0] : null;

    const name = typeof metadata["name"] === "string" ? metadata["name"] : "";
    const declaredNamespace = typeof metadata["namespace"] === "string" ? metadata["namespace"] : "";
    const image = first !== null && typeof first["image"] === "string" ? first["image"] : "";
    const replicas = typeof spec["replicas"] === "number" ? spec["replicas"] : 1;

    const refusal = this.#validate(namespace, object, name, declaredNamespace, image, spec["replicas"], replicas);
    if (refusal !== null) {
      this.#applied.push({
        source,
        kind: "Deployment",
        name: name === "" ? "<unnamed>" : name,
        namespace,
        result: "rejected",
        reason: `${refusal.reason}: ${refusal.message}`,
      });
      return refusal;
    }

    const key = `${namespace}/${name}`;
    const previous = this.#deployments.get(key);
    const labels = stringMap(metadata["labels"]);
    const templateLabels = isRecord(template["metadata"]) ? stringMap(template["metadata"]["labels"]) : {};
    const stored: StoredDeployment = {
      namespace,
      name,
      image,
      replicas,
      revision: previous === undefined ? 1 : previous.revision + 1,
      labels,
      templateLabels: Object.keys(templateLabels).length > 0 ? templateLabels : labels,
    };
    this.#deployments.set(key, stored);
    this.#recordEvent(namespace, {
      type: "Normal",
      reason: previous === undefined ? "Created" : "Updated",
      message: `Deployment ${namespace}/${name} ${previous === undefined ? "created" : "updated"} with image ${image}`,
      objectKind: "Deployment",
      objectName: name,
    });
    this.#recordEvent(namespace, {
      type: "Normal",
      reason: "DeploymentCreated",
      message: `Created new replica set for deployment ${namespace}/${name}`,
      objectKind: "Deployment",
      objectName: name,
    });
    this.#reconcile(namespace);
    this.#applied.push({
      source,
      kind: "Deployment",
      name,
      namespace,
      result: previous === undefined ? "created" : "configured",
      reason: null,
    });
    void pathName;
    return null;
  }

  #validate(
    namespace: string,
    object: Record<string, unknown> | null,
    name: string,
    declaredNamespace: string,
    image: string,
    rawReplicas: unknown,
    replicas: number,
  ): Refusal | null {
    if (object === null) {
      return { code: 400, reason: "BadRequest", message: "the request body is not a JSON object" };
    }
    if (object["kind"] !== "Deployment") {
      return {
        code: 422,
        reason: "Invalid",
        message: `this server serves Deployment and Service objects, and received kind ${JSON.stringify(object["kind"])}`,
      };
    }
    if (name === "") {
      return { code: 422, reason: "Invalid", message: "metadata.name is required" };
    }
    // An object that declares *no* namespace is namespaced by the request, which is what the real API
    // server's own strategy does and what every namespace-neutral manifest in the world relies on. A
    // manifest that declares a *different* one is a mismatch and is refused, as the real server
    // refuses it, rather than silently relocated. Both halves matter and the earlier shape had only
    // the second: requiring a literal namespace made a manifest that omits it - which is every
    // manifest a person actually writes - unwritable, so a criterion's `apply` step could only ever
    // submit an object that restated a fact the request already carried.
    if (declaredNamespace !== "" && declaredNamespace !== namespace) {
      return {
        code: 422,
        reason: "Invalid",
        message:
          `the object declares namespace ${JSON.stringify(declaredNamespace)} and was submitted to ` +
          `${JSON.stringify(namespace)}; a cluster refuses a mismatch rather than relocating the object`,
      };
    }
    if (rawReplicas !== undefined && (!Number.isInteger(replicas) || replicas < 0)) {
      return {
        code: 422,
        reason: "Invalid",
        message: `spec.replicas must be a non-negative integer, and received ${JSON.stringify(rawReplicas)}`,
      };
    }
    if (image === "") {
      return {
        code: 422,
        reason: "Invalid",
        message: "spec.template.spec.containers[0].image is required",
      };
    }
    return null;
  }

  #submitService(
    namespace: string,
    pathName: string | null,
    body: unknown,
    source: string,
  ): Refusal | null {
    const object = isRecord(body) ? body : null;
    const metadata = object !== null && isRecord(object["metadata"]) ? object["metadata"] : {};
    const spec = object !== null && isRecord(object["spec"]) ? object["spec"] : {};
    const name = typeof metadata["name"] === "string" ? metadata["name"] : "";
    const declaredNamespace = typeof metadata["namespace"] === "string" ? metadata["namespace"] : "";

    if (object === null) {
      return { code: 400, reason: "BadRequest", message: "the request body is not a JSON object" };
    }
    if (object["kind"] !== "Service") {
      return {
        code: 422,
        reason: "Invalid",
        message: `this server serves Deployment and Service objects, and received kind ${JSON.stringify(object["kind"])}`,
      };
    }
    if (name === "") return { code: 422, reason: "Invalid", message: "metadata.name is required" };
    // Same rule as the Deployment path, and stated in one place there rather than twice here: an
    // omitted namespace is taken from the request, a conflicting one is refused.
    if (declaredNamespace !== "" && declaredNamespace !== namespace) {
      return {
        code: 422,
        reason: "Invalid",
        message:
          `the object declares namespace ${JSON.stringify(declaredNamespace)} and was submitted to ` +
          `${JSON.stringify(namespace)}; a cluster refuses a mismatch rather than relocating the object`,
      };
    }

    const rawPorts = Array.isArray(spec["ports"]) ? spec["ports"] : [];
    const ports: K8sServicePort[] = [];
    for (const entry of rawPorts) {
      if (!isRecord(entry)) continue;
      const port = typeof entry["port"] === "number" ? entry["port"] : null;
      if (port === null) {
        return { code: 422, reason: "Invalid", message: "each service port requires a numeric `port`" };
      }
      ports.push({
        name: typeof entry["name"] === "string" ? entry["name"] : "",
        port,
        targetPort: typeof entry["targetPort"] === "number" ? entry["targetPort"] : port,
        protocol: typeof entry["protocol"] === "string" ? entry["protocol"] : "TCP",
      });
    }
    const key = `${namespace}/${name}`;
    const previous = this.#services.get(key);
    // A cluster IP is assigned once and never changes while the object lives, which is why an
    // update carries the previous one forward rather than deriving a fresh address.
    this.#services.set(key, {
      namespace,
      name,
      type: typeof spec["type"] === "string" ? spec["type"] : "ClusterIP",
      clusterIP: previous?.clusterIP ?? `10.96.${String(parseInt(stableHash(key).slice(0, 2), 16) % 256)}.${String(parseInt(stableHash(key).slice(2, 4), 16) % 256)}`,
      ports,
      selector: stringMap(spec["selector"]),
    });
    this.#applied.push({
      source,
      kind: "Service",
      name,
      namespace,
      result: previous === undefined ? "created" : "configured",
      reason: null,
    });
    void pathName;
    return null;
  }

  #status(response: ServerResponse, code: number, reason: string, message: string): void {
    this.#json(response, code, { kind: "Status", apiVersion: "v1", status: "Failure", code, reason, message });
  }

  #json(response: ServerResponse, code: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(code, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
  }
}

/**
 * A substitute control plane reading its image registry from `registryDirectory`.
 *
 * The registry is a *directory* rather than a list of names handed in, and that is the design rather
 * than an implementation detail: it makes the simulated world's answer depend on an artifact the
 * application's own build really produced, so the interesting failure is a disagreement between two
 * real artifacts instead of a flag someone flipped.
 */
export function httpCluster(registryDirectory: string): ClusterPort {
  return new HttpCluster(registryDirectory);
}

/** Re-exported so the adapter can name the surfaces it substitutes without importing the vocabulary file. */
export { K8S_SIMULATED_SURFACES };
export type { K8sApplyResult };
