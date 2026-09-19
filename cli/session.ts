/**
 * What a run needs before it can be defined: the ports, the registry and the clarifier.
 *
 * This module exists because there are now **two** consumers of the same composition. `cli/veridian.ts`
 * is a bin whose bottom line runs `main()`, so nothing can import it to reuse a decision it makes; and
 * an MCP server is a second front door onto the identical lifecycle. Writing the wiring twice would be
 * the defect this repository has recorded most often - *two implementations of one rule disagree the
 * first time a world arrives that only one of them was written for* - and it would disagree silently,
 * because the second copy would work for every demo file it was written against.
 *
 * So the composition lives here, once, and both consumers call it. What stayed behind in
 * `cli/veridian.ts` is everything that needs a *terminal*: printing, formatting and the exit code.
 * A session is a value; printing is a caller's business.
 *
 * `SessionOptions` is deliberately narrower than `CliArguments`. A caller that is not the command line
 * has no `--force` and no `--defects`, and requiring fields nobody reads would make every future
 * consumer build a command line it does not have. The command line maps itself onto this shape in one
 * place, `sessionOptions`, so a fourth option is a compile error rather than a field nobody set.
 */

import {
  ClarificationEngine,
  NullSelfPromptPort,
  createDeriver,
  defaultDeriveRules,
} from "../core/clarification/index.ts";
import type { Logger, UserPromptPort } from "../core/clarification/index.ts";
import { assetsRoot } from "../core/assets.ts";
import { detectorContextFor, resolveDefinition } from "../core/definition.ts";
import type { DefinitionOutcome } from "../core/definition.ts";
import { nodeIo } from "../core/io.ts";
import type { IoPort } from "../core/io.ts";
import { HttpMemory, MemoryInferrer, NullMemory } from "../core/memory/index.ts";
import type { MemoryPort } from "../core/memory/index.ts";
import { loadSchemaSet } from "../core/schema/index.ts";
import type { SchemaSet } from "../core/schema/registry.ts";
import { ValidatorRegistry } from "../core/validation/index.ts";

import { DEFAULT_MEMORY_URL } from "./arguments.ts";
import type { CliArguments } from "./arguments.ts";
import { createCliPromptPort, createSelfPromptPort, systemClock } from "./support.ts";
import { allValidators } from "./validators.ts";
import { adapterDescriptors, registeredAdapters } from "./worlds.ts";

/** The actor name the substrate records writes under. */
export const MEMORY_ACTOR = "Veridian";

export interface Session {
  readonly io: IoPort;
  readonly schemas: SchemaSet;
  readonly registry: ValidatorRegistry;
  readonly clarifier: ClarificationEngine;
  /** The same port the clarification ladder and the manual repair gate both ask through. */
  readonly user: UserPromptPort;
  /** How much material rung 4 can read, or the fact that the rung is unplugged. */
  readonly selfPromptLabel: string;
  readonly memory: MemoryPort;
  readonly memoryLabel: string;
}

/**
 * The three run-time choices a session depends on.
 *
 * `CliArguments` does satisfy this structurally - which is why the command line does not hand itself
 * over. A call site that passed a whole `CliArguments` would keep compiling after a fourth option was
 * added here, and the session would be configured by a field nobody set. See `sessionOptions` below.
 */
export interface SessionOptions {
  readonly memoryUrl: string | null;
  readonly noMemory: boolean;
  readonly noSelfPrompt: boolean;
}

