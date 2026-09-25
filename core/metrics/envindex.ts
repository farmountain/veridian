/**
 * The environment index: what every run's application could **see**, joined across the history.
 *
 * ## Why this is a reader and not a store
 *
 * `docs/DIGITAL-TWIN-DESIGN.md` refuses a second persistence layer in as many words - *"a join and a
 * name, not a layer"* - and the argument is that a cache is a second source of truth, so the first time
 * a run is deleted the two disagree and a reader cannot tell which is wrong. So this module holds no
 * state. It walks the bundles that are already on disk, exactly as `eli.ts` and `history.ts` do, and
 * answers a question of them.
 *
 * What makes that possible is that the crawl is written into `environment.json` rather than only into
 * a per-criterion artifact. The crawl is a property of the *run's world* - what the child the world
 * started could see - so it belongs beside the run's other world facts, and putting it there makes
 * this join as cheap as the ELI's.
 *
 * ## The reading it exists to produce
 *
 * The headline number is `runsWithInheritedCredentials`: how many runs on this disk gave their
 * application a credential-shaped name that the world's own document did not declare. Before the
 * `process.environment` seam nothing could answer that, because nothing recorded the environment the
 * child was handed - and the bundle's `env` block, which is the *declaration*, reads as though it were
 * the answer. A reader looking at `env: { CART_BUILD_CHANNEL: "nightly" }` reasonably concludes the
 * application could see one variable; measured on this machine it could see eighty-four.
 *
 * ## Two things it deliberately does not do
 *
 * It does not re-derive the subject. `subjectOf` is the same string M1 groups by and the same one the
 * ELI uses, reached through `listEliRows`, so three readers agreeing is a property of calling one
 * function rather than of three implementations staying in step.
 *
 * It does not invent a reading for a bundle that has none. A run written before the crawl existed, or
 * by a world that started no child, is reported in `runsWithoutReading` and is *not* counted as a run
 * that came back clean. That distinction is the whole point: an absent measurement and a measurement
 * of nothing are the two things this repository separates more often than any other pair.
 */

import { isEnvCrawl } from "../environment/env-crawl.ts";
import type { EnvCrawl, EnvMode } from "../environment/env-crawl.ts";
import type { IoPort } from "../io.ts";
import { listEliRows, readRunEnvironment } from "./eli.ts";

/**
 * One run's crawl, reduced to what an index is for.
 *
 * The full `EnvCrawl` carries every name with three booleans each, which is the right shape for a
 * bundle and the wrong one for an index across two hundred runs: a reader asking "which subjects ever
 * had a credential visible" does not need eighty-four entries per run to answer it. What is kept is
 * what answers that question, and `credentialNames` is kept as names rather than as a count because a
 * reader comparing two subjects needs to see *which* name appeared.
 */
export interface EnvIndexRun {
  readonly runId: string;
  readonly mode: EnvMode;
  readonly visible: number;
  readonly inherited: number;
  readonly credentials: readonly string[];
  /** Credential-shaped names the world did not declare. Empty is the clean reading. */
  readonly inheritedCredentials: readonly string[];
}

/** One subject's runs, and what the whole group could see. */
export interface EnvIndexGroup {
  readonly subject: string;
  readonly runs: readonly EnvIndexRun[];
  /** Every mode any run of this subject used, sorted - a subject that changed its policy shows both. */
  readonly modes: readonly EnvMode[];
  /** Every credential-shaped name any run could see, sorted. A union, not a count of duplicates. */
  readonly credentialNames: readonly string[];
  /** Every credential-shaped name no world of this subject declared, sorted. **The finding.** */
  readonly inheritedCredentialNames: readonly string[];
  /** How many of this subject's runs gave their application an undeclared credential. */
  readonly runsWithInheritedCredentials: number;
}

