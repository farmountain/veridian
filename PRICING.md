# Pricing

Veridian is a BSD-2-Clause CLI. You can use it, fork it, and ship it inside a commercial product for
nothing. This page is what is **for sale**, which is not the same thing as what is licensed.

Nothing here is an established price. These are the offers being tested with the first buyers, and
they will move when a buyer says they are wrong.

---

## 1. Validation pilot — the main offer

**What the buyer hands over:** one repository, one goal — "prove that the thing our agent produces
actually works before it merges".

**What they get back, in 2 weeks:**

1. A goal file for their application, written against their real acceptance criteria, in the
   repository's own format.
2. A working `veridian validate` run in their CI, with a failing-then-passing pair of runs in the
   evidence bundle as the demonstration that the criterion is load-bearing rather than decorative.
3. A written report of what the sandbox could and could not observe, including the boundaries it
   does not hold.
4. Their engineer walked through the bundle format so they can read a run without me.

**Price:** an engagement fee of **SGD 6,000–9,000** for the two weeks, depending on the number of
criteria and whether a new adapter is needed. Fixed scope, fixed price, paid on completion of the
four deliverables above. No retainer, no per-seat.

**Not included:** writing their acceptance criteria for them, making their agent smarter, fixing
their application.

---

## 2. Support subscription — after a pilot

**SGD 1,500 / month**, month-to-month, cancel any time.

- 1-business-day response to a blocking defect, 3-business-day fix or workaround (see
  [SUPPORT.md](./SUPPORT.md)).
- Priority on adapter work for their stack.
- A quarterly written review of what their runs observed — the failure taxonomy across runs, which
  criteria are load-bearing, which are never exercised.

**Why this instead of a licence key:** the code is BSD-2. A licence check inside a BSD-licensed CLI
is the first thing a buyer's counsel removes, and it would break the fork-and-vendor promise that
makes the tool safe to adopt. The thing that is genuinely scarce is the author's time.

---

## 3. What is free, permanently

- The CLI, all twelve worlds, the VS Code Cockpit, the MCP surface.
- The evidence bundle format and the JSON schemas.
- Bug reports and public answers.

---

## 4. Why these numbers

They are calibrated to be small enough that a platform lead can approve them without procurement,
and large enough to prove someone will pay at all. The first goal is not revenue; it is one signed
pilot and one customer reference. A price that is easy to say yes to is worth more right now than a
price that is correct for a company that does not yet exist.

**Contact:** open an issue titled `pilot: <company>` or email the address in `package.json`.
