/**
 * The broker family's front door.
 *
 * Same shape as the other eight: the family, its names, and a fresh-array accessor, so a registry can
 * own its list without being handed the frozen one. The substitute itself is deliberately not
 * re-exported here, for the reason every family in this tree keeps the same door closed - a validator
 * family that also handed out the world would invite a caller to reach the world through the
 * vocabulary that judges it, and `core/environment/*-observation.ts` exists to keep that direction
 * shut.
 */
export { DATA_VALIDATORS, DATA_VALIDATOR_NAMES, dataValidators } from "./data-validators.ts";
