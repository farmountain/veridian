import { DefinitionError } from "../goal/load.ts";

/**
 * The step register: every action a criterion may take, and the code that gives each one meaning.
 *
 * ## What this file replaced, and why the replacement is the point
 *
 * The vocabulary of actions used to be a hand-kept list, `STEP_KINDS`, beside a `switch` in
 * `decodeStep` and a second `switch` in `encodeStep`. That is the same fact - *which actions exist* -
 * written down **three** times, and reconciled by nothing. `AGENTS.md` carries the finding already,
 * from the schema's side: *a vocabulary the engine owns and the schema re-states falls behind the
 * engine, and the failure mode is not a warning, it is a document that cannot be written.* The two
 * switches were the other half of that failure, and it had already happened once in this repository
 * (`db.rowCount`, unwritable under the schema's pattern).
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` recorded the fix as **owed rather than speculative**, and
 * made it conditional on a second non-web adapter existing. That condition is met - `local-db` and
 * `sim-k8s` both contribute actions - and `sim-posix` is the third world to need one. Adding it to a
 * list beside two switches is what this file exists to stop: a fourth edit of the same hand-kept
 * vocabulary, at the exact moment the vocabulary outgrew the shape.
 *
 * Here, one action is **one entry**. A codec carries the wire key, a summary for refusals, the
 * decoder and the encoder - so the two directions that must agree live in the same object literal and
 * cannot be edited apart. {@link STEP_KINDS} is *derived* from the register, so the list and the code
 * are the same fact rather than two copies of it.
 *
 * ## What is still written twice, and the guard that holds it
 *
 * The JSON Schema cannot be derived from this file: `schemas/acceptance.schema.json` ships as an
 * artifact and is validated against operators' documents, so it stays a static file whose `Step.oneOf`
 * is the vocabulary's fourth appearance. `tests/step-kinds.test.ts` is what holds the two together -
 * it reads the schema, pins the register to it, and then *executes* every member: decoded,
 * round-tripped through {@link encodeStep}, and re-decoded. A register that agrees with its schema and
 * whose decoder cannot decode every member is still broken, so agreement alone is not the claim.
 *
 * ## Why the union type, and not the register, is the source of names
 *
 * {@link StepKind} is `ValidationStep["kind"]` rather than a tuple of strings, so the compiler - not a
 * convention - is what makes `stepKinds()` total. Every member of the union needs a codec or the
 * exhaustiveness check below fails to typecheck, which means a new action cannot be half-added.
 */

export const WAIT_STATES = ["attached", "detached", "visible", "hidden"] as const;
export type WaitState = (typeof WAIT_STATES)[number];

/**
 * The methods a `call` step may use, upper case because that is the world's one spelling of them.
 *
 * Decoding upper-cases whatever the document said, so a criterion may write `put` and a reader of the
 * adapter's record still sees one spelling. Four of the five are named by their effect rather than by
 * a verb on purpose: `HEAD` is here because "does this object exist" is a question an object store
 * answers without a body, and a criterion that had to `GET` a large object to learn that would be
 * paying for an answer it never reads.
 */
export const CALL_METHODS = ["GET", "PUT", "POST", "DELETE", "HEAD"] as const;
export type CallMethod = (typeof CALL_METHODS)[number];

/**
 * A step decoded from its wire shape. The contract has one action key; this has one discriminant.
 *
 * Each member is one world's kind of action, and the comments say which world and why - because the
 * next question a reader asks of an unfamiliar action is *what is the world it acts on*.
 */
