/**
 * The substitute control plane, driven over a real socket.
 *
 * `cluster-port.ts` is the whole substance of the `sim-k8s` world: every cluster criterion's reading
 * is derived here, and every refusal an application's deploy tool sees comes from here. Until this
 * file existed the port had **no test at all** - its behaviour was reachable only through the demo,
 * which is the same defect this repository already paid for once, when the four database validators
 * that decide every verdict in their world were held by a single end-to-end example.
 *
 * ## Why these tests use `fetch` and a bound port rather than calling a method
 *
 * Because the property this world claims is not "the port's functions return the right values". It is
 * that **a real HTTP client reaches a real server on a real socket and gets the Kubernetes API's
 * answer** - that is what makes the substitution honest, and a test that called an internal method
 * would verify an object rather than a claim. So every assertion below goes through the wire, and
 * every request carries the API's own path.
 *
 * The cost is real and worth stating: these tests bind a port, so they are slower than the rest of
 * the suite, and they are the reason `listen({ port: 0 })` exists in the adapter.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { K8S_SIMULATED_SURFACES } from "../../core/environment/k8s-observation.ts";
import type { K8sApplyResult } from "../../core/environment/k8s-observation.ts";
import { httpCluster } from "./cluster-port.ts";
import type { ClusterPort, ClusterSnapshot } from "./cluster-port.ts";

/** The image the application's build is said to have produced in most fixtures. */
const IMAGE = "registry.local/cart-web:1.4.0";
/** A tag nothing in this world ever built, which is the failure this adapter models. */
const MISSING = "registry.local/cart-web:9.9.9";
const NAMESPACE = "dev";

const DEPLOYMENTS = `/apis/apps/v1/namespaces/${NAMESPACE}/deployments`;
const SERVICES = `/api/v1/namespaces/${NAMESPACE}/services`;
const PODS = `/api/v1/namespaces/${NAMESPACE}/pods`;
const EVENTS = `/api/v1/namespaces/${NAMESPACE}/events`;

/** Directories made by this file, removed when the file's tests finish. */
const scratch: string[] = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

/**
 * A registry directory holding exactly the given images.
 *
 * Written as the marker files an application's own build would leave - `{ image }` - because that
 * shape is the contract between the build and the world, and a test that built `Set`s directly would
 * not be testing the contract.
 */
function registry(images: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "veridian-sim-k8s-"));
  scratch.push(directory);
  images.forEach((image, index) => {
    writeFileSync(join(directory, `image-${String(index)}.json`), JSON.stringify({ image }), "utf8");
  });
  return directory;
}

interface Bound {
  readonly cluster: ClusterPort;
  readonly url: string;
}

/** A live control plane. Every caller closes it in an `after` hook. */
async function start(images: readonly string[]): Promise<Bound> {
  const cluster = httpCluster(registry(images));
  const url = await cluster.listen({ host: "127.0.0.1", port: 0 });
  return { cluster, url };
}

/** A control plane whose registry directory does not exist at all. */
async function startWithNoRegistry(): Promise<Bound> {
  const missing = join(tmpdir(), `veridian-sim-k8s-absent-${String(Date.now())}`);
  const cluster = httpCluster(missing);
  const url = await cluster.listen({ host: "127.0.0.1", port: 0 });
  return { cluster, url };
}

async function close(bound: Bound): Promise<void> {
  await bound.cluster.close();
}

interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function send(
  bound: Bound,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<Answer> {
  const response = await fetch(`${bound.url}${path}`, {
    method,
    ...(payload === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  });
  const parsed: unknown = await response.json();
  return { status: response.status, body: parsed as Record<string, unknown> };
}

/**
 * A workable Deployment, with any key of it replaceable.
 *
 * The default carries the labels real ones carry: `metadata.labels` for the object and
 * `spec.template.metadata.labels` for the pods, because the pod reading falls back to the object's
 * labels when the template declares none and a fixture that only ever set the template would not
 * exercise that fallback.
 */
function deployment(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "cart-web", labels: { app: "cart-web" } },
    spec: {
      replicas: 3,
      template: {
        metadata: { labels: { app: "cart-web" } },
        spec: { containers: [{ name: "cart-web", image: IMAGE }] },
      },
    },
  };
  return { ...base, ...patch };
}

