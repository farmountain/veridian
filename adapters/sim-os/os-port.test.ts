/**
 * The substitute's own tests.
 *
 * Every claim this world makes about itself is a claim a hardening contract will later rest on, so
 * each is asserted here rather than described in the port's comment. The suite is deliberately heavier
 * on *negatives* than on positives: that `icacls` grants a permission is nearly uninteresting, and
 * that it withdraws **only the permission it was given** is the property that makes an access criterion
 * mean something - the two halves are asserted together below, because a `PASS` on one of them says
 * nothing about the other.
 *
 * Four tests are worth reading first, and each of them is a defect this world has already shipped:
 *
 * - **the permission operand** (`/remove <account>:(W)`). Keeping only the account and dropping the
 *   word made `/remove svc:(R)` and `/remove svc:(R) /remove svc:(W)` produce an identical world, so
 *   two genuinely different programs were indistinguishable and a criterion could never tell them
 *   apart. The four-way assertion - remove write, remove read, remove both, remove neither - is the
 *   only shape that can see it.
 * - **`icacls` on a path the world has never governed.** `recordFor` used to hand the map a record and
 *   then return a *different* one, so the mutation landed on an object nothing else held: the command
 *   reported `Successfully processed N files.` and the reading still showed the pristine default. The
 *   test reads the grant back, and reverting `recordFor` fails it.
 * - **the reading does not mutate.** Two reads of one world are `deepEqual`, including after a service
 *   starts - because M1 compares exactly these documents, and a reading that edited what it read would
 *   make one world look like two.
 * - **a world a run inherits is not a world that run built.** `prepare()` wipes a hand-written tree,
 *   and the test proves the file was readable first so it cannot pass vacuously.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  OS_IDENTITY_PATHS,
  osPort,
  type OsPort,
} from "./os-port.ts";
import {
  accessOf,
  aclAt,
  fileOn,
  isOsObservationData,
  permissionsOf,
  serviceNamed,
  settingsIn,
  settingValues,
} from "../../core/environment/os-observation.ts";
import type { OsFamily, OsObservationData } from "../../core/environment/os-observation.ts";

/** A world built against a real temporary tree, torn down whatever the body does. */
const withPort = async (
  body: (port: OsPort, root: string) => Promise<void>,
  options: { readonly family?: OsFamily; readonly user?: string } = {},
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "veridian-sim-os-"));
  const port = osPort({
    root,
    family: options.family ?? "windows",
    system: options.family === "macos" ? "macOS 14.5" : "Windows Server 2022",
    user: options.user ?? "svc-audit",
  });
  try {
    await port.prepare();
    await body(port, root);
  } finally {
    await port.stop();
    await rm(root, { recursive: true, force: true });
  }
};

/** One command, run as a given caller. */
const exec = async (
  port: OsPort,
  argv: readonly string[],
  source: "application" | "criterion" | "world" = "application",
) => port.exec({ argv, source });

const SECRETS = "C:\\ProgramData\\Veridian\\secrets.env";

/** A file the application wrote, at a path the world has never governed. */
const writeByHand = async (root: string, segments: readonly string[], contents: string): Promise<void> => {
  await mkdir(join(root, ...segments.slice(0, -1)), { recursive: true });
  await writeFile(join(root, ...segments), contents, "utf8");
};

// ---- the tree, and what a run may inherit ------------------------------------------------------

test("the sandbox is a real tree with real contents", async () => {
  await withPort(async (port, root) => {
    const identity = await exec(port, ["type", OS_IDENTITY_PATHS.windows]);
    assert.equal(identity.exitCode, 0, "type could not read a file the world itself wrote");

    const listing = await port.read();
    assert.ok(isOsObservationData(listing), "a reading this world produced is not readable as one");
    assert.equal(listing.family, "windows");
    assert.equal(listing.user, "svc-audit");
    assert.equal(listing.caseSensitive, false, "a Windows volume folds case, and the reading says so");

    const file = fileOn(listing, OS_IDENTITY_PATHS.windows);
    assert.ok(file, "the reading does not hold a file the world really wrote");
    assert.match(file.sha256 ?? "", /^[0-9a-f]{64}$/, "a file read from disk must carry its real hash");
    assert.equal(file.bytes, Buffer.byteLength(file.text ?? "", "utf8"));
    assert.ok(root.length > 0);
  });
});

