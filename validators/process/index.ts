/**
 * The `process.*` validator family's front door.
 *
 * Same shape as the other nine: the family, its names and a fresh-array accessor, so a registry can
 * own its list without a family exporting a mutable global.
 *
 * The file probe and the process runner are deliberately **not** re-exported here.
 * `adapters/local-process/process-port.ts` is the way a command is run and a path is read, and
 * `adapters/local-process/local-process-environment.ts` is the adapter; a validator family that also
 * handed out a runner would invite a caller to reach the world through the vocabulary that judges it,
 * which is the one direction `core/environment/process-observation.ts` exists to keep closed. A
 * validator reads a reading. It never runs the command that produces one - a `run` step is how a
 * criterion acts in the world, and it is the adapter that performs it.
 */

export {
  PROCESS_VALIDATORS,
  PROCESS_VALIDATOR_NAMES,
  processValidators,
} from "./process-validators.ts";