function service(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "cart-web" },
    spec: { type: "ClusterIP", selector: { app: "cart-web" }, ports: [{ port: 80, targetPort: 8080 }] },
  };
  return { ...base, ...patch };
}

/** The names of every event reason present in a reading, sorted. */
function reasons(reading: ClusterSnapshot): readonly string[] {
  return reading.events.map((event) => event.reason).sort();
}

// ---------------------------------------------------------------------------------------------

describe("the substitute control plane declares itself", () => {
  it("answers the version route with the surfaces it substitutes", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "GET", "/version");
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body["simulated"], K8S_SIMULATED_SURFACES);
    } finally {
      await close(bound);
    }
  });

  it("says in its own version string that it is not a cluster", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "GET", "/version");
      const version = answer.body["gitVersion"];
      assert.equal(typeof version, "string");
      // A reader who greps a log for the version must be able to tell a substituted cluster from a
      // real one without knowing this project at all.
      assert.match(String(version), /simulated/);
    } finally {
      await close(bound);
    }
  });

  it("advertises no surface it does not substitute", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "GET", "/version");
      const surfaces = answer.body["simulated"];
      assert.ok(Array.isArray(surfaces));
      assert.ok(surfaces.length > 0, "a substitute that declares nothing is indistinguishable from a real cluster");
      for (const surface of surfaces) assert.equal(typeof surface, "string");
    } finally {
      await close(bound);
    }
  });
});

describe("the API routes are the Kubernetes API's own", () => {
  it("serves a deployment list, a named deployment, pods, services and events", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", SERVICES, service());

      const list = await send(bound, "GET", DEPLOYMENTS);
      assert.equal(list.status, 200);
      assert.equal(list.body["kind"], "DeploymentList");

      const named = await send(bound, "GET", `${DEPLOYMENTS}/cart-web`);
      assert.equal(named.status, 200);
      assert.equal(named.body["name"], "cart-web");

      const podList = await send(bound, "GET", PODS);
      assert.equal(podList.body["kind"], "PodList");
      const serviceList = await send(bound, "GET", SERVICES);
      assert.equal(serviceList.body["kind"], "ServiceList");
      const eventList = await send(bound, "GET", EVENTS);
      assert.equal(eventList.body["kind"], "EventList");
    } finally {
      await close(bound);
    }
  });

  it("answers 404 for a path it does not serve, naming the path", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "GET", "/apis/apps/v1/namespaces/dev/configmaps");
      assert.equal(answer.status, 404);
      assert.equal(answer.body["reason"], "NotFound");
      assert.match(String(answer.body["message"]), /configmaps/);
    } finally {
      await close(bound);
    }
  });

  it("answers 404 for a named deployment that is not there, rather than an empty object", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "GET", `${DEPLOYMENTS}/nope`);
      assert.equal(answer.status, 404);
      assert.match(String(answer.body["message"]), /deployments\.apps "nope" not found/);
    } finally {
      await close(bound);
    }
  });

  it("refuses a method it does not support, in the API's own Status shape", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "DELETE", DEPLOYMENTS);
      assert.equal(answer.status, 405);
      assert.equal(answer.body["kind"], "Status");
      assert.equal(answer.body["status"], "Failure");
      assert.equal(answer.body["reason"], "MethodNotAllowed");
    } finally {
      await close(bound);
    }
  });
});

