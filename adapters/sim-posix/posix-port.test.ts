/**
 * The substitute's own tests.
 *
 * Every claim this world makes about itself is a claim a contract will later rest on, so each is
 * asserted here rather than described in the port's comment. The suite is deliberately heavier on
 * *negatives* than on positives: that `apt-get install nginx` reports success is nearly uninteresting,
 * and that it also installs `libpcre3` - the dependency a table lookup would miss - is the property
 * that makes the package manager a substitution rather than a stub.
 *
 * The two tests worth reading first:
 *
 * - **the permission decision** reaches a file whose mode says the run's account may not read it, and
 *   then reaches it again after the mode is changed. If this pair ever passes for the wrong reason the
 *   whole hardening family is judging nothing, so the pair is asserted together.
 * - **the reading does not mutate** reads twice and requires the two documents to be `deepEqual`. The
 *   cluster port shipped an event counter that advanced inside its own snapshot derivation, and M1 -
 *   which compares exactly these documents - would have called one cluster two different worlds.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isPosixObservationData, fileAt, execsOf, portAt } from "../../core/environment/posix-observation.ts";
import { posixPort } from "./posix-port.ts";
import type { PosixPort } from "./posix-port.ts";

const withPort = async (body: (port: PosixPort, root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "veridian-sim-posix-"));
  const port = posixPort({ root, distribution: "veridian-simulated-linux", user: "app" });
  try {
    await port.prepare();
    await body(port, root);
  } finally {
    await port.stop();
    await rm(root, { recursive: true, force: true });
  }
};

test("the sandbox is a real tree with real contents", async () => {
  await withPort(async (port, root) => {
    const os = await port.exec({ argv: ["cat", "/etc/os-release"], source: "criterion" });
    assert.equal(os.exitCode, 0, "cat could not read a file the world itself wrote");
    assert.match(os.stdout, /veridian-simulated-linux/);

    const listing = await port.read();
    const release = fileAt(listing, "/etc/os-release");
    assert.ok(release, "the reading does not hold a file the world really wrote");
    assert.equal(release.kind, "file");
    assert.equal(release.owner, "root");
    assert.match(release.sha256 ?? "", /^[0-9a-f]{64}$/, "a file read from disk must carry its real hash");
    assert.ok(root.length > 0);
  });
});

test("prepare() builds the system from nothing, so a run cannot inherit the last one's tree", async () => {
  await withPort(async (port, root) => {
    // Stand in for the tree a previous run leaves behind. `stop()` keeps the sandbox on purpose - a
    // bundle quotes paths inside it - so the next run's first observation is the one place a stale file
    // can be read as this run's own work. It was: two criteria passed on a file from an earlier run
    // whose content this run's application had not written, and the following reset hid the cause.
    await mkdir(join(root, "etc", "veridian"), { recursive: true });
    await writeFile(join(root, "etc", "veridian", "policy.conf"), "CART_WEB_BIND=127.0.0.1\n", "utf8");
    const before = await port.read();
    assert.ok(
      fileAt(before, "/etc/veridian/policy.conf"),
      "the stale file was not readable before the rebuild, so this test measures nothing",
    );

    await port.prepare();

    const listing = await port.read();
    assert.equal(
      listing.files.some((entry) => entry.path === "/etc/veridian/policy.conf"),
      false,
      "a file the previous run left behind is still readable, so a criterion can pass on an " +
        "artifact this run never installed",
    );
  });
});

test("the package manager resolves the index's own dependencies", async () => {
  await withPort(async (port) => {
    const install = await port.exec({ argv: ["apt-get", "install", "-y", "nginx"], source: "application" });
    assert.equal(install.exitCode, 0);
    const listing = await port.read();
    const names = listing.packages.filter((entry) => entry.status === "installed").map((entry) => entry.name);
    assert.ok(names.includes("nginx"), "the named package was not installed");
    assert.ok(
      names.includes("libpcre3"),
      "nginx's dependency was skipped, which means the index was read as a list of names and not as " +
        "a graph - the difference between substituting apt and stubbing it",
    );
    assert.equal(names.filter((name) => name === "nginx").length, 1, "a package can only be installed once");
  });
});

test("an unknown package is refused by name rather than silently accepted", async () => {
  await withPort(async (port) => {
    const refused = await port.exec({ argv: ["apt-get", "install", "nginx-plus"], source: "application" });
    assert.equal(refused.exitCode, 100);
    assert.match(refused.stderr, /Unable to locate package nginx-plus/);
    const listing = await port.read();
    assert.equal(
      listing.packages.some((entry) => entry.name === "nginx-plus"),
      false,
      "a package the index does not hold must not appear in the reading as installed",
    );
  });
});

test("an account is added to a table that is really written to /etc/passwd", async () => {
  await withPort(async (port) => {
    const added = await port.exec({ argv: ["adduser", "--system", "svc-nginx"], source: "application" });
    assert.equal(added.exitCode, 0);
    const listing = await port.read();
    const account = listing.users.find((entry) => entry.name === "svc-nginx");
    assert.ok(account, "the account was not created");
    assert.notEqual(account.uid, 0, "a system account must not be root");
    const passwd = fileAt(listing, "/etc/passwd");
    assert.ok(passwd?.text?.includes("svc-nginx:"), "/etc/passwd does not hold the account it must");
  });
});

test("a flag's value is the flag's value and never the command's operand", async () => {
  await withPort(async (port) => {
    // Both spellings of the same flag, because a parse that reads operands as "the words that do not
    // start with `-`" gets one of them right and the other wrong: `--home <path>` puts the path in
    // the operand list, `--home=<path>` does not. The first is the shape a provisioner really writes,
    // and it made the *home directory* the account name while `adduser` still exited 0 - which is how
    // a criterion asking whether `cart` exists came to read a world that had no such account.
    const spaced = await port.exec({
      argv: ["adduser", "--system", "--home", "/var/lib/cart-web", "cart"],
      source: "application",
    });
    assert.equal(spaced.exitCode, 0, spaced.stderr);
    const joined = await port.exec({ argv: ["adduser", "--home=/srv/audit", "auditor"], source: "application" });
    assert.equal(joined.exitCode, 0, joined.stderr);

    const listing = await port.read();
    const cart = listing.users.find((entry) => entry.name === "cart");
    const auditor = listing.users.find((entry) => entry.name === "auditor");
    assert.ok(cart, "the account named `cart` was not created");
    assert.ok(auditor, "the account named `auditor` was not created");
    assert.equal(cart.home, "/var/lib/cart-web", "the flag's value was not read as the home directory");
    assert.equal(auditor.home, "/srv/audit", "the `--home=` spelling was not read as the home directory");
    for (const entry of listing.users) {
      assert.equal(
        entry.name.startsWith("/"),
        false,
        `a directory became an account (${entry.name}), which is a flag's value read as an operand`,
      );
    }
  });
});

test("the words after the account name are groups to join", async () => {
  await withPort(async (port) => {
    // One operand is the account; every further bare word is a group. This is the half of the parse
    // the defect above inverted, so it is asserted on its own rather than as a side effect.
    const added = await port.exec({
      argv: ["adduser", "--system", "--home", "/var/lib/cart-web", "cart", "cart-ops"],
      source: "application",
    });
    assert.equal(added.exitCode, 0, added.stderr);
    const listing = await port.read();
    const account = listing.users.find((entry) => entry.name === "cart");
    assert.ok(account, "the account was not created");
    assert.deepEqual([...account.groups].sort(), ["cart", "cart-ops"]);
    const group = fileAt(listing, "/etc/group");
    assert.ok(group?.text?.includes("cart-ops:"), "/etc/group does not hold the group the account joined");
  });
});

test("the permission decision refuses and then permits, for the same file", async () => {
  await withPort(async (port) => {
    // `/etc/motd` is the world's own file: owned by `root`, mode `0644`, so the run's account reaches
    // it through the *other* bits. Changing the mode is therefore the whole experiment - no owner
    // changed, no file created, one number - which is what makes this a test of the decision rather
    // than of two unrelated edits.
    const open = await port.exec({ argv: ["cat", "/etc/motd"], source: "criterion" });
    assert.equal(open.exitCode, 0, open.stderr);

    const tightened = await port.exec({ argv: ["chmod", "0600", "/etc/motd"], source: "application" });
    assert.equal(tightened.exitCode, 0);

    const denied = await port.exec({ argv: ["cat", "/etc/motd"], source: "criterion" });
    assert.equal(
      denied.exitCode,
      1,
      "a 0600 root-owned file was readable by the account the criteria act as, so nothing is enforced",
    );
    assert.match(denied.stderr, /Permission denied/);

    const probe = await port.exec({ argv: ["test", "-r", "/etc/motd"], source: "criterion" });
    assert.equal(probe.exitCode, 1, "test -r disagreed with cat about the same file");

    const chowned = await port.exec({ argv: ["chown", "app:app", "/etc/motd"], source: "application" });
    assert.equal(chowned.exitCode, 0);
    const permitted = await port.exec({ argv: ["cat", "/etc/motd"], source: "criterion" });
    assert.equal(
      permitted.exitCode,
      0,
      "the same file, the same mode, a different owner - and it is still refused, so the owner " +
        "bits were never consulted",
    );
    assert.match(permitted.stdout, /authorised use only/);
  });
});

test("a file the application wrote itself is read from the real tree", async () => {
  await withPort(async (port, root) => {
    await mkdir(join(root, "etc", "veridian"), { recursive: true });
    await writeFile(join(root, "etc", "veridian", "hardening.conf"), "permitrootlogin no\n", "utf8");
    // The world was never told about this file. It appears in the reading because the reading walks
    // the real tree, and the substituted programs reach it because the inode falls back to the file.
    const listing = await port.read();
    const found = fileAt(listing, "/etc/veridian/hardening.conf");
    assert.ok(found, "a file really sitting on disk is absent from the reading");
    assert.match(found.sha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal(found.text, "permitrootlogin no\n");

    const chmod = await port.exec({ argv: ["chmod", "0600", "/etc/veridian/hardening.conf"], source: "application" });
    assert.equal(chmod.exitCode, 0, "chmod refused a file that really exists on disk");
    const cat = await port.exec({ argv: ["cat", "/etc/veridian/hardening.conf"], source: "criterion" });
    assert.equal(cat.exitCode, 0, cat.stderr);
  });
});

test("chmod refuses a path that is not there rather than inventing an inode", async () => {
  await withPort(async (port) => {
    const refused = await port.exec({ argv: ["chmod", "0600", "/etc/veridian/absent.conf"], source: "criterion" });
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /No such file or directory/);
    const listing = await port.read();
    assert.equal(fileAt(listing, "/etc/veridian/absent.conf"), null, "chmod created the file it was told to protect");
  });
});

test("a service really binds a real port, and stopping it really closes the socket", async () => {
  await withPort(async (port, root) => {
    await mkdir(join(root, "etc", "systemd", "system"), { recursive: true });
    await writeFile(
      join(root, "etc", "systemd", "system", "edge.service"),
      "[Unit]\nDescription=edge\n\n[Service]\nExecStart=/usr/sbin/edge --listen\nPort=18080\n",
      "utf8",
    );
    const started = await port.exec({ argv: ["systemctl", "start", "edge"], source: "application" });
    assert.equal(started.exitCode, 0, started.stderr);

    const listening = await port.read();
    const open = portAt(listening, 18080);
    assert.ok(open, "the port the unit declared is not in the reading");
    assert.equal(open.state, "listening");
    assert.equal(
      open.verified,
      true,
      "verified must mean a socket was really reached; a table entry the world wrote about itself is not an observation",
    );

    const scan = await port.exec({ argv: ["nmap", "-p", "18080", "127.0.0.1"], source: "criterion" });
    assert.equal(scan.exitCode, 0);
    assert.match(scan.stdout, /18080\/tcp open/, "a scan of a bound port reported it closed");

    const stopped = await port.exec({ argv: ["systemctl", "stop", "edge"], source: "application" });
    assert.equal(stopped.exitCode, 0);
    const closed = await port.read();
    assert.equal(portAt(closed, 18080)?.state, "closed", "the listener outlived its own stop");
  });
});

test("a program outside the register is refused, and the refusal names what answers", async () => {
  await withPort(async (port) => {
    const refused = await port.exec({ argv: ["grep", "PermitRootLogin", "/etc/ssh/sshd_config"], source: "criterion" });
    assert.equal(refused.result, "refused");
    assert.equal(
      refused.exitCode,
      null,
      "a refusal has no exit code; giving it one would make it indistinguishable from a program that ran and failed",
    );
    assert.match(refused.reason ?? "", /apt-get/, "the refusal must name the register, not merely complain");
    assert.match(refused.reason ?? "", /grep/);

    const shell = await port.exec({ argv: ["sh", "-c", "cat /etc/passwd"], source: "criterion" });
    assert.equal(shell.result, "refused");
    assert.match(shell.reason ?? "", /shell/);
  });
});

test("egress is refused and recorded as an attempt, not as a page", async () => {
  await withPort(async (port) => {
    const fetched = await port.exec({ argv: ["curl", "https://example.invalid/"], source: "application" });
    assert.equal(fetched.result, "refused");
    assert.match(fetched.reason ?? "", /no egress/);
    const listing = await port.read();
    const attempts = execsOf(listing, "curl");
    assert.equal(attempts.length, 1, "the attempt must be in the action record even though it was refused");
    assert.equal(attempts[0]?.source, "application");
  });
});

test("a read does not mutate the record it reads", async () => {
  await withPort(async (port) => {
    await port.exec({ argv: ["apt-get", "update"], source: "application" });
    await port.exec({ argv: ["systemctl", "start", "absent-service"], source: "application" });
    const first = await port.read();
    const second = await port.read();
    assert.deepEqual(
      second,
      first,
      "two readings of one state differ, so the world mutates itself while being observed - and M1 " +
        "compares exactly these documents",
    );
    assert.ok(isPosixObservationData(first));
    assert.equal(
      first.execs.length,
      2,
      "the action record must hold what ran, and reading it must not add to it",
    );
  });
});

test("reset rebuilds the world and keeps the record of what was done to it", async () => {
  await withPort(async (port, root) => {
    await writeFile(join(root, "etc", "left-behind"), "written by the application\n", "utf8");
    await port.exec({ argv: ["apt-get", "install", "ufw"], source: "application" });
    assert.ok(fileAt(await port.read(), "/etc/left-behind"), "the file the application wrote is not in the reading");

    await port.reset();

    const after = await port.read();
    assert.equal(fileAt(after, "/etc/left-behind"), null, "the reset left the application's file in the world");
    assert.equal(
      after.packages.some((entry) => entry.name === "ufw" && entry.status === "installed"),
      false,
      "the reset kept a package a previous iteration installed, so the next iteration starts in a " +
        "world that was not the one the first iteration started in",
    );
    assert.equal(
      after.users.some((entry) => entry.name === "ufw"),
      false,
      "a reset restores the base world; it does not leave the accounts a previous iteration created",
    );
    assert.ok(
      after.execs.some((exec) => exec.program === "apt-get"),
      "the reset cleared the action record - a reset restores the world, it does not restore the record",
    );
  });
});

test("the reading names every surface it substituted", async () => {
  await withPort(async (port) => {
    const listing = await port.read();
    // Written out rather than read from `POSIX_SIMULATED_SURFACES`, because the list here is the
    // *claim* - "these seven things are what this world is not" - and iterating the constant would
    // make the test agree with the code by construction. A surface dropped from the constant has to
    // fail here, and that can only happen if the two lists are written independently.
    const replaced = [
      "kernel",
      "distribution",
      "package-manager",
      "package-index",
      "permissions",
      "egress",
      "provisioning",
    ];
    for (const surface of replaced) {
      assert.ok(
        listing.simulated.includes(surface as (typeof listing.simulated)[number]),
        `the reading does not declare the ${surface} substitution, so it is indistinguishable from a real host`,
      );
    }
    assert.equal(listing.user, "app", "the reading must name the account the criteria act as");
    assert.ok(listing.root.length > 0);
  });
});

test("a command the adapter ran itself can be filed in the same record", async () => {
  await withPort(async (port) => {
    port.record({
      source: "application",
      argv: ["/usr/bin/provision", "--apply"],
      program: "/usr/bin/provision",
      result: "completed",
      exitCode: 0,
      stdout: "provisioned\n",
      stderr: "",
      reason: null,
      durationMs: 12,
    });
    const listing = await port.read();
    const filed = execsOf(listing, "/usr/bin/provision");
    assert.equal(filed.length, 1);
    assert.equal(filed[0]?.result, "completed");
    assert.equal(filed[0]?.exitCode, 0);
  });
});

/**
 * The one boundary this world holds.
 *
 * `join(root, "..", "..")` leaves the sandbox and lands in the host's tree, so a command that climbed
 * out would read the *developer's* file while the reading described it as the sandbox's. That is a
 * verdict about a file the world does not hold, so the command is refused rather than resolved - and
 * the refusal is an *observation*, which is why this test asserts a record instead of an exception.
 */
