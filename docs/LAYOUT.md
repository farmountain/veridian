# Layout

> Moved verbatim out of `AGENTS.md` so that the always-on instruction file stays a budget rather
> than a library. Nothing here was rewritten in transit; each entry keeps the measurement that
> made it a rule.


Everything in this tree now exists and holds real code. Single repository - do not
split it into multiple repos prematurely. Create a directory only when its first real file lands.

```
extension/vscode/       The VS Code Cockpit - a thin client, no validation logic. `src/port.ts`
                        declares the slice of the editor API the Cockpit uses, by hand, so every
                        decision is testable without an editor; only `src/host/vscode-port.ts` and
                        `src/host/activate.ts` import `vscode`, and `src/host-boundary.test.ts` holds
                        that as an executable rule. The one directory with a build step: the
                        extension host is not Node's loader, so it compiles to `out/`, and
                        `npm run smoke:out` is what loads that artifact (no test in the tree can).
                        `npm run package` produces `veridian-cockpit-<version>.vsix` and
                        `npm run smoke:vsix` reads it back as a zip, because the archive is a third
                        artifact no test in either tree can load; `src/packaging.test.ts` holds the editor floor, the
                        type floor, the allowlist and the licence copy. Read
                        `extension/vscode/README.md` for the install routes and the list of what
                        a real VS Code test host would still have to cover.
core/clarification/     The ambiguity protocol: ladder (derived → inferred → defaulted → self_prompted
                        → answered → deferred), detectors, JSON-pointer editing, the report. Lowest
                        layer. Rung 4 is the run answering its *own* gap from material it already
                        holds; it may eliminate a candidate the contract offered and may never invent
                        one, which is the whole safety argument for letting a run answer itself.
core/schema/            JSON Schema validation + the loader that reads schemas/.
core/goal/              Goal definition, loading, persistence, versioning.
core/acceptance/        AcceptanceCriterion + the engine that turns a contract into an
                        executable validation sequence (core/acceptance/plan.ts) + the register of
                        step kinds (core/acceptance/steps.ts), which is the one place a kind is
                        declared that the schema and the engine both read.
core/execution/         Run controller implementing the state machine above + the repair gate.
core/validation/        ValidationResult, validator registry, status semantics, verdict rollup.
core/environment/       EnvironmentAdapter interface + Environment Manager (lifecycle,
                        health checks, reset, snapshot/restore) + web-observation.ts, the shared
                        vocabulary that keeps validators from depending on adapters + db-observation.ts,
                        the same idea for the database family + k8s-observation.ts for the cluster
                        family + posix-observation.ts for the system family + os-observation.ts for the
                        machine family (the fifth, and the third proof that the rule holds - a validator
                        family that needs no core change to exist) + cloud-observation.ts for the
                        provider family (the sixth, and the fourth reason that rule holds, and the one
                        that carries the action vocabulary, the reference grammar and the refusal
                        vocabulary the substitute and the validators share) + container-observation.ts
                        for the runtime family (the seventh, and the fifth reason that rule holds, and
                        the one that carries the reference grammar, the renderings the validators
                        compare and the vocabulary for a command the world refuses) + vscode-
                        observation.ts for the extension-host family (the eighth, and the sixth
                        reason that rule holds, and the one that carries the reference grammar, the
                        renderings the validators compare, the seven simulated surfaces and the
                        vocabulary for a call the world refuses) + api-observation.ts for the HTTP
                        service family (the ninth, and the seventh reason that rule holds, and the
                        one that carries the exchange record, the pointer reader and the renderings a
                        non-browser reading needs - so a family whose world is entirely real still
                        needs no core change) + process-observation.ts for the program family (the
                        tenth, and the eighth reason that rule holds, and the one that carries the
                        two target grammars that family needs - a selector naming a command, a
                        world-relative path naming a file - beside the refusal that decides which
                        spellings of a path leave the world, so a validator family whose world has
                        no socket and no substitute still needed no core change either) + data-
                        observation.ts for the broker family (the eleventh, and the ninth reason
                        that rule holds, and the one that carries the request an application made
                        rather than a document a world holds - the `call`/`probe` pair whose two
                        halves answer opposite questions, and a reference grammar whose nouns fix
                        their own segment counts) + mobile-observation.ts for the handset family
                        (the twelfth, and the tenth reason that rule holds, and the one that carries
                        the register's result vocabulary, so a command the world does not implement
                        is `refused` while a resource it does not hold is `absent`) + the boundary
                        vocabulary (BoundaryPolicy/BoundaryReport) that keeps a declared safety limit
                        from being mistaken for an enforced one. `load.ts` carries each world's plan
                        block into the parsed `EnvironmentPlan`, which makes it the **twelfth**
                        additive place a new world must touch - a place an earlier census of those
                        places missed, so the figure is written down here rather than left to be
                        rediscovered by whoever adds the thirteenth.
core/evidence/          Evidence Engine. Writes the run bundle.
core/run/               Run identity, history, iteration state.
core/memory/            Optional durable memory client (HipCortex). Never required to run.
core/metrics/           M1..M5 as executable measurements over run bundles (metrics.ts is pure
                        functions over a reading; history.ts reads the reading off disk). Not
                        acceptance criteria: no browser can observe "the same code gave the same
                        result twice", so a web contract for these would be a lie.
core/definition.ts      DEFINE end to end: goal + acceptance + environment → a resolved plan.
core/assets.ts          Where Veridian's OWN files live, derived from import.meta.url. One level up
                        is the package root from the source tree and from dist/. Distinct from
                        io.ts, which resolves the OPERATOR's files against the working directory;
                        conflating the two is the defect this file exists to remove.
adapters/local-web/     LocalWebEnvironment — start/health-check/stop/reset a local app, and the
                        lazy Playwright browser port. Playwright is a declared OPTIONAL PEER rather
                        than a dependency, so `npm ci` installs nothing for it and the absence is
                        what the world reports when it cannot observe.
adapters/local-db/      LocalDbEnvironment - build a SQLite file, read it, reset by rebuilding.
                        The second adapter, and the proof that EnvironmentAdapter is a seam rather
                        than a browser harness with an interface bolted on. `database-port.ts`
                        carries the measured facts about `node:sqlite`; the engine is reached by a
                        dynamic `import`, so there is no dependency to install either.
adapters/sim-k8s/       SimK8sEnvironment - the first SIMULATED world, and the first adapter whose
                        substitution is the point rather than a convenience. The application really
                        deploys itself, over a real HTTP control plane it really calls, into
                        namespaces the control plane really holds - and there is no cluster software
                        anywhere in the loop. `cluster-port.ts` is the substitute (its own HTTP
                        surface, so the application cannot tell the difference) and `index.ts` is the
                        front door; the substitution is declared in the plan and in `environment.json`.
adapters/sim-posix/     SimPosixEnvironment - the second SIMULATED world, and the one whose subject
                        is the operating system. A real application process provisions a real tree
                        by printing command vectors on its stdout; the substitute executes them and
                        holds accounts, groups, packages, inodes with modes and owners, units and
                        sockets. No VM, no image, no boot. `posix-port.ts` is the substitute (and
                        `posix-port.test.ts` is 20 tests over it), and `sim-posix-environment.ts` is
                        the adapter, which **refuses by name** a `snapshot-restore` reset it cannot
                        perform rather than silently downgrading it to a restart.
adapters/sim-os/        SimOsEnvironment - the third SIMULATED world, and the one whose subject is a
                        machine rather than a cluster or a system. Same shape as `sim-posix` one
                        family out: the application really provisions, by printing command vectors
                        the substitute really executes, and the substitute holds machine accounts,
                        file modes and ACLs with explicit and inherited entries, package records,
                        registry store entries, service definitions and ports. `os-port.ts` is the
                        substitute, and `sim-os-environment.ts` is the adapter, which declares the
                        five `OS_ENV` names the application reads - a host path this machine can
                        open and the world's own spelling of the same directory, because a program
                        that passed the host path to a `run` step would be refused.
adapters/sim-cloud/     SimCloudEnvironment - the fourth SIMULATED world, and the first whose subject
                        is a remote provider ACCOUNT rather than a container for files. A real HTTP
                        server speaks a provider's own routes over loopback, holds buckets, objects,
                        queues, secrets and principals, and decides every permission question with
                        the account's own evaluator (deny beats allow; an explicit deny beats
                        everything). `cloud-port.ts` is the substitute, `sim-cloud-environment.ts`
                        declares the five `CLOUD_ENV` names the application reads, and the reading
                        carries `simulated` naming each surface that is stood in for. No cloud
                        account, no session, no provider API and no outbound socket. This is the only
                        adapter that performs a `call` step, so a criterion can put its own request
                        to the account rather than infer the account's answer from the application's
                        traffic.
adapters/sim-container/ SimContainerEnvironment - the fifth SIMULATED world, and the one whose
                        subject is a container runtime. The application really provisions, by
                        printing command vectors the substitute really executes, and the substitute
                        holds image records (tags, labels, an image id derived from the layer list)
                        and container records (state, exit code, mounts, published ports, limits,
                        healthchecks, captured output) beside a register of runtime commands
                        answered in process. `container-port.ts` is the substitute and
                        `sim-container-environment.ts` is the adapter, which declares the four
                        `CONTAINER_ENV` names the application reads. It states its own limits rather
                        than hiding them: limits are **declared and never enforced**, an account is
                        **recorded and never switched to**, and a published port is `exposed` and
                        never `reachable`.
adapters/sim-vscode/    SimVSCodeEnvironment - the sixth SIMULATED world, and the first whose
                        subject is an editor's extension API. A real extension is loaded by a real
                        Node process through a module this world resolves in place of `vscode`;
                        every action that needs the extension running starts a fresh host process,
                        and every host process activates the extension, so an activation count is
                        a count of host processes. `vscode-port.ts` is the substitute, holding
                        contributions, commands, invocations, settings, status items, output
                        channels, messages, subscriptions and durable state beside the calls it
                        refuses by name; `sim-vscode-environment.ts` is the adapter, which declares
                        the four `VSCODE_ENV` names the application reads. Its only evidence kind
                        is `json` - there is no page to screenshot - and `snapshot-restore` is
                        refused by name rather than downgraded to a restart.
adapters/local-api/     LocalApiEnvironment - the ninth world, and the first that is NOT simulated
                        at all. It starts a real service as a real child process, waits for the
                        readiness line the service prints on stdout, and then puts the CONTRACT's own
                        requests to it over loopback - so a criterion asks the service directly rather
                        than inferring its answer from the application's traffic, and what it reads
                        back is the real status line, the real headers, the real byte count and a
                        pointer into the real body. `api-port.ts` is the client (the global `fetch`, a
                        timeout, and a client that never throws - a timeout is an observation, not a
                        crash) and `local-api-environment.ts` is the adapter, which refuses a request
                        aimed outside the service's own origin by name. It reuses the sixth world's
                        `call` step and adds none of its own, and it is the one world whose reading
                        carries no `simulated` field at all: nothing is stood in.
adapters/local-process/ LocalProcessEnvironment - the tenth world, and the second that is NOT
                        simulated at all, aimed at a subject with no socket in it. It starts a real
                        program as a real child process, waits for the readiness line the program
                        prints on stdout, and judges the text it printed on stdout and stderr, the
                        code it exited with, a probe of whether it is still up and the files it
                        really wrote under a real directory. `process-port.ts` is the file probe
                        (the seam takes the ACCESSION, never the declaration - the declaration is
                        what the reading records) and `local-process-environment.ts` is the adapter,
                        which declares the three `PROCESS_ENV` names the application reads. It adds
                        no step kind: a contract provisions a tree with the `run` steps the second
                        world introduced. There is no `*_SIMULATED_SURFACES` constant for this world
                        and none is wanted, which is why its reading carries no `simulated` field.
adapters/sim-data/      SimDataEnvironment - the eleventh world and the seventh SIMULATED one, aimed
                        not at a document a world holds but at a REQUEST AN APPLICATION MADE. The
                        application really opens a TCP socket on loopback and really writes a
                        broker protocol into it - length-prefixed frames, a CRC32C over each body,
                        and a version negotiated through `ApiVersions` before anything else is
                        sent - and the substitution and the transport are deliberately on opposite
                        sides of that line: `data-port.ts` holds topics, partitions with their
                        records and offsets, high watermarks and in-sync sets, consumer groups with
                        generations and members, committed positions and a meter, while `wire.ts`
                        decodes and bounds-checks the bytes for real. `protocol.ts` is the register
                        of twelve APIs, and it is the authority on how each is spelled. No broker
                        process, no replica follower, no on-disk log, no group coordinator, no
                        rebalancer and no outbound socket. `sim-data-environment.ts` declares the two
                        `DATA_ENV` names the application reads, of the five it declares. Its only
                        evidence kind is `json`, and it writes two of them per criterion when there
                        was traffic.
adapters/sim-mobile/    SimMobileEnvironment - the twelfth world and the eighth SIMULATED one, and
                        the first whose subject is a handset. A real application process provisions
                        a substitute device by printing command vectors on its stdout, and the
                        substitute holds boot state, installed bundles with their versions,
                        permissions and grants, deep links, notifications, keychain entries and
                        per-bundle log lines, answers a 22-command register in process, really
                        spawns a bundle through `core/process.ts` and applies the launch deadline
                        itself, and refuses by name a path outside both the application's own tree
                        and its sandbox. No emulator, no image and no booted system anywhere in the
                        loop. `mobile-port.ts` is the substitute and `sim-mobile-environment.ts`
                        is the adapter, which declares the four `MOBILE_ENV` names the application
                        reads. It differs from the other `sim-*` ports in four ways its suites
                        state: a command the world does not implement is `refused` while a
                        resource it does not hold is `absent` (`MOBILE_ACTION_RESULTS`),
                        `rebuild()` deliberately keeps `calls` and `escapes` across a reset because
                        the boundary record describes the run rather than the world, a recorded
                        command has its secret flag value **redacted rather than omitted** so the
                        request's shape survives into the bundle, and the reading is
                        `core/environment/mobile-observation.ts`'s `mobile.device`.
validators/playwright/  Playwright web validators (element, visible, value, text, count, url,
                        console.clean, network.ok).
validators/database/    Database validators (table, column, count, value). Judge a reading in
                        core/environment/db-observation.ts, which is what keeps them from importing
                        an adapter. Each declares its own `targetNoun`, so the clarification ladder
                        asks "which table" rather than "which element".
validators/k8s/         Cluster validators (applied, deployment, image, ready, pod, service, event).
                        Judge a reading in core/environment/k8s-observation.ts, on the same rule as
                        the database family - and the reason the third family needed no core change.
validators/posix/        System validators (ran, package, installed, user, file, contents,
                        permission, owner, service, running, port, probe). Judge a reading in
                        core/environment/posix-observation.ts - the fourth family, and the second
                        reason that rule holds. `owner` and `permission` are deliberately different
                        questions, which is why AC-009 exists to prove it.
validators/os/          System validators for a machine (ran, account, setting, file, contents,
                        owner, access, acl, service, running, principal, probe). Judge a reading in
                        core/environment/os-observation.ts - the fifth family, and the third reason
                        that rule holds. The three state questions about one file are split on
                        purpose: `owner` is who holds the object, `acl` is what was written on it
                        and whether each entry is explicit or inherited, and `access` is what one
                        named account may actually do. Three facts with three different repairs, so
                        one validator judging all three would report one defect where there are
                        three.
validators/cloud/       Provider-account validators (bucket, object, tag, policy, access, queue,
                        secret, call, setting, probe, meter). Judge a reading in
                        core/environment/cloud-observation.ts - the sixth family, and the fourth
                        reason that rule holds. The family prints what an operator reads rather than
                        raw JSON: a bucket, an object, a policy and a decision each render to a
                        spelling a failure report can quote. Two of the eleven are distinguished by
                        WHO ASKED, and the names read the way a reader does not expect: `cloud.call`
                        reads the request the **application** made and `cloud.probe` the one the
                        **criterion** made, which is why a criterion's own request cannot be
                        mistaken for evidence about the application. `cloud.call` is not the only
                        validator that makes its own request and the cloud plan is not the only plan
                        that admits the `call` step - `local-api` does too, for the whole of every
                        one of its criteria.
validators/container/   Runtime validators (runtime, image, tag, digest, label, env, state, alive,
                        exitcode, command, user, mount, port, limit, health, logs, stderr, call,
                        probe). Judge a reading in core/environment/container-observation.ts - the
                        seventh family, and the fifth reason that rule holds. It has no new step
                        kind: the application provisions through command vectors printed on its
                        stdout and is acted on with `run`, exactly as `sim-posix` and `sim-os` are.
                        The family prints what an operator reads rather than raw JSON, and the
                        renderings are part of each comparison: `container.limit` compares
                        `(declared, not enforced)` and `container.port` compares `(exposed)`,
                        because a value that omitted them would say a limit held and a port was
                        reachable when neither is true. `container.exitcode` is all lower case,
                        like every validator name in this tree.
validators/vscode/      Extension-host validators (host, identity, engine, activation,
                        contribution, command, invocation, setting, status, output, message, state,
                        subscription, file, refusal, call, probe). Judge a reading in
                        core/environment/vscode-observation.ts - the eighth family, and the sixth
                        reason that rule holds. It has no new step kind: the application provisions
                        by printing command vectors on its stdout and is acted on with `run`, and
                        the two `invoke`/`activate` vectors are how a criterion reaches into the
                        host. Five of the seventeen are targetless - `host`, `identity`, `engine`,
                        `activation` and `message` ask about the world itself - and two of those
                        are the checks that keep the substitution honest: a manifest whose `main`
                        escapes the extension's own directory is refused, and `engines.vscode` is
                        evaluated against the `apiVersion` the document declares.
validators/api/         HTTP-service validators (service, exchange, status, header, body, bytes,
                        json, log). Judge a reading in core/environment/api-observation.ts - the
                        ninth family, and the seventh reason that rule holds. It has no new step
                        kind: every criterion in the world makes its requests with `call`, which the
                        sixth world introduced. Three target grammars live in one family on purpose,
                        because the subjects are different kinds of thing: a bare 1-based position
                        addresses one exchange (`api.status`, `api.body`, `api.bytes`,
                        `api.exchange`), `<position>:<header-name>` addresses one header of one
                        exchange split at the first colon (`api.header`), and
                        `<position>/<json-pointer>` addresses one value inside one body (`api.json`),
                        so a contract can pin `1/WIDGET/unitPriceCents` without a deep comparison of
                        the whole document. `api.log` reads what the service printed on stdout or
                        stderr, which is the one part of a service's behaviour no response carries.
validators/process/     Program validators (host, probe, argv, state, exitcode, run, stdout,
                        stderr, file, kind, contents, size). Judge a reading in
                        core/environment/process-observation.ts - the tenth family, and the eighth
                        reason that rule holds. It has no new step kind: a criterion acts in the
                        world with `run`, and a program's own output is read as a stream. Its family
                        was the first asked two different kinds of question - the eleventh world's
                        is the second - so it carries two target
                        grammars and the *validator* chooses between them rather than the spelling:
                        a target naming a command is `app` (the program the world started) or a
                        bare 1-based position (the criterion's own `run` steps, which is why
                        `commandAt` is index-free for `app` and index-based for a position - the
                        program is the same program in every criterion, while "the second command"
                        is a fact about *this* criterion), and a target naming a file is a
                        world-relative path. A path that leaves the root is refused by
                        `processPath` - a leading separator, a drive letter, and a `..` that pops
                        past the root - and the adapter records the refusal as a boundary crossing
                        rather than reporting a missing file, because a resource that is absent and
                        a place that is out of bounds are two different observations. `process.file`
                        and `process.contents` read their target as a place and `process.exitcode`
                        reads its target as a selector, so neither can misread the other's
                        spelling.
validators/data/        Broker validators (node, topic, layout, partition, record, key, value,
                        group, member, commit, call, probe, meter). Judge a reading in
                        core/environment/data-observation.ts - the eleventh family, and the ninth
                        reason that rule holds. It has no new step kind: a criterion acts in the
                        world through a `run` step, and one of them expects the world to **refuse**
                        it rather than resolve it. Two of the thirteen are distinguished by WHO
                        ASKED, and the pair inverts the way a reader does not expect: `data.call`
                        reads the requests the **application** put to the broker and `data.probe`
                        the requests the **criterion** issued, so a contract cannot earn its own
                        pass with a request it made itself - and one criterion exists precisely to
                        depend on the two disagreeing, because the application's `CreateTopics` for
                        two fresh topics reads `ok` while the criterion's own for a topic the world
                        already holds reads `refused`. It carries two target grammars on purpose,
                        one per kind of question: a topic-shaped reference is split on `/` and each
                        noun fixes its own segment count (`cart-events`, `cart-events/0`,
                        `cart-events/0/2`, `cart-indexer`, `cart-indexer/member-1`,
                        `cart-indexer/cart-events/0`), with every other spelling refused and told
                        the count it wanted, while `data.call` and `data.probe` take an API name as
                        `protocol.ts` spells it and `data.meter` names a counter. `data.layout`
                        compares the topic's whole rendering, which carries the world's own limit
                        inside the value it compares - `replication 1 recorded` beside `isr [1]` -
                        because a substitute that is honest about its boundary has to carry that
                        honesty into the comparison rather than beside it.
validators/mobile/      Handset validators (device, os, screen, orientation, bundle, installed,
                        permission, deeplink, notification, logs, call, probe). Judge a reading in
                        core/environment/mobile-observation.ts - the twelfth family, and the tenth
                        reason that rule holds. It has no new step kind: the application provisions
                        through command vectors printed on its stdout and is acted on with `run`.
                        Five of the twelve are targetless - `device`, `os`, `screen`, `orientation`
                        and `installed` ask about the world itself. `mobile.deeplink` is spelled
                        without a hyphen because a validator name has to match
                        `^[a-z0-9]+(\.[a-z0-9]+)+$`, and `mobile.call` reads the requests the
                        **application** put to the device while `mobile.probe` reads the ones the
                        **criterion** issued - the same inversion `cloud.call`/`cloud.probe` and
                        `data.call`/`data.probe` carry.
cli/                    The interface that exists today: arguments, support, worlds.ts (the adapter
                        register and the requirements each adapter declares), veridian.ts.
schemas/                goal/acceptance/environment/run/result/ambiguity .schema.json - the
                        machine-readable contracts.
examples/shopping-cart/ The canonical demo: correct app + a run-time defect overlay + the goal,
                        contract and environment it is judged by.
examples/inventory-db/  The second demo, and the one that carries the argument: the same lifecycle,
                        verdict rules, evidence bundle and repair protocol against a world with no
                        process, no socket, no page and no console.
examples/sim-k8s/       The third demo, and the first simulated one: the application deploys itself
                        into a substitute control plane and is judged on what the substitute holds.
                        Two defects, ten criteria, and the world's composition recorded so a PASS is
                        traceable to a named substitute rather than to unexamined reality.
examples/sim-posix/     The fourth demo, and the first whose subject is an operating system: the
                        application provisions a substitute Linux system and is judged as a named
                        account. Four defects, thirteen criteria, one of which acts in the world
                        through a `run` step and one of which expects the world to **refuse** it.
examples/sim-os/        The fifth demo, and the same shape one family out: the application
                        provisions a substitute Windows system and is judged as `svc-audit` - an
                        account the loader refuses to let be `SYSTEM`, because an administrator
                        reads every file and a hardening contract judged as one is vacuous. Four
                        defects, seventeen criteria, with the same `run` step and the same expected
                        refusal. The `windows` family is declared, and the application **refuses**
                        any other family by name rather than adapting to it.
examples/sim-cloud/     The sixth demo, and the fourth simulated one: the application provisions a
                        remote provider account over routes it really calls, and is judged on the
                        resources that account holds. Four defects, twenty-seven criteria, one of
                        which acts in the world through a `call` step. Two identities matter and they
                        are not the same one: `cloud.principal` is who the application runs as, and
                        `svc-reader` is a reader account the program itself creates.
examples/sim-container/ The seventh demo, and the fifth simulated one: the application provisions
                        images and containers in a substitute runtime and is judged on the records
                        that runtime holds. Four defects, twenty-seven criteria, one of which acts
                        in the world through a `run` step and two of which expect the world to
                        **refuse** them. Three of the four defects are read by exactly one criterion
                        each, and are therefore the controls the fourth is read against - the fourth
                        is a one-character misspelling of a bind mount's source that moves **seven**
                        readings, which is what makes it the demo that shows one edit to a world is
                        never one fact.
examples/sim-vscode/    The eighth demo, and the sixth simulated one: a real extension is loaded by a
                        substitute extension host and judged on what that host recorded while it
                        ran. Four defects, twenty-three criteria, two of which act in the world
                        through a `run` step and one of which expects the world to **refuse** it.
                        Each defect is filed against exactly one criterion - the state the
                        extension kept, the line it logged, the message it showed and the status
                        item it wrote - and the defects are repaired in criterion order, so the
                        failing count descends `4 -> 3 -> 2 -> 1 -> 0`.
examples/local-api/     The ninth demo, and the first whose world is entirely REAL: a real service
                        is started and judged through its own HTTP interface over loopback, with no
                        page, no substitute and nothing rendered. Four defects, eight criteria, and
                        the same FAIL -> repair -> PASS loop. D2 and D3 are the controls - each is
                        read by exactly one criterion, so a reader watches one edit move one reading
                        before watching D1 move two (`AC-002` and `AC-003`) and D4 move two (`AC-006`
                        and `AC-007`). `AC-001` and `AC-008` never move at all, which is what says
                        the other six moved because of the edits rather than because the world is
                        flaky. Measured progression: `6 -> 4 -> 3 -> 2 -> 0` over five iterations.
examples/local-process/ The tenth demo, and the second whose world is entirely REAL - and the
                        first whose subject is a program rather than a page, a file of rows or a
                        service. Four defects, nine criteria. D2, D3 and D4 are the controls, each
                        read by exactly one criterion, so a reader watches one edit move one
                        reading; D1 then moves **three** at once (a release version constant the
                        program prints in its build summary, again in its verifier's summary and
                        again inside the manifest it writes - three separate true consequences of
                        one edited constant), and `AC-002`, `AC-007` and `AC-009` never move at all.
                        Its repair agent walks the table in array order, so the failing count
                        descends `6 -> 3 -> 2 -> 1 -> 0` over five iterations - the figures are the
                        run's own, and the demo's narration asserts them.
examples/sim-data/     The eleventh demo, and the seventh simulated one: the application opens a
                        real TCP socket on loopback and really writes a broker protocol into it, and
                        is judged on the topics, partitions, records, groups and committed offsets
                        the substitute holds. Four defects, twenty criteria. D1 (a cleanup policy),
                        D2 (the same error on the second topic) and D4 (a committed position one
                        short) are the controls, each read by exactly one criterion, so a reader
                        watches one edit move one reading; D3 then moves **two** at once, because one
                        release constant is printed in the four record payloads `AC-011` compares and
                        again in the checkpoint payload `AC-015` compares. The failing count
                        descends `5 -> 4 -> 3 -> 1 -> 0` over five iterations - read off the run's
                        own `iterations`, where the failing criteria per iteration are
                        `[AC-004, AC-005, AC-011, AC-014, AC-015]` then `[AC-005, AC-011, AC-014,
                        AC-015]` then `[AC-011, AC-014, AC-015]` then `[AC-014]` then none. D4 is the
                        defect this world exists to make observable: the pipeline delivers three
                        orders and commits `2`, so every record is correct, the log is complete, and
                        the one thing wrong is where the group will resume - a fact no record in the
                        data states, which is why the reading had to be about the request.
examples/vscode-cockpit/ The twelfth demo, and the only one whose application is Veridian's own
                        client. It adds NO world: it runs the same `sim-vscode` substitute the eighth
                        demo uses, unchanged, and is separate because the application is different in
                        the one way that matters - it stages the real compiled Cockpit (the
                        manifest's own `files` allowlist, copied out of the manifest rather than
                        restated) into its app tree and judges that. It exists to separate two claims:
                        "the tests passed" and "the thing works". The Cockpit's 72-test suite was
                        green before and after the two defects this world found, because both were in
                        `vscode-port.ts` - the one file adapting the real editor API, and therefore
                        the one file a double of that API cannot falsify. Eleven criteria. Measured
                        against the published `0.2.1`: D1 (a discarded promise in `registerCommand`)
                        moves **exactly** `AC-008`, D2 (no shape check on an opened document) moves
                        **exactly** `AC-010`, and both repaired gives `PASS (COMPLETED, 1
                        iteration(s))` 11/11, exit 0. It is the one demo that needs a build product,
                        so it **refuses by name** when `extension/vscode/out` is absent, naming
                        `npm run build`, rather than skipping - a skipped check reports a green
                        suite. Its staged tree and its sandbox are both generated and ignored, and
                        `vscode.identity` pins the version in the manifest it stages, so a version
                        bump moves that expectation in the same pass.
examples/sim-mobile/    The thirteenth demo, and the eighth simulated world: the app provisions a
                        substitute handset through commands it really issues, and is judged on the
                        bundles, permissions, deep links, notifications, keychain entries and log
                        lines that device holds. Four defects, twenty-five criteria, three of which
                        act in the world through a `run` step and one of which expects the world to
                        **refuse** it. Three of the four defects are the controls, each read by
                        exactly one criterion; the fourth spells a release constant that is printed
                        both in the bundle the device holds and in the notification body, so one
                        edit moves **two** readings. The failing count descends
                        `5 -> 4 -> 2 -> 1 -> 0` over five iterations.
examples/defect-text.ts One implementation of the CRLF rule for a textual overlay on a source file.
                        Two demos injecting defects is two chances to teach the rule differently;
                        a third copy is where the rule gets broken.
Dockerfile              A DISTRIBUTION route, not a sandbox environment. Built and run in CI,
                        because this machine has no container runtime and an unbuilt
                        Dockerfile is a claim.
tsconfig.build.json     The build config. The base config is noEmit; this one emits to dist/ and
                        rewrites the .ts import specifiers to .js.
dist/                   GENERATED by `npm run build`. Never edited, never committed, and never
                        the way you run the code - the source is still the interface.
acceptance/             Veridian judged by Veridian: `veridian-mvp.yaml` (the goal),
                        `acceptance.yaml` (7 criteria, judged by the `local-process` family) and
                        `environment.yaml`. Driven by `scripts/acceptance.mjs` through
                        `npm run acceptance`, which runs the contract TWICE - a first run that passes
                        and a second that fails is the signature of a world a run *inherited* rather
                        than *built*. It is deliberately not a `demo:*` script: a demo shows a defect
                        found and repaired, and this contract is observed once with `--no-repair`,
                        because the application it judges is the CLI itself and there is nothing to
                        repair.
                        It has **no `*-demo.test.ts` of its own**, and that asymmetry is deliberate
                        rather than an omission. The thirteen demo suites hold properties of a defect
                        table - the `correct` block present exactly once in the shipped program, the
                        criterion a defect is filed against, the progression the table predicts - and
                        a contract with no defects has none of those. What actually matters here is
                        held by *executing* it, which a CI job does, and the one property execution
                        cannot state is held by the fourth roster in `tests/demo-rosters.test.ts`:
                        that this route is named in the manifest, in both documents and in the
                        workflow, and that its step is ordered above the demo loop.
tests/                  Veridian's own tests (+ fixtures/helpers). See the tests instruction below.
scripts/                Bootstrap scripts that must run before anything is type-checked, beside
                        `acceptance.mjs` - the runner for the contract above, which lives here
                        because it is a script `package.json` names rather than a bootstrap step.
docs/                   Design documents. Indexed below.
```