describe("a submission is recorded the way a real apply is", () => {
  it("records the first submission as `created` and the second as `configured`", async () => {
    const bound = await start([IMAGE]);
    try {
      const first = await send(bound, "POST", DEPLOYMENTS, deployment());
      assert.equal(first.status, 201);
      const second = await send(bound, "POST", DEPLOYMENTS, deployment());

      const results = bound.cluster.applies().map((entry) => entry.result);
      assert.deepEqual(results, ["created", "configured"]);
      assert.equal(second.status, 201);
    } finally {
      await close(bound);
    }
  });

  it("records the source the server observed rather than a guess at the client's file", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      const record = bound.cluster.applies()[0];
      assert.ok(record !== undefined);
      assert.equal(record.source, `POST ${DEPLOYMENTS}`);
      assert.equal(record.kind, "Deployment");
      assert.equal(record.name, "cart-web");
      assert.equal(record.namespace, NAMESPACE);
      assert.equal(record.reason, null);
    } finally {
      await close(bound);
    }
  });

  it("records an apply step's manifest path as the source, keeping the two apart", async () => {
    const bound = await start([IMAGE]);
    try {
      const record = bound.cluster.submit(NAMESPACE, deployment(), "manifests/deployment.yaml");
      assert.equal(record.source, "manifests/deployment.yaml");
      await send(bound, "POST", DEPLOYMENTS, deployment());
      // Ordered: the in-process submission first, the socket's second. A reader of the bundle can
      // tell "the software under test asked for this" from "a criterion did" by this field alone.
      assert.deepEqual(
        bound.cluster.applies().map((entry) => entry.source),
        ["manifests/deployment.yaml", `POST ${DEPLOYMENTS}`],
      );
    } finally {
      await close(bound);
    }
  });

  it("bumps the revision on an update, so a rollout is visible in the reading", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", DEPLOYMENTS, deployment());
      const reading = bound.cluster.snapshot(NAMESPACE);
      assert.equal(reading.deployments[0]?.revision, 2);
      assert.equal(reading.deployments[0]?.generation, 2);
      assert.equal(reading.deployments[0]?.observedGeneration, 2);
    } finally {
      await close(bound);
    }
  });
});

