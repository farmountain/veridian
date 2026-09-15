/**
 * The four defects this demo injects into the application, and the criteria each one moves.
 *
 * ## Why this table is a list of defects and not a list of (file, defect) pairs
 *
 * One file, one overlay - exactly as in `examples/sim-os/`. The application is a single provisioning
 * program, and a defect is an *edit* to it rather than a file that is wrong. Keeping `correct` and
 * `defective` beside each other means the pair is the whole statement of the defect, and there is no
 * second place for the edit to drift out of step with its description.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * Measured, not intended. The progression is measured by `npm run demo:cloud`, which is the only thing
 * that can measure it: the sets below describe a run, and a list of iteration verdicts copied into a test
 * would be a claim about a run that nothing could reproduce. What `tests/sim-cloud-demo.test.ts` holds is
 * the *table* those sets are derived from - that each `correct` form is anchored in the shipped program,
 * that the four ids are distinct and in criterion order, and that repairing one changes only the block it
 * names.
 *
 * - `D1` - the request that blocks public access asks for `false`. Moves `AC-003`, and nothing else,
 *   which is what "one criterion can see this defect and the others cannot" looks like.
 * - `D2` - the object's tags are written onto the *bucket*. Moves `AC-005` (the bucket's tag set is no
 *   longer the two tags it was given) and `AC-009` (the object carries none). Two criteria, in opposite
 *   directions: one gains a tag it was never given and one loses the tag it was.
 * - `D3` - the announcement is published to the dead-letter queue. Moves `AC-011` (the work queue is
 *   empty) and `AC-013` (the queue that should only ever receive failures holds a message). Again two,
 *   again in opposite directions, and again a defect no single reading can state on its own.
 * - `D4` - the deny statement is written against the receipts bucket instead of the assets bucket. Moves
 *   `AC-026` (the policy the pipeline holds no longer names the assets bucket) and `AC-027` (the
 *   account's own answer for deleting that bucket is still "no", but the *reason* is now "nothing allows
 *   it" rather than "a statement refuses it"). This is the subtlest of the four: the outcome of the
 *   authorization question does not change, only the rule the outcome came from - which is exactly the
 *   distinction a hardening contract exists to keep.
 *
 * The twenty-three criteria no defect moves are not dead weight: they are the control. A run in which
 * every criterion moved would be a run whose readings are not independent.
 *
 * ## One criterion, or several
 *
 * `criterionId` is the criterion that reads the *defect itself* rather than its consequence. `D2` is the
 * clearest case: the tagging request is aimed at the wrong resource, so the criterion that catches the
 * mistake is the one asking whether the *object* carries the tag it was given - and the bucket's tag set
 * failing is downstream of that. `D4` is the same shape one kind of resource out: the deny statement is
 * aimed at the wrong bucket, so the criterion that catches it is the one reading the *policy* the
 * principal holds, and the account's answer failing is downstream of that. The moved sets above are the
 * full story; `criterionId` is the one the table files the defect against.
 *
 * `D4`'s two candidates are one word apart in this file's own history and they are worth separating:
 * `AC-026` reads what the program *wrote* (a policy document, rendered statement by statement) and
 * `AC-027` reads what the account *decided* and the rule it decided from. A consequence reading is one
 * that reads a fact derived from the state the defect edited, and the account's decision is derived from
 * the policy - so the table files the defect against `AC-026`, and the contract's `AC-027` says so.
 *
 * ## Line endings
 *
 * `D1`-`D3` are single-line blocks and `D4` is multi-line, on purpose. A single-line block never reaches
 * the newline conversion in `defect-text.ts`, because there is no newline in it to convert - so a table
 * whose blocks are *all* single-line cannot exercise the rule at all. This project shipped a demo whose
 * table was entirely single-line while a comment claimed the opposite, and measured that breaking the
 * conversion left its test green. `D4`'s block is the one that reaches it, and `tests/defect-text.test.ts`
 * holds the rule itself against synthetic blocks and both endings.
 *
 * `D4`'s two blocks are also deliberately **not** nested. Each carries the `];` line that closes the
 * array it belongs to, so neither is a substring of the other even though they differ on one word.
 */
import {
  defectStates,
  injectDefects,
  repairDefect,
  type Defect,
  type DefectStatus,
} from "../defect-text.ts";

/** The file the overlay edits, named once. */
export const PROVISION_FILE = "provision.mjs";

export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-003",
    summary:
      "the bucket is asked to stop blocking public access, so the one request whose whole purpose is " +
      "to close the bucket is the request that opens it",
    correct: "{ blocked: true }",
    defective: "{ blocked: false }",
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-009",
    summary:
      "the object's tags are written to the bucket's tagging route instead of the object's, so the " +
      "bucket carries a tag it was never given and the object carries none",
    correct: 'send("PUT", `${OBJECT_PATH}?tagging`, { tags: OBJECT_TAGS })',
    defective: 'send("PUT", `${BUCKET_PATH}?tagging`, { tags: OBJECT_TAGS })',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-013",
    summary:
      "the announcement is published to the dead-letter queue, so the work queue is empty and the " +
      "queue that should only ever receive failures holds a message",
    correct: 'send("POST", `/v1/queues/${QUEUE}/messages`, {',
    defective: 'send("POST", `/v1/queues/${DEAD_LETTER_QUEUE}/messages`, {',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-026",
    summary:
      "the statement refusing to delete the assets bucket is written against the receipts bucket " +
      "instead, so the assets bucket is protected by nothing and the receipts bucket is protected twice",
    correct:
      '  { effect: "deny", principal: PRINCIPAL, action: "s3.deleteBucket", resource: `bucket/${BUCKET}` },\n' +
      "];",
    defective:
      '  { effect: "deny", principal: PRINCIPAL, action: "s3.deleteBucket", resource: `bucket/${RECEIPTS_BUCKET}` },\n' +
      "];",
  }),
]);

/** The three interfaces the rest of the demo works in, so nothing outside re-derives a state. */
export interface DemoStatus {
  readonly defect: Defect;
  readonly state: "injected" | "intact" | "unknown";
}

export interface InjectOutcome {
  readonly text: string;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

export interface RepairOutcome {
  readonly text: string;
  readonly repaired: Defect | null;
}

/** Which of the four defects the text currently carries. */
export function status(text: string): readonly DemoStatus[] {
  return defectStates(DEFECTS, text).map((entry: DefectStatus) =>
    Object.freeze({ defect: entry.defect, state: entry.state }),
  );
}

/** Inject every defect that is not already present. Idempotent. */
export function inject(text: string): InjectOutcome {
  const outcome = injectDefects(DEFECTS, PROVISION_FILE, text);
  return Object.freeze({
    text: outcome.text,
    injected: Object.freeze([...outcome.injected]),
    alreadyInjected: Object.freeze([...outcome.alreadyInjected]),
  });
}

/** Repair the first defect still injected, in table order. One per call, on purpose. */
export function repairOne(text: string): RepairOutcome {
  const outcome = repairDefect(DEFECTS, PROVISION_FILE, text);
  return Object.freeze({ text: outcome.text, repaired: outcome.repaired });
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