Also at repo root: `README.md`, `AGENTS.md` (this file), `LICENSE` (BSD 2-Clause), `package.json`,
`tsconfig.json`, `.nvmrc`, `.gitignore`, and `.vscode/` (the two files the Cockpit's F5
development-install route needs, kept as plain JSON so a parser can check them). **`README.md` is the front door** - the first thing a reader opens - and this file is
the hand-off to the next agent. They answer different questions: the README says what Veridian is and
how to see it work, this file says how to change it without breaking a rule it paid for. When a change
alters what the README claims - a command, an exit code, quoted output - correct the README in the
same pass, because a README that describes a command that no longer behaves that way is the same
defect as a validator that reports a pass it did not observe.

**There is now an `acceptance/` directory, and it took eleven worlds before one could be written.**
`docs/IMPLEMENTATION-PLAN.md` §5 and step 9 of its execution order call for
`acceptance/veridian-mvp.yaml` - Veridian judged by its own tool. It could not be written inside the
MVP, and the finding was recorded rather than the attempt quietly dropped: at the time, the only
registered adapter was `local-web` and all eight registered validators were browser observations, so a
contract about a CLI would have made every criterion `INCONCLUSIVE` and exited 2 - the same defect as
`--browser none` on the canonical demo.

**That reason is spent, and the directory is what says so rather than a paragraph claiming it.** Twelve
adapters are registered, eleven of them need no browser - `local-web` is the only one that drives one -
and `local-api`, `local-process` and `sim-data`
are precisely the "non-web adapter" this file once said the scope boundary forbade building
speculatively - they were not built speculatively, they were built because a world whose subject is an
HTTP contract is inside the boundary, a world whose subject is a program is too, and a world whose
subject is a request an application made is inside it as well, and once `local-api` existed a
non-browser contract about a program became expressible. So `acceptance/veridian-mvp.yaml` is written,
its seven criteria are judged by the `local-process` world, and `npm run acceptance` runs it.

