/**
 * The `local-process` world's front door.
 *
 * Two exports and a type, in the shape the sibling adapters use. The file probe is exported beside
 * the adapter because it is the *other* half of this world: the adapter starts a program, and the
 * probe reads what that program left behind. Its name is deliberately `FileProbe` rather than
 * anything involving `IoPort` - a validator reads a reading, and a validator of this family has no
 * business holding the object that opens the directory.
 */
export { LocalProcessEnvironment } from "./local-process-environment.ts";
export type { LocalProcessEnvironmentOptions } from "./local-process-environment.ts";
export {
  MAX_STREAM_CHARS,
  MISSING_APPLICATION,
  MISSING_PROCESS_BLOCK,
  MISSING_ROOT,
  PROCESS_ENV,
  PROCESS_ENV_NAMES,
  STEP_TIMEOUT_MS,
} from "./local-process-environment.ts";
export { MAX_TEXT_BYTES, nodeFileProbe } from "./process-port.ts";
export type { FileProbe, FileProbeRequest } from "./process-port.ts";
