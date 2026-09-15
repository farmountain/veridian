/**
 * The `api.*` validator family's front door.
 *
 * Same shape as the other eight: the family, its names and a fresh-array accessor, so a registry can
 * own its list without a family exporting a mutable global.
 *
 * The client is deliberately not re-exported here. `adapters/local-api/api-port.ts` is the way a
 * request reaches the server and `adapters/local-api/local-api-environment.ts` is the adapter; a
 * validator family that also handed out the client would invite a caller to reach the world through
 * the vocabulary that judges it, which is the one direction `core/environment/api-observation.ts`
 * exists to keep closed. A validator reads a reading. It never makes the request that produces one -
 * the `call` step is how a criterion puts its own request to the world, and it is the adapter that
 * performs it.
 */

export {
  API_VALIDATORS,
  API_VALIDATOR_NAMES,
  apiValidators,
} from "./api-validators.ts";