**Two runs, not one, and the second run is the check.** `scripts/acceptance.mjs` invokes the contract
twice, requires both to be `PASS`, and exits 1 naming the cause when they disagree. A single run on a
fresh checkout would pass over a world that never rebuilt at all: `#rebuild` in
`adapters/local-process` empties the sandbox when the world is *created*, so run 1 starts clean
everywhere, and run 1 leaves its own `config.yaml` behind because nothing removes the tree at the end
of a run - only at the start of the next one. *A world a run inherits is not a world that run built*,
and this is the second time this repository has paid for that rule. The check was falsified rather than
trusted: blowing away `#rebuild` gives `run 1: exit 0 - PASS / run 2: exit 1 - FAIL`, with `AC-002` and
`AC-003` each naming the exit code of a command that answered 3, and the adapter was then restored byte
for byte.

**It is not a `demo:*` script, and the prefix would have been a lie.** A demo shows a defect found and
repaired; this contract has `maxIterations: 1` and is observed once with `--no-repair`, because the
application under it is the CLI itself and there is nothing to repair. Borrowing the prefix would have
enrolled it in three checks that a false statement satisfies - *every declared demo is run by a CI job*,
*README.md lets a reader run every declared demo*, and the roster guard that holds both - so
`tests/demo-rosters.test.ts` holds a roster of its own for it, across the four places that name it:
`package.json`, `README.md`, `AGENTS.md` and `.github/workflows/ci.yml`.

