/**
 * The `sim-posix` world's front door.
 *
 * The adapter and its substitute host are exported together because they belong together: the port is
 * injectable so the adapter's own behaviour - running an application's provisioning commands,
 * refusing an escape, rebuilding and re-provisioning on reset - can be tested against a scripted
 * system, and a consumer that wants the real substitute takes both. The reading vocabulary is *not*
 * re-exported here; it lives in `core/environment/posix-observation.ts`, because a validator that
 * imported this file would be a validator importing an adapter.
 */

export { SimPosixEnvironment, POSIX_ENV } from "./sim-posix-environment.ts";
export type { SimPosixEnvironmentOptions } from "./sim-posix-environment.ts";
export { posixPort } from "./posix-port.ts";
export type { PosixPort, PosixPortOptions, ExecRequest } from "./posix-port.ts";