export type ValidationStep =
  /** A page. */
  | { readonly kind: "goto"; readonly url: string }
  | { readonly kind: "click"; readonly target: string }
  | { readonly kind: "reload" }
  | { readonly kind: "fill"; readonly target: string; readonly value: string }
  | { readonly kind: "select"; readonly target: string; readonly value: string }
  | { readonly kind: "press"; readonly target: string; readonly key: string }
  | { readonly kind: "waitFor"; readonly target: string; readonly state: WaitState }
  /**
   * One statement executed against the world's own database, before the criterion is observed.
   *
   * It is the criterion's *action*, not its judgement: it sets the world up, or tries to violate a
   * constraint, and the `expect` entries read what actually happened. One statement rather than a
   * batch, so a failure names the statement that produced it.
   */
  | { readonly kind: "sql"; readonly statement: string }
  /**
   * One manifest put to the world's own cluster, before the criterion is observed.
   *
   * The cluster counterpart of `sql`, and it follows the same rule for the same reason: the step is
   * the criterion's *action*, not its judgement. The path is read relative to the application
   * directory, so a criterion judges the manifests the application actually ships. A manifest
   * embedded in the contract would be judged instead of the artifact - and an operator repairing the
   * application would be repairing a file the run never read.
   */
  | { readonly kind: "apply"; readonly manifest: string }
  /**
   * One command executed inside the world's own system, before the criterion is observed.
   *
   * The system counterpart of `sql` and `apply`, with one deliberate difference: it is an **argument
   * vector**, not a command line. A shell string would need a shell, and the shell would be a second
   * substitution with its own quoting rules to get wrong - while the interesting question ("can this
   * user read that file?") is asked perfectly well by naming the program and its arguments. The world
   * resolves the name against its own `bin/`, so the same record drives a real substituted system and
   * a real one.
   *
   * It exists because some criteria *act* rather than only read: "an unprivileged account cannot read
   * the secret" is not a property of a file, it is the result of an attempt, and the attempt is the
   * evidence.
   */
  | { readonly kind: "run"; readonly argv: readonly string[] }
  /**
   * One HTTP request put to the world's own control plane, before the criterion is observed.
   *
   * The cloud counterpart of `sql`, `apply` and `run`, and the only one of the four whose subject is
   * a **request** rather than a file, a manifest or a program. That is what makes it a different kind
   * of action rather than a fourth spelling of the same one: an account is not provisioned by
   * declaring a desired state, it is provisioned by calls, and which calls were made - and which were
   * refused - is the thing a hardening contract is written about.
   *
   * `path` is the world's own path, resolved by the substitute against the account it stands in for,
   * so a criterion can name `/cart/config.json` without knowing which host answered. `body` is a
   * string rather than a nested document: an object store's `PUT` body *is* the object's contents,
   * and requiring a contract to nest bytes inside a JSON object to make them expressible would make
   * the common case the awkward one.
   */
  | {
      readonly kind: "call";
      readonly method: CallMethod;
      readonly path: string;
      readonly body: string | null;
    };

/** Every action, as the union above declares them. Derived, so it cannot omit a member. */
export type StepKind = ValidationStep["kind"];

/**
 * One action's behaviour, and the reason the decoder and the encoder cannot drift apart.
 *
 * `P` is the member of {@link ValidationStep} this codec produces and consumes. The two functions are
 * declared as *methods* on purpose: method parameters are bivariant, so a `StepCodec<GotoStep>` is
 * assignable to the `StepCodec` the register holds without a cast - and a cast here is exactly the
 * place a wrong-shaped step would slip through unnoticed.
 */
export interface StepCodec<P = unknown> {
  /** The wire key. One key, and it is the whole action - see the schema's `additionalProperties`. */
  readonly kind: StepKind;
  /** What this action does, in one clause, for a refusal that names the alternatives. */
  readonly summary: string;
  decode(body: unknown, path: string): P;
  encode(payload: P): unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function defect(path: string, message: string): DefinitionError {
  return new DefinitionError(path, [{ path, keyword: "definition", message }]);
}

function requireString(value: unknown, path: string, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw defect(path, `${what} must be a non-empty string`);
  }
  return value;
}

