/**
 * The environment a child process can see, as a reading rather than a dump.
 *
 * ## The gap this exists to close
 *
 * Confinement in this repository covers three dimensions and is measured in each: a child cannot write
 * outside its `writeRoots`, cannot read outside its `readRoots`, and cannot spawn unless a world asks
 * for it. There is a fourth dimension, and until this file it was covered by nothing and recorded by
 * nothing. `core/process.ts` starts every child as `{ ...process.env, ...declared }`, so a Veridian
 * world's application inherits the operator's entire shell - and `core/evidence/writer.ts` writes
 * `env: plan.env`, which is the world's **declaration**. A reader opening a bundle therefore sees an
 * `env` block, concludes the environment was that, and is wrong; the application could also read every
 * credential in the shell that launched the run.
 *
 * That was measured end to end rather than inferred, and the measurement is worth stating because it
 * is the reason this reading exists: a throwaway goal whose probe reported counts, run through the real
 * CLI with a name planted in the invoking shell, passed a criterion asserting the planted name reached
 * the application. It did. The application also saw 5 credential-shaped names, all of them populated.
 *
 * ## The one rule, and how it is held
 *
 * **Names leave. Values never.** That is not a promise made in this comment and enforced by care - it
 * is a property of the types below. {@link EnvCrawlEntry} has four fields and not one of them can hold
 * a value: `name` is the key, and `declared`, `credential` and `populated` are booleans. There is no
 * `value`, no `preview`, no `length`, and no `hash`. An implementation that wanted to leak a value
 * would have to widen the type to do it, and `tests/env-crawl.test.ts` asserts the leak is
 * *unrepresentable* by planting a distinctive secret in the environment and asserting the serialised
 * crawl does not contain it - so the guard is against a future field rather than against a typo.
 *
 * This matters more here than anywhere else in the tree. An environment is the one artifact that
 * reliably holds live credentials, it is written into `.veridian/runs/<id>/environment.json` and into
 * per-criterion evidence artifacts, and `.veridian/` is a directory people commit by accident. `denv.ts`
 * refuses to export a host path; this file refuses to export a value at all.
 *
 * ## Two questions, and why they are two fields rather than one enumeration
 *
 * `declared` and `credential` are orthogonal, and collapsing them into one class word would lose the
 * reading that matters. A world that declares `CART_BUILD_CHANNEL` owns that name - it is the world's,
 * and a reader comparing two runs wants to know it came from the document. A name the world did **not**
 * declare and that matches a credential shape is the finding: something reached the application the
 * operator never chose. `OPENAI_API_KEY` is both credential-shaped *and* inherited here, and the pair
 * `(credential: true, declared: false)` is the one a criterion can refuse. One enum could not say both.
 *
 * `populated` is separate for the same reason a bundle distinguishes `url: null` from a missing key: a
 * name present and empty is a declaration, and a name present and occupied is a secret in reach.
 */

/** Whether a world inherited the operator's environment or declared its own. */
export const ENV_MODES = ["inherit", "declared"] as const;
export type EnvMode = (typeof ENV_MODES)[number];