test("prepare() builds the system from nothing, so a run cannot inherit the last one's tree", async () => {
  await withPort(async (port, root) => {
    // Stand in for the tree a previous run leaves behind. `stop()` keeps the sandbox on purpose - a
    // bundle quotes paths inside it - so the next run's first observation is the one place a stale file
    // can be read as this run's own work.
    await writeByHand(root, ["ProgramData", "Veridian", "policy.conf"], "CART_BIND=127.0.0.1\n");
    const before = await port.read();
    assert.ok(
      fileOn(before, "C:\\ProgramData\\Veridian\\policy.conf"),
      "the stale file was not readable before the rebuild, so this test measures nothing",
    );

    await port.prepare();

    const listing = await port.read();
    assert.equal(
      listing.files.some((entry) => entry.path === "C:\\ProgramData\\Veridian\\policy.conf"),
      false,
      "a file the previous run left behind is still readable, so a criterion can pass on an artifact " +
        "this run never installed",
    );
  });
});

test("reset() restores the world but not the record", async () => {
  await withPort(async (port) => {
    await exec(port, ["whoami"], "criterion");
    await port.reset();
    const listing = await port.read();
    assert.equal(
      listing.execs.some((record) => record.program === "whoami"),
      true,
      "a reset that cleared the exec record would destroy the evidence of a boundary crossing it " +
        "then reports as a clean run",
    );
    assert.equal(
      listing.files.some((entry) => entry.path.includes("policy.conf")),
      false,
      "the tree itself is rebuilt",
    );
  });
});

test("a file the application wrote appears in the reading without the world being told", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    const listing = await port.read();
    const file = fileOn(listing, SECRETS);
    assert.ok(file, "a real file on disk is missing from the reading");
    assert.equal(file.text, "TOKEN=abc\n");
    assert.equal(file.owner, "svc-audit", "a file the world did not create is owned by its acting account");
    assert.equal(
      aclAt(listing, SECRETS),
      null,
      "a path the world was never told how to govern must have no record at all, so a criterion " +
        "about it is INCONCLUSIVE rather than FAIL",
    );
  });
});

test("read() does not mutate the world it reads", async () => {
  await withPort(async (port) => {
    await exec(port, ["sc", "create", "cart-web", "binPath=", "node app.mjs --port 18501"]);
    await exec(port, ["sc", "start", "cart-web"]);
    const first = await port.read();
    const second = await port.read();
    assert.deepEqual(second, first, "two readings of one world have to be the same document");
    assert.equal(second.services.length, 1, "a read must not register or forget anything");
  });
});

// ---- the access decision, and the operand it must not drop -------------------------------------

test("icacls on a path the world never governed is visible in the next reading", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    const ungoverned = await port.read();
    assert.equal(
      aclAt(ungoverned, SECRETS),
      null,
      "the world holds a record for a path it was never told how to govern, so this test is not " +
        "measuring the case it exists for",
    );

    const account = await exec(port, ["net", "user", "svc-cart", "/add"]);
    assert.equal(account.exitCode, 0, account.stderr);
    const granted = await exec(port, ["icacls", SECRETS, "/grant", "svc-cart:(R)"]);
    assert.equal(granted.exitCode, 0, granted.stderr);

    const listing = await port.read();
    const acl = aclAt(listing, SECRETS);
    assert.ok(acl, "the world holds no record for a path it was just told how to govern");
    assert.equal(
      acl.entries.some((entry) => entry.account === "svc-cart" && entry.permission === "read"),
      true,
      "a grant performed on a path with no record yet landed on an object the map never held, so " +
        "the command reported success for a world it did not change",
    );
    assert.equal(permissionsOf(acl, "svc-cart"), "read");
  });
});

test("the reading holds an access decision only for accounts the world actually knows", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    await exec(port, ["icacls", SECRETS, "/grant", "svc-cart:(R)"]);

    const before = aclAt(await port.read(), SECRETS);
    assert.ok(before);
    assert.equal(
      accessOf(before, "svc-cart", "read"),
      null,
      "no decision was recorded for an account this system does not hold, and `null` is how a " +
        "criterion tells that apart from a decision that says `none`",
    );

    await exec(port, ["net", "user", "svc-cart", "/add"]);
    const after = aclAt(await port.read(), SECRETS);
    assert.ok(after);
    assert.equal(accessOf(after, "svc-cart", "read"), "permitted");
    // `Everyone` really does reach every account, including the ones the world seeded, and that is
    // asserted rather than assumed. The default record a windows path is handed carries a read `allow`
    // for `Everyone`, consulted last, so `SYSTEM` is *permitted* to read it. This test originally
    // expected `refused` here and reported the port as wrong: a test that disagrees with the rule is a
    // test making a claim, and the claim was the thing that needed checking.
    assert.equal(
      accessOf(after, "SYSTEM", "read"),
      "permitted",
      "the `Everyone` entry is consulted last, which is what makes it reach a seeded account too",
    );
    assert.equal(
      accessOf(after, "SYSTEM", "write"),
      "refused",
      "and it grants read only - a default that quietly carried write would widen every path it touched",
    );
    assert.equal(accessOf(after, "Everyone", "read"), "permitted");
  });
});

