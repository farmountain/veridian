/**
 * The four defects the `sim-data` demo injects, and the one file they all live in.
 *
 * ## Why this table is flat rather than a list of (file, defect) pairs
 *
 * `examples/sim-k8s/defects.ts` needed the pair because that application ships two manifest files, and
 * a defect that reported itself as fixed after matching something in a different file would be exactly
 * the failure it exists to catch. This application ships one file - `app/provision.mjs` - so the table
 * is flat and `source.ts` reads and writes that one file, which keeps `defect-text.ts`'s single-text
 * contract honest: it takes one artifact's text and answers questions about it, and nothing here asks
 * it to span two.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * `criterionId` is the criterion filed against the defect - the criterion that reads the *defect
 * itself* rather than one of its consequences - and the set of criteria each defect actually moves is a
 * measurement, not an intention. `tests/sim-data-demo.test.ts` pins the table; the per-iteration
 * progression is measured by running `npm run demo:data`, which is the demo's own contract.
 *
 *   - `D1` creates the order log with a compaction policy where the pipeline asked for deletion. It is
 *     filed against `data.layout` (AC-004), which prints the policy beside the shape, and it is the
 *     clearest control in the table: this world holds one node, never deletes a record and states as
 *     much in its own `DATA_SIMULATED_SURFACES`, so a cleanup policy here is a value the broker
 *     **records and never applies**. Nothing else can read it. A criterion that compared only the
 *     partition count and the in-sync set would report a pass over a topic that had quietly been given
 *     a different lifecycle, which is the sentence AC-004's own description is written to make.
 *   - `D2` does the same to the index log, filed against `data.layout` for `cart-index` (AC-005). It is
 *     a separate defect rather than a second expectation on one, because the two logs have different
 *     repairs: an order log that compacts loses ordering history, an index that compacts loses the
 *     entries its key was built for. One criterion judging both would report one defect where there
 *     are two.
 *   - `D3` moves the release stamp the pipeline puts on every record. One constant, and it is the only
 *     defect in the table with more than one consequence, because the constant is read in **two**
 *     record builders: the four order events (`data.value`, AC-011 - four expectations inside one
 *     criterion) and the indexer's checkpoint (`data.value` on `cart-index/0/0`, AC-015). That is the
 *     headline, and it is the table's demonstration that one edit is never one fact in a world where
 *     one value is written into two places.
 *   - `D4` commits the *index* of the last record delivered instead of the offset of the next one, so a
 *     pipeline that read three orders commits `2`. It is filed against `data.commit` (AC-014) and it
 *     is the defect this demo exists for: `app/provision.mjs`'s own header names this off-by-one as the
 *     subject. It is also irreversible from the log's side - every record is there either way, and only
 *     the committed position says whether the third order will be re-delivered on every restart - which
 *     is why a world that stored whatever it was told is the only world that can report it at all.
 *
 * The criteria no defect moves are not dead weight: they are the control. A run in which every
 * criterion moved would be a run whose readings are not independent. And two of the four defects above
 * move exactly one criterion each, which is what lets a reader watch one edit produce one reading
 * before watching one edit produce three.
 *
 * ## What no defect in this table may touch, and why it is not a style preference
 *
 * `environment.yaml`'s `start.readyPattern` waits for the line `cart-broker provisioned: N requests, M
 * topics, K records`, which `provision.mjs` prints on its last statement before it exits. A defect aimed
 * at that line would stop the world from ever becoming ready - the readiness check would time out, every
 * criterion would read `INCONCLUSIVE`, and the run would report a defect whose intent was to be
 * *observable*. So no block here names it. `tests/local-process-demo.test.ts` learned this the
 * expensive way and `examples/local-process/defects.ts` records it; the same trap is present here and
 * the same guard is written for it.
 *
 * The other half is that **no validator in `validators/data/` reads the provisioning transcript at
 * all**: the adapter captures the child's stdout and stderr, and exposes a readiness boolean and
 * nothing else. So a defect aimed at a narration line would move *no* criterion, however the line read.
 * A defect in this world has to change a piece of *state* the broker holds, because that is the only
 * thing any criterion can see.
 *
 * ## Ordering
 *
 * The table is in **criterion order** - AC-004, AC-005, AC-011, AC-014 - which is the order the repair
 * agent walks. Ordering matters because `repairOne` repairs exactly one defect per call, and one defect
 * per iteration is what makes the demo's progression a diagnosis rather than a batch edit: iteration
 * three's report is what iteration two's repair left behind.
 *
 * ## Line endings
 *
 * `D1`, `D2` and `D4` are single-line blocks and `D3` is multi-line, which matters more than it looks.
 * A single-line block never reaches the newline conversion in `defect-text.ts`, so it cannot tell a
 * correct implementation of the CRLF rule from a broken one: this project already shipped a demo whose
 * defect table was entirely single-line while its comment claimed the opposite, and measured that
 * breaking the rule left its test green. `D3`'s block is multi-line so that a checkout storing this file
 * in CRLF reaches that conversion.
 *
 * `D3`'s block carries its second line unchanged - `const CLIENT_ID = "cart-broker";` is byte-identical
 * in both forms - and that is the whole of the reason it is there. `D1`'s and `D2`'s blocks are full
 * lines rather than the `cleanup: "delete"` fragment they share, because that fragment occurs **twice**
 * in `provision.mjs` and `defect-text.ts` counts occurrences, requiring exactly one.
 *
 * ## Why the defects are where they are, and not in the broker's state
 *
 * Every record this world judges - the three orders in the first partition, the fourth alone in the
 * third, the checkpoint, the committed position - is *derived* from this one file on every run, and the
 * sandbox is rebuilt from it before each iteration. So a defect injected anywhere else would be erased
 * by the next iteration's own provisioning, and the demo would report a repair the world never had a
 * chance to observe. The editable artifact has to be the input, not the output.
 */

