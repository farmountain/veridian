/**
 * Adopting a world: reading an interchange document, and refusing when it names a different world.
 *
 * ## What an import is, and what it is not
 *
 * This module does **not** build a world. The adapter builds it, from the operator's own environment
 * document, exactly as it does for a world nobody exported - and that is deliberate, because a reader
 * that could construct a world would be resolving one on *this* machine and calling the result the
 * document's. The import's entire content is one question:
 *
 * > **Is the world this run is about to create the world the document names?**
 *
 * The answer is a comparison of two identities, and both are put through `exportDocument` first, so
 * the import and the export cannot disagree about what an identity is. That is the same seam this
 * repository has paid for most often: a second implementation of a rule is a rule that will disagree
 * the first time a world arrives that only one of them was written for. Here there is one
 * implementation - `denv.ts`'s `renderWorldIdentity` - reached through the predicate this file calls.
 *
 * ## Why a mismatch is a refusal and not a warning
 *
 * Because the alternative is the defect this product exists to prevent, one layer out. The plan
 * carries `imported` and the bundle writes it, so a mismatched import that only warned would leave a
 * run whose evidence says *adopted from `<document>`* beside readings taken in a different world. A
 * reader auditing that bundle has no way to tell: both claims are present, one is false, and nothing
 * in the document says which. The refusal has to happen before the world exists, which is why the
 * check is a load-time refusal and not a run-time observation.
 *
 * ## What is adopted, and what is not
 *
 * Only the **identity** travels. A declared root, a sandbox directory, an account and a service name
 * are re-derived from the operator's own document, because a rendered identity block has already
 * lost the prefix that would let them be re-derived from the document - `renderWorldIdentity` renders
 * a `root` to its last segment on purpose, since the operator's checkout is not the world's. An
 * import that reconstructed a plan from the document would have to invent that prefix, and inventing
 * an operator prefix is precisely *resolving a world on this machine and calling it the document's*.
 * So the local document supplies everything the world needs, and the document supplies the claim
 * that the world about to exist is the one it is about.
 *
 * ## Why this file is here rather than in `core/environment/`
 *
 * The phase that planned this work named `core/environment/load.ts` as its touch point, and the
 * loader *is* touched - it reads the declaration. The verification cannot live there. It has to read
 * a file (which needs an `IoPort` the loader does not take) and it has to reach the export predicate
 * and the interchange document, both of which are in this directory. `core/environment/` imports
 * nothing from the other five core directories today - it is a leaf - and the alternative was making
 * it import this one, which would have inverted that. So the **declaration** is decoded by
 * `core/environment/load.ts`, beside every other block, with its refusals; the **verification** is
 * one step out, in the layer that composes them. *The split follows the grain the tree already has:
 * a document field is decoded where documents are decoded, and a comparison between a document and a
 * predicate is made where both are in scope.*
 */

import type { ReadonlyIoPort } from "../io.ts";
import type { EnvironmentPlan, ImportDeclaration, ImportRecord } from "../environment/types.ts";
import type { WorldIdentity } from "../evidence/index.ts";
import { worldIdentity, worldLabel } from "../evidence/index.ts";
import { canonicalJson, exportDocument } from "./denv.ts";
import { parseEsi } from "./esi.ts";
import type { EsiDocument } from "./esi.ts";

/**
 * A declared import that cannot be honoured, with the path it failed at.
 *
 * The path is spelled the way the operator's own document spells it (`$.import.from`), rather than
 * as an internal locator, because the message is read by whoever wrote the document - the same rule
 * `load.ts`'s `defect()` follows for every other refusal in this tree.
 */
export interface ImportRefusal {
  readonly path: string;
  readonly message: string;
}

/**
 * Whether a value is a refusal rather than the thing asked for.
 *
 * `unknown` rather than the union it is used to split, because the two halves of that union are put
 * together by the caller - `readImportDocument` returns one shape and `importWorld` the other - and a
 * guard that could only be applied to an already-typed union would be unusable at the one place it
 * is needed, which is where the two are still apart.
 */
export const isImportRefusal = (value: unknown): value is ImportRefusal =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly message?: unknown }).message === "string" &&
  typeof (value as { readonly path?: unknown }).path === "string";

/**
 * The identity block, as the export predicate would render it.
 *
 * Both sides of the comparison go through this, and through the same function, which is what makes
 * the byte-identity claim meaningful: `exportDocument` is the one implementation of *what may leave
 * and in what form*, so an import that compared raw identities would pass on a document the exporter
 * had rendered and fail on one it had not - two different answers to one question, decided by which
 * side of a round trip the reader was standing on.
 */