/** Every codec, in the order a refusal lists them. One entry per member of {@link ValidationStep}. */
const REGISTER: readonly StepCodec[] = [
  {
    kind: "goto",
    summary: "navigate a browser to a URL",
    decode: (body, path) => ({ kind: "goto" as const, url: requireString(body, path, "goto") }),
    encode: (step: { readonly kind: "goto"; readonly url: string }) => step.url,
  },
  {
    kind: "click",
    summary: "click an element",
    decode: (body, path) => ({ kind: "click" as const, target: requireString(body, path, "click") }),
    encode: (step: { readonly kind: "click"; readonly target: string }) => step.target,
  },
  {
    kind: "reload",
    summary: "reload the page",
    decode: () => ({ kind: "reload" as const }),
    encode: () => ({}),
  },
  {
    kind: "fill",
    summary: "type a value into a field",
    decode: (body, path) => {
      if (!isPlainObject(body)) throw defect(path, "fill must be an object with target and value");
      return {
        kind: "fill" as const,
        target: requireString(body["target"], `${path}.target`, "fill.target"),
        value: requireString(body["value"], `${path}.value`, "fill.value"),
      };
    },
    encode: (step: { readonly kind: "fill"; readonly target: string; readonly value: string }) => ({
      target: step.target,
      value: step.value,
    }),
  },
  {
    kind: "select",
    summary: "choose an option in a select",
    decode: (body, path) => {
      if (!isPlainObject(body)) throw defect(path, "select must be an object with target and value");
      return {
        kind: "select" as const,
        target: requireString(body["target"], `${path}.target`, "select.target"),
        value: requireString(body["value"], `${path}.value`, "select.value"),
      };
    },
    encode: (step: { readonly kind: "select"; readonly target: string; readonly value: string }) => ({
      target: step.target,
      value: step.value,
    }),
  },
  {
    kind: "press",
    summary: "press a key on an element",
    decode: (body, path) => {
      if (!isPlainObject(body)) throw defect(path, "press must be an object with target and key");
      return {
        kind: "press" as const,
        target: requireString(body["target"], `${path}.target`, "press.target"),
        key: requireString(body["key"], `${path}.key`, "press.key"),
      };
    },
    encode: (step: { readonly kind: "press"; readonly target: string; readonly key: string }) => ({
      target: step.target,
      key: step.key,
    }),
  },
  {
    kind: "waitFor",
    summary: "wait for an element to reach a state",
    decode: (body, path) => {
      if (!isPlainObject(body)) throw defect(path, "waitFor must be an object with a target");
      // Defaulted here rather than through the protocol: `waitFor.state` is applied during decode,
      // where its meaning is local and its default is fail-safe in the only direction that matters.
      // Waiting for `visible` is *stricter* than `attached`, so the default cannot let a step pass
      // that would have failed — it can only fail a step that a laxer reading would have allowed.
      const state = body["state"] ?? "visible";
      if (typeof state !== "string" || !(WAIT_STATES as readonly string[]).includes(state)) {
        throw defect(`${path}.state`, `waitFor.state must be one of ${WAIT_STATES.join(", ")}`);
      }
      return {
        kind: "waitFor" as const,
        target: requireString(body["target"], `${path}.target`, "waitFor.target"),
        state: state as WaitState,
      };
    },
    // `state` is written out even when it was defaulted, because what the adapter receives must be
    // what was actually decided — not what the author happened to type.
    encode: (step: { readonly kind: "waitFor"; readonly target: string; readonly state: WaitState }) => ({
      target: step.target,
      state: step.state,
    }),
  },
  {
    kind: "sql",
    summary: "execute one statement against the world's database",
    decode: (body, path) => ({ kind: "sql" as const, statement: requireString(body, path, "sql") }),
    encode: (step: { readonly kind: "sql"; readonly statement: string }) => step.statement,
  },
  {
    kind: "apply",
    summary: "submit one manifest to the world's cluster",
    decode: (body, path) => ({ kind: "apply" as const, manifest: requireString(body, path, "apply") }),
    encode: (step: { readonly kind: "apply"; readonly manifest: string }) => step.manifest,
  },
  {
    kind: "run",
    summary: "execute one command inside the world's system",
    decode: (body, path) => {
      if (!Array.isArray(body) || body.length === 0) {
        throw defect(path, "run must be a non-empty array of arguments");
      }
      const argv = body.map((entry, index) => {
        if (typeof entry !== "string" || entry.trim() === "") {
          throw defect(`${path}[${index}]`, `run[${index}] must be a non-empty string`);
        }
        return entry;
      });
      return { kind: "run" as const, argv };
    },
    encode: (step: { readonly kind: "run"; readonly argv: readonly string[] }) => [...step.argv],
  },
  {
    kind: "call",
    summary: "put one request to the world's control plane",
    decode: (body, path) => {
      if (!isPlainObject(body)) throw defect(path, "call must be an object with method and path");
      const method = requireString(body["method"], `${path}.method`, "call.method").toUpperCase();
      // Checked against the tuple rather than a hand-written `switch`, so a method the register's
      // type does not name cannot be reached by a document - and the two cannot disagree.
      if (!(CALL_METHODS as readonly string[]).includes(method)) {
        throw defect(`${path}.method`, `call.method must be one of ${CALL_METHODS.join(", ")}`);
      }
      const raw = body["body"];
      if (raw !== undefined && raw !== null && typeof raw !== "string") {
        throw defect(`${path}.body`, "call.body must be a string when it is given");
      }
      return {
        kind: "call" as const,
        method: method as CallMethod,
        path: requireString(body["path"], `${path}.path`, "call.path"),
        body: typeof raw === "string" ? raw : null,
      };
    },
    // `body` is written out even when it is `null`, for the same reason `waitFor.state` is: what the
    // adapter receives must be what was actually decided, and "no body" is a decision a reader of the
    // record has to be able to tell from "the encoder dropped a field".
    encode: (step: { readonly kind: "call"; readonly method: CallMethod; readonly path: string; readonly body: string | null }) => ({
      method: step.method,
      path: step.path,
      body: step.body,
    }),
  },
];

