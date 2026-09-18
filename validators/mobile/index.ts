/**
 * The `mobile.*` validator family's front door.
 *
 * Same shape as the other eleven: the family, its names and a fresh-array accessor, so a registry can
 * own its list without a family exporting a mutable global.
 *
 * The substitute itself is deliberately not re-exported here. `adapters/sim-mobile/mobile-port.ts` is
 * the world and `adapters/sim-mobile/sim-mobile-environment.ts` is the adapter; a validator family that
 * also handed out the substitute would invite a caller to reach the world through the vocabulary that
 * judges it, which is the one direction `core/environment/*-observation.ts` exists to keep closed.
 */

export {
  MOBILE_VALIDATORS,
  MOBILE_VALIDATOR_NAMES,
  mobileValidators,
} from "./mobile-validators.ts";
