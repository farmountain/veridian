/**
 * The environment layer.
 *
 * `types` declares the contracts, `load` decodes a definition into a plan, and `manager` is the only
 * thing allowed to move that plan through the lifecycle. Adapters implement `EnvironmentAdapter`;
 * they are deliberately absent from this barrel, because importing one from the Core would make the
 * Core depend on a particular world — which is the boundary *"VS Code ≠ Veridian"* draws for every
 * surface, not just the editor.
 */

export {
  finalizeEnvironment,
  loadEnvironmentDocument,
  probeUrl,
} from "./load.ts";

export {
  ENVIRONMENT_STATES,
  EnvironmentManager,
  type EnvironmentFailure,
  type EnvironmentManagerOptions,
  type EnvironmentReady,
  type EnvironmentState,
  type EnvironmentTransition,
  type PrepareResult,
  type ResetResult,
} from "./manager.ts";

export {
  RESET_STRATEGIES,
  type ApplicationStart,
  type ArtifactKind,
  type BrowserPolicy,
  type EnvironmentAdapter,
  type EnvironmentDefinitionShape,
  type EnvironmentPlan,
  type EvidenceArtifact,
  type HealthPolicy,
  type HealthProbe,
  type HealthReport,
  type Observation,
  type ObservationRequest,
  type ResetStrategy,
} from "./types.ts";
