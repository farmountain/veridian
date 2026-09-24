/**
 * The ESI: the interchange document. **Export only.**
 *
 * The ELI is a view a reader over one machine can ask a question of, and dENV is a rule about which
 * of its keys may leave. This module produces the thing that actually leaves - the world's identity
 * block beside the per-run environment readings the predicate approved - in a shape a second machine
 * can read without knowing anything about this repository.
 *
 * Three properties are the whole of the design, and each one is a refusal of something easier:
 *
 *  - **Export only, and no reader that resolves a world.** There is deliberately no import path here,
 *    and there never will be one in this file. An import half is a code path that would resolve a
 *    world on *this* machine and call the result the world's, which is the false `PASS` this product
 *    exists to make impossible. `parseEsi` parses bytes; it does not build a world.
 *
 *    Phase 08 built the import, and this file is still the half that cannot resolve anything - which
 *    is why the import is **one file over** rather than a fifth export here. `import.ts` reads a
 *    document, compares the identity it names with the identity the operator's own plan derives, and
 *    refuses when they differ; the world is then built by the adapter that would have built it anyway.
 *    So the sentence this block used to end with - *this document can be read and not adopted* - is
 *    now a sentence about this file rather than about the program: `esi.ts` reads, `import.ts`
 *    verifies, and the adapter builds. `tests/world-import.test.ts` holds the roster that keeps it
 *    that way.
 *  - **Byte-stable.** Exporting the same input twice produces the same string, and the same input with
 *    its keys inserted in a different order produces the same string too. The second half is what
 *    makes the first mean anything: `JSON.stringify` preserves insertion order, so a writer that
 *    happened to be stable because one code path built one object would produce a different document
 *    the first time a second path built the same value in another order. A document two readers cannot
 *    diff is a document they cannot compare, and this tree has already paid for that shape once - a
 *    bundle ledger that only appended listed 36 artifacts for 10 files with four sizes for one path.
 *  - **Nothing the predicate refused reaches it.** Not as a value, and not as a placeholder. An absent
 *    key means the exporter did not carry it, and the reason lives in the refusal record this module
 *    returns beside the document - *an archive has to be read back to be known*, and a refusal has to
 *    be reported rather than rendered.
 *
 * The identity block is read **through the predicate** rather than from the bundle directly. That is
 * the seam this repository has paid for the most times: `world` is one of the three keys dENV rules
 * `rendered` rather than `kept`, because a `database` world is named after its file and a process
 * world's detail holds the application's command line. An ESI writer that read `world` off the bundle
 * would be a second implementation of that rule, and the two would disagree the first time a world
 * arrived that only one of them was written for.
 */

import { worldLabel } from "../evidence/index.ts";
import type { IoPort } from "../io.ts";
import { canonicalJson, exportDocument } from "./denv.ts";
import { listEliRows, readRunEnvironment } from "./eli.ts";
import type { EliRow } from "./eli.ts";

/**
 * The document's own version, so a reader can tell what it is holding rather than inferring it.
 *
 * It is a number rather than a date and it is not derived from anything: the point of a version is
 * that it changes when the *shape* changes, and a value computed from the tree would change for
 * reasons that have nothing to do with this document.
 */
export const ESI_VERSION = 1;

/** The world's identity, as the predicate let it leave. */
export interface EsiWorld {
  readonly kind: string;
  readonly name: string;
  readonly detail: Readonly<Record<string, string>> | null;
}

/** One run's reading: what it concluded, and the environment document the predicate approved. */
export interface EsiRun {
  readonly run_id: string;
  readonly verdict: string;
  readonly state: string;
  readonly iteration_count: number;
  readonly environment: Readonly<Record<string, unknown>>;
}

export interface EsiDocument {
  readonly esi_version: number;
  readonly subject: string;
  /**
   * The identity block, or `null` for a subject whose bundles declare no world.
   *
   * Taken from the group's **first readable run**, which is the earliest by run id - so two exports of
   * one history name the same run, and the choice is reproducible rather than "whichever the reader
   * happened to open first".
   */
  readonly world: EsiWorld | null;
  /**
   * Every world label this subject's runs declared, sorted and de-duplicated.
   *
   * It is a list rather than a boolean because a boolean would answer "did the world move" and throw
   * away *where it moved to* - and the second question is the one a reader auditing a reset asks.
   * One entry means the subject's bundles agree; more than one is a reading, not an error, because
   * dENV's own measurement found `world` moving on a subject whose runs were recorded either side of
   * the work that added the field.
   */
  readonly world_variants: readonly string[];
  readonly runs: readonly EsiRun[];
}