test("icacls /remove withdraws the permission it was given and no other", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");

    // Nothing governs this path yet, and that is the precondition rather than an aside: a security
    // record is created when a command *touches* a path, and this file was written into the host tree
    // by hand, so the first `/remove` below is also the command that gives the path its default record.
    // That record is the acting account (read and write) plus `Everyone` (read).
    assert.equal(
      aclAt(await port.read(), SECRETS),
      null,
      "the world holds a record for a path no command has touched, so the removals below are not " +
        "measuring the default they are written against",
    );

    // `Everyone` is withdrawn first, and that is what makes the readings below say anything at all:
    // while it stands every account is permitted to read *by it*, so `permissionsOf` reports `read` no
    // matter what happened to the account's own entries - a reading that cannot fail while the entry
    // stands is not a measurement of the removal. The same collision makes the refusal rule ("silence
    // is not consent") unreachable on the default record.
    const withdrawn = await exec(port, ["icacls", SECRETS, "/remove", "Everyone:(R)"]);
    assert.equal(withdrawn.exitCode, 0, withdrawn.stderr);
    const base = aclAt(await port.read(), SECRETS);
    assert.ok(base);
    assert.equal(
      permissionsOf(base, "svc-audit"),
      "read,write",
      "the acting account's own default entries are read and write",
    );

    // Each permission word is exercised while the account holds **both**, which is the only state in
    // which the two single-word removals discriminate: a filter that ignored the word takes both and
    // reports `none` where this expects `write` or `read`. A version that dropped the operand passed
    // every reading in which only one entry existed, which is how the defect shipped.
    const removeRead = await exec(port, ["icacls", SECRETS, "/remove", "svc-audit:(R)"]);
    assert.equal(removeRead.exitCode, 0, removeRead.stderr);
    const afterRead = aclAt(await port.read(), SECRETS);
    assert.ok(afterRead);
    assert.equal(
      permissionsOf(afterRead, "svc-audit"),
      "write",
      "withdrawing the read grant also withdrew the write grant - the operand was ignored, and two " +
        "different programs would then produce an identical world",
    );
    assert.equal(afterRead.entries.length, 1, "the command named one entry and moved one entry");

    const grantedBack = await exec(port, ["icacls", SECRETS, "/grant", "svc-audit:(R)"]);
    assert.equal(grantedBack.exitCode, 0, grantedBack.stderr);
    const removeWrite = await exec(port, ["icacls", SECRETS, "/remove", "svc-audit:(W)"]);
    assert.equal(removeWrite.exitCode, 0, removeWrite.stderr);
    const afterWrite = aclAt(await port.read(), SECRETS);
    assert.ok(afterWrite);
    assert.equal(
      permissionsOf(afterWrite, "svc-audit"),
      "read",
      "and the same the other way round: withdrawing write must leave read standing",
    );

    const removeBoth = await exec(port, ["icacls", SECRETS, "/remove", "svc-audit:(RW)"]);
    assert.equal(removeBoth.exitCode, 0, removeBoth.stderr);
    const afterBoth = aclAt(await port.read(), SECRETS);
    assert.ok(afterBoth);
    assert.equal(
      permissionsOf(afterBoth, "svc-audit"),
      "none",
      "removing both permissions has to leave the account holding neither",
    );
  });
});

test("icacls refuses an argument that is not <account>:(PERMS)", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    const bare = await exec(port, ["icacls", SECRETS, "/remove", "svc-audit"]);
    assert.equal(bare.exitCode, 1);
    assert.match(bare.stderr, /not written <account>:\(PERMS\)/);

    const word = await exec(port, ["icacls", SECRETS, "/grant", "svc-audit:(Z)"]);
    assert.equal(word.exitCode, 1);
    assert.match(word.stderr, /it understands R, W, RW, M and F/);

    const missing = await exec(port, ["icacls", SECRETS, "/inheritance:r", "/grant"]);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /needs an argument/);
  });
});

