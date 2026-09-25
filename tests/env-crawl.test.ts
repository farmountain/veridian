/**
 * The environment crawler.
 *
 * Two halves, and they are testing different things. Most of the file is the ordinary business of a
 * reading: counts that add up, a classification that is right, order that is stable so two crawls can
 * be diffed.
 *
 * The one that matters is the **leak control**. `AGENTS.md` records the shape this repository pays for
 * repeatedly - a capability asserted beside the code rather than derived from it - and an environment
 * dump is where that mistake would be most expensive: it is the one artifact that reliably holds live
 * credentials, it is written to `.veridian/runs/<id>/environment.json` and to per-criterion evidence
 * on disk, and `.veridian/` is a directory people commit by accident. So the guard here is not "we
 * checked the code does not print a value". It is that a **distinctive planted secret does not appear
 * anywhere in the serialised crawl**, which is a test of the type as much as of the code: adding a
 * `value` field for any reason fails it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENV_MODES,
  ENV_READINGS,
  crawlEnvironment,
  isEnvCrawl,
  readEnvironmentCrawl,
  renderEnvironmentCrawl,
} from "../core/environment/env-crawl.ts";
import type { EnvCrawl } from "../core/environment/env-crawl.ts";

/** A value whose only job is to be findable if it ever leaves. */
const PLANTED = "sk-planted-0123456789abcdefghijklmnop";

const crawlOf = (
  env: Readonly<Record<string, string>>,
  declared: readonly string[] = [],
  mode: "inherit" | "declared" = "inherit",
): EnvCrawl => crawlEnvironment(env, { declared, mode });

describe("the crawler counts what a child could see", () => {
  it("names every variable and separates the ones the world declared from the ones it did not", () => {
    const crawl = crawlOf({ CART_CHANNEL: "nightly", PATH: "/usr/bin", HOME: "/home/op" }, [
      "CART_CHANNEL",
    ]);

    assert.deepEqual(
      crawl.entries.map((entry) => entry.name),
      ["CART_CHANNEL", "HOME", "PATH"],
      "the entries are sorted by name, so two crawls of one environment serialise identically",
    );
    assert.equal(crawl.entries.length, 3);
    assert.equal(crawl.inherited, 2, "only the name the document declared is not inherited");
    assert.equal(crawl.populated, 3);
    assert.equal(crawl.entries.find((entry) => entry.name === "CART_CHANNEL")?.declared, true);
    assert.equal(crawl.entries.find((entry) => entry.name === "PATH")?.declared, false);
  });

  it("treats an empty value as a declaration rather than as an occupied one", () => {
    // The distinction `url: null` carries one layer up: a name present and empty is something the world
    // put there, and a name present and occupied is a value in reach. A crawler that reported one
    // count for both would make `OPENAI_API_KEY=""` and a live key the same reading.
    const crawl = crawlOf({ DECLARED_EMPTY: "", FILLED: "x" });
    assert.equal(crawl.entries.length, 2);
    assert.equal(crawl.populated, 1);
    assert.equal(crawl.entries.find((entry) => entry.name === "DECLARED_EMPTY")?.populated, false);
  });

  it("counts a name the process had no value for, rather than dropping it", () => {
    const crawl = crawlEnvironment({ PRESENT: undefined, SET: "1" }, { declared: [], mode: "inherit" });
    assert.equal(crawl.entries.length, 2);
    assert.equal(crawl.entries.find((entry) => entry.name === "PRESENT")?.populated, false);
  });
});

