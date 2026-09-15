/**
 * The `sim-container` front door.
 *
 * Exports the adapter, its environment-variable names and the substitute engine. It deliberately does
 * **not** re-export `core/environment/container-observation.ts`: that vocabulary belongs to the validators,
 * and a barrel that carried it here would invite the family next door to reach a world through an adapter.
 */

export { containerPort } from "./container-port.ts";
export type {
  ContainerEscape,
  ContainerExecRequest,
  ContainerPort,
  ContainerPortOptions,
} from "./container-port.ts";
export { CONTAINER_ENV, CONTAINER_WORKSPACE, SimContainerEnvironment, parseCommandLine } from "./sim-container-environment.ts";
export type { SimContainerEnvironmentOptions } from "./sim-container-environment.ts";
