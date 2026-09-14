#!/usr/bin/env node
/**
 * The deploy program: the application's own client for the cluster it was handed.
 *
 * This is `start.command` in `environment.yaml`, so it is the program the world runs to bring the
 * application up - and it is a real program talking to a real socket, which is the first of the three
 * obligations a simulated world has to meet.
 *
 * ## What it does, in order
 *
 * 1. Reads the cluster address, namespace and image-registry directory out of its environment. All
 *    three are required and it refuses to run without them: a deploy program that guessed an address
 *    would be deploying into a world nobody described, and the guess would be invisible in the run.
 * 2. Builds the image (see `build.mjs`) into the registry directory the world named, so the world's
 *    answer about image availability depends on an artifact this application really produced.
 * 3. Submits each manifest in `MANIFESTS` to the API server over HTTP, routing by `kind` the way a
 *    client does, and prints the API server's own answer for each one.
 *
 * ## Why a refusal is reported and not thrown
 *
 * The real Kubernetes objects are its own routes, status codes and `Status` bodies, so a refusal here
 * is a *reading*: the cluster did not take the object. Exiting non-zero on one would be worse than
 * useless, because the adapter classifies a non-zero exit from `start.command` as the world failing to
 * start - so `k8s.applied` would never run, and "the Service was refused" would be reported as
 * "nothing could be observed" instead of as the deployment defect it is. This program's contract is to
 * submit and report; whether the cluster ends up holding the objects is what the acceptance criteria
 * decide.
 *
 * ## The one dependency
 *
 * It parses manifests with the same YAML library the engine uses, rather than with a hand-rolled
 * reader. A second parser would be a second answer to "what does this manifest say", and the file the
 * criteria submit through `apply` would then be read by two implementations that can disagree.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import { build } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** The names the adapter sets. Deliberately `VERIDIAN_CLUSTER_*` and not `KUBERNETES_*`. */
export const CLUSTER_ENV = {
  api: "VERIDIAN_CLUSTER_API",
  namespace: "VERIDIAN_CLUSTER_NAMESPACE",
  images: "VERIDIAN_CLUSTER_IMAGES",
};

/**
 * The manifests this deploy program ships, in submission order.
 *
 * The Deployment first, because the Service selects the pods the Deployment creates and a reader of
 * the run's transcript should see the two in that order. Both are named rather than globbed: a
 * directory listing would make the deployed set depend on whatever a repair dropped in the directory,
 * which is not a fact the application's code should be reporting.
 */
export const MANIFESTS = ["manifests/deployment.yaml", "manifests/service.yaml"];

/**
 * The route for one kind, the way a client's own route table answers it.
 *
 * `null` rather than a guess for an unserved kind: a deploy program that posted an unknown object to
 * a plausible-looking path would be inventing an interface, and the API server's `404` would then be
 * read as a cluster problem rather than as this program's.
 */
export function routeFor(kind, namespace) {
  if (kind === "Deployment") return `/apis/apps/v1/namespaces/${namespace}/deployments`;
  if (kind === "Service") return `/api/v1/namespaces/${namespace}/services`;
  return null;
}

/**
 * Submit one manifest. Returns the API server's own answer rather than this program's opinion of it.
 *
 * The response body is always read, even when the status is a success, because a client that discards
 * a body is blind by its own hand: the API server puts the reason for a refusal in `Status.message`,
 * and a program that reported only `422` would send its reader hunting a cause it was already told.
 */
export async function apply(manifest, api, namespace) {
  const route = routeFor(manifest.kind, namespace);
  if (route === null) {
    return { status: 0, reason: "ClientError", message: `no route for kind ${JSON.stringify(manifest.kind)}` };
  }
  const response = await fetch(`${api}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manifest),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const accepted = response.status >= 200 && response.status < 300;
  return {
    status: response.status,
    reason: accepted ? "" : typeof body?.reason === "string" ? body.reason : "Unknown",
    message: accepted ? "" : typeof body?.message === "string" ? body.message : text.slice(0, 300),
  };
}

async function main() {
  const api = process.env[CLUSTER_ENV.api] ?? "";
  const namespace = process.env[CLUSTER_ENV.namespace] ?? "";
  const images = process.env[CLUSTER_ENV.images] ?? "";

  if (api === "" || namespace === "" || images === "") {
    process.stderr.write(
      `cart-web deploy: this program needs ${CLUSTER_ENV.api}, ${CLUSTER_ENV.namespace} and ` +
        `${CLUSTER_ENV.images}, and the environment provided ` +
        `${JSON.stringify({ api, namespace, images })}\n`,
    );
    return 2;
  }

  const built = build(images);
  process.stdout.write(`cart-web build: ${built.image} -> ${built.directory}\n`);

  let applied = 0;
  for (const file of MANIFESTS) {
    const manifest = parseYaml(readFileSync(join(here, file), "utf8"));
    const answer = await apply(manifest, api, namespace);
    const accepted = answer.status >= 200 && answer.status < 300;
    if (accepted) applied += 1;
    process.stdout.write(
      accepted
        ? `cart-web deploy: ${file} -> ${answer.status} accepted\n`
        : `cart-web deploy: ${file} -> ${answer.status} ${answer.reason}: ${answer.message}\n`,
    );
  }

  // The line `start.readyPattern` waits for. It names the namespace it was given, so it is evidence
  // that this program read the world's own description rather than its own defaults.
  process.stdout.write(`cart-web deployed: ${applied} objects applied to ${namespace}\n`);
  return 0;
}

process.exitCode = await main();