function renderedIdentity(value: unknown): WorldIdentity | null {
  const document = exportDocument({ world: value }).document;
  const block = document["world"];
  if (typeof block !== "object" || block === null || Array.isArray(block)) return null;
  const record = block as Record<string, unknown>;
  const kind = record["kind"];
  const name = record["name"];
  if (typeof kind !== "string" || typeof name !== "string") return null;
  const detail = record["detail"];
  return {
    kind,
    name,
    detail:
      typeof detail === "object" && detail !== null && !Array.isArray(detail)
        ? (detail as Record<string, string>)
        : null,
  };
}

/**
 * The first fact the two identities disagree about, or `null` when they agree.
 *
 * Names a fact rather than reporting "they differ", because the two identities are short objects and
 * the difference between them is exactly the thing the operator has to go and look at. A refusal that
 * says *the root differs: the document says `sandbox`, this document says `elsewhere`* is actionable;
 * *the identity does not match* leaves the reader diffing two JSON blobs by eye.
 */
function firstDifference(adopted: WorldIdentity, local: WorldIdentity): string | null {
  if (adopted.kind !== local.kind) {
    return `the world's kind differs: the document names a \`${adopted.kind}\` world and this ` +
      `document declares a \`${local.kind}\` one`;
  }
  if (adopted.name !== local.name) {
    return `the world's name differs: the document names \`${adopted.name}\` and this document ` +
      `declares \`${local.name}\``;
  }
  const adoptedDetail = adopted.detail ?? {};
  const localDetail = local.detail ?? {};
  for (const key of [...new Set([...Object.keys(adoptedDetail), ...Object.keys(localDetail)])].sort()) {
    if (adoptedDetail[key] !== localDetail[key]) {
      return `\`${key}\` differs: the document says \`${adoptedDetail[key] ?? "(absent)"}\` and ` +
        `this document says \`${localDetail[key] ?? "(absent)"}\``;
    }
  }
  return null;
}

/**
 * Verify that a plan's world is the world a document names, and return what to record about it.
 *
 * `declared` is the import the operator's document asked for - passed rather than read off the plan,
 * because the plan's `imported` field is what this function produces and reading it here would make
 * the two the same thing.
 */
export function importWorld(
  document: EsiDocument,
  imported: ImportDeclaration,
  plan: EnvironmentPlan,
): ImportRecord | ImportRefusal {
  const adopted = renderedIdentity(document.world);
  if (adopted === null) {
    return {
      path: "$.import.from",
      message:
        `the interchange document at ${imported.from} names no world, so there is nothing to adopt ` +
        "this run into. A document without an identity block describes runs that were observed " +
        "somewhere and says nowhere; adopting it would be adopting a verdict with no subject.",
    };
  }

  const local = renderedIdentity(worldIdentity(plan));
  if (local === null) {
    return {
      path: "$.import.from",
      message:
        `the environment document this run is using declares no world, so it cannot be the world ` +
        `named by the interchange document at ${imported.from}. The document names a ` +
        `\`${adopted.kind}\` world called \`${adopted.name}\`, and a document that declares no ` +
        "adapter block, no url and no database is not that world.",
    };
  }

  const difference = firstDifference(adopted, local);
  if (difference !== null) {
    return {
      path: "$.import.from",
      message:
        `the interchange document at ${imported.from} names a different world from the one this ` +
        `document declares, so this run's readings would not be readings of it - ${difference}. ` +
        "An import is a verification and not a materialisation: this document's own adapter builds " +
        "the world, and the import's only job is to establish that the world built is the world the " +
        "document is about.",
    };
  }

  return {
    from: imported.from,
    subject: document.subject,
    world: worldLabel(adopted),
    identity: canonicalJson(adopted),
    runs: document.runs.length,
  };
}

/**
 * Read an interchange document off disk, at the path the environment document named.
 *
 * A refusal rather than a `null`, for the reason every other reader in this tree refuses: an import
 * that silently did not happen is an operator who believes a run is traceable to another machine's
 * document and a bundle that says nothing about it. `parseEsi` answers `null` for bytes that are not
 * an ESI, and that `null` becomes a refusal here with the path and the reason attached.
 */
export async function readImportDocument(
  io: ReadonlyIoPort,
  imported: ImportDeclaration,
): Promise<EsiDocument | ImportRefusal> {
  let text: string | null;
  try {
    text = await io.readTextFile(imported.from);
  } catch (error) {
    return {
      path: "$.import.from",
      message: `the interchange document at ${imported.from} could not be read (${describe(error)})`,
    };
  }
  if (text === null) {
    return {
      path: "$.import.from",
      message:
        `no interchange document exists at ${imported.from}. An import that is declared and cannot ` +
        "be read is refused rather than skipped, because a skipped import is a run that reports the " +
        "world it built and says nothing about the document it was supposed to be.",
    };
  }

  const parsed = parseEsi(text);
  if (parsed === null) {
    return {
      path: "$.import.from",
      message: `${imported.from} is not an interchange document this build can read`,
    };
  }
  return parsed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