test("icacls reports that no change was asked for rather than succeeding silently", async () => {
  await withPort(async (port) => {
    const nothing = await exec(port, ["icacls", OS_IDENTITY_PATHS.windows, "/T"]);
    assert.equal(nothing.exitCode, 1);
    assert.equal(nothing.stderr, "icacls: no change was asked for\n");

    // The one-letter account is deliberate. `x:(R)` is an `<account>:(PERMS)` token, and the escape
    // guard once read any token beginning with a letter and a colon as a drive - so this grant was
    // refused as "names a place this world does not hold", which sends the reader to inspect the path.
    // A drive *path* has a separator after the colon and a grant token does not; this is the assertion
    // that holds that difference, and the one below it is the file that really cannot be found.
    const absent = await exec(port, ["icacls", "C:\\ProgramData\\Veridian\\missing.conf", "/grant", "x:(R)"]);
    assert.equal(absent.exitCode, 1);
    assert.match(absent.stderr, /The system cannot find the file specified./);
  });
});

test("a deny beats an allow at the same level, and an explicit entry outranks an inherited one", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    await exec(port, ["net", "user", "svc-cart", "/add"]);

    const denied = await exec(port, [
      "icacls",
      SECRETS,
      "/grant",
      "svc-cart:(R)",
      "/deny",
      "svc-cart:(W)",
    ]);
    assert.equal(denied.exitCode, 0, denied.stderr);
    const acl = aclAt(await port.read(), SECRETS);
    assert.ok(acl);
    assert.equal(accessOf(acl, "svc-cart", "read"), "permitted");
    assert.equal(
      accessOf(acl, "svc-cart", "write"),
      "refused",
      "a deny has to beat an allow at the same level, which is the direction that fails safe",
    );
  });
});

test("icacls /inheritance:r promotes what was inherited rather than deleting it", async () => {
  await withPort(async (port, root) => {
    const snapshot = join(root, "..", `veridian-os-inherit-${String(Date.now())}`);
    try {
      await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
      // The account is created *before* the snapshot, so the snapshot carries it. `permissionsOf`
      // reaches a decision only for an account the world holds, so a restored world without it would
      // report `null` for the very entry this test is about - the promotion would have happened and
      // the reading would have had no way to show it.
      await exec(port, ["net", "user", "svc-cart", "/add"]);
      await exec(port, ["icacls", SECRETS, "/grant", "svc-cart:(R)"]);
      await port.snapshot(snapshot);

      // The one way an inherited entry can exist in this world: a restored state document that holds
      // one. Nothing in the register writes one, so a test that skipped this would assert `every(
      // entry => !entry.inherited)` about a list that was never anything else - a green assertion that
      // says nothing about promotion.
      const statePath = join(snapshot, "world.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        security: [string, { entries: { inherited: boolean }[] }][];
      };
      const secrets = state.security.find(([path]) => path === SECRETS);
      assert.ok(secrets, "the snapshot does not hold the record this test needs to promote");
      for (const entry of secrets[1].entries) entry.inherited = true;
      await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
      await port.restoreFrom(snapshot);

      const before = aclAt(await port.read(), SECRETS);
      assert.ok(before);
      assert.equal(
        before.entries.some((entry) => entry.inherited),
        true,
        "the restored record lost the inherited entries this test exists to promote",
      );
      const count = before.entries.length;

      const promoted = await exec(port, ["icacls", SECRETS, "/inheritance:r"]);
      assert.equal(promoted.exitCode, 0, promoted.stderr);
      const after = aclAt(await port.read(), SECRETS);
      assert.ok(after);
      assert.equal(
        after.entries.every((entry) => !entry.inherited),
        true,
        "what was inherited is still inherited, so the command changed nothing",
      );
      assert.equal(
        after.entries.length,
        count,
        "removing inheritance promotes entries; deleting them would silently widen what the file " +
          "permits and report success for it",
      );
      assert.equal(permissionsOf(after, "svc-cart"), "read");
    } finally {
      await rm(snapshot, { recursive: true, force: true });
    }
  });
});

test("the acting account is refused read access once its read grant is withdrawn", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    const readable = await exec(port, ["type", SECRETS], "criterion");
    assert.equal(readable.exitCode, 0, "the default record grants the acting account read");

    const withdrawn = await exec(port, [
      "icacls",
      SECRETS,
      "/remove",
      "svc-audit:(R)",
      "/remove",
      "Everyone:(R)",
    ]);
    assert.equal(withdrawn.exitCode, 0, withdrawn.stderr);

    const refused = await exec(port, ["type", SECRETS], "criterion");
    assert.equal(refused.exitCode, 1, "a file this account may not read must not be readable");
    assert.match(refused.stderr, /Access is denied/);
    assert.match(refused.stderr, /no entry names this account/, "the refusal names which rule fired");
  });
});

// ---- the store, the accounts, the services ------------------------------------------------------

