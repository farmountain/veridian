#!/usr/bin/env node
/**
 * The build step, and the only thing in this application that produces an image.
 *
 * A real build pushes a tagged image to a registry and a manifest names the tag. This build writes one
 * JSON record per image into the directory the world named in `VERIDIAN_CLUSTER_IMAGES`, and the
 * substitute registry reads that directory back. That is the whole of the substitution, and it is
 * deliberate that the world's answer depends on an artifact the application's own code produced: it is
 * what makes the interesting failure a disagreement between two real artifacts (the tag the build
 * made and the tag a manifest pins) rather than a flag somebody set.
 *
 * ## What is real here and what is not
 *
 * Real: this file runs as a child of the application's own deploy program; the directory it writes is
 * a directory on this filesystem; the registry the control plane consults is that same directory, read
 * fresh on every reconcile.
 *
 * Substituted: nobody builds a container, nobody pushes anything, and no registry answers a pull. The
 * world declares that in every reading (`simulated: [..., "cri", ...]`), because a claim of "the image
 * is available" would otherwise be indistinguishable from a claim that a registry served it.
 *
 * ## Runnable two ways, on purpose
 *
 * `node build.mjs` builds and prints, and importing this module from `deploy.mjs` does the same thing
 * without a second process. A build step that could only be reached through the deploy program would
 * be untestable on its own, and one that could only be run by hand would make the deploy program a
 * wrapper rather than a program.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

/**
 * The tag this application builds.
 *
 * This literal appears in exactly two artifacts on purpose: here, and in
 * `manifests/deployment.yaml`. A manifest pins a tag and a build produces it, which is the ordinary
 * shape of a Kubernetes deployment - and the failure that matters is precisely the two disagreeing, so
 * giving them one shared source of truth would delete the defect class this example exists to show. It
 * is the same reason `examples/shopping-cart` keeps its price in the page rather than in the contract.
 */
export const IMAGE = "registry.local/cart-web:1.4.0";

/** Where the build writes. Matches `cluster.images` in `environment.yaml`, relative to the app. */
export const IMAGES_DIR = join(repo, "build", "images");

/**
 * Build one image record into `target`.
 *
 * The directory is emptied first rather than merged, because a build that left a previous tag behind
 * would make the registry hold an image this run never produced - and then a manifest naming the old
 * tag would pull successfully, for a reason no reader could see in the manifest.
 *
 * The record's shape is the one the substitute registry reads: an object with a non-empty string
 * `image`. Nothing else is written, because a field nothing reads is a claim rather than a record.
 */
export function build(target = IMAGES_DIR) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "cart-web.json"), `${JSON.stringify({ image: IMAGE }, null, 2)}\n`, "utf8");
  return { directory: target, image: IMAGE };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const result = build();
  process.stdout.write(`cart-web build: ${result.image} -> ${result.directory}\n`);
}
