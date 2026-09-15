/**
 * The `sim-vscode` front door.
 *
 * Exports the adapter, its environment-variable names and the substitute host. It deliberately does
 * **not** re-export `core/environment/vscode-observation.ts`: that vocabulary belongs to the validators,
 * and a barrel that carried it here would invite the family next door to reach a world through an
 * adapter.
 */

export { vscodePort } from "./vscode-port.ts";
export type { VSCodeEscape, VSCodeExecRequest, VSCodePort, VSCodePortOptions } from "./vscode-port.ts";
export {
  SimVSCodeEnvironment,
  VSCODE_ENV,
  parseCommandLine,
} from "./sim-vscode-environment.ts";
export type { SimVSCodeEnvironmentOptions } from "./sim-vscode-environment.ts";