describe("a refusal is an observation, not an exception", () => {
  /**
   * Each row: the patch that makes the object unworkable, and the fragment of the API's own message.
   * The message fragment is asserted rather than the code alone, because a refusal that does not say
   * what was wrong sends the reader to inspect the one thing that is not broken.
   */
  const refusals: readonly { readonly what: string; readonly patch: Record<string, unknown>; readonly says: RegExp }[] = [
    {
      what: "a kind this server does not serve",
      patch: { kind: "ConfigMap" },
      says: /this server serves Deployment and Service objects, and received kind "ConfigMap"/,
    },
    { what: "no name", patch: { metadata: { labels: {} } }, says: /metadata\.name is required/ },
    {
      what: "no image",
      patch: { spec: { replicas: 1, template: { spec: { containers: [{}] } } } },
      says: /containers\[0\]\.image is required/,
    },
    {
      what: "a negative replica count",
      patch: { spec: { replicas: -1, template: { spec: { containers: [{ image: IMAGE }] } } } },
      says: /spec\.replicas must be a non-negative integer, and received -1/,
    },
    {
      what: "a fractional replica count",
      patch: { spec: { replicas: 1.5, template: { spec: { containers: [{ image: IMAGE }] } } } },
      says: /must be a non-negative integer/,
    },
    {
      what: "a namespace that disagrees with the request",
      patch: { metadata: { name: "cart-web", namespace: "prod" } },
      says: /refuses a mismatch rather than relocating the object/,
    },
  ];

  for (const row of refusals) {
    it(`refuses ${row.what} with the API's own 422 and message`, async () => {
      const bound = await start([IMAGE]);
      try {
        const answer = await send(bound, "POST", DEPLOYMENTS, deployment(row.patch));
        assert.equal(answer.status, 422);
        assert.equal(answer.body["reason"], "Invalid");
        assert.match(String(answer.body["message"]), row.says);
      } finally {
        await close(bound);
      }
    });
  }

  it("records a refusal as a rejected apply rather than swallowing it", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({ kind: "ConfigMap" }));
      const record = bound.cluster.applies()[0];
      assert.ok(record !== undefined);
      assert.equal(record.result, "rejected");
      assert.equal(record.kind, "Deployment");
      assert.match(String(record.reason), /Invalid: this server serves Deployment and Service objects/);
      // Nothing was stored, so a criterion built on the refusal sees an empty cluster rather than a
      // half-applied one.
      assert.deepEqual(bound.cluster.snapshot(NAMESPACE).deployments, []);
    } finally {
      await close(bound);
    }
  });

  it("takes an omitted namespace from the request, the way the real API does", async () => {
    const bound = await start([IMAGE]);
    try {
      // The object carries no `metadata.namespace` at all - which is every namespace-neutral manifest
      // a person actually writes. The earlier shape required a literal namespace, so a criterion's
      // `apply` step could only ever submit an object that restated a fact the request already held.
      const posted = await send(bound, "POST", DEPLOYMENTS, {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "cart-web" },
        spec: { template: { spec: { containers: [{ image: IMAGE }] } } },
      });
      assert.equal(posted.status, 201);
      assert.equal(bound.cluster.applies()[0]?.result, "created");
      assert.equal(bound.cluster.snapshot(NAMESPACE).deployments[0]?.namespace, NAMESPACE);
      // And it is still absent from every other namespace, which is what makes the defaulting a
      // namespacing rather than a second way to write the same thing.
      assert.deepEqual(bound.cluster.snapshot("prod").deployments, []);
    } finally {
      await close(bound);
    }
  });

  it("refuses a service kind it does not serve, with the same 422", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "POST", SERVICES, service({ kind: "Endpoints" }));
      assert.equal(answer.status, 422);
      assert.match(String(answer.body["message"]), /received kind "Endpoints"/);
    } finally {
      await close(bound);
    }
  });

  it("refuses a service port with no numeric port", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "POST", SERVICES, service({ spec: { ports: [{ name: "http" }] } }));
      assert.equal(answer.status, 422);
      assert.match(String(answer.body["message"]), /each service port requires a numeric `port`/);
    } finally {
      await close(bound);
    }
  });

  it("refuses a service whose namespace disagrees with the request", async () => {
    const bound = await start([IMAGE]);
    try {
      const answer = await send(bound, "POST", SERVICES, service({ metadata: { name: "cart-web", namespace: "prod" } }));
      assert.equal(answer.status, 422);
      assert.match(String(answer.body["message"]), /refuses a mismatch/);
    } finally {
      await close(bound);
    }
  });
});