export async function openSession(options: SessionOptions, logger: Logger): Promise<Session> {
  const io = nodeIo();

  // Two ports on purpose, because there are two roots and only one of them is the operator's.
  // `io` resolves the operator's files (`--goal my-app/goal.yaml`) against the working directory,
  // which is what those paths mean. The schemas are not the operator's files: they shipped inside
  // the package, so they are resolved against the module that ships them. Reading them through `io`
  // worked only while the CLI was run from the repository root; installed, it asked the caller's
  // directory for Veridian's own schema and reported it missing. See `core/assets.ts`.
  const schemas = await loadSchemaSet(nodeIo({ root: assetsRoot() }));
  const registry = new ValidatorRegistry(allValidators());

  // One prompt port for the whole process. Two ports would be two answers to "is a human watching",
  // and the one that agreed with the other would be the one nobody checked.
  const user = createCliPromptPort();

  // The material the run reads to answer its own gaps: the names it is already holding because it
  // registered them. Deliberately not "everything on disk" - a self-prompt may corroborate a
  // candidate the contract already offered, and a wider reading would be the run inventing one.
  //
  // `--no-self-prompt` replaces the port rather than narrowing the material, because a port holding
  // no names would report `available: false` for a reason the operator did not choose. The null port
  // is the ladder's own word for "there is no self to prompt", so the rung is *skipped* rather than
  // declined, and the two are different: a declined round is work the run did and reported, a skipped
  // rung is work it never attempted. The label is a fact about which of those happened, reported
  // beside the memory and prompt facts for the same reason they are - an operator reading a
  // transcript in which rung 4 never fired cannot otherwise tell it was unplugged.
  const material = [...registry.names(), ...registeredAdapters()];
  const selfPrompt = options.noSelfPrompt
    ? { port: NullSelfPromptPort, label: "disabled (--no-self-prompt)" }
    : {
        port: createSelfPromptPort({ material, logger }),
        label: `from ${String(material.length)} registered names`,
      };

  const memory = selectMemory(options, logger);

  const clarifier = new ClarificationEngine({
    derive: createDeriver(defaultDeriveRules(io)),
    infer: new MemoryInferrer(memory.port),
    selfPrompt: selfPrompt.port,
    user,
    clock: systemClock,
    logger,
  });

  return {
    io,
    schemas,
    registry,
    clarifier,
    user,
    selfPromptLabel: selfPrompt.label,
    memory: memory.port,
    memoryLabel: memory.label,
  };
}

/**
 * Memory is enabled by default and degrades loudly.
 *
 * `HttpMemory` never throws and never blocks a run - it flips its own `available` flag and logs once
 * - so the honest default is to *use* memory and let an absent server be a warning rather than a
 * prerequisite. Requiring a server would make an offline run impossible; silently skipping the write
 * would make the record a lie. `--no-memory` is for the third case, where an operator wants a run
 * that provably consulted nothing.
 */
export function selectMemory(
  options: SessionOptions,
  logger: Logger,
): { port: MemoryPort; label: string } {
  if (options.noMemory) {
    return { port: new NullMemory(), label: "disabled (--no-memory)" };
  }
  const url = options.memoryUrl ?? process.env["HIPCORTEX_URL"] ?? DEFAULT_MEMORY_URL;
  return {
    port: new HttpMemory({ baseUrl: url, actor: MEMORY_ACTOR, logger }),
    label: url,
  };
}

/**
 * Read the goal, close every gap the protocol can close, and report what it could not.
 *
 * Exported because a caller that holds a session should not have to rebuild the detector context to
 * ask the same question - `resolveDefinition`'s two contexts are constructed in one place for exactly
 * this reason, and a second constructor here would be a second chance for `appDir` to be wrong.
 */
export async function define(session: Session, goalPath: string): Promise<DefinitionOutcome> {
  return resolveDefinition(
    session.io,
    session.schemas,
    {
      goalPath,
      registry: session.registry,
      registeredAdapters: registeredAdapters(),
      adapterDescriptors: adapterDescriptors(),
    },
    session.clarifier,
  );
}

/**
 * The detector context for a *runtime* question, built from a session.
 *
 * The runtime detectors ask the same questions the definition detectors asked, against the same
 * registry, and they are raised from a different layer. Rather than have each consumer rebuild the
 * request, the session answers it - so the two contexts cannot disagree about which worlds and
 * validators this build holds.
 */
export function runtimeDetectorContext(
  session: Session,
  sourceLabel: string,
  appDir?: string,
): ReturnType<typeof detectorContextFor> {
  return detectorContextFor(
    {
      registry: session.registry,
      registeredAdapters: registeredAdapters(),
      adapterDescriptors: adapterDescriptors(),
    },
    sourceLabel,
    appDir,
  );
}

/**
 * The session's three run-time choices, read off a parsed command line.
 *
 * The mapping is written once, here, rather than leaning on `CliArguments` satisfying `SessionOptions`
 * structurally. It does satisfy it today - and that is the problem rather than the convenience: a
 * fourth option added to `SessionOptions` would keep compiling at every call site that handed over a
 * whole `CliArguments`, and the CLI would pass a session configured by a field it never set. Spelling
 * the three out makes the compiler ask for the fourth.
 */
export function sessionOptions(parsed: CliArguments): SessionOptions {
  return {
    memoryUrl: parsed.memoryUrl,
    noMemory: parsed.noMemory,
    noSelfPrompt: parsed.noSelfPrompt,
  };
}