test("a command that climbs out of the sandbox is refused rather than resolved", async () => {
  await withPort(async (port) => {
    const escaping = await port.exec({ argv: ["cat", "/../../../etc/passwd"], source: "criterion" });
    assert.equal(escaping.result, "refused");
    assert.equal(escaping.exitCode, null, "a refusal is not an exit code");
    assert.match(escaping.reason ?? "", /climbs out of the sandbox/);
    assert.equal(escaping.stdout, "", "nothing may be read on the way to being refused");

    // The guard keys on a `..` *segment*, not on the substring: a legitimate file whose name merely
    // contains two dots is still a name in this world.
    const odd = await port.exec({ argv: ["cat", "/etc/..release"], source: "criterion" });
    assert.notEqual(odd.result, "refused", "a name containing two dots is not an escape");
  });
});

/**
 * A snapshot of this world is not the files.
 *
 * Three of the four facts asserted here - the mode, the installed package and the service - live in the
 * world's bookkeeping rather than in the tree, so a snapshot that copied the tree would restore
 * contents and lose exactly the facts every hardening criterion reads. The fourth is the one that makes
 * the restore *honest*: a service recorded as running has to have a socket bound again, or `verified`
 * would report a fact nobody observed.
 */
test("a snapshot restores the modes, the packages and the sockets, not just the files", async () => {
  await withPort(async (port, root) => {
    const snapshots = await mkdtemp(join(tmpdir(), "veridian-sim-posix-snap-"));
    try {
      await mkdir(join(root, "etc", "systemd", "system"), { recursive: true });
      await writeFile(
        join(root, "etc", "systemd", "system", "edge.service"),
        "[Unit]\nDescription=edge\n\n[Service]\nExecStart=/usr/sbin/edge --listen\nPort=18080\n",
        "utf8",
      );
      await port.exec({ argv: ["apt-get", "install", "-y", "ufw"], source: "application" });
      await port.exec({ argv: ["systemctl", "start", "edge"], source: "application" });
      await port.exec({ argv: ["chmod", "0600", "/etc/motd"], source: "application" });

      const before = await port.read();
      const mode = fileAt(before, "/etc/motd")?.mode;
      const hash = fileAt(before, "/etc/motd")?.sha256 ?? "";
      assert.equal(mode, "0600");
      assert.equal(
        portAt(before, 18080)?.verified,
        true,
        "the fixture must really be listening before it is photographed",
      );

      const destination = join(snapshots, "one");
      await mkdir(destination, { recursive: true });
      await port.snapshot(destination);

      // Mutate the four facts, through the world's own interface, so a restore has something to undo.
      await port.exec({ argv: ["chmod", "0644", "/etc/motd"], source: "application" });
      await port.exec({ argv: ["apt-get", "remove", "ufw"], source: "application" });
      await port.exec({ argv: ["systemctl", "stop", "edge"], source: "application" });
      await writeFile(join(root, "etc", "motd"), "tampered\n", "utf8");

      const mutated = await port.read();
      assert.equal(fileAt(mutated, "/etc/motd")?.mode, "0644");
      assert.notEqual(fileAt(mutated, "/etc/motd")?.sha256, hash, "the fixture did not really change");
      assert.equal(portAt(mutated, 18080)?.state, "closed");

      await port.restoreFrom(destination);
      const restored = await port.read();

      assert.equal(fileAt(restored, "/etc/motd")?.mode, mode, "the mode was lost, so the restore copied files");
      assert.equal(fileAt(restored, "/etc/motd")?.sha256, hash, "the tampered contents survived the restore");
      assert.equal(
        restored.packages.find((entry) => entry.name === "ufw")?.status,
        "installed",
        "an installed package is world bookkeeping, and a tree cannot restore it",
      );
      assert.equal(portAt(restored, 18080)?.state, "listening", "the service was recorded but no socket was bound");
      assert.equal(
        portAt(restored, 18080)?.verified,
        true,
        "`verified` has to be a real connect after a restore too, or it reports a fact nobody observed",
      );
    } finally {
      await rm(snapshots, { recursive: true, force: true });
    }
  });
});

test("a restore from a directory that holds no snapshot is refused by name", async () => {
  await withPort(async (port) => {
    const missing = join(tmpdir(), "veridian-sim-posix-absent-snapshot");
    await assert.rejects(
      () => port.restoreFrom(missing),
      /world\.json/,
      "a restore that fails has to name the file it could not find",
    );
  });
});