describe("the registry the application built decides what is ready", () => {
  it("reports a deployment whose image was built as running and available", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      const reading = bound.cluster.snapshot(NAMESPACE);
      assert.equal(reading.pods.length, 3);
      assert.ok(reading.pods.every((pod) => pod.ready && pod.phase === "Running" && pod.reason === null));
      assert.equal(reading.deployments[0]?.readyReplicas, 3);
      assert.equal(reading.deployments[0]?.availableReplicas, 3);
      assert.equal(reading.deployments[0]?.conditions[0]?.status, "True");
      assert.equal(reading.deployments[0]?.conditions[0]?.reason, "MinimumReplicasAvailable");
    } finally {
      await close(bound);
    }
  });

  it("reports a deployment whose image was never built as pending, and says why", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({
        spec: { replicas: 3, template: { spec: { containers: [{ image: MISSING }] } } },
      }));
      const reading = bound.cluster.snapshot(NAMESPACE);
      assert.equal(reading.pods.length, 3);
      assert.ok(reading.pods.every((pod) => !pod.ready && pod.phase === "Pending"));
      assert.ok(reading.pods.every((pod) => pod.reason === "ImagePullBackOff"));
      assert.ok(reading.pods.every((pod) => pod.node === null));
      assert.equal(reading.deployments[0]?.readyReplicas, 0);
      assert.equal(reading.deployments[0]?.conditions[0]?.status, "False");
      assert.equal(reading.deployments[0]?.conditions[0]?.reason, "MinimumReplicasUnavailable");
    } finally {
      await close(bound);
    }
  });

  it("counts the pods it asks for, not the pods that are ready", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({
        spec: { replicas: 4, template: { spec: { containers: [{ image: IMAGE }] } } },
      }));
      const reading = bound.cluster.snapshot(NAMESPACE);
      // `replicas: 4` and `readyReplicas: 4` is a healthy rollout; the two fields exist separately
      // because a deployment asking for four and serving none is `replicas: 4, readyReplicas: 0`.
      assert.equal(reading.deployments[0]?.replicas, 4);
      assert.equal(reading.pods.length, 4);
    } finally {
      await close(bound);
    }
  });

  it("treats a registry directory that does not exist as an empty registry, not an error", async () => {
    const bound = await startWithNoRegistry();
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      const reading = bound.cluster.snapshot(NAMESPACE);
      // The consequence is stated where it lands: a cluster whose images were never built reports
      // every pod unpullable, which is the correct reading rather than a crash.
      assert.equal(reading.pods.length, 3);
      assert.ok(reading.pods.every((pod) => pod.reason === "ImagePullBackOff"));
    } finally {
      await close(bound);
    }
  });

  it("lets one deployment be ready while another is not, in the same reading", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", DEPLOYMENTS, deployment({
        metadata: { name: "cart-worker", labels: { app: "cart-worker" } },
        spec: { replicas: 1, template: { metadata: { labels: { app: "cart-worker" } }, spec: { containers: [{ image: MISSING }] } } },
      }));
      const reading = bound.cluster.snapshot(NAMESPACE);
      const web = reading.deployments.find((entry) => entry.name === "cart-web");
      const worker = reading.deployments.find((entry) => entry.name === "cart-worker");
      assert.equal(web?.readyReplicas, 3);
      assert.equal(worker?.readyReplicas, 0);
      // Sorted by name, so two readings of the same cluster cannot disagree about the order either.
      assert.deepEqual(reading.deployments.map((entry) => entry.name), ["cart-web", "cart-worker"]);
    } finally {
      await close(bound);
    }
  });

  it("carries the template labels onto the pods it derives", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({
        spec: {
          replicas: 1,
          template: { metadata: { labels: { app: "cart-web", tier: "web" } }, spec: { containers: [{ image: IMAGE }] } },
        },
      }));
      const pod = bound.cluster.snapshot(NAMESPACE).pods[0];
      assert.equal(pod?.labels["app"], "cart-web");
      assert.equal(pod?.labels["tier"], "web");
      // A selector a criterion can write, added by the world rather than by the manifest.
      assert.equal(typeof pod?.labels["pod-template-hash"], "string");
    } finally {
      await close(bound);
    }
  });
});

