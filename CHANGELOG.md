# Changelog

All notable changes to Veridian are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses semantic versioning.

## Unreleased

### Fixed

- **`local-process` judged the runtime's own diagnostics as the application's output.** Node's
  `SecurityWarning` lines were captured into the application's stderr stream, so a criterion that
  asserted "this wrote nothing to stderr" failed against a program that wrote nothing. The
  observation layer now separates the runtime's diagnostics from the program's stream
  (`core/environment/process-observation.ts`).

### Known limitation

- **Four worlds require Node 22 today.** `local-api`, `sim-k8s`, `sim-cloud` and `sim-data` stand a
  real server on loopback; Node 24+ enforces the network permission, so `--permission` without
  `--allow-net` refuses every socket and those worlds report `environment INVALID`. The fix is
  understood (`ConfinementRequest.network` carried into `--allow-net`), but it changes what the
  bundle reports for the network boundary and therefore moves the tests that hold that vocabulary.
  Until it lands, run those worlds on the version `.nvmrc` pins.

### Added

- `PRICING.md`, `SUPPORT.md`, `SECURITY.md` and issue templates: the commercial surface that was
  missing rather than the code that was.

## 0.6.1

### Fixed

- The Cockpit archive catches up to its source: the shipped `.vsix` matches the extension in the
  tree.

## 0.6.0

### Added

- Run history becomes a twin: a recorded run can be replayed as a world.

## 0.5.0

### Added

- The Level-3 MCP surface: eight tools over `mcp/server.ts`.
- One description across every channel — README, package metadata and CLI help agree.