export interface EnvIndexReport {
  readonly groups: readonly EnvIndexGroup[];
  /**
   * Runs whose `environment.json` carried no crawl, by run id - reported, never dropped.
   *
   * This is a **third** list, distinct from `EliReport.unreadable` (a result that cannot be parsed, so
   * not a row at all) and `EliEnvReport.unreadableEnvironments` (a row whose world document is
   * missing). A run here is a row whose world document is present and whose *boundary block* holds no
   * environment reading, which is what a bundle written before the crawler existed looks like. Merging
   * it into either of the others would report a run nobody could measure as a run that measured clean.
   */
  readonly runsWithoutReading: readonly string[];
}

/**
 * The crawl out of a parsed `environment.json`, or `null` when there is none to read.
 *
 * The file is snake_cased and the in-memory type is not, so this maps the one to the other and then
 * hands the result to `isEnvCrawl` rather than trusting its own mapping. That is deliberate: the
 * structural check is the one place that knows what a crawl is, and a reader that built the object and
 * judged it with its own eyes would be a second definition of the shape - the defect the process
 * observation's own `isProcessObservationData` exists to prevent one family over.
 */
export function crawlFrom(document: Readonly<Record<string, unknown>>): EnvCrawl | null {
  const boundary = document["boundary"];
  if (typeof boundary !== "object" || boundary === null || Array.isArray(boundary)) return null;
  const block = (boundary as Record<string, unknown>)["environment"];
  if (typeof block !== "object" || block === null || Array.isArray(block)) return null;
  const record = block as Record<string, unknown>;
  const candidate = {
    mode: record["mode"],
    entries: record["entries"],
    inherited: record["inherited"],
    populated: record["populated"],
    credentials: record["credentials"],
    inheritedCredentials: record["inherited_credentials"],
  };
  return isEnvCrawl(candidate) ? candidate : null;
}

/**
 * **The environment index over the runs on disk.**
 *
 * The grouping is `listEliRows`', so a change to the subject rule moves this reading with the metrics
 * and the ELI rather than on its own. Runs are read in the order the join produced them, which is run
 * -name order, so two invocations over an unchanged history produce the same report and a diff of two
 * reports is a diff of the history.
 *
 * A subject with no readable crawl is still a group. Dropping it would make "this subject's runs were
 * all clean" and "this subject could not be read at all" the same absence, which is the shape this
 * repository refuses wherever it finds it.
 */
export async function listEnvIndex(io: IoPort, stateDir: string): Promise<EnvIndexReport> {
  const report = await listEliRows(io, stateDir);
  const crawls = new Map<string, EnvCrawl>();
  const runsWithoutReading: string[] = [];

  for (const row of report.rows) {
    const document = await readRunEnvironment(io, stateDir, row.runId);
    const crawl = document === null ? null : crawlFrom(document);
    if (crawl === null) {
      runsWithoutReading.push(row.runId);
      continue;
    }
    crawls.set(row.runId, crawl);
  }

  const groups = report.groups.map((group): EnvIndexGroup => {
    const runs: EnvIndexRun[] = [];
    const modes = new Set<EnvMode>();
    const credentialNames = new Set<string>();
    const inheritedNames = new Set<string>();

    for (const row of group.rows) {
      const crawl = crawls.get(row.runId);
      if (crawl === undefined) continue;
      modes.add(crawl.mode);
      for (const entry of crawl.credentials) credentialNames.add(entry.name);
      for (const name of crawl.inheritedCredentials) inheritedNames.add(name);
      runs.push({
        runId: row.runId,
        mode: crawl.mode,
        visible: crawl.entries.length,
        inherited: crawl.inherited,
        credentials: crawl.credentials.map((entry) => entry.name),
        inheritedCredentials: [...crawl.inheritedCredentials],
      });
    }

    return {
      subject: group.subject,
      runs,
      modes: [...modes].sort(),
      credentialNames: [...credentialNames].sort(),
      inheritedCredentialNames: [...inheritedNames].sort(),
      runsWithInheritedCredentials: runs.filter((run) => run.inheritedCredentials.length > 0).length,
    };
  });

  return { groups, runsWithoutReading };
}
