/**
 * The `os.*` validator family's front door.
 *
 * Same shape as the other four: the family, its names and a fresh-array accessor, so a registry can own
 * its list without a family exporting a mutable global.
 *
 * The substitute itself is deliberately not re-exported here. `adapters/sim-os/os-port.ts` is the world
 * and `adapters/sim-os/sim-os-environment.ts` is the adapter; a validator family that also handed out
 * the substitute would invite a caller to reach the world through the vocabulary that judges it, which
 * is the one direction `core/environment/*-observation.ts` exists to keep closed.
 */

export { OS_VALIDATORS, OS_VALIDATOR_NAMES, osValidators } from "./os-validators.ts";
