/**
 * The `sim-cloud` world's front door.
 *
 * The adapter and its account port are exported together because they belong together: the port is
 * injectable so the adapter's own behaviour - putting a criterion's request to the account, refusing
 * a target addressed elsewhere, rebuilding the account on reset - can be tested against a substitute
 * held in memory, and a consumer that wants the real one takes both.
 *
 * `targetProblem` is exported beside the factory rather than hidden, because it is the one rule this
 * adapter and this port must agree on: the port refuses a request addressed to another host, and the
 * adapter records that refusal as a boundary crossing. Two copies would disagree the first time one
 * was extended, so it is one exported function with two callers.
 *
 * The reading vocabulary is *not* re-exported here. It lives in
 * `core/environment/cloud-observation.ts`, because a validator that imported this file would be a
 * validator importing an adapter - and `sim-k8s/index.ts` records the same rule one world over.
 */

export { CLOUD_ENV, SimCloudEnvironment } from "./sim-cloud-environment.ts";
export type { SimCloudEnvironmentOptions } from "./sim-cloud-environment.ts";
export { httpCloud, targetProblem } from "./cloud-port.ts";
export type { CloudPort, CloudSnapshot } from "./cloud-port.ts";
