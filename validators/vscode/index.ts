/**
 * The `vscode.*` validator family's front door.
 *
 * Same shape as the other seven: the family, its names and a fresh-array accessor, so a registry can own
 * its list without a family exporting a mutable global.
 *
 * The substitute itself is deliberately not re-exported here. `adapters/sim-vscode/vscode-port.ts` is the
 * host and `adapters/sim-vscode/sim-vscode-environment.ts` is the adapter; a validator family that also
 * handed out the substitute would invite a caller to reach the world through the vocabulary that judges
 * it, which is the one direction `core/environment/*-observation.ts` exists to keep closed.
 */

export {
  VSCODE_VALIDATORS,
  VSCODE_VALIDATOR_NAMES,
  vscodeValidators,
} from "./vscode-validators.ts";