test("the registry holds what was written and refuses what it cannot hold", async () => {
  await withPort(async (port) => {
    const added = await exec(port, [
      "reg",
      "add",
      "HKLM\\SOFTWARE\\Veridian\\Policy",
      "/v",
      "Autostart",
      "/t",
      "REG_SZ",
      "/d",
      "yes",
    ]);
    assert.equal(added.exitCode, 0, added.stderr);

    const listing = await port.read();
    const values = settingsIn(listing, "HKLM\\SOFTWARE\\Veridian\\Policy");
    assert.equal(settingValues(values), "Autostart=yes");
    assert.equal(values[0]?.writtenBy, "application", "the store records who wrote a value");

    const multiline = await exec(port, [
      "reg",
      "add",
      "HKLM\\SOFTWARE\\Veridian\\Policy",
      "/v",
      "Notes",
      "/d",
      "one\ntwo",
    ]);
    assert.equal(multiline.exitCode, 1);
    assert.match(multiline.stderr, /one line in this world/);

    const badType = await exec(port, [
      "reg",
      "add",
      "HKLM\\SOFTWARE\\Veridian\\Policy",
      "/v",
      "N",
      "/t",
      "REG_BINARY",
      "/d",
      "x",
    ]);
    assert.equal(badType.exitCode, 1);
    assert.match(badType.stderr, /REG_SZ, REG_DWORD/);

    const perUser = await exec(port, ["reg", "add", "HKCU\\Software\\Veridian", "/v", "N", "/d", "x"]);
    assert.equal(perUser.exitCode, 1);
    assert.match(perUser.stderr, /machine-wide store only/);

    const missing = await exec(port, ["reg", "query", "HKLM\\SOFTWARE\\Veridian\\Policy", "/v", "Nope"]);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /unable to find the specified registry key or value/);
  });
});

test("net creates an account, and a group entry reaches the account inside it", async () => {
  await withPort(async (port, root) => {
    await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
    const created = await exec(port, ["net", "user", "svc-cart", "/add"]);
    assert.equal(created.exitCode, 0, created.stderr);
    const again = await exec(port, ["net", "user", "svc-cart", "/add"]);
    assert.equal(again.exitCode, 1, "creating an account twice has to be refused, not ignored");
    assert.match(again.stderr, /already exists/);

    // The `Everyone` entry is withdrawn here, and that is what makes "silence is not consent" reachable
    // at all: while it stands, *every* account is permitted by it, so an account with no entry for
    // itself is permitted by somebody else's. Asserting the refusal rule against a record that carries
    // `Everyone` would be asserting the default's behaviour and calling it the rule's.
    await exec(port, [
      "icacls",
      SECRETS,
      "/remove",
      "svc-cart:(R)",
      "/remove",
      "svc-cart:(W)",
      "/remove",
      "Everyone:(R)",
    ]);
    const empty = aclAt(await port.read(), SECRETS);
    assert.ok(empty);
    assert.equal(
      accessOf(empty, "svc-cart", "read"),
      "refused",
      "an account with no entry for it, and no `Everyone` standing behind it, is refused rather " +
        "than permitted - silence is not consent",
    );

    await exec(port, ["net", "localgroup", "Auditors", "svc-cart", "/add"]);
    await exec(port, ["icacls", SECRETS, "/grant", "Auditors:(R)"]);
    const listing = await port.read();
    const acl = aclAt(listing, SECRETS);
    assert.ok(acl);
    assert.equal(
      accessOf(acl, "svc-cart", "read"),
      "permitted",
      "a group entry has to reach the account inside it, or an ACL written for a group is invisible",
    );
    assert.equal(
      accessOf(acl, "svc-audit", "read"),
      "permitted",
      "the acting account still carries its own read grant; withdrawing `Everyone` withdrew neither",
    );
    const account = listing.accounts.find((entry) => entry.name === "svc-cart");
    assert.equal(account?.groups.includes("Auditors"), true, "the group membership was not recorded");
    assert.equal(account?.kind, "user");
    assert.equal(account?.createdBy, "application", "the world records who made a change it holds");
  });
});

