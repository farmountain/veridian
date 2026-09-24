# Build / test commands

> Moved verbatim out of `AGENTS.md` so that the always-on instruction file stays a budget rather
> than a library. Nothing here was rewritten in transit; each entry keeps the measurement that
> made it a rule.


**The source tree is the program, and there is no build step between the two** - but there is now a
build step **for the artifact**, and the difference matters enough to state twice. Node 22 strips
types and executes `.ts` directly, so development, the gate and the demo all run the source. An
*installed* Veridian cannot be that source, because Node refuses to strip types under `node_modules`,
so `npm run build` compiles it to `dist/` and copies the schemas in. The **VS Code Cockpit** is the
third runtime and has a build step for the same class of reason rather than a preference: the
extension host loads JavaScript and is not Node's loader, so `extension/vscode` compiles to `out/`.
Every command below was executed on this machine and is quoted from its real output.

```powershell
npm ci                     # install. Runtime: yaml. Dev: typescript, @types/node.
                           # Also runs `prepare`, which is `npm run build`, so dist/ exists afterwards.
npx tsc --noEmit           # typecheck. Currently silent - a single error means a real regression.
node --test                # the whole suite. 2660 tests over 441 suites, ~6-8s. No directory argument.
                           # 2660 = the root's own 2568 + the Cockpit's 92, because the runner walks
                           # the tree and reaches extension/vscode/src/*.test.ts. The inclusion is
                           # measured rather than assumed: a test title that exists only in the
                           # Cockpit appears twice in this run. Neither figure is
                           # the whole story on its own: the root tsconfig EXCLUDES extension/**, so
                           # `npx tsc --noEmit` here does not typecheck the Cockpit and the root gate
                           # is not the extension's gate.
npm run gate               # typecheck then test. Run this before claiming anything is done.

npm run build              # tsc -p tsconfig.build.json, then node scripts/copy-assets.mjs
npm run smoke:dist         # drive the COMPILED CLI from a temp directory; asserts exit 2, not 3
npm run smoke:mcp          # spawn the real MCP server as a child and drive it over a pipe;
                           # 8 checks and exit 0. No build: the source tree is the program.
```

The Cockpit has its own gate, and it is **three** commands rather than one, because the extension is
the only tree that ships compiled:

```powershell
cd extension/vscode
npm ci                     # install. Dev only: typescript, @types/node, @types/vscode,
                           # @vscode/vsce, ovsx. There is no runtime dependency, and Playwright is
                           # not one of them - which is why reading the archive is done with
                           # node:zlib by hand rather than with a zip library.
npm run gate               # typecheck, test, build, smoke:out - in that order.
                           # npx tsc --noEmit  -> silent
                           # node --test       -> 92 tests, 0 failing
                           # npm run build     -> out/, 7 files
                           # npm run smoke:out -> loads the compiled entry point, 15 checks
npm run smoke:out          # alone: resolve the manifest's `main`, activate it twice under a
                           # recording double of `vscode` (scripts/vscode-stub.mjs), and assert the
                           # registered commands equal the seven the manifest declares. Exit 1 if the
                           # compiled file the manifest names is not there.
npm run package            # vsce package --no-dependencies
                           # The archive lands at veridian-cockpit-<version>.vsix - `vsce` takes the
                           # name and the version out of the manifest it packages, so the filename
                           # cannot claim a version the extension inside it does not have.
                           # 13 files, 125.09 KB, at the extension root. Deliberately NOT in `gate`:
                           # a packaging tool's output is not part of the source tree's contract,
                           # and making the local gate depend on `vsce` would make every local run
                           # need it. CI runs it, and runs the check below against it.
npm run smoke:vsix         # read that archive back as a zip and assert what it holds: the entry
                           # point `main` names, the manifest field-for-field, the absence of
                           # src/, tests and node_modules, the licence and the readme byte for
                           # byte, and every compiled file identical to the build's. 35 checks.
                           # Exit 1 if the archive is stale, incomplete or wider than the
                           # manifest allowlists.
```

**`npm run smoke:out` exists for the same reason `npm run smoke:dist` does, one runtime further out.**
`node --test` runs `.ts`; the extension host runs `out/*.js`; so the seven files that ship are covered by
nothing in this tree. It was falsified rather than trusted - pointing `main` at a path the build does
not produce makes it fail naming that path and exit 1. It is also only *necessary*, never sufficient:
`scripts/vscode-stub.mjs` is a recording double, and `extension/vscode/README.md` names what only a
real VS Code test host could exercise.