/**
 * The names this platform supplies to a child no matter what map it was handed - a **measurement**, made
 * on Windows with Node 22.18 and stated as one.
 *
 * ## Why a reading needs this, and the defect it was found by
 *
 * A crawl of the map a world hands over is not a crawl of what the child can see, and the difference is
 * every bit as capable of producing a false clean as the inheritance this seam was built to remove.
 * `spawn(..., { env: { six names } })` does not give the child six names on this platform: it gives it
 * seventeen, because `CreateProcess` supplies eleven of its own whether or not they were asked for.
 * Measured, in process, against the example's own contract:
 *
 *   the map handed over        6 names   (`crawl.entries.length` - what the reading reports)
 *   the child's own census    17 names   (`Object.keys(process.env)` - what the program printed)
 *   the difference            11 names   exactly this list
 *
 * So a crawl that stopped at six would report `inherited: 0` for a child that inherited `USERNAME`,
 * `USERDOMAIN` and `LOGONSERVER` from the operating system, and it would report zero inherited
 * credentials for a child that had one if this platform's baseline happened to include one. **That is
 * the same shape as `env: plan.env`** - a reading of the intention, presented as a reading of the
 * outcome - one level down, and it was found by the example's two instruments disagreeing rather than
 * by anyone reading this file.
 *
 * ## What is done about it
 *
 * Under `declared`, the runner seeds the map with whichever of these names the current process actually
 * holds, and crawls **that**. The child's environment does not change by one byte - these names arrived
 * before and arrive now - but the map the reading is taken of is now the map the child gets, so
 * `visible` is true rather than short by eleven.
 *
 * The list is a curated fact and is therefore a liability, so it carries a control rather than a
 * promise: `tests/env-confinement.test.ts` starts a real child on an empty map and asserts that nothing
 * it saw is missing from this list. A platform that began supplying a twelfth name would fail that
 * assertion by name, which is the only honest way to hold a measurement.
 *
 * `SESSIONNAME`, `ComSpec` and the rest of this machine's shell were **not** in the child's view under
 * `declared`, which is the point of the mode: they are the operator's, not the operating system's.
 */
export const PLATFORM_BASELINE = [
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
] as const;

/**
 * The subset of the platform baseline this process actually holds.
 *
 * Names this process does not hold are omitted rather than invented, so a child started from a stripped
 * parent is not handed a value the runner made up - which would be a reading that *created* the fact it
 * reports.
 */
export function platformBaseline(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const name of PLATFORM_BASELINE) {
    const value = env[name];
    if (value !== undefined) baseline[name] = value;
  }
  return baseline;
}

/**
 * The name pattern, which is a heuristic and is stated as one.
 *
 * It is deliberately broader than any single vendor's spelling: a name containing `KEY`, `TOKEN`,
 * `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`, `PRIVATE`, `SESSION`, `COOKIE`, `SIGNATURE`, `SALT`,
 * `CERT`, `DSN` or `CONNECTION` is treated as credential-shaped whatever it holds. The direction of the
 * error is chosen rather than accidental: a false positive costs a reader one line of noise, and a
 * false negative costs them the knowledge that a credential was reachable.
 */
const CREDENTIAL_NAME =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE|SESSION|COOKIE|SIGNATURE|SALT|CERT|DSN|CONNECTION/i;

/**
 * The value-shape pattern, because a name-only screen is measurably insufficient.
 *
 * Measured on this machine: ten names carried credential-shaped values under innocuous names -
 * `GIT_ASKPASS`, `PYTHONSTARTUP`, `COPILOT_DEBUG_NONCE` among them - so a crawler that screened on keys
 * alone would report a clean environment while a secret sat in it under a name nobody would look at.
 *
 * The test is deliberately conservative, and its exclusions are the part that carries the weight:
 * anything containing a path separator or a drive letter is a path and not a token, anything with
 * whitespace is prose, and anything shorter than 20 characters is too short to be a key worth naming.
 * What is left is a run of characters with no spaces, at least one letter and one digit, and a wide
 * character set - which is what a key looks like and not what a version, a flag or a sentence looks
 * like. It is a heuristic and it is reported as one: the reading names the entries it matched rather
 * than folding them into a number, so a reader who disagrees with the classifier can see what it saw.
 */
function looksLikeCredentialValue(value: string): boolean {
  if (value.length < 20) return false;
  if (/\s/.test(value)) return false;
  if (/[\\/]/.test(value)) return false;
  if (/^-----BEGIN/.test(value)) return true;
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return new Set(value).size >= 16;
}

/**
 * One name the child could see.
 *
 * Four fields, none of which can hold a value - see this file's header. `declared` is whether the
 * world's own document named it, which is the half the bundle already recorded; `credential` is the
 * classifier's opinion; `populated` is whether a non-empty value was present, which is the difference
 * between a declared name and a live secret.
 */
