import type { Ambiguity, DerivePort, DeriveResult } from "./types.ts";

/** Filesystem seam for derivation. Kept to two methods — derivation reads, never writes. */
export interface IoPort {
  readTextFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  readonly cwd: string;
}

export interface DeriveRule {
  readonly id: string;
  /** Cheap, synchronous test so the rule list behaves as a table. */
  matches(ambiguity: Ambiguity): boolean;
  derive(ambiguity: Ambiguity): DeriveResult | null | Promise<DeriveResult | null>;
}

/**
 * Derivation is the first rung because it is the only rung whose answer is *evidence* rather than
 * *judgement*. A derivation cites where it came from; the other rungs cite why they were chosen.
 */
export function createDeriver(rules: readonly DeriveRule[]): DerivePort {
  return {
    async derive(ambiguity) {
      for (const rule of rules) {
        if (!rule.matches(ambiguity)) continue;
        const result = await rule.derive(ambiguity);
        if (result !== null) return result;
      }
      return null;
    },
  };
}

/** Match a pointer against a suffix of pointer tokens, so `/criteria/3/mandatory` matches `/mandatory`. */
function pointerEndsWith(pointer: string, suffix: string): boolean {
  if (suffix === "") return true;
  return pointer === suffix || pointer.endsWith(suffix);
}

interface SchemaDefault {
  /**
   * The artifact the default belongs to.
   *
   * Suffix matching alone is not enough: `goal` and `acceptance` both have a `version`, most
   * artifacts have a `mandatory` or a `state`. Without an origin check a goal's default would be
   * cited as the authority for an acceptance field — a citation that looks checkable and is not,
   * which is worse than no citation at all.
   */
  readonly origin: Ambiguity["origin"];
  readonly suffix: string;
  readonly value: unknown;
  readonly cite: string;
}

/**
 * Values fixed by `schemas/`. These are derivations and not guesses: the artifact omitted a field
 * whose value the contract already determines. The citation is a real JSON-Schema pointer, so every
 * piece of evidence here can be checked against the file it names.
 *
 * Note that `/version` cites `const` rather than `default` for the acceptance contract. That is
 * deliberate: a `const` fixes the value just as tightly, and the citation points at the keyword that
 * actually does it rather than at a keyword that happens to be nearby.
 */
const SCHEMA_DEFAULTS: readonly SchemaDefault[] = [
  {
    origin: "goal",
    suffix: "/version",
    value: 1,
    cite: "schemas/goal.schema.json#/properties/version/default",
  },
  {
    origin: "goal",
    suffix: "/acceptance",
    value: "acceptance.yaml",
    cite: "schemas/goal.schema.json#/properties/acceptance/default",
  },
  {
    origin: "goal",
    suffix: "/environment",
    value: "environment.yaml",
    cite: "schemas/goal.schema.json#/properties/environment/default",
  },
  {
    origin: "goal",
    suffix: "/limits/maxIterations",
    value: 10,
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/maxIterations/default",
  },
  {
    origin: "goal",
    suffix: "/limits/maxRuntimeMs",
    value: 300_000,
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/maxRuntimeMs/default",
  },
  {
    origin: "goal",
    suffix: "/limits/maxCriterionMs",
    value: 30_000,
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/maxCriterionMs/default",
  },
  {
    origin: "goal",
    suffix: "/limits/networkPolicy",
    value: "deny",
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/networkPolicy/default",
  },
  {
    origin: "goal",
    suffix: "/limits/networkAllowList",
    value: [],
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/networkAllowList/default",
  },
  {
    origin: "goal",
    suffix: "/limits/filesystemWrite",
    value: "sandbox",
    cite: "schemas/goal.schema.json#/$defs/Limits/properties/filesystemWrite/default",
  },
  {
    origin: "acceptance",
    suffix: "/version",
    value: 1,
    cite: "schemas/acceptance.schema.json#/properties/version/const",
  },
  {
    origin: "acceptance",
    suffix: "/mandatory",
    value: true,
    cite: "schemas/acceptance.schema.json#/$defs/Criterion/properties/mandatory/default",
  },
  {
    origin: "environment",
    suffix: "/reset/strategy",
    value: "restart",
    cite: "schemas/environment.schema.json#/properties/reset/properties/strategy/default",
  },
  {
    // Reachable only for an HTTP world, and the coupling is the point.
    //
    // The gap this row closes is raised by exactly one detector site, and that site is guarded:
    // `detectEnvironmentAmbiguities` asks for `/browser/enabled` and `/health/expectStatus` only
    // when the document is *not* file-backed (`detect.ts`, both guards). For a world that names a
    // `databasePath` and no `url`, neither gap is ever raised, so neither row can fire - which is
    // correct and deliberate: deriving `expectStatus: 200` for a database invents a number nothing
    // will ever return, and the run would then wait out its whole health timeout for it.
    //
    // Recorded here rather than left implicit because a default row and the gap that reaches it are
    // one fact written in two files. The two halves are held by tests:
    // `tests/definition-resolution.test.ts` proves a *sparse web* document reaches this row through
    // the real ladder (it asserts `via: "derived"` and cites this schema), and
    // `tests/inventory-db-demo.test.ts` proves a file-backed one raises no such gap at all
    // (`questionsAsked === 0`, every document). A row whose gap became unreachable would leave a
    // derivation that can never be exercised, and this note is what makes that visible.
    origin: "environment",
    suffix: "/browser/enabled",
    value: true,
    cite: "schemas/environment.schema.json#/properties/browser/properties/enabled/default",
  },
  {
    // Same coupling as `/browser/enabled` above: raised only for a world with an address.
    origin: "environment",
    suffix: "/health/expectStatus",
    value: 200,
    cite: "schemas/environment.schema.json#/properties/health/properties/expectStatus/default",
  },
  {
    origin: "environment",
    suffix: "/health/timeoutMs",
    value: 20_000,
    cite: "schemas/environment.schema.json#/properties/health/properties/timeoutMs/default",
  },
  {
    origin: "environment",
    suffix: "/health/intervalMs",
    value: 100,
    cite: "schemas/environment.schema.json#/properties/health/properties/intervalMs/default",
  },
  {
    // The fourth dimension of the boundary, and the row whose absence made a schema default dead
    // data.
    //
    // `process.environment` decides what the application a process world starts may SEE. The schema
    // declares `"default": "inherit"` and `core/environment/load.ts` applies it, so the *value* was
    // never in question - but this table cited nothing for it, and a default declared in a schema and
    // consulted by no row here is exactly the shape this file's own header warns about: *a default row
    // and the gap that reaches it are one fact written in two files.*
    //
    // The asymmetry is what made it visible. The WRITE boundary's default - `/limits/filesystemWrite`
    // in the goal - has a row and is recorded as `derived` in every run. So do the read surface, the
    // reset strategy and the health fields. The environment was the one boundary whose default was
    // applied by a decoder and cited by nothing, so a bundle showed `mode: inherit` in the crawl -
    // what the mode *is* - and nowhere showed that the mode had been a choice, or what bound it.
    //
    // Coupled to `/process/environment` in `detect.ts`, which raises the gap only for a process world,
    // on the same reasoning as the two rows above: the field exists only under that block, so asking a
    // database world for it would invent a gap in a document that has no such field to leave out. The
    // two halves are held by `tests/env-reality-ladder.test.ts`; a row whose gap became unreachable
    // would leave a derivation that can never be exercised, which is why that file asserts both that
    // an omitted field reaches this citation AND that a stated one raises nothing.
    origin: "environment",
    suffix: "/process/environment",
    value: "inherit",
    cite: "schemas/environment.schema.json#/properties/process/properties/environment/default",
  },
];

