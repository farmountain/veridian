---
name: hipcortex-memory
description: 'Read and write durable cross-session memory in HipCortex for the Veridian repo. Use when answering questions about project state, prior decisions, architecture, or bugs, and after any decision, bug fix, or architectural finding. Covers recall/search, ingest/add, memory correction, confidence and priority rules, forget/GDPR, and the intent/receipt rule for environment observations.'
argument-hint: '[remember|recall|latest|update|forget|stats] <text>'
---

# HipCortex Memory — Veridian

Durable memory that survives session and context-window loss. Treat it as the project's
authoritative record of *why* things are the way they are.

- **Server:** `http://127.0.0.1:3030` (override with `HIPCORTEX_URL`; managed: `https://hipcortex.fly.dev`)
- **Actor for this repo:** `Veridian`
- If the server is unreachable, tell the user to run `hipcortex start`. Never silently skip a write.

## When to use

**Read first, before answering** anything about project state, architecture, decisions, or bugs:

- "Why did we choose X?" · "What's our plan for Y?" · "Have we hit this bug before?"

**Write after** every:

- decision or architectural choice (including the condition that would overturn it)
- bug fix, with the root cause — not just the symptom
- reversal or dead end (these are the highest-value records: they stop the next session repeating them)
- non-obvious environment/workflow finding

## Procedure

1. **Recall.** `search_memory` (keyword) or `get_live_beliefs` (current state). Prefer
   `get_live_beliefs` for project-state questions; it merges symbolic facts, hypotheses, and
   world-model predictions. If the substrate is empty on the topic, say so rather than guessing.
2. **Act.** Do the work. Use `reflect` when a decision is genuinely uncertain — it samples
   hypotheses with confidences from existing context.
3. **Store.** `add_memory` with a self-contained target, or `/memory/ingest` for
   auto-classification. Prefer `ingest` unless you need precise field control.
4. **Correct, don't duplicate.** If a stored fact is wrong, update that record in place
   (step 5 below) instead of adding a contradicting one.

## Writing records

Use `ingest` (recommended) for free text:

```
POST /memory/ingest {"text": "Decided to use Postgres because ...", "actor": "Veridian"}
```

Use `add_memory` / `/memory/add` when you need control over the fields:

```
POST /memory/add {
  "actor": "Veridian",
  "action": "decided",
  "target": "<what to remember — self-contained, no pronouns>",
  "record_type": "Symbolic",
  "confidence": 0.9,
  "priority": "high",
  "tags": ["architecture"]
}
```

**The `target` must stand alone.** A record read six months from now has no conversation
around it — name the module, the alternative rejected, and the reason.

### Confidence

| Value | Use for |
|-------|---------|
| `1.0` | Verified, user-provided fact (default) |
| `0.7` | Agent inference |
| `0.3` | Speculation / unvalidated hypothesis |

### Priority

| Value | Use for |
|-------|---------|
| `pinned` | Hard constraints and safety rules. Always returned, bypasses decay. |
| `high` | Decisions and architecture. |
| `normal` | Default. |
| `low` | Transient context, fades faster. |

Pair `low` priority with `ttl_seconds` for scratch state that should expire.

### Tags

Tag for retrieval filtering, e.g. `["architecture"]`, `["bugfix","auth"]`, `["decision"]`.
Keep the vocabulary small — reuse existing tags rather than inventing synonyms.

## Correcting a wrong memory

1. Find it: `search_memory` / `GET /memory/search-flat?query=<topic>` → note the record `id`.
2. Update in place: `PATCH /memory/update/<id>` with `{"target": "<correct text>", "confidence": 1.0}`.
3. Confirm to the user: `✓ Memory corrected (version N)`.

Do not "fix" a wrong record by adding a second one — that leaves both in retrieval results.

## Environment observations

Observations of the outside world (file reads, command output, API responses) are **not**
memories to hand-write. They go through the intent/receipt seam so the substrate records them
as observed contacts:

1. `open_intent` against the entity being probed (`filesystem`, `api_gateway`, …)
2. run the probe
3. `accept_receipt` with the observation and the open `intent_id`

Using `add_memory` for these corrupts the grounding model. Use it only for decisions and findings.

## Slash commands

| Command | Action |
|---------|--------|
| `/hipcortex remember <text>` | `POST /memory/ingest` |
| `/hipcortex recall <query>` | `GET /memory/search-flat?query=<query>` |
| `/hipcortex latest <topic>` | `GET /memory/latest?actor=Veridian&action=<topic>` |
| `/hipcortex update <id> <text>` | `PATCH /memory/update/<id>` |
| `/hipcortex forget <actor>` | `DELETE /memory/forget/<actor>` (GDPR erasure) |
| `/hipcortex stats` | `GET /stats` |

Also available: `POST /memory/consolidate?actor=Veridian&threshold=0.8&dry_run=true` to find
near-duplicates before they accumulate, and `GET /memory/query?as_of=<ISO8601>&actor=Veridian`
for audit ("what did we know on date X?").

## Pitfalls

- **Answering from the context window when memory was consulted and returned nothing.**
  Report "no prior record" explicitly — silence reads as confirmation.
- **Storing symptoms.** "Fixed the parser" is useless next session. "Parser crashed because
  `split()` on a CRLF file left `\r` in the token; fixed by normalising line endings at read"
  is useful.
- **Storing without tags or actor.** Untagged records fall out of filtered searches.
