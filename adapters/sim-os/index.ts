/**
 * The sim-os world's front door.
 *
 * Two files, and the split is the same one `sim-posix` makes: `os-port.ts` is the *substitute* - the
 * thing that stands in for a Windows or macOS system - and `sim-os-environment.ts` is the *adapter*,
 * which drives it through the lifecycle every Veridian environment exposes. Only the adapter is
 * exported here, because only the adapter is what a caller registers; the port is imported by name
 * where it is needed, which is the adapter and the port's own tests.
 */
export { SimOsEnvironment, OS_ENV } from "./sim-os-environment.ts";
export type { SimOsEnvironmentOptions } from "./sim-os-environment.ts";