export interface EnvCrawlEntry {
  /** The variable's name. The only string that leaves this module. */
  readonly name: string;
  /** Whether the world's own environment document named it. */
  readonly declared: boolean;
  /** Whether the name or the value's shape says credential. Never the value. */
  readonly credential: boolean;
  /** Whether a non-empty value was present. Never the value. */
  readonly populated: boolean;
}

/**
 * The environment, as a reading.
 *
 * Every count is derived from `entries` rather than computed beside it, so a reader can check the
 * arithmetic and the two halves cannot disagree. `inheritedCredentials` is the field a criterion
 * refuses: the names that reached the application, were not chosen by the world, and look like
 * credentials.
 */
export interface EnvCrawl {
  /** How the environment was built: the operator's shell, or the document alone. */
  readonly mode: EnvMode;
  /** Every name the child could see, sorted, each with its three booleans. */
  readonly entries: readonly EnvCrawlEntry[];
  /** Names the world's document did not name, however they arrived. */
  readonly inherited: number;
  /** Names whose value was non-empty, which is the count a reader wants first. */
  readonly populated: number;
  /**
   * The credential-shaped names, as entries rather than as a count.
   *
   * Kept as entries so a reader sees *which* names the classifier matched and can disagree with it,
   * and so `populated` is answerable per name without a second count that could drift from this one.
   */
  readonly credentials: readonly EnvCrawlEntry[];
  /**
   * Credential-shaped names the world did not declare - **the finding**.
   *
   * A world that declares its environment can refuse this being non-empty, and that is the claim the
   * whole seam exists to make checkable: `env:inherited-credential 0` is what a properly declared
   * world reports, and it is a number a criterion can compare rather than a sentence somebody wrote.
   */
  readonly inheritedCredentials: readonly string[];
}

/** What the crawler needs to know that the map itself cannot say. */
export interface EnvCrawlOptions {
  /** The names the world's own document declared, so the marker's presence is not inferred. */
  readonly declared: readonly string[];
  readonly mode: EnvMode;
}

/**
 * Crawl one environment map.
 *
 * A pure function of the map and the declaration, which is what makes it testable without a process
 * and comparable across runs. The entries are sorted by name so two crawls of the same environment
 * serialise identically - a reading whose order depended on insertion would defeat the diff it exists
 * for, and `esi.ts` paid for that lesson on the export side.
 */
export function crawlEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  options: EnvCrawlOptions,
): EnvCrawl {
  const declaredNames = new Set(options.declared);
  const entries: EnvCrawlEntry[] = Object.keys(env)
    .sort()
    .map((name) => {
      const value = env[name] ?? "";
      return {
        name,
        declared: declaredNames.has(name),
        credential: CREDENTIAL_NAME.test(name) || looksLikeCredentialValue(value),
        populated: value !== "",
      };
    });

  const credentials = entries.filter((entry) => entry.credential);
  return {
    mode: options.mode,
    entries,
    inherited: entries.filter((entry) => !entry.declared).length,
    populated: entries.filter((entry) => entry.populated).length,
    credentials,
    inheritedCredentials: credentials
      .filter((entry) => !entry.declared)
      .map((entry) => entry.name),
  };
}

/**
 * Whether a value can be read as a crawl.
 *
 * Structural, in the shape `isProcessObservationData` uses: it answers "can this be read as an
 * environment reading", which is what decides between a validator judging a world and a validator
 * reporting that the world arrived unreadable. A reading that is present but not readable must not
 * pass for an environment that held nothing - that substitution is the reason the counts are checked
 * rather than just the arrays.
 */
export function isEnvCrawl(value: unknown): value is EnvCrawl {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!(ENV_MODES as readonly unknown[]).includes(record["mode"])) return false;
  if (typeof record["inherited"] !== "number") return false;
  if (typeof record["populated"] !== "number") return false;
  const entries = record["entries"];
  if (!Array.isArray(entries) || !entries.every(isEntry)) return false;
  const credentials = record["credentials"];
  if (!Array.isArray(credentials) || !credentials.every(isEntry)) return false;
  const inherited = record["inheritedCredentials"];
  return Array.isArray(inherited) && inherited.every((name) => typeof name === "string");
}

