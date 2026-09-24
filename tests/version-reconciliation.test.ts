import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nodeIo } from "../core/io.ts";
import { MCP_SERVER_VERSION } from "../mcp/protocol.ts";

/**
 * One version, six places that state it, and - until this file existed - nothing that compared them.
 *
 * `docs/DISTRIBUTION-AND-ENVIRONMENTS.md` records the gap in its own words: *"A version is written in
 * four files and reconciled by nothing. The extension's `package.json`, this repository's root
 * `package.json`, and each of their `package-lock.json` root entries carry the same figure by
 * convention and no mechanism, so the marketplace's version and the CLI's reported `veridianVersion`
 * can drift apart silently."* That paragraph then records the time it already happened: the
 * extension's two `package-lock.json` entries were left at `0.2.1` after the manifest moved to
 * `0.2.2`. So this is not a hypothetical - the drift has been paid for once, in a file whose whole
 * subject is that the same figure in several places needs a mechanism rather than a convention.
 *
 * **Two of the six were not in that paragraph's count, and both were found by looking rather than by
 * reading it.** The MCP surface carries its own implementation version
 * (`MCP_SERVER_VERSION` in `mcp/protocol.ts`), and the Cockpit demo's contract pins the extension's
 * name and version in `examples/vscode-cockpit/acceptance.yaml`. The first is the sharper defect: it
 * read `"unreleased"` for a full release after the surface shipped, because `mcp/server.test.ts`
 * asserted only `typeof serverInfo["version"] === "string"` - a check the word `"unreleased"`
 * satisfies, and which is therefore a check that cannot fail for the defect it sits beside. The
 * second is one this repository documents but nothing enforced: `README.md` states *"Its expectations
 * move with the version, so a version bump moves them"* and names the test that catches it, and that
 * test only runs the demo - it does not read the contract against the manifest, so a bump that
 * half-moved would have to fail at demo-run time to be noticed at all.
 *
 * **What this asks is agreement, not correctness.** Nothing here can know that `0.6.0` is the right
 * release; it asserts that the six sites state the *same* figure, which is the failure that actually
 * happened and the one a bump introduces. A version is the clearest case in this tree of a figure
 * that cannot be pinned by the test that changes it - so the same note `tests/docs-roster.test.ts`
 * carries applies: when the bump moves every site together and none is re-measured, this file stays
 * green, and the remedy is to re-take the measurement rather than to loosen the assertion.
 *
 * **The ninth check is the one this file would otherwise be missing.** A pattern that stops matching
 * yields `null` from every site, and six `null`s agree with each other perfectly - the vacuous pass
 * that `tests/docs-roster.test.ts` and `tests/phases-roster.test.ts` both open with a control
 * against. So every site must yield a version *string* before the comparison is allowed to mean
 * anything.
 */
const repo = nodeIo();

/** A `"version"` field read out of a JSON document, or `null` if the document or the field is absent. */
function versionIn(text: string | null): string | null {
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = (parsed as { version?: unknown }).version;
  return typeof value === "string" ? value : null;
}

describe("the release version, everywhere it is stated", () => {
  it("states one figure across both manifests, both lockfiles, the MCP surface and the demo contract", async () => {
    const rootManifest = versionIn(await repo.readTextFile("package.json"));
    const rootLock = versionIn(await repo.readTextFile("package-lock.json"));
    const extManifest = versionIn(await repo.readTextFile("extension/vscode/package.json"));
    const extLock = versionIn(await repo.readTextFile("extension/vscode/package-lock.json"));

    // The contract is not JSON, so its figure is read by pattern. `contains: veridian-cockpit X.Y.Z`
    // is matched on the whole `contains:` line rather than on the digits, because a bare number in a
    // YAML file could belong to any of the criteria above it - and this criterion's *subject* is the
    // name and version pair, which is what makes the two worth reading together.
    const contract = await repo.readTextFile("examples/vscode-cockpit/acceptance.yaml");
    const pinned = contract === null ? null : /contains:\s*veridian-cockpit\s+(\d+\.\d+\.\d+)/u.exec(contract);
    const contractVersion = pinned?.[1] ?? null;

    const sites: readonly (readonly [string, string | null])[] = [
      ["package.json", rootManifest],
      ["package-lock.json", rootLock],
      ["extension/vscode/package.json", extManifest],
      ["extension/vscode/package-lock.json", extLock],
      ["mcp/protocol.ts MCP_SERVER_VERSION", MCP_SERVER_VERSION],
      ["examples/vscode-cockpit/acceptance.yaml", contractVersion],
    ];

    // The control, and it comes first on purpose: six `null`s agree with each other, so without this
    // the assertion below passes for a tree where every pattern has stopped matching.
    const silent = sites.filter(([, value]) => value === null).map(([name]) => name);
    assert.deepEqual(
      silent,
      [],
      `no version figure could be read from ${silent.join(", ")}. Either the field was removed - in ` +
        `which case remove that site from this file too - or the pattern stopped matching the ` +
        `spelling it now uses. The comparison below is over the remaining sites and means nothing ` +
        `until this is empty.`,
    );

    const distinct = [...new Set(sites.map(([, value]) => value))].sort();
    assert.equal(
      distinct.length,
      1,
      `the version is stated as ${String(distinct.length)} different figures: ${distinct.join(" | ")}. ` +
        `The sites are ${sites.map(([name, value]) => `${name}=${String(value)}`).join(", ")}. This ` +
        `repository has already paid for this once, when the extension's lockfile entries were left ` +
        `at 0.2.1 after the manifest moved to 0.2.2, and a half-moved bump is the defect this ` +
        `assertion exists for - move every site rather than choosing between them.`,
    );
  });

  it("does not leave the MCP surface reporting itself unreleased", () => {
    // The specific word, pinned rather than described, because it is what shipped: the constant read
    // `"unreleased"` for a full release after `v0.5.0` announced the surface in its own notes. The
    // assertion above would have caught it too - but only once, and only as "a different figure",
    // where this names the defect a reader can act on. A value that resolves differently from the
    // source tree and from `dist/` cannot be used here (see the constant's own comment), so the
    // protection is this assertion rather than a resolution at run time.
    assert.notEqual(
      MCP_SERVER_VERSION,
      "unreleased",
      "the MCP surface reports its implementation version as `unreleased`, but it has shipped - " +
        "v0.5.0's release notes announce it. The word is true of a state the tree is no longer in.",
    );
    assert.match(
      MCP_SERVER_VERSION,
      /^\d+\.\d+\.\d+$/u,
      `MCP_SERVER_VERSION is ${JSON.stringify(MCP_SERVER_VERSION)}, which is not a released version. ` +
        `A caller reading serverInfo cannot tell a build of this surface from a placeholder.`,
    );
  });
});
