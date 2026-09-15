/**
 * The `sim-data` front door.
 *
 * Exports the adapter, its environment-variable names and the substitute broker. It deliberately does
 * **not** re-export `core/environment/data-observation.ts`: that vocabulary belongs to the validators,
 * and a barrel that carried it here would invite the family next door to reach a world through an
 * adapter.
 *
 * `DATA_COMMAND_WORDS` and `dataCommandUsage()` travel beside the port rather than through the
 * validator family on purpose. They are the register of what this world *performs*, which is a fact
 * about the substitute; the validators name what a criterion may *ask*, and reconciling the two lists
 * is the same mistake as letting a validator read an adapter.
 */

export { DATA_COMMAND_WORDS, dataCommandUsage, tcpData } from "./data-port.ts";
export type { DataCommandWord, DataIdentity, DataPort, DataSnapshot } from "./data-port.ts";
export { DATA_ENV, SimDataEnvironment } from "./sim-data-environment.ts";
export type { SimDataEnvironmentOptions } from "./sim-data-environment.ts";