/** A key the predicate refused on one run's document, with the reason it gave. */
export interface EsiRefusal {
  readonly run_id: string;
  readonly key: string;
  readonly reason: string;
}

/** A value the predicate rendered on one run's document, with the reason - present, but not verbatim. */
export interface EsiRendering {
  readonly run_id: string;
  readonly path: string;
  readonly reason: string;
}

export interface EsiExport {
  readonly document: EsiDocument;
  /** The document as it would be written: canonical, so two exports compare with `assert.equal`. */
  readonly json: string;
  readonly refused: readonly EsiRefusal[];
  readonly rendered: readonly EsiRendering[];
}

/** The identity block, read out of a document the predicate has already approved. */
const worldOf = (document: Readonly<Record<string, unknown>>): EsiWorld | null => {
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
        ? (detail as Readonly<Record<string, string>>)
        : null,
  };
};

/**
 * The interchange document for **one subject**.
 *
 * A subject rather than the whole history, because the identity block is a property of a world and a
 * subject is one goal judged in one world - so a document that spanned subjects would have to answer
 * "which world is this", which is a question it cannot answer. The caller that wants all of them gets
 * a list, and each entry is self-contained.
 *
 * Runs whose document could not be read are **omitted from `runs` and counted nowhere**, which is
 * deliberate: they are not a row with an empty environment, because an empty environment is
 * indistinguishable from a record that declared nothing. The reader that wants them asks
 * `listEliEnvDeltas`, whose `unreadableEnvironments` names them - and this module does not restate
 * that list, so the two cannot disagree about its length.
 */
export function esiForSubject(
  subject: string,
  rows: readonly EliRow[],
  documents: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): EsiExport {
  const runs: EsiRun[] = [];
  const refused: EsiRefusal[] = [];
  const rendered: EsiRendering[] = [];
  const variants = new Set<string>();
  let world: EsiWorld | null = null;

  for (const row of rows) {
    const raw = documents.get(row.runId);
    if (raw === undefined) continue;

    const exported = exportDocument(raw);
    for (const entry of exported.refused) {
      refused.push({ run_id: row.runId, key: entry.key, reason: entry.reason });
    }
    for (const entry of exported.rendered) {
      rendered.push({ run_id: row.runId, path: entry.path, reason: entry.reason });
    }

    const identity = worldOf(exported.document);
    if (identity !== null) {
      variants.add(worldLabel(identity));
      if (world === null) world = identity;
    }

    runs.push({
      run_id: row.runId,
      verdict: row.verdict,
      state: row.state,
      iteration_count: row.iterationCount,
      environment: exported.document,
    });
  }

  const document: EsiDocument = {
    esi_version: ESI_VERSION,
    subject,
    world,
    world_variants: [...variants].sort(),
    runs,
  };

  return { document, json: canonicalJson(document), refused, rendered };
}

/**
 * Every subject's interchange document, read off the bundles already on disk.
 *
 * It reads through `listEliRows` and `readRunEnvironment` rather than walking the runs directory
 * itself, so the population, the grouping key and the document the predicate rules are all the ones
 * the ELI and dENV already read - three readers agreeing because they call one function each, which is
 * the property that cannot drift.
 */
export async function listEsi(io: IoPort, stateDir: string): Promise<readonly EsiExport[]> {
  const report = await listEliRows(io, stateDir);
  const documents = new Map<string, Readonly<Record<string, unknown>>>();

  for (const row of report.rows) {
    const document = await readRunEnvironment(io, stateDir, row.runId);
    if (document !== null) documents.set(row.runId, document);
  }

  return report.groups.map((group) => esiForSubject(group.subject, group.rows, documents));
}

/**
 * Read an interchange document back off its own bytes.
 *
 * It is deliberately a **parse and not an import**: it answers "what does this document say", and it
 * cannot answer "make me a world", because a reader that could would be resolving a world on this
 * machine and calling it the document's. The import half is `import.ts`, it compares rather than
 * constructs, and it is reached from here only by a caller holding both a parsed document and a plan.
 *
 * A malformed document returns `null` rather than throwing, on the same reasoning the ELI uses for a
 * bundle that cannot name its world: "these bytes are not an ESI" is one fact, and a thrown parse
 * error is that fact with a stack attached.
 */
export function parseEsi(json: string): EsiDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record["esi_version"] !== ESI_VERSION) return null;
  if (typeof record["subject"] !== "string") return null;
  if (!Array.isArray(record["runs"])) return null;
  return parsed as EsiDocument;
}