`.veridian/` is created at runtime and is not committed.

### Persistence on disk

Veridian state lives under `.veridian/` — filesystem-first, so it stays portable, debuggable,
Git-friendly, and independently inspectable:

```
.veridian/
├── config.yaml
├── environments/
├── goals/
├── runs/
│   └── <run-id>/
│       ├── goal.yaml
│       ├── acceptance.yaml
│       ├── environment.json
│       ├── execution.log
│       ├── result.json
│       ├── artifacts/AC-00N.observation.json
│       ├── artifacts/repair-<iteration>.log
│       ├── screenshots/AC-00N.png
│       └── trace/AC-00N.zip
└── snapshots/
```

**A `trace` artifact reports `bytes: null`, and that is a contract rather than a gap.** The archive is
declared when the criterion is observed, but Playwright writes it when the page closes, so its length
does not exist yet at declaration time; the adapter records `null` rather than a guess. The *path* is
derived once and used for both the bundle's spelling and the OS's, so the file the bundle names is the
file on disk - which is the property a reader needs, because a size can be read from the filesystem
and a wrong size cannot be detected from the bundle at all. One trace per criterion, not one per run:
the file is a recording of that criterion's actions, and `tests/local-web-environment.test.ts` holds
the path.

**`artifacts/repair-<iteration>.log` is the only file in the bundle that is not evidence about the
application.** It is the *actor's* own output - the repair command's stdout, stderr, command line, exit
code and working directory - written before the run acts on its answer, so an external agent can read
whoever repaired the code while the run is still going. It is keyed by iteration rather than named once
because the bundle is last-write-wins per path and a second repair would otherwise overwrite the first
attempt's explanation. Nothing in the verdict reads it; a repair is believed only once the criteria are
re-observed from a clean world, which is why it is safe to store verbatim.

`.veridian/latest-result.json` and `.veridian/latest-failure.md` are the Level-2 agent feedback
artifacts — an external agent reads them to learn what failed without Veridian having to drive it.
