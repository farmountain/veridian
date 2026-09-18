/**
 * The `sim-mobile` front door.
 *
 * Exports the adapter, its environment-variable names and the substitute device. It deliberately does
 * **not** re-export `core/environment/mobile-observation.ts`: that vocabulary belongs to the validators,
 * and a barrel that carried it here would invite the family next door to reach a world through an adapter.
 */
export { mobilePort } from "./mobile-port.ts";
export type { MobileEscape, MobileExecRequest, MobilePort, MobilePortOptions } from "./mobile-port.ts";
export { MOBILE_ENV, MOBILE_WORKSPACE, SimMobileEnvironment, parseCommandLine } from "./sim-mobile-environment.ts";
export type { SimMobileEnvironmentOptions } from "./sim-mobile-environment.ts";
