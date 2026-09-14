/**
 * The Evidence Engine.
 *
 * A barrel, and deliberately a thin one: the only things re-exported are the writer, its layout
 * helper and the shapes it writes. Keeping adapters and validators out of this file is what stops
 * the bundle format from acquiring a dependency on one particular way of observing a world.
 */

export { BUNDLE_FILES } from "./types.ts";
export type {
  EnvironmentRecord,
  IterationSummary,
  ReproducibilityRecord,
  RunBundleLayout,
  RunOutcome,
  WrittenResult,
} from "./types.ts";

export {
  RunBundle,
  bundleLayout,
  captureReproducibility,
  environmentRecord,
  evidenceCompleteness,
  renderFailureReport,
  serializeClarificationRecord,
  serializeCriterion,
  serializeEnvironment,
  serializeResult,
} from "./writer.ts";
export type { RunBundleOptions } from "./writer.ts";