describe("the event log is a record of acting, not of looking", () => {
  it("writes a Failed warning when the image cannot be pulled, naming the image", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({
        spec: { replicas: 1, template: { spec: { containers: [{ image: MISSING }] } } },
      }));
      const events = bound.cluster.snapshot(NAMESPACE).events;
      const failed = events.find((event) => event.reason === "Failed");
      assert.ok(failed !== undefined, `expected a Failed event; got ${reasons(bound.cluster.snapshot(NAMESPACE)).join(", ")}`);
      assert.equal(failed.type, "Warning");
      assert.equal(failed.objectKind, "Pod");
      assert.match(failed.message, /no such image in the registry this world's build produced/);
      assert.match(failed.message, new RegExp(MISSING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      await close(bound);
    }
  });

  it("writes Normal scheduling and scaling events when it can pull the image", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 1, template: { spec: { containers: [{ image: IMAGE }] } } } }));
      const present = reasons(bound.cluster.snapshot(NAMESPACE));
      // The cluster's own vocabulary puts these under `Normal`, which is why the `k8s.event`
      // validator reads every type rather than warnings only.
      assert.ok(present.includes("Scheduled"), `expected Scheduled; got ${present.join(", ")}`);
      assert.ok(present.includes("ScalingReplicaSet"), `expected ScalingReplicaSet; got ${present.join(", ")}`);
      assert.ok(!present.includes("Failed"));
    } finally {
      await close(bound);
    }
  });

  it("merges an identical event by identity and increments its count", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 1, template: { spec: { containers: [{ image: MISSING }] } } } }));
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 1, template: { spec: { containers: [{ image: MISSING }] } } } }));
      const events = bound.cluster.snapshot(NAMESPACE).events;
      const scaling = events.filter((event) => event.reason === "ScalingReplicaSet");
      // Two reconciles, two revisions, so two distinct replica sets - but only one key per
      // (type, reason, objectKind, objectName), which is what keeps the *set* of events a function of
      // the objects rather than of how many times state was asserted.
      assert.equal(scaling.length, 1);
      assert.equal(scaling[0]?.count, 2);
    } finally {
      await close(bound);
    }
  });

  it("does not mutate the record when it is read twice", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 2, template: { spec: { containers: [{ image: MISSING }] } } } }));
      const first = bound.cluster.snapshot(NAMESPACE);
      const second = bound.cluster.snapshot(NAMESPACE);
      // The defect this holds: an earlier shape recorded the pod events *inside* the derivation, so
      // the first read wrote `count: 1` and the second wrote `count: 2` - and M1, which compares
      // exactly these documents, would have called one cluster two different worlds. A real cluster
      // records its events when its controller acts, not when a client looks.
      assert.deepEqual(second, first);
      // Two pods, so two `Failed` events - one per pod, because the key includes the pod's name. The
      // property under test is not the number of events; it is that reading twice did not increment
      // anything, so every count is still one.
      const failed = first.events.filter((event) => event.reason === "Failed");
      assert.equal(failed.length, 2);
      assert.ok(failed.every((event) => event.count === 1), "a read incremented a count");
    } finally {
      await close(bound);
    }
  });

  it("scopes every reading to one namespace", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      const other = bound.cluster.snapshot("prod");
      assert.deepEqual(other.deployments, []);
      assert.deepEqual(other.pods, []);
      assert.deepEqual(other.events, []);
      assert.equal(bound.cluster.snapshot(NAMESPACE).deployments.length, 1);
    } finally {
      await close(bound);
    }
  });
});

describe("services", () => {
  it("stores a service and assigns it a cluster IP once", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", SERVICES, service());
      const first = bound.cluster.snapshot(NAMESPACE).services[0];
      assert.equal(first?.name, "cart-web");
      assert.equal(first?.type, "ClusterIP");
      assert.equal(typeof first?.clusterIP, "string");
      assert.deepEqual(first?.ports, [{ name: "", port: 80, targetPort: 8080, protocol: "TCP" }]);

      await send(bound, "POST", SERVICES, service());
      const second = bound.cluster.snapshot(NAMESPACE).services[0];
      // A cluster IP is assigned once and never changes while the object lives.
      assert.equal(second?.clusterIP, first?.clusterIP);
      assert.deepEqual(bound.cluster.applies().map((entry) => entry.result), ["created", "configured"]);
    } finally {
      await close(bound);
    }
  });

  it("keeps a service's selector readable, because that is how a pod is found", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", SERVICES, service());
      assert.deepEqual(bound.cluster.snapshot(NAMESPACE).services[0]?.selector, { app: "cart-web" });
    } finally {
      await close(bound);
    }
  });

  it("defaults a missing service type to ClusterIP and a missing targetPort to the port", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", SERVICES, service({ spec: { ports: [{ port: 8080 }] } }));
      const reading = bound.cluster.snapshot(NAMESPACE).services[0];
      assert.equal(reading?.type, "ClusterIP");
      assert.equal(reading?.ports[0]?.targetPort, 8080);
      assert.equal(reading?.ports[0]?.protocol, "TCP");
    } finally {
      await close(bound);
    }
  });
});

