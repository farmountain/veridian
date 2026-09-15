/**
 * The API world's front door.
 *
 * A barrel rather than a re-export of the class alone, and the list of what it carries is the point:
 * a caller of this world gets the adapter, the client seam it sends through, and the three refusals
 * that name a missing field. Nothing here reaches into the adapter's private surface, and nothing
 * here is a second implementation of anything the adapter already decides.
 */
export {
  LocalApiEnvironment,
  MISSING_SERVICE,
  MISSING_START_COMMAND,
  MISSING_URL,
  STEP_TIMEOUT_MS,
} from "./local-api-environment.ts";
export type { LocalApiEnvironmentOptions } from "./local-api-environment.ts";
export { nodeApiClient } from "./api-port.ts";
export type { ApiAnswer, ApiClient, ApiRequest } from "./api-port.ts";