test("a service's running state is earned by a real socket, and a stop really closes it", async () => {
  await withPort(async (port) => {
    const created = await exec(port, [
      "sc",
      "create",
      "cart-web",
      "binPath=",
      "node provision.mjs --port 18511",
      "obj=",
      "svc-cart",
    ]);
    assert.equal(created.exitCode, 0, created.stderr);

    const stopped = serviceNamed(await port.read(), "cart-web");
    assert.equal(stopped?.status, "stopped");
    assert.equal(stopped?.account, "svc-cart", "the account the service runs as is the point");
    assert.equal(stopped?.port, 18511, "the port the command line declared");
    assert.equal(stopped?.pid, null);

    const running = await exec(port, ["sc", "start", "cart-web"]);
    assert.equal(running.exitCode, 0, running.stderr);
    const live = serviceNamed(await port.read(), "cart-web");
    assert.equal(live?.status, "running", "the reading reports running only after a real connect");
    assert.equal(typeof live?.pid, "number");

    const netstat = await exec(port, ["netstat", "-ano"], "criterion");
    assert.match(netstat.stdout, /127\.0\.0\.1:18511.*LISTENING/);

    await exec(port, ["sc", "stop", "cart-web"]);
    const closed = serviceNamed(await port.read(), "cart-web");
    assert.equal(closed?.status, "stopped");
    const after = await exec(port, ["netstat", "-ano"], "criterion");
    assert.match(after.stdout, /127\.0\.0\.1:18511.*CLOSED/);

    const unknown = await exec(port, ["sc", "start", "no-such-service"]);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr, /is not held by this world/);
  });
});

test("a service that declares no port is running without a socket, and says so", async () => {
  await withPort(async (port) => {
    await exec(port, ["sc", "create", "cart-worker", "binPath=", "node worker.mjs"]);
    await exec(port, ["sc", "start", "cart-worker"]);
    const service = serviceNamed(await port.read(), "cart-worker");
    assert.equal(service?.status, "running");
    assert.equal(
      service?.port,
      null,
      "a service whose command line names no port binds nothing, and the reading says null rather " +
        "than guessing a number",
    );
  });
});

test("stopping the world closes the listeners and keeps the tree", async () => {
  await withPort(async (port, root) => {
    await exec(port, ["sc", "create", "cart-web", "binPath=", "node provision.mjs --port 18521"]);
    await exec(port, ["sc", "start", "cart-web"]);
    await port.stop();

    assert.equal(
      existsSync(join(root, "ProgramData", "Veridian", "identity.json")),
      true,
      "a bundle quotes paths inside the sandbox, so stopping may not remove it",
    );
    const listing = await port.read();
    const service = serviceNamed(listing, "cart-web");
    assert.equal(
      service?.status,
      "failed",
      "with the listener closed the service cannot be reached, and the reading reports the state it " +
        "can observe rather than the one it recorded",
    );
  });
});

// ---- refusals: the world says no, and says why --------------------------------------------------

test("a program the world does not answer is refused by name, with the register quoted back", async () => {
  await withPort(async (port) => {
    const refused = await exec(port, ["choco", "install", "nodejs"]);
    assert.equal(refused.result, "refused");
    assert.equal(refused.exitCode, null, "a refusal has no exit code and must not be given one");
    assert.match(
      refused.reason ?? "",
      /this world answers curl, icacls, net, netstat, reg, sc, type, ver, where, whoami and nothing else/, 
      "a refusal quotes the whole register back, because that is what tells the reader what this " +
        "system does answer",
    );
    assert.equal(refused.source, "application", "the record says who asked");
  });
});

test("a command naming a place outside the sandbox is refused before it runs", async () => {
  await withPort(async (port) => {
    const climbing = await exec(port, ["type", "..\\..\\Windows\\win.ini"]);
    assert.equal(climbing.result, "refused");
    assert.match(climbing.reason ?? "", /names a place this world does not hold/);

    const other = await exec(port, ["type", "D:\\work\\secrets.txt"]);
    assert.equal(other.result, "refused", "another drive is this machine's, not the world's");

    const nested = await exec(port, ["icacls", "C:\\ProgramData\\..\\Windows", "/grant", "x:(R)"]);
    assert.equal(nested.result, "refused");
  });
});

test("the reading keeps a path as the system spells it, and refuses the other family's spelling", async () => {
  await withPort(async (port, root) => {
    const listing = await port.read();
    assert.equal(
      listing.files.every((entry) => entry.path.startsWith("C:\\")),
      true,
      "a reading that spelled its own paths the host's way could not be compared across machines",
    );
    assert.equal(
      listing.root,
      root,
      "the host root is recorded as the host spells it, because that is where a bundle has to look",
    );
    assert.equal(
      listing.files.some((entry) => entry.path.startsWith(root)),
      false,
      "no reading path may leak the host tree",
    );

    // Both commands that take a path answer this the same way, and that is the assertion rather than a
    // second example: `where` resolves its argument through the world's grammar, and `type` used to skip
    // that step and go straight to the host mapping - where `path.join` accepts a separator the grammar
    // does not have. It answered "cannot find the path because it does not exist" for a spelling this
    // world would have refused to resolve, which is two grammars for one world's paths.
    for (const argv of [["type", "/etc/os-release"], ["where", "/etc/os-release"]]) {
      const posixSpelling = await exec(port, argv);
      assert.equal(posixSpelling.exitCode, 1, `${argv[0]} resolved a spelling this world does not have`);
      assert.match(
        posixSpelling.stderr,
        /spelled for a system that separates with a forward slash/,
        `${argv[0]} refused for a reason that does not name the real one`,
      );
    }
  });
});

