/**
 * Which world a run measured, derived from the plan that declared it.
 *
 * The plan is the adapter's whole world, and it carries that world's identity in twelve slots: two
 * flat fields (`url`, `databasePath`) and ten per-world blocks. Until this file existed, none of
 * them reached the bundle - `environmentRecord()` copied fifteen fields with no block among them, so
 * a `sim-cloud` bundle could name its adapter and could not name its account. A reader opening
 * `environment.json` a week later could learn that a verdict came from a substitute provider, and
 * not which account, region or principal it was reached against.
 *
 * The derivation lives here, over the plan, rather than in each adapter reporting its own identity:
 * *the plan is the only thing every world has in common.* An adapter that reported its own identity
 * would be reporting it a second time, in a second shape, and the two would disagree the first time
 * a world arrived that only one of them was written for.
 *
 * `kind` is the **shape of world** the plan declares - which block it filled in - and deliberately
 * not a restatement of `adapter`. Those are two different questions and a bundle has to answer both:
 * two adapters can share a kind (a real cluster and a substituted one both declare `cluster`, which
 * is exactly the pair this tree would build next), and a reader asking "what kind of world was this"
 * is not asking "which class constructed it". The adapter is recorded beside this, under its own
 * name, in the same file.
 *
 * `detail` carries the rest of what the block declared, flattened to strings, because a reader
 * auditing a `sim-cloud` verdict wants `principal` and `region` and not only `account`. A field the
 * plan left `null` is **omitted** rather than written as a `null`: a `Record<string, string>` has one
 * value type, and inventing a rendering for "not declared" would be the parallel vocabulary this
 * tree refuses. So the presence of a key means the plan declared a value for it.
 */

import type { EnvironmentPlan } from "../environment/types.ts";

export interface WorldIdentity {
  readonly kind: string;
  readonly name: string;
  /**
   * The block's other declared fields, flattened to strings, or `null` when it declared only a name.
   *
   * Nullable rather than always-present because `{}` would be a claim that the block declared
   * nothing else, which is a different fact from a block that has nothing else to declare.
   */
  readonly detail: Readonly<Record<string, string>> | null;
}

/**
 * The world's name in one string - `cloud:acct-cart`, `cluster:cart-dev`.
 *
 * One definition, read by the metric that has to say which run could not name its world: a second
 * spelling of this format would be a second answer to "which world is this".
 */
export function worldLabel(world: Pick<WorldIdentity, "kind" | "name">): string {
  return `${world.kind}:${world.name}`;
}

/** The declared facts, with every `null` omitted. See the note on `detail` above. */
function facts(entries: readonly (readonly [string, string | number | null])[]): Readonly<Record<string, string>> {
  const detail: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value !== null) detail[key] = String(value);
  }
  return detail;
}

/**
 * The identity a plan declares for its world, or `null` when it declares none.
 *
 * The blocks are consulted in the order the plan declares them, and the first one that is present
 * wins. A plan that filled in two blocks would be a plan this loader already refuses, so the order
 * is not a precedence rule so much as a stable reading - but it is written down because a reader
 * comparing two bundles has to be able to reproduce it.
 *
 * The two flat fields are read last, after all ten blocks: a world that declares both a block and an
 * address is identified by its block, because `api`'s own doc says why the two are not folded -
 * "`url` is an address and this is an identity, and they answer different questions".
 */
export function worldIdentity(plan: EnvironmentPlan): WorldIdentity | null {
  const { api, cluster, posix, os, cloud, container, vscode, process: child, data, mobile } = plan;

  if (api !== null) {
    return { kind: "api", name: api.service, detail: facts([["service", api.service], ["url", plan.url]]) };
  }
  if (cluster !== null) {
    return {
      kind: "cluster",
      name: cluster.name,
      detail: facts([["namespace", cluster.namespace], ["images", cluster.imagesPath]]),
    };
  }
  if (posix !== null) {
    return {
      kind: "posix",
      name: posix.distribution,
      detail: facts([["user", posix.user], ["root", posix.root]]),
    };
  }
  if (os !== null) {
    return {
      kind: "os",
      name: os.system,
      detail: facts([["family", os.family], ["user", os.user], ["root", os.root]]),
    };
  }
  if (cloud !== null) {
    return {
      kind: "cloud",
      name: cloud.account,
      detail: facts([
        ["provider", cloud.provider],
        ["region", cloud.region],
        ["account", cloud.account],
        ["principal", cloud.principal],
      ]),
    };
  }
  if (container !== null) {
    return {
      kind: "container",
      name: container.runtime,
      detail: facts([["platform", container.platform], ["root", container.root]]),
    };
  }
  if (vscode !== null) {
    return {
      kind: "vscode",
      name: vscode.host,
      detail: facts([
        ["api_version", vscode.apiVersion],
        ["activation_event", vscode.activationEvent],
        ["root", vscode.root],
      ]),
    };
  }
  if (child !== null) {
    return {
      kind: "process",
      name: child.host,
      detail: facts([
        ["command", child.application?.command ?? null],
        ["args", child.application === null ? null : child.application.args.join(" ")],
        ["root", child.root],
        // The observation surface reaches the bundle, and that is the point of putting it here rather
        // than leaving it in the plan. A reader auditing a verdict has to be able to answer "what was
        // this run allowed to see" - and a world that read the operator's own tree is the one case
        // where the answer is not "only its own sandbox". Absent when the list is empty, on this
        // file's own rule: a key means the plan declared a value for it.
        ["observe", child.observe.length === 0 ? null : child.observe.join(" ")],
      ]),
    };
  }
  if (data !== null) {
    return {
      kind: "data",
      name: data.cluster,
      detail: facts([["node_id", data.nodeId], ["host", data.host], ["port", data.port]]),
    };
  }
  if (mobile !== null) {
    return {
      kind: "mobile",
      name: mobile.device,
      detail: facts([["platform", mobile.platform], ["root", mobile.root]]),
    };
  }
  if (plan.url !== null) {
    return { kind: "web", name: plan.url, detail: facts([["address", plan.url]]) };
  }
  if (plan.databasePath !== null) {
    return { kind: "database", name: plan.databasePath, detail: facts([["path", plan.databasePath]]) };
  }
  return null;
}