describe("the crawler classifies by name and by value, because a name-only screen is not enough", () => {
  it("matches a credential-shaped name", () => {
    const crawl = crawlOf({ OPENAI_API_KEY: "x", PLAIN: "y" });
    assert.deepEqual(
      crawl.credentials.map((entry) => entry.name),
      ["OPENAI_API_KEY"],
    );
  });

  it("matches a credential-shaped VALUE under a name nothing would suspect", () => {
    // Measured on this machine: ten names in one shell carried credential-shaped values under
    // innocuous names. A crawler screening keys alone reports a clean environment with a secret in it.
    const crawl = crawlOf({ HARMLESS_LOOKING: PLANTED, ALSO_FINE: "nightly" });
    assert.deepEqual(
      crawl.credentials.map((entry) => entry.name),
      ["HARMLESS_LOOKING"],
      "a value-shaped credential was screened out because its name was innocent",
    );
  });

  it("does not call a path a credential, which is the false positive that made the first version useless", () => {
    // The first version of the value test flagged ten names in one shell, including `ComSpec` - which
    // holds `C:\Windows\system32\cmd.exe`. A classifier that calls every long path a secret reports a
    // number nobody can act on, so a separator or a drive letter disqualifies a value.
    const crawl = crawlOf({
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      PIPED: "\\\\.\\pipe\\vscode-git-0123456789abcdef",
      Sentence: "this is a long value with spaces in it 1234567890",
      Version: "2026.09.25-b20260925",
    });
    assert.deepEqual(
      crawl.credentials.map((entry) => entry.name),
      [],
      `a path, a pipe name, a sentence or a version was reported as a credential: ${crawl.credentials
        .map((entry) => entry.name)
        .join(", ")}`,
    );
  });

  it("reports the credential-shaped names as entries, so a reader can see what the classifier saw", () => {
    const crawl = crawlOf({ A_TOKEN: PLANTED, B_KEY: "" });
    assert.equal(crawl.credentials.length, 2);
    assert.equal(crawl.credentials.find((entry) => entry.name === "A_TOKEN")?.populated, true);
    assert.equal(
      crawl.credentials.find((entry) => entry.name === "B_KEY")?.populated,
      false,
      "a declared but empty credential is credential-shaped and not occupied, and both are readings",
    );
  });
});

describe("the reading names what the world did not declare", () => {
  it("separates an inherited credential from a declared one", () => {
    const declared = ["CART_TOKEN"];
    const crawl = crawlOf({ CART_TOKEN: "abc", OPENAI_API_KEY: PLANTED }, declared);

    assert.equal(crawl.credentials.length, 2);
    assert.deepEqual(
      crawl.inheritedCredentials,
      ["OPENAI_API_KEY"],
      "the world's own declared credential is not the finding; the one it never named is",
    );
  });

  it("is empty when the world declared everything credential-shaped that is visible", () => {
    const crawl = crawlOf({ CART_TOKEN: "abc" }, ["CART_TOKEN"]);
    assert.deepEqual(crawl.inheritedCredentials, []);
  });

  it("carries the mode it was built in", () => {
    assert.equal(crawlOf({ A: "1" }, ["A"], "declared").mode, "declared");
    assert.equal(crawlOf({ A: "1" }, ["A"]).mode, "inherit");
  });
});

describe("the crawl cannot carry a value, and that is asserted rather than promised", () => {
  it("does not contain a planted secret in its serialised form", () => {
    const crawl = crawlOf(
      {
        OPENAI_API_KEY: PLANTED,
        HARNESS_GATE_TOKEN: PLANTED,
        INNOCENT_NAME: PLANTED,
        normal: "not-a-secret",
      },
      ["normal"],
    );

    const serialised = JSON.stringify(crawl);
    assert.equal(
      serialised.includes(PLANTED),
      false,
      "a value reached the serialised crawl. This is the one defect in this module that cannot be " +
        "fixed later: the crawl is written into environment.json and into per-criterion evidence, on " +
        "disk, in a directory people commit by accident.",
    );
    // And the stronger half: the value is not there because the type has nowhere to put it, not
    // because this particular input happened not to reach a field. Each entry's key set is asserted,
    // so adding a `value` - or a `preview`, or a `hash` - fails here rather than in a bundle.
    for (const entry of crawl.entries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["credential", "declared", "name", "populated"],
        "an entry gained a field, and the only reason to add one is to carry something about the value",
      );
    }
  });

  it("does not contain a planted secret in its rendered lines either", () => {
    const crawl = crawlOf({ OPENAI_API_KEY: PLANTED });
    const rendered = renderEnvironmentCrawl(crawl).join("\n");
    assert.equal(rendered.includes(PLANTED), false);
    assert.ok(
      rendered.includes("OPENAI_API_KEY"),
      "the name is the finding and has to be readable - this is the half that is allowed to leave",
    );
  });

  it("bounds the render to names and figures", () => {
    const crawl = crawlOf({ OPENAI_API_KEY: PLANTED, PATH: "/usr/bin" }, ["PATH"]);
    assert.deepEqual(renderEnvironmentCrawl(crawl), [
      "env:mode inherit",
      "env:visible 2",
      "env:declared 1",
      "env:inherited 1",
      "env:populated 2",
      "env:credential-shaped 1",
      "env:credential-populated 1",
      "env:inherited-credential 1",
      "env:credential OPENAI_API_KEY",
    ]);
  });
});

