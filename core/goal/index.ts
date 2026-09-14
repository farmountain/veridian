export {
  DefinitionError,
  dirOf,
  finalizeGoal,
  loadDocument,
  loadGoalDocument,
  parseDocument,
  resolveSibling,
} from "./load.ts";
export type { LoadOptions } from "./load.ts";

export type {
  FilesystemWritePolicy,
  Goal,
  GoalDocument,
  GoalLimits,
  NetworkPolicy,
  SourceRef,
} from "./types.ts";
