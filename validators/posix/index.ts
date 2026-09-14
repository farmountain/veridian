/**
 * The `posix.*` validator family's front door.
 *
 * Same shape as the other three: the family, its names and a fresh-array accessor, so a registry can
 * own its list without a family exporting a mutable global.
 */

export { POSIX_VALIDATORS, POSIX_VALIDATOR_NAMES, posixValidators } from "./posix-validators.ts";