const isEntry = (value: unknown): value is EnvCrawlEntry => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["name"] === "string" &&
    typeof record["declared"] === "boolean" &&
    typeof record["credential"] === "boolean" &&
    typeof record["populated"] === "boolean"
  );
};

/**
 * The questions a criterion may ask of one crawl, as a closed set.
 *
 * Declared here rather than in the validator so the vocabulary has one home: the validator resolves a
 * target against this list, the failure report names the list when a target is not in it, and a test
 * can iterate it. A target grammar spread across two files is a list that agrees with itself until one
 * of them is edited - the defect this repository has recorded more times than any other.
 *
 * The four name-valued members are strings rather than a number on purpose: `contains` on a list of
 * names is how a criterion asks *is `OPENAI_API_KEY` reachable*, and answering that with a count would
 * make the question unaskable.
 */
export const ENV_READINGS = [
  "mode",
  "visible",
  "declared",
  "inherited",
  "populated",
  "credential",
  "credential-populated",
  "inherited-credential",
  "names",
  "credentials",
  "inherited-credentials",
] as const;
export type EnvReading = (typeof ENV_READINGS)[number];

/**
 * Answer one reading.
 *
 * Every member is total: the caller has already refused an unknown reading by name, so a branch here
 * cannot be reached with a value the list does not contain. The counts are rendered as decimal strings
 * because that is what the comparison machinery compares - the same choice `renderExit` makes for an
 * exit code, and for the same reason: a criterion compares text, and a number rendered two ways would
 * be two different readings of one fact.
 */
export function readEnvironmentCrawl(crawl: EnvCrawl, reading: EnvReading): string {
  const names = (entries: readonly EnvCrawlEntry[]): string => entries.map((entry) => entry.name).join(" ");
  switch (reading) {
    case "mode":
      return crawl.mode;
    case "visible":
      return String(crawl.entries.length);
    case "declared":
      return String(crawl.entries.length - crawl.inherited);
    case "inherited":
      return String(crawl.inherited);
    case "populated":
      return String(crawl.populated);
    case "credential":
      return String(crawl.credentials.length);
    case "credential-populated":
      return String(crawl.credentials.filter((entry) => entry.populated).length);
    case "inherited-credential":
      return String(crawl.inheritedCredentials.length);
    case "names":
      return names(crawl.entries);
    case "credentials":
      return names(crawl.credentials);
    case "inherited-credentials":
      return crawl.inheritedCredentials.join(" ");
  }
}

/**
 * The reading, as lines, in the shape the process family's other renderers use.
 *
 * Every line is `name value` so a criterion can compare a figure with a pattern rather than a sentence
 * with a substring. The credential names are printed one per line because they are the finding and a
 * reader chasing one needs to be able to read it - and printing a *name* is safe here for the reason
 * this whole module exists: the value is one field to the left of what is printed, and there is no
 * field to the left.
 */
export function renderEnvironmentCrawl(crawl: EnvCrawl): readonly string[] {
  const lines = [
    `env:mode ${crawl.mode}`,
    `env:visible ${String(crawl.entries.length)}`,
    `env:declared ${String(crawl.entries.length - crawl.inherited)}`,
    `env:inherited ${String(crawl.inherited)}`,
    `env:populated ${String(crawl.populated)}`,
    `env:credential-shaped ${String(crawl.credentials.length)}`,
    `env:credential-populated ${String(crawl.credentials.filter((entry) => entry.populated).length)}`,
    `env:inherited-credential ${String(crawl.inheritedCredentials.length)}`,
  ];
  for (const name of crawl.inheritedCredentials) lines.push(`env:credential ${name}`);
  return lines;
}