import {
  defectStates,
  injectDefects,
  repairDefect,
  type Defect,
  type DefectState,
  type DefectStatus,
  type InjectResult,
  type RepairResult,
} from "../defect-text.ts";

/** The one file every defect in this table lives in, relative to the application directory. */
export const PROVISION_FILE = "provision.mjs";

/**
 * In **criterion order**, which is the order the repair agent walks: `data.layout` for the order log
 * (AC-004), `data.layout` for the index log (AC-005), `data.value` on the order events (AC-011) and
 * `data.commit` on the group's position (AC-014).
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-004",
    summary: "the order log is created to compact where the pipeline needs its history kept",
    correct: '  { name: "cart-events", partitions: 3, replication: 1, cleanup: "delete" },',
    defective: '  { name: "cart-events", partitions: 3, replication: 1, cleanup: "compact" },',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-005",
    summary: "the index log is created with the same wrong cleanup policy",
    correct: '  { name: "cart-index", partitions: 1, replication: 1, cleanup: "delete" },',
    defective: '  { name: "cart-index", partitions: 1, replication: 1, cleanup: "compact" },',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-011",
    summary: "every record is stamped with a release the pipeline never ran",
    correct: 'const RELEASE = "1.0.0";\nconst CLIENT_ID = "cart-broker";',
    defective: 'const RELEASE = "1.1.0";\nconst CLIENT_ID = "cart-broker";',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-014",
    summary: "the pipeline commits the index of the last record delivered instead of the next offset",
    correct: "const NEXT_OFFSET = ORDERS_IN_PIPELINE;",
    defective: "const NEXT_OFFSET = ORDERS_IN_PIPELINE - 1;",
  }),
]);

/** What one defect's block says about one file's text. */
export interface DemoStatus {
  readonly defect: Defect;
  readonly state: DefectState;
}

/** The outcome of injecting every defect this file holds. */
export interface InjectOutcome {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

/** The outcome of repairing at most one defect. */
export interface RepairOutcome {
  readonly text: string;
  readonly repaired: Defect | null;
}

/**
 * What each defect's block says about the text it is given.
 *
 * Every defect is answered, including the ones whose block is in a file that could not be read, which
 * is why the caller reads the file rather than this function doing it: a demo that needed a file it
 * could not find should say so once, at the read, rather than have each defect report itself as
 * `unknown`.
 */
export function status(text: string): readonly DemoStatus[] {
  return defectStates(DEFECTS, text).map((entry: DefectStatus) =>
    Object.freeze({ defect: entry.defect, state: entry.state }),
  );
}

/**
 * Inject every defect that is not already in.
 *
 * `injectDefects` refuses a file whose blocks are ambiguous - neither form present, or both - so an
 * already-injected defect is reported as such rather than injected twice, and a file that has drifted
 * raises here rather than being edited into a third state.
 */
export function inject(text: string): InjectOutcome {
  const result: InjectResult = injectDefects(DEFECTS, PROVISION_FILE, text);
  return { text: result.text, injected: result.injected, alreadyInjected: result.alreadyInjected };
}

/**
 * Repair the **first still-injected** defect, in criterion order, and report which one it was.
 *
 * The repaired defect is returned so the caller can verify the change rather than describe it: a
 * function that edits a file must not announce a repair it has not confirmed.
 */
export function repairOne(text: string): RepairOutcome {
  const result: RepairResult = repairDefect(DEFECTS, PROVISION_FILE, text);
  return { text: result.text, repaired: result.repaired };
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