test("a macOS world speaks macOS, and refuses what only the other family has", async () => {
  await withPort(
    async (port, root) => {
      const version = await exec(port, ["sw_vers"]);
      assert.equal(version.exitCode, 0);
      assert.match(version.stdout, /ProductVersion:\t14\.5/);

      const who = await exec(port, ["id"]);
      assert.match(who.stdout, /uid=501\(dev\)/);

      const listing = await port.read();
      assert.equal(listing.simulated.includes("preferences"), true);
      assert.equal(
        listing.simulated.includes("registry"),
        false,
        "a reading carries the surfaces that stood in for this system, not for either of them",
      );

      await writeByHand(root, ["etc", "veridian", "secrets.env"], "TOKEN=abc\n");
      const cat = await exec(port, ["cat", "/etc/veridian/secrets.env"], "criterion");
      assert.equal(cat.exitCode, 0, cat.stderr);
      assert.equal(cat.stdout, "TOKEN=abc\n");

      const chmod = await exec(port, ["chmod", "600", "/etc/veridian/secrets.env"]);
      assert.equal(chmod.exitCode, 0, chmod.stderr);
      const acl = aclAt(await port.read(), "/etc/veridian/secrets.env");
      assert.ok(acl);
      assert.equal(acl.mode, "0600", "this family has modes, and the reading carries one");
      assert.equal(accessOf(acl, "dev", "read"), "permitted");
      assert.equal(
        accessOf(acl, "Everyone", "read"),
        "refused",
        "a mode replaces the entries rather than amending them, so other has no read bit at 0600",
      );

      const additions = await exec(port, ["sysadminctl", "-addUser", "svc-cart"]);
      assert.equal(additions.exitCode, 0, additions.stderr);
      const created = (await port.read()).accounts.find((entry) => entry.name === "svc-cart");
      assert.equal(created?.home, "/Users/svc-cart");

      const windowsProgram = await exec(port, ["reg", "query", "HKLM\\SOFTWARE"]);
      assert.equal(windowsProgram.result, "refused", "icacls and reg are not macOS programs");
    },
    { family: "macos", user: "dev" },
  );
});

test("launchd holds a job it can read, and refuses one it cannot", async () => {
  await withPort(
    async (port, root) => {
      const plist = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<plist><dict>",
        "  <key>Label</key><string>com.veridian.cart</string>",
        "  <key>UserName</key><string>svc-cart</string>",
        "  <key>ProgramArguments</key><array>",
        "    <string>/usr/local/bin/node</string><string>cart.mjs</string><string>--port</string>",
        "    <string>18531</string>",
        "  </array>",
        "</dict></plist>",
      ].join("\n");
      await writeByHand(root, ["Library", "LaunchDaemons", "com.veridian.cart.plist"], plist);

      // Written to disk and never announced: a job the system holds is one the reading has to show,
      // and merging it during the read is what keeps `read()` a pure function of the world's state.
      const discovered = serviceNamed(await port.read(), "com.veridian.cart");
      assert.ok(discovered, "a job file on disk is a job this system holds");
      assert.equal(discovered.port, 18531, "the port is read out of the command line, not guessed");

      const loaded = await exec(port, [
        "launchctl",
        "load",
        "/Library/LaunchDaemons/com.veridian.cart.plist",
      ]);
      assert.equal(loaded.exitCode, 0, loaded.stderr);
      const started = await exec(port, ["launchctl", "start", "com.veridian.cart"]);
      assert.equal(started.exitCode, 0, started.stderr);
      const held = serviceNamed(await port.read(), "com.veridian.cart");
      assert.equal(held?.status, "running");
      assert.equal(held?.account, "svc-cart");

      await writeByHand(root, ["Library", "LaunchDaemons", "broken.plist"], "this is not a plist");
      const refused = await exec(port, ["launchctl", "load", "/Library/LaunchDaemons/broken.plist"]);
      assert.equal(refused.exitCode, 1);
      assert.match(
        refused.stderr,
        /will not register a service it cannot read a command out of/,
        "a plist the world cannot read is refused rather than registered with an empty command",
      );
    },
    { family: "macos", user: "dev" },
  );
});

