/**
 * The `sim-k8s` world's front door.
 *
 * The adapter and its control-plane port are exported together because they belong together: the port
 * is injectable so the adapter's own behaviour - applying a manifest, refusing an escape, rebuilding
 * on reset - can be tested against a scripted cluster, and a consumer that wants the real substitute
 * API server takes both. The reading vocabulary is *not* re-exported here; it lives in
 * `core/environment/k8s-observation.ts`, because a validator that imported this file would be a
 * validator importing an adapter.
 */

export { SimK8sEnvironment, CLUSTER_ENV } from "./sim-k8s-environment.ts";
export type { SimK8sEnvironmentOptions } from "./sim-k8s-environment.ts";
export { httpCluster } from "./cluster-port.ts";
export type { ClusterPort, ClusterSnapshot } from "./cluster-port.ts";