**`npm run smoke:vsix` is the same argument once more, and it is the one with a third-party tool in
the middle.** A `.vsix` is a zip that `vsce` builds from an allowlist in the manifest, and every
decision about what travels is made by that tool and by nothing in this tree. The script opens the zip
itself - central directory, stored and deflated entries, `inflateRawSync` - because there is no
runtime dependency here and adding one to read an archive would be the tail wagging the dog. It was
falsified five ways rather than trusted: adding `src` to the allowlist fails both negative checks and
exits 1; adding a byte to a compiled file *after* packaging fails the byte-identity check and exits 1;
appending a line to the licence copy fails with `the licence in the archive is the repository's, byte
for byte (1327 bytes)` and exits 1; appending a line to `extension/vscode/README.md` *after* packaging
fails `the readme in the archive is the source's, byte for byte` and exits 1 - the check
that had to be written before it could be falsified, because the readme is the marketplace's long
description and until this pass it was the one file in the archive compared for *existence* and nothing
else, so an archive built before the last edit to it shipped a description that disagreed with the
repository while every check here passed; and taking `LICENSE` out of `files` is the instructive one,
because `vsce` prints `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`, packages **10** files
and **exits 0** - so the packaging step reports nothing wrong and `smoke:vsix` is what fails. *A
warning is not a check, and a file a packaging tool copies by convention is a file nothing promised to
compare.*

**The marketplaces are a declared route now rather than a habit.** `vsce publish` and `ovsx publish`
were named in `extension/vscode/README.md` as the third distribution route while `ovsx` was installed
nowhere and declared nowhere - so the route existed only as prose a maintainer had to reproduce from
memory, which is this repository's recurring defect: *a route named in a document that nothing in the
tree can execute.* `npm run publish:vsce` and `npm run publish:ovsx` are one script,
`scripts/publish-vsix.mjs`, and the flag at its centre is what keeps the route honest: `--packagePath`.
Bare `vsce publish` and bare `ovsx publish` each *package* the directory themselves, so a maintainer
running one would upload a second build rather than the archive `smoke:vsix` had just read back - and
`vsce publish <version>` runs `npm version`, editing one of the several files that carry the version
number. The archive's name is resolved by `scripts/vsix-archive.mjs` instead of repeated, because the
smoke test needs that same answer and two copies of one rule is how a publisher ends up uploading an
archive nobody produces. Neither command is in `gate`, for the reason the README already gave: a token
and a claimed publisher name are needed, and the source tree's gate must not require a credential or a
third party to be reachable. Two things were **measured rather than assumed**. The missing-archive
guard was falsified by renaming the archive away - it names `npm run package` and exits 1. And the
token message was corrected by running the route: the first draft claimed the publisher would *refuse*
without `OVSX_PAT`, and it does not refuse - it asks (`? Personal Access Token for namespace
'farmountain':`), so the message says that instead, and the USAGE warns that a non-interactive caller
has no terminal to answer it. *An error message may only name a cause the reporter observed.*

**The archive travels by one more route, and until this pass a document had not named it: the release
itself.** Release `v0.2.1` carried **no asset at all** - the marketplaces were described, the tag was
pushed, and the one address a reader without a marketplace account can walk to was empty. It was found
by listing the release's assets rather than by reading the README that described the routes, because a
route described and a route reachable are two different claims. `gh release upload v0.2.1
extension/vscode/veridian-cockpit-0.2.1.vsix --clobber` is the command, and the upload's own success
line is **not** the evidence: `gh release download` returns a file whose SHA-256 matches both the local
archive's hash and the `digest` the release API reports, which is the only reading that says the thing
a reader will download is the thing `smoke:vsix` read back. *A step whose name states an outcome must
fail when that outcome does not happen* - and this file already paid for that rule once, when the
`demo` job's step named *"upload the evidence bundle"* reported success and carried nothing.

The `.vsix` is generated and is **ignored rather than committed**, for the reason `dist/` and `out/`
are: a committed archive is a binary nobody can diff against the extension it claims to be, and it is
one `git add .` away from being committed. The rule in `.gitignore` is `*.vsix` rather than one
filename, so a second target added to the `package` script cannot arrive unignored. **The release is
therefore the only durable address for a built archive**, which is what makes attaching it to the tag
part of the release rather than a follow-up.

