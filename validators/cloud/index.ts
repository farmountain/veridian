/**
 * The `cloud.*` validator family's front door.
 *
 * Same shape as the other five: the family, its names and a fresh-array accessor, so a registry can own
 * its list without a family exporting a mutable global.
 *
 * The substitute itself is deliberately not re-exported here. `adapters/sim-cloud/cloud-port.ts` is the
 * world and `adapters/sim-cloud/sim-cloud-environment.ts` is the adapter; a validator family that also
 * handed out the substitute would invite a caller to reach the world through the vocabulary that judges
 * it, which is the one direction `core/environment/*-observation.ts` exists to keep closed.
 */

export { CLOUD_VALIDATORS, CLOUD_VALIDATOR_NAMES, cloudValidators } from "./cloud-validators.ts";
