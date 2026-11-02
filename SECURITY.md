# Security policy

## Supported versions

Only the latest published minor version receives fixes. `veridian` is a developer tool that runs
on your machine; it is not a hosted service, so there is no server-side surface to patch.

| Version | Supported |
|---|---|
| 0.6.x | yes |
| < 0.6 | no |

## Reporting a vulnerability

Open a private security advisory on this repository (Security → Advisories → New draft advisory).
Do not open a public issue for a suspected vulnerability.

Include: the version (`veridian --version`), the platform and Node version, the smallest goal file
that reproduces it, and what you expected the sandbox boundary to do.

You will get an acknowledgement within **3 working days** and a decision within **10 working days**.
If a fix is warranted it ships in the next minor release with credit, unless you ask not to be named.

## What counts as a vulnerability here

Veridian executes code that a model wrote. The interesting failures are therefore boundary
failures, not memory bugs:

- **Confinement escape.** A child process reaching a path, socket or child it was not granted under
  `confinement` in the plan, or a run whose `environment.json` reports a boundary as `enforced`
  when the runtime did not hold it.
- **Evidence forgery.** A run whose `PASS` can be produced without the criteria being observed —
  for example by writing `result.json` directly, or by a validator that reports `PASS` on missing
  evidence rather than `INCONCLUSIVE`.
- **Reset failure.** State surviving a reset into the next iteration, so a later `PASS` is a
  statement about contaminated state.
- **Secret leakage into a bundle.** A credential from the operator's environment appearing in
  `execution.log`, `environment.json`, an artifact or a screenshot.

## What this policy does not cover

- A goal file that names a path outside its own application directory: that is refused by the
  adapter by design and recorded as a boundary crossing, not a vulnerability.
- The behaviour of code the agent wrote inside the sandbox. Veridian reports it; it does not
  vouch for it.
- Denial of service against your own machine by a goal you wrote and ran.

## Known limitation, stated rather than hidden

Node's permission model has two network states — every socket or none — and no way to name an
origin. Worlds whose subject is a socket (`local-api`, `sim-k8s`, `sim-cloud`, `sim-data`) declare
`networkPolicy: allow` and their bundle therefore reports the boundary as `not-requested` rather
than `enforced`. That is accurate. A world that does not need a socket leaves the network denied by
the runtime, which on Node 24+ is a real guard and on Node 22 was inert.
