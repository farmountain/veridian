/**
 * The four defects the `sim-container` demo injects, and the one file they all live in.
 *
 * ## Why this table is a list of defects and not a list of (file, defect) pairs
 *
 * `examples/sim-k8s/defects.ts` needed the pair because that application ships two manifest files, and
 * a defect that reported itself as fixed after matching something in a different file would be exactly
 * the failure it exists to catch. This application ships one file - `app/provision.mjs` - so the table
 * is flat, and `source.ts` reads and writes that one file, which keeps `defect-text.ts`'s single-text
 * contract honest: it takes one artifact's text and answers questions about it, and nothing here asks
 * it to span two.
 *
 * ## What the four defects are for, and what each one is measured to move
 *
 * `criterionId` is the criterion filed against the defect - the criterion that reads the *defect
 * itself* rather than one of its consequences - and the set of criteria each defect actually moves is
 * a measurement, not an intention. `tests/sim-container-demo.test.ts` asserts the moved set per
 * iteration, so a criterion that starts moving for a reason nobody wrote down fails a test rather than
 * quietly changing what the demo means.
 *
 *   - `D1` labels the image with another application's name. One criterion is filed (`container.label`,
 *     AC-010, which asks the image to name the application it is) and it is the only one that moves:
 *     the image still exists, still carries its version label, and still runs the same command. A
 *     label is metadata, and this is what a single wrong label costs.
 *   - `D2` publishes the container port onto itself instead of onto the host port the contract names.
 *     One criterion is filed (`container.port`, AC-011). Nothing else in this world reads the port
 *     table: the container starts cleanly, reports healthy, and is unreachable at the port it
 *     advertises - which is precisely the shape of failure AC-011's own description describes.
 *   - `D3` moves the service's self-declaration from `read-only` to `read-write`. One criterion is
 *     filed (`container.logs`, AC-018) and one moves. This is the most interesting defect in the table
 *     for the opposite reason to `D4`: nothing in this world reads that line, so no derived reading can
 *     move - the only thing that can see it is a criterion that quotes the program's own output.
 *   - `D4` misspells the bind mount's source. It is filed against `container.call` (AC-022), because
 *     the application's *request to start* the container is refused - a refusal rather than a failure,
 *     which is the distinction AC-022's description exists to record. It has the widest consequence set
 *     of the four, and every criterion in it is a separate true fact about the same world: the mount
 *     reading now says `source absent`, the container is created and never running, so its healthcheck
 *     never ran, its logs and its stderr are empty, and a criterion's own `container exec` is refused
 *     by the world for the same reason a real engine refuses one. The set is measured in the test
 *     rather than listed here, because a list in prose is a claim nothing reads.
 *
 * The criteria no defect moves are not dead weight: they are the control. A run in which every
 * criterion moved would be a run whose readings are not independent.
 *
 * ## Ordering
 *
 * The table is in **criterion order** - AC-010, AC-011, AC-018, AC-022 - which is the order the repair
 * agent walks. Ordering matters because `repairOne` repairs exactly one defect per call, and one defect
 * per iteration is what makes the demo's progression a diagnosis rather than a batch edit: iteration
 * three's report is what iteration two's repair left behind.
 *
 * ## Line endings
 *
 * `D1`-`D3` are single-line blocks and `D4` is multi-line, which matters more than it looks. A
 * single-line block never reaches the newline conversion in `defect-text.ts`, so it cannot tell a
 * correct implementation of the CRLF rule from a broken one: this project already shipped a demo whose
 * defect table was entirely single-line while its comment claimed the opposite, and measured that
 * breaking the rule left its test green. `D4`'s block is multi-line so that a checkout storing this
 * file in CRLF reaches that conversion - and `tests/defect-text.test.ts` is where the rule is held
 * against synthetic blocks with both endings supplied by the test, because the one thing a test over
 * this table cannot do is supply the ending.
 *
 * ## Why `D4`'s block is two lines, and why the two blocks are not nested
 *
 * `BUILD_CONTEXT` is the source of **two** bind mounts - this application creates a second container
 * from the same image - so a one-line block naming `-v, BUILD_CONTEXT + ":" + WORKSPACE` would occur
 * twice and `defect-text.ts` counts occurrences, requiring exactly one. The block therefore carries the
 * `"--name"` line above it, which is what makes it name one mount.
 *
 * Both blocks carry that line, so neither is a substring of the other and neither form reports the
 * ambiguous `unknown` state. The obvious shorter shape - a two-line correct block and a one-line
 * defective block that is its second line - reads `unknown`, because the defective form is then present
 * inside the correct one and both counts are one. `defect-text.ts` refuses that ambiguity by design.
 *
 * ## Why the defects are where they are, and not in the generated programs
 *
 * Three of the four are facts this file *sends* - a Dockerfile instruction, a published mapping, a mount
 * argument - and the fourth is a line inside a program this file *writes*. All four are edited in
 * `provision.mjs`, and none of them is edited in `context/`, because `context/` is rebuilt from this
 * file on every run: a defect injected into a generated file would be erased by the next iteration's
 * own provisioning, and the demo would report a repair the world never saw. That is the same rule as
 * "a repair the world never observed is not a repair", one layer out.
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
 * In **criterion order**, which is the order the repair agent walks: `container.label` (AC-010) reads
 * the image's title, `container.port` (AC-011) reads the published mapping, `container.logs` (AC-018)
 * reads the service's own stdout and `container.call` (AC-022) reads whether the start the application
 * asked for was answered.
 */
export const DEFECTS: readonly Defect[] = Object.freeze([
  Object.freeze({
    id: "D1",
    criterionId: "AC-010",
    summary: "the image is labelled with another application's name",
    correct: '  "LABEL org.opencontainers.image.title=" + APPLICATION,',
    defective: '  "LABEL org.opencontainers.image.title=" + "cart-api",',
  }),
  Object.freeze({
    id: "D2",
    criterionId: "AC-011",
    summary: "the container port is published onto itself instead of onto the host port",
    correct: 'const PUBLISH = String(HOST_PORT) + ":" + String(PORT);',
    defective: 'const PUBLISH = String(PORT) + ":" + String(PORT);',
  }),
  Object.freeze({
    id: "D3",
    criterionId: "AC-018",
    summary: "the service declares itself read-write over a catalogue it only reads",
    correct: '"catalog: read-only for svc-cart"',
    defective: '"catalog: read-write for svc-cart"',
  }),
  Object.freeze({
    id: "D4",
    criterionId: "AC-022",
    summary: "the bind mount's source is misspelled, so the start is refused",
    correct: '    "--name", APPLICATION,\n    "-v", BUILD_CONTEXT + ":" + WORKSPACE,',
    defective: '    "--name", APPLICATION,\n    "-v", "./contxt" + ":" + WORKSPACE,',
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