**`npm run smoke:dist` is not optional when the build, the packaging or the asset resolution
changes.** Every test in `tests/` covers `.ts` files that are never shipped; without this, the
artifact that *is* shipped is covered by nothing, which is the unverified claim this project has
already paid for twice. It asserts exit 2 specifically: with `--browser none` every criterion is a
browser observation, so a healthy run is four `INCONCLUSIVE` criteria - while exit 3 means the built
CLI could not find the schemas it shipped with. That number was not chosen by reasoning; the check was
falsified by reverting the asset root in the compiled `dist/cli/veridian.js`, and it failed with
`schema "schemas/goal.schema.json" could not be read` and exit 3.

Running things:

```powershell
node cli/veridian.ts <command> [flags]      # or: npm run veridian -- <command> [flags]
node cli/veridian.ts metrics --defects AC-001,AC-002,AC-003
                                            # M1..M5 over the runs on disk. Reads bundles; starts
                                            # nothing. Exits 1 if a metric was violated, 2 if there
                                            # is no run to measure.
npm run demo                                # the canonical demo. Asks the environment document for
                                            # its browser, so the three-defect FAIL -> repair -> PASS
                                            # progression actually runs. Exit 0 when it passes.
npm run demo:db                             # the second demo: the same loop against a SQLite file,
                                            # with no browser at all. Exit 0 when it passes.
npm run demo:k8s                            # the third demo, and the first simulated world: the app
                                            # deploys itself into a substitute control plane. Exit 0
                                            # when it passes.
npm run demo:posix                          # the fourth demo, and the second simulated world: the app
                                            # provisions a substitute Linux system through commands it
                                            # really issues, judged as a named account. Exit 0 when it
                                            # passes.
npm run demo:os                             # the fifth demo, and the third simulated world: the app
                                            # provisions a substitute Windows system and is judged as
                                            # `svc-audit`, which the loader refuses to let be SYSTEM.
                                            # Exit 0 when it passes.
npm run demo:cloud                          # the sixth demo, and the fourth simulated world: the app
                                            # provisions a substitute provider account over routes it
                                            # really calls, judged as `svc-cart`, with no cloud account,
                                            # no session and no outbound socket. Exit 0 when it passes.
npm run demo:container                      # the seventh demo, and the fifth simulated world: the app
                                            # provisions images and containers in a substitute runtime
                                            # and is judged on the records it holds. No Docker, no
                                            # daemon and no image anywhere in the loop. Exit 0 when it
                                            # passes: measured, 5 iterations and 27/27 criteria.
npm run demo:vscode                         # the eighth demo, and the sixth simulated world: a real
                                            # extension is loaded by a substitute extension host and
                                            # judged on what that host recorded while it ran. No editor,
                                            # no window and no installed VS Code anywhere in the loop.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 23/23 criteria, the failing count descending
                                            # 4 -> 3 -> 2 -> 1 -> 0.
npm run demo:api                            # the ninth demo, and the first whose world is NOT
                                            # simulated: a real service is started and judged through
                                            # its own HTTP interface over loopback, with the contract
                                            # rather than the application making the requests. No
                                            # page, no substitute, nothing rendered. Exit 0 when it
                                            # passes: measured, 5 iterations and 8/8 criteria, with
                                            # the failing count descending 6 -> 4 -> 3 -> 2 -> 0.
npm run demo:local-process                  # the tenth demo, and the second whose world is NOT
                                            # simulated - and the first whose subject is a program:
                                            # a real child process judged on what it printed, what
                                            # it exited with, whether it is still up and the files
                                            # it really wrote. No socket, no page, no substitute.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 9/9 criteria, the failing count descending
                                            # 6 -> 3 -> 2 -> 1 -> 0.
npm run demo:data                           # the eleventh demo, and the seventh simulated world -
                                            # and the first whose subject is a REQUEST the application
                                            # made: a real TCP socket, a real broker protocol written
                                            # into it, and a substitute on the other end. No broker
                                            # process, no replica follower, no on-disk log and no
                                            # outbound socket. Exit 0 when it passes: measured, 5
                                            # iterations and 20/20 criteria, the failing count
                                            # descending 5 -> 4 -> 3 -> 1 -> 0.
npm run demo:cockpit                        # the twelfth demo, and the only one whose application
                                            # is Veridian's OWN client: the compiled Cockpit, staged
                                            # into a substitute extension host and judged on what it
                                            # really did while loaded. It adds no world - it reuses
                                            # `sim-vscode` unchanged. Needs `npm run build` inside
                                            # `extension/vscode` first, and REFUSES by name when
                                            # `out/` is absent rather than skipping. Exit 0 when it
                                            # passes: measured, 1 iteration and 11/11 criteria.
npm run demo:mobile                         # the thirteenth demo, and the eighth simulated world:
                                            # the app provisions a substitute handset through
                                            # commands it really issues, judged on the bundles,
                                            # permissions, deep links, notifications and logs that
                                            # device holds. No emulator, no image, no booted system.
                                            # Exit 0 when it passes: measured, 5 iterations and
                                            # 25/25 criteria, the failing count descending
                                            # 5 -> 4 -> 2 -> 1 -> 0.
npm run demo:no-browser                     # the same demo with `--browser none`. Every criterion is
                                            # a browser observation, so this must end INCONCLUSIVE
                                            # (exit 2). It shows the refusal, not the aha.
npm run acceptance                          # Veridian judged by Veridian: its own contract - goal,
                                            # criteria and world - judged by the `local-process`
                                            # adapter, and run TWICE inside one invocation, so a world
                                            # the second run inherits is proved to be one it rebuilt
                                            # rather than one the first left behind. Not a `demo:*`
                                            # script: it is observed once with `--no-repair` because the
                                            # application under it is the CLI itself. Exit 0 when it
                                            # passes: measured, run 1 and run 2 both
                                            # `PASS (COMPLETED, 1 iteration(s))`, 7/7 criteria.
npm run acceptance:ladder                   # the second self-acceptance route, and it judges what the
                                            # first cannot: not the command line as a *product* but a
                                            # *run* as a witness. Each of its four criteria issues its
                                            # own `veridian validate` against `acceptance/ladder/
                                            # fixtures/`, then reads that nested run's own
                                            # `latest-result.json` for the rung each gap reached, the
                                            # reason a resolution deferred, the origin it was raised
                                            # from and the rungs attempted. Run TWO passes for the same
                                            # reason the route above is a script. Writes to
                                            # `sandbox/ladder/outer` - a sibling of the sandbox, never
                                            # `.veridian/` - so it cannot contend for the single-slot
                                            # summary. Exit 0 when it passes: measured, ~21 s wall for
                                            # both passes, each `PASS (COMPLETED, 1 iteration(s))`,
                                            # 4/4 criteria.
