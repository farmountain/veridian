# Support

## The short version

Veridian is BSD-2-Clause software. It ships with no warranty and no guaranteed response. Paid
support exists because "no guaranteed response" is not good enough when the tool gates your CI —
see [PRICING.md](./PRICING.md).

## Free support (community)

- **Bug reports:** open an issue with the template. Include the `veridian --version`, the Node
  version, the goal file, and `.veridian/latest-failure.md` from the failing run. A report without
  the failure report is answered with a request for it.
- **Questions:** open a discussion. Answered when there is time, in public, so the next person
  finds it.
- **Security issues:** do **not** open an issue — see [SECURITY.md](./SECURITY.md).

## Paid support (pilot customers)

Included in a paid pilot, see [PRICING.md](./PRICING.md):

| Item | Commitment |
|---|---|
| Response to a blocking defect | 1 business day |
| Fix or written workaround for a blocking defect | 3 business days |
| Weekly 30-minute call during the pilot | included |
| Direct channel (email, not an issue tracker) | included |
| Named engineer | me, the author |

## What is not supported

- Goals that call out to a third-party service that has changed its API. Veridian reports what it
  observed; it does not chase someone else's breaking change for free.
- Producing a `PASS` for code that does not pass. If a criterion is wrong, the fix is a criterion.
- Running on a Node version outside `engines` in `package.json`. It may work; it is not covered.

## Where the answer usually is

1. `.veridian/latest-failure.md` — the failure taxonomy plus the per-criterion `expected`/`actual`.
2. `veridian get-failure <run-id>` — the same thing for a specific run.
3. `docs/BUILD-AND-TEST-COMMANDS.md` — the exact commands this repository runs in CI.
