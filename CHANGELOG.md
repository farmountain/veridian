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
- **Four worlds failed on Node 24+ because the network permission is enforced there.** `local-api`,
  `sim-k8s`, `sim-cloud` and `sim-data` stand a real server on loopback; `--permission` without
  `--allow-net` refused every socket, so `environment INVALID — no criterion is a measurement`.
  Confinement now carries a network dimension (`ConfinementRequest.network`), and these four goals
  declare `networkPolicy: allow`, which makes their bundle report the boundary as `not-requested`
  rather than `enforced`. On Node 22 the flag was inert and the bundle was wrong; on Node 24+ both
  the flag and the report are true.

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
