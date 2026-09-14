/**
 * EXECUTE — the loop and the things it needs.
 *
 * Public surface of `core/execution`. Note what is *not* here: no adapter, no validator, no CLI.
 * The loop is written against `WorldPort` so that the same code is provable offline against a
 * scripted world and credible online against a browser, and that only works while the port stays
 * the boundary.
 */
export { runValidationLoop } from "./loop.ts";

export { CommandRepairGate, ManualRepairGate, NoRepairGate, ScriptedRepairGate } from "./repair.ts";
export type { CommandRepairGateOptions, ManualRepairGateOptions } from "./repair.ts";

export type {
  CriterionExecution,
  IterationSummary,
  IterationVerdict,
  LoopOptions,
  LoopResult,
  RepairDecision,
  RepairGate,
  RepairOutcome,
  RepairRequest,
  WorldPort,
} from "./types.ts";
