/**
 * The `container.*` validator family's front door.
 *
 * Same shape as the other six: the family, its names and a fresh-array accessor, so a registry can own
 * its list without a family exporting a mutable global.
 *
 * The substitute itself is deliberately not re-exported here. `adapters/sim-container/container-port.ts`
 * is the world and `adapters/sim-container/sim-container-environment.ts` is the adapter; a validator
 * family that also handed out the substitute would invite a caller to reach the world through the
 * vocabulary that judges it, which is the one direction `core/environment/*-observation.ts` exists to
 * keep closed.
 */

export {
  CONTAINER_VALIDATORS,
  CONTAINER_VALIDATOR_NAMES,
  containerValidators,
} from "./container-validators.ts";