describe("the reading vocabulary is closed and total", () => {
  it("answers every declared reading, and answers it as text", () => {
    const crawl = crawlOf({ PATH: "/usr/bin", OPENAI_API_KEY: PLANTED, EMPTY: "" }, ["PATH"]);
    for (const reading of ENV_READINGS) {
      const answer = readEnvironmentCrawl(crawl, reading);
      assert.equal(typeof answer, "string", `${reading} answered with something other than text`);
      assert.equal(answer.length > 0, true, `${reading} answered with nothing at all`);
    }
    assert.equal(readEnvironmentCrawl(crawl, "mode"), "inherit");
    assert.equal(readEnvironmentCrawl(crawl, "visible"), "3");
    assert.equal(readEnvironmentCrawl(crawl, "declared"), "1");
    assert.equal(readEnvironmentCrawl(crawl, "inherited"), "2");
    assert.equal(readEnvironmentCrawl(crawl, "populated"), "2");
    assert.equal(readEnvironmentCrawl(crawl, "credential"), "1");
    assert.equal(readEnvironmentCrawl(crawl, "credential-populated"), "1");
    assert.equal(readEnvironmentCrawl(crawl, "inherited-credential"), "1");
    assert.equal(readEnvironmentCrawl(crawl, "inherited-credentials"), "OPENAI_API_KEY");
    assert.equal(readEnvironmentCrawl(crawl, "credentials"), "OPENAI_API_KEY");
  });

  it("joins names so a criterion can ask whether one specific name was reachable", () => {
    const crawl = crawlOf({ PATH: "/usr/bin", HOME: "/home/op" });
    const names = readEnvironmentCrawl(crawl, "names");
    assert.ok(names.includes("PATH"), "a criterion asking 'was PATH readable' must be answerable");
    assert.ok(names.includes("HOME"));
  });

  it("declares the two modes and no others", () => {
    assert.deepEqual([...ENV_MODES], ["inherit", "declared"]);
  });
});

describe("a crawl can be read back, and a malformed one cannot pass for an empty one", () => {
  it("accepts what it produced", () => {
    const crawl = crawlOf({ A: "1" }, ["A"]);
    assert.equal(isEnvCrawl(JSON.parse(JSON.stringify(crawl)) as unknown), true);
  });

  it("refuses a value that is present but not a crawl", () => {
    // The substitution this guards against: a validator reading `{}` as a crawl and reporting zero
    // visible names for a world that handed a child nothing, when what happened is that nothing was
    // recorded. "Nobody measured" and "the measurement was nothing" are the pair this repository
    // separates more often than any other.
    for (const candidate of [null, undefined, 0, "", "env", [], {}, { mode: "inherit" }]) {
      assert.equal(isEnvCrawl(candidate), false, `${JSON.stringify(candidate)} passed as a crawl`);
    }
    const crawl = crawlOf({ A: "1" });
    const { entries: _dropped, ...withoutEntries } = crawl;
    assert.equal(isEnvCrawl(withoutEntries), false, "a crawl with no entries array passed");
    assert.equal(isEnvCrawl({ ...crawl, mode: "aggressive" }), false, "an unknown mode passed");
    assert.equal(
      isEnvCrawl({ ...crawl, inherited: "two" }),
      false,
      "a count that is not a number passed, and a validator comparing it would compare a string",
    );
  });
});