describe("the world can be photographed and put back", () => {
  it("round-trips its stored objects through dump and load", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", SERVICES, service());
      const state = bound.cluster.dump();

      await bound.cluster.close();
      const restored = await start([IMAGE]);
      try {
        restored.cluster.load(state);
        assert.deepEqual(restored.cluster.snapshot(NAMESPACE), bound.cluster.snapshot(NAMESPACE));
      } finally {
        await close(restored);
      }
    } finally {
      await close(bound);
    }
  });

  it("refuses a snapshot that is not a cluster state, rather than loading nothing quietly", async () => {
    const bound = await start([IMAGE]);
    try {
      assert.throws(() => bound.cluster.load("{\"kind\":\"SomethingElse\"}"), /not a cluster state document/);
    } finally {
      await close(bound);
    }
  });

  it("empties the objects on clear, and leaves the apply record alone", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      bound.cluster.clear();
      assert.deepEqual(bound.cluster.snapshot(NAMESPACE).deployments, []);
      assert.deepEqual(bound.cluster.snapshot(NAMESPACE).events, []);
      // The action record is the run's history, not the cluster's state. Clearing it would destroy
      // the evidence of what the run did by repairing the world it did it to.
      assert.equal(bound.cluster.applies().length, 1);
    } finally {
      await close(bound);
    }
  });
});

describe("two readings of the same submissions agree", () => {
  it("produces identical documents for two clusters given identical inputs", async () => {
    const first = await start([IMAGE]);
    const second = await start([IMAGE]);
    try {
      for (const bound of [first, second]) {
        await send(bound, "POST", DEPLOYMENTS, deployment());
        await send(bound, "POST", SERVICES, service());
      }
      // No clock and no random source is read anywhere in the port, which is what makes M1 - "the
      // same code gave the same result twice" - a measurement rather than a hope. The one thing this
      // cannot see is a hash that depends on the process, which `stableHash` is chosen to avoid.
      assert.deepEqual(second.cluster.snapshot(NAMESPACE), first.cluster.snapshot(NAMESPACE));
    } finally {
      await close(first);
      await close(second);
    }
  });

  it("names a pod from the deployment's name and revision, so the name moves with the rollout", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 1, template: { spec: { containers: [{ image: IMAGE }] } } } }));
      const before = bound.cluster.snapshot(NAMESPACE).pods[0]?.name;
      await send(bound, "POST", DEPLOYMENTS, deployment({ spec: { replicas: 1, template: { spec: { containers: [{ image: IMAGE }] } } } }));
      const after = bound.cluster.snapshot(NAMESPACE).pods[0]?.name;
      assert.notEqual(after, before);
      assert.match(String(after), /^cart-web-[0-9a-f]{8}-0$/);
    } finally {
      await close(bound);
    }
  });
});

describe("the port reports the results the apply validator reads", () => {
  it("uses only the four results a submission can have", async () => {
    const bound = await start([IMAGE]);
    try {
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", DEPLOYMENTS, deployment());
      await send(bound, "POST", DEPLOYMENTS, deployment({ kind: "ConfigMap" }));
      const allowed: readonly K8sApplyResult[] = ["created", "configured", "unchanged", "rejected"];
      for (const entry of bound.cluster.applies()) {
        assert.ok(allowed.includes(entry.result), `unexpected result ${entry.result}`);
      }
      assert.deepEqual(bound.cluster.applies().map((entry) => entry.result), ["created", "configured", "rejected"]);
    } finally {
      await close(bound);
    }
  });
});