test("defaults writes and reads a preference domain, and refuses a flag it does not know", async () => {
  await withPort(
    async (port) => {
      const written = await exec(port, [
        "defaults",
        "write",
        "com.veridian.cart",
        "KeepAlive",
        "-bool",
        "true",
      ]);
      assert.equal(written.exitCode, 0, written.stderr);
      const read = await exec(port, ["defaults", "read", "com.veridian.cart", "KeepAlive"]);
      assert.equal(read.stdout, "true\n");

      const unknown = await exec(port, ["defaults", "write", "com.veridian.cart", "KeepAlive", "-data", "x"]);
      assert.equal(unknown.exitCode, 1);
      assert.match(unknown.stderr, /and nothing else/);
    },
    { family: "macos", user: "dev" },
  );
});

// ---- snapshot and restore ----------------------------------------------------------------------

test("a snapshot restores the tree, the record, the store and the running service", async () => {
  await withPort(async (port, root) => {
    const snapshot = join(root, "..", `veridian-os-snapshot-${String(Date.now())}`);
    try {
      await writeByHand(root, ["ProgramData", "Veridian", "secrets.env"], "TOKEN=abc\n");
      await exec(port, ["icacls", SECRETS, "/grant", "svc-cart:(R)"]);
      await exec(port, ["net", "user", "svc-cart", "/add"]);
      await exec(port, [
        "reg",
        "add",
        "HKLM\\SOFTWARE\\Veridian\\Policy",
        "/v",
        "Autostart",
        "/d",
        "yes",
      ]);
      await exec(port, ["sc", "create", "cart-web", "binPath=", "node provision.mjs --port 18541"]);
      await exec(port, ["sc", "start", "cart-web"]);
      await port.snapshot(snapshot);

      // Move the world well away from the snapshot, then put it back.
      await exec(port, ["icacls", SECRETS, "/remove", "svc-cart:(R)"]);
      await exec(port, ["sc", "stop", "cart-web"]);
      await exec(port, ["reg", "delete", "HKLM\\SOFTWARE\\Veridian\\Policy", "/v", "Autostart"]);
      const moved = await port.read();
      assert.equal(settingsIn(moved, "HKLM\\SOFTWARE\\Veridian\\Policy").length, 0);
      assert.equal(serviceNamed(moved, "cart-web")?.status, "stopped");

      await port.restoreFrom(snapshot);

      const restored = await port.read();
      const acl = aclAt(restored, SECRETS);
      assert.ok(acl, "the security record did not come back");
      assert.equal(
        accessOf(acl, "svc-cart", "read"),
        "permitted",
        "a restored record that lost its entries would decide access for a system nobody configured",
      );
      assert.equal(restored.accounts.some((entry) => entry.name === "svc-cart"), true);
      assert.equal(settingValues(settingsIn(restored, "HKLM\\SOFTWARE\\Veridian\\Policy")), "Autostart=yes");
      const service = serviceNamed(restored, "cart-web");
      assert.equal(service?.status, "running");
      const netstat = await exec(port, ["netstat", "-ano"], "criterion");
      assert.match(
        netstat.stdout,
        /127\.0\.0\.1:18541.*LISTENING/,
        "a service the snapshot called running has to be reachable again, or the reading would " +
          "report a fact nobody observed",
      );
    } finally {
      await rm(snapshot, { recursive: true, force: true });
    }
  });
});

test("restoring from a directory with no state document is an error rather than an empty world", async () => {
  await withPort(async (port, root) => {
    const empty = join(root, "..", `veridian-os-empty-${String(Date.now())}`);
    await mkdir(empty, { recursive: true });
    try {
      await assert.rejects(() => port.restoreFrom(empty), /no state document/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

// ---- the exec record, which is not the state record ---------------------------------------------

test("an execution the adapter ran itself is recorded with its own caller", async () => {
  await withPort(async (port: OsPort) => {
    port.record({
      source: "application",
      argv: ["node", "provision.mjs"],
      program: "node",
      result: "completed",
      exitCode: 0,
      stdout: "cart-web provisioned: 2 files installed\n",
      stderr: "",
      reason: null,
      durationMs: 12,
    });
    const listing: OsObservationData = await port.read();
    const recorded = listing.execs.filter((record) => record.program === "node");
    assert.equal(recorded.length, 1);
    assert.equal(
      recorded[0]?.source,
      "application",
      "the application's own process is run by the adapter, so the world records it rather than " +
        "spawning it a second time",
    );
    assert.match(recorded[0]?.stdout ?? "", /provisioned/);
  });
});
