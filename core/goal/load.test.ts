import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dirOf, resolveSibling } from "./load.ts";
import type { SourceRef } from "./types.ts";

/** A goal document's source. `resolveSibling` reads only `dir`. */
const goalAt = (dir: string): SourceRef => ({ path: `${dir}/goal.yaml`, dir, text: "" });

/**
 * The absolute-path cases are the ones that matter, and they run on every platform.
 *
 * `resolveSibling` is pure string manipulation, so a POSIX path exercises the POSIX branch wherever
 * the suite is run. Without that, the defect it once had was invisible on Windows and unreachable to
 * every test written on Windows - which is exactly how it reached a Linux CI runner.
 */
describe("resolveSibling", () => {
  it("keeps an absolute directory absolute, so a POSIX root survives the collapse", () => {
    const source = goalAt("/home/runner/work/veridian/examples/shopping-cart");
    assert.equal(
      resolveSibling(source, "acceptance.yaml"),
      "/home/runner/work/veridian/examples/shopping-cart/acceptance.yaml",
    );
  });

  it("keeps an absolute reference absolute rather than re-rooting it under the source", () => {
    const source = goalAt("/repo/examples");
    assert.equal(resolveSibling(source, "/shared/acceptance.yaml"), "/shared/acceptance.yaml");
  });

  it("collapses `..` against an absolute root without dropping the root", () => {
    const source = goalAt("/repo/examples/shopping-cart");
    assert.equal(
      resolveSibling(source, "../cart/acceptance.yaml"),
      "/repo/examples/cart/acceptance.yaml",
    );
  });

  it("collapses a `./` prefix without dropping an absolute root", () => {
    const source = goalAt("/repo/examples/shopping-cart");
    assert.equal(
      resolveSibling(source, "./acceptance.yaml"),
      "/repo/examples/shopping-cart/acceptance.yaml",
    );
  });

  it("leaves a Windows drive path as it was, since that shape was never the broken one", () => {
    const source = goalAt("D:/repo/examples");
    assert.equal(resolveSibling(source, "acceptance.yaml"), "D:/repo/examples/acceptance.yaml");
  });

  it("resolves a sibling of a goal named by a bare relative path", () => {
    const source = goalAt(".");
    assert.equal(resolveSibling(source, "acceptance.yaml"), "acceptance.yaml");
  });

  /**
   * A reference that collapses its directory away must not make the *next* join absolute.
   *
   * `app: ..` one directory below the repository is the shape that produced this. Joining `..` onto
   * `acceptance` collapses to the empty string, and the empty string is not a directory: it is what
   * the next join inserted a separator in front of, so the declared `sandbox` became `/sandbox` and
   * the rooted check read that separator as a root marker. Measured on the self-acceptance contract -
   * the world opened `D:/sandbox` while the CLI it judged wrote to `<repository>/sandbox`, and the
   * one criterion that could see the two disagree reported `veridian-cli (root ../../sandbox)`.
   *
   * This is the same seam the absolute cases above guard, and it survived that fix for the reason
   * the collapse's own comment gives: an empty first segment *inside* an absolute path and an empty
   * *directory* in front of a relative one are the same string to a walk that reads a leading
   * separator as a root.
   */
  it("answers `.` rather than the empty string when a reference collapses its directory away", () => {
    assert.equal(resolveSibling(goalAt("acceptance"), ".."), ".");
  });

  it("does not invent a root out of an empty directory, which is what a collapse once handed it", () => {
    assert.equal(resolveSibling(goalAt(""), "sandbox"), "sandbox");
  });

  it("keeps a child of a collapsed directory relative, which is the defect that reached a run", () => {
    const collapsed = resolveSibling(goalAt("acceptance"), "..");
    assert.equal(resolveSibling(goalAt(collapsed), "sandbox"), "sandbox");
  });

  it("still re-roots a child when the collapsed directory really was a root", () => {
    const collapsed = resolveSibling(goalAt("/repo"), "..");
    assert.equal(collapsed, "/");
    assert.equal(resolveSibling(goalAt(collapsed), "sandbox"), "/sandbox");
  });

  it("collapses a reference that walks past the top of a relative directory to `.`", () => {
    assert.equal(resolveSibling(goalAt("a/b"), "../.."), ".");
  });
});

describe("dirOf", () => {
  it("keeps the root of an absolute POSIX path, since it is what resolveSibling collapses against", () => {
    assert.equal(dirOf("/repo/examples/goal.yaml"), "/repo/examples");
  });

  it("answers `.` for a bare filename, which has no directory part", () => {
    assert.equal(dirOf("goal.yaml"), ".");
  });
});
