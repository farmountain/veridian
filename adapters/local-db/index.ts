/**
 * The `local-db` world's front door.
 *
 * The adapter and its storage port are exported together because they belong together: the port is
 * injectable so the adapter's own behaviour - reading, refusing an escape, rebuilding on reset - can
 * be tested without a database file, and a consumer that wants the real engine takes both.
 */

export { LocalDbEnvironment, DB_ENGINE } from "./local-db-environment.ts";
export type { LocalDbEnvironmentOptions } from "./local-db-environment.ts";
export { sqliteDatabase } from "./database-port.ts";
export type { DatabasePort, DbInspection, DbInspectRequest, DbStatementOutcome } from "./database-port.ts";