npm run e2e:install                         # one-time: fetch the Playwright browser
npm run e2e                                 # the canonical demo, --browser playwright explicitly
```

**`--browser none` cannot show the canonical demo, and saying so cost a broken front door.** The
script used to pass `--browser none`, which made the one command a reader is most likely to type
abort at iteration 1 with four `INCONCLUSIVE` criteria and exit 2. A demo that cannot demonstrate is
not a demo. The flag is still useful - it is how you watch the loop refuse to judge what it did not
observe - so it is its own script now, with narration that says what it will show.

**There is no `npm run format`, and there should not be one yet.** The script used to run
`prettier --write .` while `prettier` was not installed, so it could only ever fail with
`prettier: not found`; it has been removed rather than left behind as a broken command a reader might
run and then have to diagnose. The `PostToolUse` formatter hook is a documented no-op for the same
reason (see below). Do not install a formatter to "fix" this without asking - the format of the tree
is currently hand-maintained and consistent, and a first `prettier --write` would touch almost every
file.

`scripts/e2e-install.mjs` is `.mjs` **on purpose**: it is the bootstrap that fetches Playwright, so
it has to be runnable before anything in the repository has been type-checked. `scripts/copy-assets.mjs`
is `.mjs` for a related reason: it runs *after* `tsc` in the same npm script, so it must not itself
need compiling. `scripts/acceptance.mjs` is `.mjs` on the same ground as the first - it drives the CLI
through a child process, so it has to be runnable whatever state the tree's types are in.

**CI runs the same gates, on both platforms, and now the artifacts too.**
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) has seven jobs. `gate` runs `npm run gate` on
`ubuntu-latest` and `windows-latest` (both resolving Node from `.nvmrc`). `demo` runs the canonical
demo on ubuntu, asserts that `--browser none` really exits 2, and uploads `.veridian/` as an artifact.
`browserless worlds` runs twelve of the fourteen declared demos and names the world that regressed,
because before that job existed no CI ran any of them - it ran seven under the name `simulated
worlds` until the name stopped describing its own membership, and `demo:api`, `demo:local-process`,
`demo:data` and `demo:cockpit` were declared, shipped, documented and run by nothing.
**It also carries the one command the `for world` loop cannot**: `npm run acceptance`, the
self-acceptance contract, which is not a `demo:*` script and would otherwise be a command the manifest
declares and no job executes - the four-name defect again, one script over. That step is **now
observed, and how it was observed is the reason this paragraph is worth reading**: its first
execution on a runner (`35422604027`) printed `run 1: exit 1 - FAIL  (MAX_ITERATIONS, 1
iteration(s))` and the same for run 2, because the `cli/` extraction that landed in the same commit
had silently dropped a behaviour this contract was the only thing in the tree to assert. It was
repaired in `fadff22`, and its first green run is `35422903806`, where both invocations printed
`run N: exit 0 - PASS  (COMPLETED, 1 iteration(s))`. *An unexecuted check is not a formality that was
deferred; it is a defect that has not been observed yet - and this one took a single run to find.*
`distribution` runs `npm run smoke:dist` and then a
full `npm pack` -> install into a clean directory -> run round trip, because that is the only check
that reads `files` and `bin` the way a consumer does. `MCP surface` runs `npm run smoke:mcp`, which
spawns the real server as a child and drives it over a real pipe - the fourth artifact check, and the
only one whose artifact is a running program rather than a file. It is a **job of its own** rather
than a step inside `distribution`, because everything in that job needs `npm run build` and this
check does not: the source tree *is* the program. `container image` builds the Dockerfile and
requires the container to run the CLI **and** to resolve its own schemas from a browserless run, and
`VS Code Cockpit` runs the extension's own gate and reads the packaged `.vsix` back - the root gate
neither typechecks nor tests that tree, because the root tsconfig excludes `extension/**`.

**Both of those last two jobs have now run, and that is why they can be cited.** They were added and
pushed in one commit, which means they existed for a short window as exactly the thing this file
warns about - an unexecuted check. Run `34845548864` on `41d16f8` has all five jobs green, so the
Dockerfile is a built image rather than a correct-looking file, and `npm pack` is a working install
rather than a configuration. Docker cannot be exercised on this machine at all, which is precisely
why the job has to exist and why watching its first run is part of the change rather than a follow-up.

**And the newest run - `34853388649` on `135919e`, the `sim-k8s` commit - was green while one of its
steps did nothing.** The `demo` job's last step is named *"upload the evidence bundle"*; it reported
`No files were found with the provided path: .veridian/`, uploaded nothing, and the build passed. Two
causes, both worth stating. `.veridian/` is a **hidden** directory and `upload-artifact@v4` excludes
hidden files by default, so the path was searched and nothing in it was eligible; and the step was
configured `if-no-files-found: warn`, so the failure to carry the one thing it exists to carry was a
line in a list of warnings a reader learns to skip - alongside two Node-20 deprecation notices, which
is what makes that list easy to skip. Both are fixed (`include-hidden-files: true`,
`if-no-files-found: error`), and the point is the same one this file makes about guards: **a step
whose name states an outcome must fail when that outcome does not happen, or the name is a claim.**
Every green run up to this one carried the same silent no-op, which is why the defect was found by
reading *this* run's annotations rather than by reading the workflow - the workflow looks correct.
The fix is confirmed on run `34853562503`, where the same step now carries
`veridian-evidence` at **257,359 bytes** - read from the API rather than inferred from a warning
that stopped appearing, because "the warning is gone" and "the artifact exists" are different claims
and only the second one is the one this step makes.

*Written into `AGENTS.md`:* **a requirement that names a *place* must be resolved as a pointer, not
read as a literal key**; **two implementations of one rule disagree the first time a world arrives
that only one of them was written for**; **a capability report must be derived from what the code did,
not from a literal list beside it**; **a test that asks whether a value is in a list cannot see a list
that is wrong in a different way**; **a register whose members are schema `oneOf` branches needs a
guard of its own**; **a read must not mutate the record it reads**; **a resource that is absent and a
request that is refused are two different observations, and HTTP already has a word for each**; and
**a step whose name states an outcome must fail when that outcome does not happen**.

The `demo` exit-2 step reads `$?` after `set +e` because Actions runs bash with `-e`, which would
abort on the 2 before the assertion could look at it. Both new exit-code assertions use the same
shape.