/** Rung 1a: a field the schema has already fixed. */
export function schemaDefaultRule(): DeriveRule {
  return {
    id: "schema-default",
    matches: (ambiguity) => ambiguity.kind === "missing_value",
    derive: (ambiguity) => {
      const hit = SCHEMA_DEFAULTS.find(
        (entry) => entry.origin === ambiguity.origin && pointerEndsWith(ambiguity.path, entry.suffix),
      );
      if (!hit) return null;
      return { value: hit.value, evidence: `schema default - ${hit.cite}` };
    },
  };
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Rung 1b: the artifact's own filename. Used for a root-level `id`, which exists for traceability only.
 *
 * Scoped to the *root* pointer deliberately. Nested `/id` fields exist — an acceptance criterion has
 * one — and filling those from the filename would give every criterion the same identity, collapsing
 * a whole contract into one criterion and hiding every failure but the last.
 */
export function filenameRule(): DeriveRule {
  return {
    id: "filename",
    matches: (ambiguity) => ambiguity.kind === "missing_value" && ambiguity.path === "/id",
    derive: (ambiguity) => {
      const label = ambiguity.context?.["sourceLabel"];
      if (typeof label !== "string" || !label) return null;
      const base = label.split(/[\\/]/).at(-1) ?? label;
      const withoutExtension = base.replace(/\.[^.]+$/, "");
      const slug = slugify(withoutExtension);
      if (!slug) return null;
      return { value: slug, evidence: `derived from filename ${base}` };
    },
  };
}

interface PackageManifest {
  readonly scripts?: Record<string, string>;
}

const START_SCRIPT_PREFERENCE = ["start", "dev", "serve", "preview"] as const;

/**
 * Rung 1c: the application's own manifest.
 *
 * This is the one derivation that reads the repository rather than the contract, and it is
 * deliberately narrow: it only answers "how is this app normally started", and only when the
 * manifest gives exactly one preferred script. Anything less clear-cut returns `null` so the
 * ladder continues rather than the engine inventing a command.
 */
export function manifestStartRule(io: IoPort): DeriveRule {
  return {
    id: "manifest-start",
    matches: (ambiguity) =>
      ambiguity.kind === "missing_value" && pointerEndsWith(ambiguity.path, "/start"),
    derive: async (ambiguity) => {
      const appDir = ambiguity.context?.["appDir"];
      if (typeof appDir !== "string" || !appDir) return null;

      const manifestPath = `${appDir.replace(/[\\/]+$/, "")}/package.json`;
      const raw = await io.readTextFile(manifestPath);
      if (raw === null) return null;

      let manifest: PackageManifest;
      try {
        manifest = JSON.parse(raw) as PackageManifest;
      } catch {
        return null;
      }
      const scripts = manifest.scripts ?? {};
      const script = START_SCRIPT_PREFERENCE.find((name) => name in scripts);
      if (!script) return null;

      return {
        value: { command: "npm", args: ["run", script] },
        evidence: `${manifestPath}#scripts.${script}`,
      };
    },
  };
}

/** The rule set used when no stronger evidence is available. */
export function defaultDeriveRules(io: IoPort): readonly DeriveRule[] {
  return [schemaDefaultRule(), filenameRule(), manifestStartRule(io)];
}