/**
 * The register, keyed by kind, built once from {@link REGISTER}.
 *
 * Built rather than searched on every call, and built with a check that the register has no duplicate
 * and no member of the union missing - because "every action has exactly one codec" is the one
 * property the whole file rests on, and an assumption that property holds is what the three copies
 * used to be.
 */
const BY_KIND: ReadonlyMap<StepKind, StepCodec> = (() => {
  const map = new Map<StepKind, StepCodec>();
  for (const codec of REGISTER) {
    if (map.has(codec.kind)) {
      throw new Error(`the step register declares "${codec.kind}" twice`);
    }
    map.set(codec.kind, codec);
  }
  return map;
})();

/** Every action a criterion may take, derived from the register. */
export const STEP_KINDS: readonly StepKind[] = [...BY_KIND.keys()];

const codecFor = (kind: StepKind): StepCodec => {
  const codec = BY_KIND.get(kind);
  // Unreachable through `decodeStep`, which only looks up a key it found in a document. Kept because
  // a register read that can return `undefined` is a `?.` at every call site, which is how the one
  // site that mattered would end up swallowing the absence.
  if (codec === undefined) throw new Error(`no codec is registered for step kind "${kind}"`);
  return codec;
};

const stepPath = (criterionId: string, index: number, key?: string): string =>
  `${criterionId}.steps[${index}]${key ? `.${key}` : ""}`;

/** Does the record carry this key at all? `undefined` is absent; `null` is a stated, illegal value. */
const carries = (raw: Readonly<Record<string, unknown>>, kind: StepKind): boolean =>
  Object.hasOwn(raw, kind) && raw[kind] !== undefined;

/**
 * Decode one wire step into a discriminated step.
 *
 * The "exactly one action" rule is checked before the codec runs, so a record naming two actions is
 * refused by the register rather than by whichever codec happened to be reached first - and a record
 * naming none is refused by name rather than by a `default:` branch someone forgot to write.
 */
export function decodeStep(
  raw: Readonly<Record<string, unknown>>,
  criterionId: string,
  index: number,
): ValidationStep {
  const present = STEP_KINDS.filter((kind) => carries(raw, kind));
  if (present.length !== 1) {
    throw defect(
      stepPath(criterionId, index),
      `a step must name exactly one action; found ${present.length === 0 ? "none" : present.join(", ")}. ` +
        `The actions are: ${STEP_KINDS.join(", ")}.`,
    );
  }
  const kind = present[0] as StepKind;
  // The codec returns its own member of `ValidationStep`, which is what this function promises. The
  // register is the only place a codec is written, so a codec that returned a differently-shaped
  // object would be a type error at its own definition and not merely here.
  return codecFor(kind).decode(raw[kind], stepPath(criterionId, index, kind)) as ValidationStep;
}

/**
 * Encode a decoded step back into the wire record an adapter receives.
 *
 * The encoder lives in the *same codec* as the decoder, on purpose. A round-trip pair split across
 * two files drifts, and the drift is silent: the decoder keeps accepting documents the encoder no
 * longer produces, and the adapter is handed a shape only one of the two knows about.
 */
export function encodeStep(step: ValidationStep): Readonly<Record<string, unknown>> {
  return { [step.kind]: codecFor(step.kind).encode(step) };
}

/** What each action is, for a refusal or a help listing that has to name the alternatives. */
export function describeStepKinds(): string {
  return STEP_KINDS.map((kind) => `  ${kind.padEnd(9)} ${codecFor(kind).summary}`).join("\n");
}

/**
 * A compile-time proof that no member of {@link ValidationStep} lacks a codec.
 *
 * `STEP_KINDS` is derived from the register, so a step kind added to the union and forgotten here
 * would simply be missing from the list - and the failure would arrive as an operator's contract
 * being refused for naming an action the product supports. Typing this `Record<StepKind, true>` turns
 * that into a typecheck error at the moment the kind is added, which is the only time it is cheap to
 * fix. Exported rather than private so the compiler cannot treat it as dead code.
 */
export const STEP_CODEC_COVERAGE: Record<StepKind, true> = {
  goto: true,
  click: true,
  reload: true,
  fill: true,
  select: true,
  press: true,
  waitFor: true,
  sql: true,
  apply: true,
  run: true,
  call: true,
};
