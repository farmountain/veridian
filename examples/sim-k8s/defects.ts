/**
 * The two defects the `sim-k8s` demo injects, and the file each one lives in.
 *
 * ## Why this table is a list of (file, defect) pairs
 *
 * `examples/defect-text.ts` is deliberately single-file: it takes the text of *one* artifact and
 * answers questions about it, because a block of text that matched something in a different file would
 * be a defect that reported itself as fixed. This example's application ships two manifest files, so
 * the table has to say which one each defect belongs to, and the inject/repair helpers here fan out
 * over the files and pass each one only its own slice.
 *
 * That is not bookkeeping. A defect table that spanned files would have to guess which file a block
 * belonged to, and the guess would be made by the same code that is supposed to notice the defect had
 * gone missing.
 *
 * ## What the two defects are for
 *
 * `D1` renames the Service, so the deploy program submits a Service nobody asked about. Two criteria
 * move and they move *differently*: `k8s.applied` finds no record of a submission of `Service/cart-web`
 * and answers `INCONCLUSIVE`, because a deploy step that never ran and a deploy step the API server
 * refused are different defects and the action record can only report the second; `k8s.service` reads
 * the state record and answers `FAIL`, because the cluster genuinely holds no such Service. The pair is
 * the clearest evidence this project has that `INCONCLUSIVE` is not a softer `FAIL` - one of the two
 * readings is decisive and the other is honest about being unable to be.
 *
 * `D2` pins an image tag the build never produced. Four criteria fail from it - the spec, the ready
 * replicas, the pod count and the failed-pull event - and they fail *differently* too: one reads what
 * the Deployment asks for, two read what is serving, and one reads the cluster's own account of why.
 * That is a rollout that never finished, described the way a real run describes it.
 *
 * ## One criterion, or several
 *
 * A defect may be visible through several criteria and this file names one. The rule is that
 * `criterionId` is the criterion that reads the *defect itself* rather than its consequence - the tag
 * in the spec, the missing object - so that a reader who follows the id lands on the criterion that
 * would have caught it even if every derived count had happened to be right.
 *
 * ## Line endings
 *
 * Both blocks are written with `\n`. Every real file on this machine may hold CRLF, so
 * `defect-text.ts` re-expresses a block in the file's own ending before matching it - the rule this
 * project paid for once, in `examples/shopping-cart`, where a `\n` block matched nothing in a CRLF
 * checkout and the demo reported a `PASS` the application had never earned.
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

/** The directory the application's manifests live in, relative to the application. */
export const MANIFEST_DIR = "manifests";

/** The Deployment. Carries `D2`. */
export const DEPLOYMENT = `${MANIFEST_DIR}/deployment.yaml`;
/** The Service. Carries `D1`. */
export const SERVICE = `${MANIFEST_DIR}/service.yaml`;

export type ManifestFile = typeof DEPLOYMENT | typeof SERVICE;

/** One defect, and the file it lives in. */
export interface DemoDefect {
  readonly file: ManifestFile;
  readonly defect: Defect;
}

/**
 * In **criterion order**, which is the order the repair agent walks: `k8s.image` (AC-003) reads the
 * Deployment's spec and `k8s.service` (AC-007) reads the Service, so the Deployment's defect comes
 * first. Ordering matters because `repairOne` repairs exactly one defect per call - one defect per
 * iteration is what makes the demo's progression a diagnosis rather than a batch edit.
 */
export const DEFECTS: readonly DemoDefect[] = Object.freeze([
  Object.freeze({
    file: DEPLOYMENT,
    defect: Object.freeze({
      id: "D2",
      criterionId: "AC-003",
      summary: "the Deployment pins an image tag the build never produced",
      correct: "          image: registry.local/cart-web:1.4.0",
      defective: "          image: registry.local/cart-web:9.9.9",
    }),
  }),
  Object.freeze({
    file: SERVICE,
    defect: Object.freeze({
      id: "D1",
      criterionId: "AC-007",
      summary: "the Service submits an object name the contract never asks for",
      correct: "  name: cart-web\n  labels:",
      defective: "  name: cart-web-api\n  labels:",
    }),
  }),
]);

/** Every file the table names, in criterion order. */
export const MANIFEST_FILES: readonly ManifestFile[] = Object.freeze([DEPLOYMENT, SERVICE]);

/** The text of each named file. */
export type ManifestText = Readonly<Record<ManifestFile, string>>;

/** What one defect's block says about one file's text. */
export interface DemoStatus {
  readonly file: ManifestFile;
  readonly defect: Defect;
  readonly state: DefectState;
}

/** The outcome of injecting every defect this file holds. */
export interface InjectOutcome {
  readonly files: ManifestText;
  readonly injected: readonly string[];
  readonly alreadyInjected: readonly string[];
}

/** The outcome of repairing at most one defect. */
export interface RepairOutcome {
  readonly files: ManifestText;
  readonly repaired: DemoDefect | null;
}

/** The defects that live in `file`, in table order. */
function inFile(file: ManifestFile): readonly Defect[] {
  return DEFECTS.filter((entry) => entry.file === file).map((entry) => entry.defect);
}

/**
 * What each defect's block says about the files it is given.
 *
 * Returned for *every* defect including the ones in a file that could not be read, which is why the
 * caller passes both files rather than one: a demo that needed a file it could not find should say so
 * once, at the read, rather than have each defect report itself as `unknown`.
 */
export function status(files: ManifestText): readonly DemoStatus[] {
  return MANIFEST_FILES.flatMap((file) =>
    defectStates(inFile(file), files[file]).map((entry: DefectStatus) =>
      Object.freeze({ file, defect: entry.defect, state: entry.state }),
    ),
  );
}

/**
 * Inject every defect that is not already in.
 *
 * `injectDefects` refuses a file whose blocks are ambiguous - neither form present, or both - so an
 * already-injected defect is reported as such rather than injected twice, and a file that has drifted
 * raises here rather than being edited into a third state.
 */
export function inject(files: ManifestText): InjectOutcome {
  const next: Record<ManifestFile, string> = { ...files };
  const injected: string[] = [];
  const alreadyInjected: string[] = [];
  for (const file of MANIFEST_FILES) {
    const result: InjectResult = injectDefects(inFile(file), file, files[file]);
    next[file] = result.text;
    injected.push(...result.injected);
    alreadyInjected.push(...result.alreadyInjected);
  }
  return { files: next, injected, alreadyInjected };
}

/**
 * Repair the **first still-injected** defect, in criterion order, and report which one it was.
 *
 * The repaired defect is returned so the caller can verify the change rather than describe it: a
 * function that edits a file must not announce a repair it has not confirmed.
 */
export function repairOne(files: ManifestText): RepairOutcome {
  for (const file of MANIFEST_FILES) {
    const result: RepairResult = repairDefect(inFile(file), file, files[file]);
    if (result.repaired !== null) {
      return { files: { ...files, [file]: result.text }, repaired: { file, defect: result.repaired } };
    }
  }
  return { files, repaired: null };
}

export type { Defect, DefectState, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
