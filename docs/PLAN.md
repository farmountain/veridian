# Veridian — Implementation Plan

> **Naming:** This document was originally written under the project name **AVF — Agent Validation
> Fabric**. The project has been renamed to **Veridian**. The body below still says "AVF" in
> places; read it as **Veridian**. The canonical statements are:
>
> - *Veridian is the sandbox testing and validation layer for AI coding agents.*
> - *The environment is the product. The agent is a client of the product.*
> - *Do not build the intelligence that creates the software. Build the world that determines
>   whether the software actually works.*

## Universal Testing & Validation Environments for AI Coding Agents

---

# 1. Product Definition

## 1.1 What we are building

AVF provides AI coding agents with reproducible environments in which their generated software can be:

1. deployed,
2. executed,
3. interacted with,
4. observed,
5. tested,
6. validated against explicit acceptance criteria,
7. reset,
8. rerun,
9. and accompanied by machine-verifiable evidence.

### Core statement

> **AVF is the sandbox testing and validation layer for AI coding agents.**
> The agents remain external.

AVF does not attempt to replace:

- Claude Code
- Cursor
- GitHub Copilot
- Codex
- Gemini
- other coding agents

AVF gives these agents a **real, isolated and reproducible world in which their work can be tested**.

---

# 2. The Fundamental Architecture

The architecture must remain centered on:

```
                 EXTERNAL AI AGENT
        ┌────────────────────────────────┐
        │ Claude Code                    │
        │ Cursor                         │
        │ Copilot                        │
        │ Codex                          │
        │ Gemini                         │
        └───────────────┬────────────────┘
                        │
                 code / actions
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│                       AVF                            │
│                                                      │
│  ┌──────────────┐      ┌──────────────────────────┐ │
│  │ Environment  │      │ Validation Engine        │ │
│  │ Manager      │      │                          │ │
│  └──────┬───────┘      │ deterministic validators │ │
│         │              │ evidence collection      │ │
│         ▼              └────────────┬─────────────┘ │
│  ┌───────────────────┐              │               │
│  │ Sandbox Adapters  │              │               │
│  │                   │              │               │
│  │ Web               │              │               │
│  │ Linux             │              │               │
│  │ Windows           │              │               │
│  │ macOS             │              │               │
│  │ Android           │              │               │
│  │ iOS               │              │               │
│  │ Docker            │              │               │
│  │ VM / MicroVM      │              │               │
│  │ Kubernetes        │              │               │
│  │ Database          │              │               │
│  │ Data Platform     │              │               │
│  │ Cloud             │              │               │
│  └────────┬──────────┘              │               │
│           │                         │               │
│           ▼                         ▼               │
│      REAL SYSTEM                PASS / FAIL        │
│                                  + EVIDENCE         │
└──────────────────────────────────────────────────────┘
```

The most important architectural rule is:

> **The environment is the product. The agent is a client of the product.**

---

# 3. What AVF Must NOT Become

This is a hard scope boundary.

AVF must not become:

```
❌ AI coding agent
❌ agent orchestration framework
❌ autonomous software development platform
❌ replacement for Claude Code
❌ replacement for Cursor
❌ replacement for Copilot
❌ CI/CD platform
❌ generic test framework
❌ browser automation framework
❌ Kubernetes management platform
❌ cloud deployment platform
❌ LLM framework
```

AVF may integrate with all of those.

It must not compete with them.

---

# 4. The Core Problem

Current coding agents are very good at producing code but have an environmental problem.

They may need to determine whether their code actually works across:

```
Web
Desktop
Mobile
Operating systems
APIs
Databases
Message queues
Data pipelines
Containers
Kubernetes
Cloud infrastructure
Security boundaries
Network conditions
Failure conditions
```

A coding agent therefore needs something equivalent to a **digital laboratory**.

AVF provides that laboratory.

---

# 5. Universal Execution Model

Every AVF environment follows the same lifecycle.

```
DEFINE
   ↓
CREATE
   ↓
START
   ↓
DEPLOY
   ↓
EXECUTE
   ↓
OBSERVE
   ↓
VALIDATE
   ↓
COLLECT EVIDENCE
   ↓
PASS / FAIL
   ↓
RESET
   ↓
REPEAT
```

The abstraction is deliberately simple.

## Environment interface

Conceptually:

```
EnvironmentAdapter

create()
start()
deploy()
execute()
observe()
snapshot()
restore()
reset()
stop()
destroy()
```

The actual implementation language/API can evolve.

The critical point is that **all environments expose the same lifecycle semantics**.

---

# 6. Universal Validation Model

Validation must be separated from environment execution.

```
Environment
      │
      ▼
Observation
      │
      ▼
Validator
      │
      ▼
ValidationResult
```

Conceptually:

```
Validator

validate(
    criterion,
    observation
) → ValidationResult
```

A result must contain at least:

```
criterion_id
status
actual
expected
timestamp
evidence
environment_id
run_id
```

Possible status:

```
PASS
FAIL
ERROR
SKIPPED
INCONCLUSIVE
```

Important:

> **INCONCLUSIVE is not PASS.**

---

# 7. Acceptance Criteria Are the Contract

AVF should not simply execute arbitrary tests.

The central object is an **Acceptance Contract**.

Example:

```yaml
goal:
  id: shopping-cart
  description: >
    User can add products to a shopping cart,
    change quantity and remove products.

criteria:

  - id: AC-001
    description: User can add a product
    validator: web.ui.element
    expected:
      element: cart
      count: 1

  - id: AC-002
    description: User can change quantity
    validator: web.ui.value
    expected:
      selector: "#quantity"
      value: 2

  - id: AC-003
    description: Total price is correct
    validator: web.ui.text
    expected:
      selector: "#total"
      value: "$20"

  - id: AC-004
    description: Product can be removed
    validator: web.ui.element
    expected:
      element: cart
      count: 0
```

The acceptance contract becomes the authoritative definition of success.

---

# 8. Deterministic End-State Principle

The central AVF rule:

> **The agent does not decide whether it succeeded.**

The agent can say:

```
"I believe this is fixed."
```

AVF must independently determine:

```
PASS
```

or:

```
FAIL
```

This distinction is fundamental.

```
Agent
  = Actor

AVF Environment
  = World

Validator
  = Judge

Evidence
  = Proof
```

---

# 9. MVP Scope

The entire universal platform is too large for MVP.

Therefore MVP is intentionally narrow.

## MVP = Web Sandbox Validation Environment

Only support:

```
VS Code
   +
AVF Core
   +
Local application
   +
Browser
   +
Playwright
   +
Deterministic acceptance criteria
   +
Evidence
   +
Reset/replay
```

Nothing else is required for MVP.

No:

```
❌ Kubernetes
❌ cloud
❌ mobile farm
❌ Windows VM
❌ macOS VM
❌ distributed execution
❌ data lake
❌ Hadoop
❌ Spark
❌ Kafka
❌ multi-agent orchestration
```

Those are future adapters.

---

# 10. MVP User Experience

The first user experience should be inside VS Code.

Not because AVF is a VS Code product.

Because VS Code is an excellent **cockpit** for the MVP.

The user opens:

```
AVF
```

Sidebar:

```
┌──────────────────────────────┐
│ AVF                          │
├──────────────────────────────┤
│                              │
│ + New Validation             │
│                              │
│ Environments                 │
│   ● Local Web                │
│                              │
│ Runs                         │
│   Run #004                   │
│   Run #003                   │
│                              │
│ Acceptance                   │
│   ✓ AC-001                   │
│   ✓ AC-002                   │
│   ✗ AC-003                   │
│                              │
│ Evidence                     │
│   Screenshots                │
│   Playwright trace           │
│   Logs                       │
│   Result                     │
│                              │
└──────────────────────────────┘
```

The extension is therefore:

> **AVF Cockpit**

not:

> AVF itself.

---

# 11. MVP Architecture

```
VS Code
│
│
▼
┌───────────────────────────────┐
│ AVF VS Code Extension         │
│                               │
│ Goal UI                       │
│ Acceptance UI                 │
│ Environment UI                │
│ Run UI                        │
│ Evidence UI                   │
└───────────────┬───────────────┘
                │
                │ IPC / local API
                ▼
┌───────────────────────────────┐
│ AVF Core                      │
│                               │
│ Goal Manager                  │
│ Acceptance Engine             │
│ Run Controller                │
│ Environment Manager           │
│ Validation Engine             │
│ Evidence Manager              │
│ Reset Manager                 │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ Local Web Environment         │
│                               │
│ Application                   │
│ Browser                       │
│ Playwright                    │
└───────────────┬───────────────┘
                │
                ▼
        Validation Results
                │
                ▼
        Evidence Bundle
```

---

# 12. Repository Structure

Start with **one repository**.

Do not split into multiple repositories prematurely.

Recommended:

```
avf/                          # → veridian/
│
├── extension/
│   └── vscode/
│
├── core/
│   ├── goal/
│   ├── acceptance/
│   ├── execution/
│   ├── validation/
│   ├── environment/
│   ├── evidence/
│   └── run/
│
├── adapters/
│   └── local-web/
│
├── validators/
│   └── playwright/
│
├── schemas/
│   ├── goal.schema.json
│   ├── acceptance.schema.json
│   ├── environment.schema.json
│   ├── run.schema.json
│   └── result.schema.json
│
├── examples/
│   └── shopping-cart/
│
├── tests/
│
├── docs/
│
└── README.md
```

Later:

```
adapters/
├── local-web/
├── docker/
├── linux-vm/
├── windows-vm/
├── macos/
├── android/
├── ios/
├── kubernetes/
├── database/
├── kafka/
├── spark/
├── hadoop/
├── cloud/
└── ...
```

---

# 13. AVF Core Components

## 13.1 Goal Manager

Responsible for:

```
Goal definition
Goal persistence
Goal versioning
Goal loading
```

Input:

```
Natural-language goal
```

Output:

```
Machine-readable goal
```

For MVP, do not build an elaborate AI goal compiler.

Allow YAML/JSON/manual criteria first.

Natural-language compilation can be added later.

---

# 14. Acceptance Engine

The acceptance engine converts:

```
Acceptance Contract
```

into:

```
Executable validation sequence
```

Example:

```
AC-001
   ↓
Launch browser
   ↓
Navigate
   ↓
Click product
   ↓
Observe cart
   ↓
Assert count == 1
```

Each criterion must be independently executable.

---

# 15. Environment Manager

Responsible for:

```
environment creation
startup
health checks
deployment
reset
snapshot
restore
shutdown
```

Example:

```
LocalWebEnvironment

create()
   ↓
install dependencies
   ↓
start application
   ↓
health check
   ↓
return environment handle
```

The environment manager must never assume that the environment is already healthy.

---

# 16. Playwright Adapter

For MVP:

```
AVF
 │
 ▼
Playwright Adapter
 │
 ├── browser launch
 ├── navigation
 ├── click
 ├── fill
 ├── screenshot
 ├── accessibility snapshot
 ├── DOM observation
 ├── network observation
 ├── trace
 └── assertion
```

Do not build your own browser automation framework.

Playwright is the adapter.

---

# 17. Evidence Engine

Every validation must produce evidence.

Example:

```
.avf/
└── runs/
    └── 2026-09-14-001/
        ├── goal.yaml
        ├── acceptance.yaml
        ├── environment.json
        ├── execution.log
        ├── result.json
        │
        ├── screenshots/
        │   ├── AC-001.png
        │   ├── AC-002.png
        │   └── AC-003.png
        │
        └── trace/
            └── playwright.zip
```

Evidence is not optional decoration.

It is part of the validation result.

---

# 18. Result Model

Example:

```json
{
  "run_id": "2026-09-14-001",
  "status": "PASS",
  "iterations": 3,
  "criteria": {
    "AC-001": {
      "status": "PASS"
    },
    "AC-002": {
      "status": "PASS"
    },
    "AC-003": {
      "status": "PASS"
    }
  },
  "evidence": {
    "screenshots": 3,
    "trace": true,
    "logs": true
  }
}
```

A run is PASS only if:

```
ALL mandatory criteria = PASS
AND
environment = valid
AND
no safety violation
AND
required evidence exists
```

---

# 19. Reproducibility

This is one of the most important differentiators.

A validation run must be reproducible.

Record:

```
Git commit
Application version
Node/Python/runtime version
Browser version
Playwright version
OS
Environment configuration
Environment variables
Test data
Seed
Network policy
Dependency versions
Timestamp
```

Eventually:

```
container digest
VM image
database snapshot
filesystem snapshot
```

---

# 20. Reset Is a First-Class Capability

An environment must be resettable.

Example:

```
RUN 001
   ↓
Application modified
   ↓
Test
   ↓
FAIL
   ↓
RESET
   ↓
RUN 002
```

The validator must not inherit contaminated state from previous runs.

For MVP:

```
git clean/reset
dependency reinstall if required
database reset
application restart
browser context reset
test data reset
```

Later:

```
container snapshot
VM snapshot
filesystem snapshot
database snapshot
cloud state snapshot
```

---

# 21. The Agent Interaction Model

AVF should initially assume the agent operates externally.

For example:

```
Claude Code
     │
     │ edits source
     ▼
Git repository
     │
     ▼
AVF detects project
     │
     ▼
AVF launches application
     │
     ▼
Playwright validation
     │
     ▼
FAIL
     │
     ▼
Evidence
     │
     ▼
Agent receives failure information
     │
     ▼
Agent repairs code
     │
     ▼
AVF reruns
```

The first MVP does not need to control Claude Code directly.

That avoids building another agent platform.

---

# 22. ReAct / CodeAct Loop

The loop can exist in AVF, but its responsibility must remain narrow.

```
GOAL
  ↓
ACCEPTANCE CONTRACT
  ↓
EXECUTE
  ↓
OBSERVE
  ↓
VALIDATE
  ↓
PASS?
 ├── YES → COMPLETE
 │
 └── NO
       ↓
   FAILURE EVIDENCE
       ↓
   AGENT REPAIR
       ↓
   RESET
       ↓
   EXECUTE
       ↓
   OBSERVE
       ↓
   VALIDATE
```

However, there is an important architectural distinction.

### AVF owns:

```
environment
execution
observation
validation
evidence
reset
iteration state
```

### External agent owns:

```
reasoning
code modification
repair strategy
implementation
```

This keeps the boundary clean.

---

# 23. MVP Agent Integration

There are three possible levels.

## Level 1 — Manual

Agent modifies code.

User clicks:

```
AVF → Validate
```

This is the simplest MVP.

---

## Level 2 — File-based feedback

AVF generates:

```
.avf/latest-result.json
.avf/latest-failure.md
```

The agent can inspect the result.

---

## Level 3 — MCP

Later:

```
Claude Code
      │
      ▼
AVF MCP
      │
      ├── create_environment
      ├── run_validation
      ├── get_result
      ├── get_evidence
      ├── reset_environment
      └── get_failure
```

This is where MCP becomes useful.

But MCP is an **interface to AVF**, not AVF itself.

---

# 24. MVP Development Sequence

## Phase 0 — Architecture Freeze

Duration:

```
1–2 days
```

Define:

```
EnvironmentAdapter
Validator
AcceptanceCriterion
ValidationRun
Evidence
ValidationResult
```

Do not write large amounts of code before these interfaces are stable.

---

# 25. Phase 1 — Core Engine

Build:

```
Goal Manager
Acceptance Manager
Run Manager
Environment Manager
Validation Manager
Evidence Manager
```

Deliverable:

```
CLI/internal API can execute:

goal
→ environment
→ validator
→ result
→ evidence
```

No sophisticated VS Code UI yet.

---

# 26. Phase 2 — Local Web Adapter

Implement:

```
LocalWebEnvironment
```

Capabilities:

```
start app
health check
stop app
reset app
```

Support:

```
npm
Python
```

initially.

Avoid supporting every framework.

Test with:

```
React
Node
Python FastAPI
```

at most.

---

# 27. Phase 3 — Playwright Validator

Implement:

```
navigate
click
fill
select
assert text
assert element
assert attribute
assert URL
assert count
screenshot
trace
```

This is enough for MVP.

---

# 28. Phase 4 — Deterministic Acceptance

Create:

```
acceptance.yaml
```

Example:

```yaml
criteria:

  - id: AC-001
    action:
      navigate: "/"

  - id: AC-002
    action:
      click: "[data-testid=add-cart]"

  - id: AC-003
    assert:
      selector: "[data-testid=cart-count]"
      equals: "1"
```

The execution engine executes these deterministically.

---

# 29. Phase 5 — Evidence

Every criterion generates:

```
PASS/FAIL
actual
expected
screenshot
logs
timestamp
trace
```

Example:

```
AC-003 FAIL

Expected:
cart total = $20

Actual:
cart total = $30

Evidence:
screenshot/AC-003.png
trace/run.zip
```

---

# 30. Phase 6 — VS Code Extension

Only after the underlying engine works.

The extension provides:

```
AVF sidebar
Goal editor
Acceptance editor
Environment status
Run button
Reset button
Run history
PASS/FAIL dashboard
Evidence viewer
```

The extension should remain thin.

---

# 31. Phase 7 — End-to-End Demonstration

The first compelling demo should intentionally contain defects.

Example application:

```
Shopping Cart
```

Initial implementation:

```
BUG 1:
Add-to-cart doesn't update count.

BUG 2:
Quantity calculation wrong.

BUG 3:
Remove button fails.
```

Acceptance:

```
AC-001 add item
AC-002 update quantity
AC-003 calculate total
AC-004 remove item
```

Execution:

```
Iteration 1
AC-001 FAIL
AC-002 FAIL
AC-003 FAIL
AC-004 FAIL

       ↓

Agent repairs

       ↓

Iteration 2
AC-001 PASS
AC-002 PASS
AC-003 FAIL
AC-004 PASS

       ↓

Agent repairs

       ↓

Iteration 3
AC-001 PASS
AC-002 PASS
AC-003 PASS
AC-004 PASS

       ↓

FINAL PASS
```

This should become the canonical AVF demo.

---

# 32. MVP End-State Acceptance Criteria

The MVP itself is complete only when this test passes.

## AVF-MVP-E2E-001

Given:

```
A deliberately defective web application
A Git repository
A machine-readable acceptance contract
A supported local development environment
```

AVF must:

```
1. Create the validation environment.

2. Start the application.

3. Verify application health.

4. Execute every mandatory acceptance criterion.

5. Produce deterministic PASS/FAIL results.

6. Capture evidence for each criterion.

7. Identify deliberately introduced defects.

8. Produce machine-readable failure information.

9. Allow the external AI coding agent to repair the application.

10. Reset/restart the environment.

11. Rerun validation.

12. Repeat until all mandatory criteria pass
    or the configured retry limit is reached.

13. Terminate immediately when all mandatory criteria pass.

14. Refuse to report PASS if any mandatory criterion fails.

15. Produce a complete reproducible evidence bundle.
```

---

# 33. Hard MVP Success Metrics

Do not measure MVP success by:

```
number of files
number of adapters
number of lines of code
number of supported frameworks
```

Measure:

### M1 — Deterministic validation

Same environment + same code + same test data:

```
Repeated runs produce equivalent results.
```

Target:

```
≥ 99% result consistency
```

for the controlled MVP test suite.

---

### M2 — Defect detection

Deliberately injected defects must be detected.

Target:

```
100% of canonical demo defects detected
```

---

### M3 — False PASS

The most important metric.

Target:

```
0 false PASS
```

for the canonical acceptance suite.

---

### M4 — Reset reproducibility

After reset:

```
same initial state
```

Target:

```
100% for controlled MVP environment
```

---

### M5 — Evidence completeness

Every criterion:

```
PASS/FAIL
+
actual
+
expected
+
evidence
```

Target:

```
100%
```

---

# 34. What Makes AVF Different From CI

This distinction must be explicit.

Traditional CI:

```
Developer
   ↓
Code
   ↓
CI pipeline
   ↓
Tests
   ↓
PASS/FAIL
```

AVF:

```
AI Agent
   ↓
Code
   ↓
Reproducible Sandbox
   ↓
Real Environment
   ↓
Interaction
   ↓
Observation
   ↓
Validation
   ↓
Evidence
   ↓
Reset
   ↓
Repair
   ↓
Re-execute
```

AVF therefore focuses on:

> **testing the outcome in the environment where the outcome actually exists.**

---

# 35. Expansion Architecture

Once Web works, the architecture should allow new environments without modifying the core.

```
                 AVF CORE
                    │
        ┌───────────┼────────────┐
        │           │            │
   Environment   Validator    Evidence
     Adapter      Adapter       Engine
        │           │
        ▼           ▼
```

Add environments independently.

---

# 36. Environment Roadmap

## Tier 1 — Local

```
Web
API
Filesystem
Linux process
Docker
Database
```

---

## Tier 2 — OS

```
Linux VM
Windows VM
macOS
```

---

## Tier 3 — Mobile

```
Android Emulator
iOS Simulator
Android physical device
iPhone physical device
```

---

## Tier 4 — Distributed Infrastructure

```
Kubernetes
Kafka
Spark
Hadoop
Airflow
Data Lake
Data Warehouse
```

---

## Tier 5 — Cloud

```
AWS
Azure
GCP
private cloud
enterprise environments
```

Each becomes an adapter.

The AVF core should not know the implementation details.

---

# 37. Validator Roadmap

MVP:

```
Web/UI
```

Then:

```
API
Database
Filesystem
Process/OS
Network
Security
Performance
Infrastructure
Data quality
Data reconciliation
```

Eventually:

```
Web Validator
API Validator
DB Validator
Kafka Validator
Spark Validator
Kubernetes Validator
Security Validator
Performance Validator
Data Validator
```

---

# 38. Database Environment

Later:

```
DatabaseEnvironment
```

Capabilities:

```
create
seed
snapshot
restore
query
assert
diff
reset
```

Validation:

```
schema
row count
values
relationships
constraints
transactions
migration
rollback
```

---

# 39. Data Platform Environment

For the existing data-platform domain, eventually:

```
Airflow
Airbyte
Kafka
Spark
Delta Lake
ClickHouse
Hive
Trino
```

could become a realistic enterprise validation environment.

Example:

```
Input data
    ↓
Airbyte
    ↓
Kafka
    ↓
Spark
    ↓
Delta Lake
    ↓
Trino
    ↓
Business query
```

AVF validates:

```
pipeline execution
data correctness
schema
record counts
business rules
failure recovery
idempotency
reprocessing
```

This is a powerful future vertical, but **not MVP**.

---

# 40. Mobile Environment

Mobile should be introduced through an adapter.

```
MobileEnvironment
   │
   ├── Android Emulator
   ├── iOS Simulator
   ├── Android Device
   └── iPhone
```

The same AVF lifecycle remains:

```
create
start
deploy
execute
observe
validate
reset
destroy
```

The environment implementation changes.

The core does not.

---

# 41. Desktop Environment

Eventually:

```
DesktopEnvironment
```

supporting:

```
Linux
Windows
macOS
```

with observation of:

```
GUI
filesystem
processes
network
OS state
logs
screenshots
```

This is where VM/microVM isolation becomes important.

---

# 42. Isolation Strategy

Do not prematurely force every environment into containers.

Use the correct isolation mechanism for the environment.

```
Web/API
    → process/container

Linux service
    → container

Untrusted OS execution
    → VM / MicroVM

Windows
    → VM

macOS
    → macOS host/VM strategy

Android
    → emulator

iOS
    → simulator / physical device

Kubernetes
    → isolated cluster/namespace
```

The adapter abstracts this complexity.

---

# 43. Snapshot and Replay Architecture

Eventually AVF should support:

```
Environment Snapshot
        ↓
Execution
        ↓
Observation
        ↓
Failure
        ↓
Restore Snapshot
        ↓
Replay
```

This becomes extremely important for agent evaluation.

For example:

```
Agent Run #1
Agent Run #2
Agent Run #3
```

all begin from:

```
Environment Snapshot S0
```

This allows meaningful comparison between agents.

---

# 44. Future Agent Benchmarking

This is a natural consequence of the architecture.

Once AVF can create identical environments:

```
Same goal
Same repository
Same environment
Same acceptance criteria
Same initial state
```

you can compare:

```
Claude Code
vs
Cursor
vs
Copilot
vs
Codex
```

using:

```
success rate
iterations
time
tool calls
cost
defects remaining
regressions
environment failures
```

But this is a **future capability**, not MVP scope.

---

# 45. MCP Strategy

Do not make MCP the foundation.

Correct hierarchy:

```
                AVF Core
                   │
        ┌──────────┼──────────┐
        │          │          │
      VS Code     CLI        MCP
        │          │          │
        └──────────┼──────────┘
                   │
             Environment
                Adapters
```

MCP becomes valuable because AI agents can directly interact with AVF.

Potential tools:

```
avf.create_environment
avf.start_environment
avf.run_validation
avf.get_validation_result
avf.get_failure
avf.get_evidence
avf.reset_environment
avf.snapshot_environment
```

Again:

> MCP is the door. AVF is the building.

---

# 46. Chrome Extension Strategy

A Chrome extension should **not** be the core architecture.

It can eventually be useful for:

```
browser observation
existing browser session
manual-to-automated test capture
recording user interactions
capturing acceptance criteria
```

But Playwright should remain the primary Web validation mechanism for MVP.

---

# 47. VS Code Strategy

VS Code is the first UI.

But:

```
VS Code ≠ AVF
```

The extension should communicate with AVF Core through a stable local interface.

This ensures that later:

```
Claude Code
Cursor
Copilot
CLI
MCP
CI
Web UI
```

can all use the same engine.

---

# 48. Recommended Technology Stack

For MVP:

```
VS Code Extension
    TypeScript

AVF Core
    TypeScript/Node.js
```

This minimizes cross-language complexity because:

```
VS Code
+
Playwright
+
local process management
```

fit naturally into the Node ecosystem.

Use:

```
JSON Schema
YAML
JSONL
SQLite or filesystem
```

for persistence initially.

Do not introduce:

```
Kafka
PostgreSQL
Kubernetes
Redis
microservices
```

into MVP.

---

# 49. MVP Persistence

Use filesystem-first architecture:

```
.avf/                         # → .veridian/
├── config.yaml
├── environments/
├── goals/
├── runs/
└── snapshots/
```

This makes AVF:

```
portable
debuggable
Git-friendly
easy to inspect
easy to reproduce
```

Later, persistence can be abstracted.

---

# 50. Core State Machine

The run controller should have an explicit state machine.

```
CREATED
   ↓
PREPARING
   ↓
READY
   ↓
EXECUTING
   ↓
OBSERVING
   ↓
VALIDATING
   ↓
   ├── PASS → COMPLETED
   │
   └── FAIL
          ↓
       FAILED
          ↓
       RESETTING
          ↓
       READY
```

Terminal states:

```
COMPLETED
ABORTED
ERROR
MAX_ITERATIONS
```

This prevents ambiguous execution behavior.

---

# 51. Failure Taxonomy

AVF should distinguish:

```
TEST_FAILURE
ENVIRONMENT_FAILURE
VALIDATOR_ERROR
APPLICATION_ERROR
TIMEOUT
SECURITY_VIOLATION
INFRASTRUCTURE_FAILURE
RESET_FAILURE
UNKNOWN
```

Do not report all failures as:

```
"test failed"
```

That will become extremely important once multiple environments exist.

---

# 52. Timeout and Safety Boundaries

Every execution must have:

```
maximum runtime
maximum iterations
maximum resource usage
network policy
filesystem boundary
process boundary
```

For MVP:

```
max iterations = 10
max validation runtime = configurable
```

No infinite agent loop.

---

# 53. Security Boundary

AVF executes potentially untrusted AI-generated code.

Therefore eventually:

```
Agent
   ↓
AVF
   ↓
Sandbox
   ↓
Target application
```

not:

```
Agent
   ↓
unrestricted host
```

For MVP, local trusted development mode is acceptable.

But the adapter architecture must leave room for stronger isolation.

---

# 54. The First 4-Week Build

## Week 1 — Core

Build:

```
repository
schemas
Goal
AcceptanceCriterion
EnvironmentAdapter
Validator
ValidationResult
Run
Evidence
```

Deliver:

```
CLI/internal execution of one deterministic validation.
```

---

## Week 2 — Web Sandbox

Build:

```
LocalWebEnvironment
PlaywrightValidator
application lifecycle
health checks
screenshots
traces
reset
```

Deliver:

```
Web application can be started,
tested and reset reproducibly.
```

---

## Week 3 — VS Code

Build:

```
sidebar
goal editor
acceptance editor
environment status
run button
result dashboard
evidence viewer
```

Deliver:

```
User can operate AVF entirely from VS Code.
```

---

## Week 4 — Agent Repair Loop + Hardening

Build:

```
failure artifact
agent feedback
rerun
iteration management
max iteration
reset
run history
reproducibility tests
```

Deliver:

```
Defective application
→ FAIL
→ agent repair
→ rerun
→ PASS
```

This is the MVP demonstration.

---

# 55. What NOT to Build During These Four Weeks

Absolutely avoid:

```
❌ MCP server
❌ Kubernetes
❌ mobile
❌ VM orchestration
❌ cloud
❌ desktop automation
❌ distributed execution
❌ SaaS backend
❌ multi-agent framework
❌ LLM training
❌ sophisticated goal compiler
❌ marketplace
❌ plugin ecosystem
❌ Chrome extension
```

Build the **minimum vertical slice** that proves the architecture.

---

# 56. MVP Definition of Done

AVF MVP is DONE when a developer can clone the repository and perform:

```
1. Open project in VS Code.

2. Open AVF.

3. Define goal.

4. Define acceptance criteria.

5. Start sandbox.

6. Run validation.

7. See deterministic failures.

8. Inspect evidence.

9. Modify code using an external AI coding agent.

10. Run validation again.

11. Environment resets correctly.

12. Validation executes again.

13. All criteria eventually pass.

14. AVF reports PASS.

15. Evidence bundle can be inspected independently.
```

No other capability is required to declare MVP complete.

---

# 57. The First Product Demonstration

The demo should be extremely simple.

### Screen 1

Claude Code/Cursor modifies:

```
Shopping Cart
```

### Screen 2

AVF:

```
Validation Run #001

AC-001  Add product       FAIL
AC-002  Quantity          FAIL
AC-003  Total             FAIL
AC-004  Remove product    PASS
```

### Screen 3

Evidence:

```
Expected: $20
Actual:   $30
Screenshot
Trace
Console log
```

### Screen 4

Agent repairs code.

### Screen 5

AVF reruns:

```
Validation Run #002

AC-001  PASS
AC-002  PASS
AC-003  PASS
AC-004  PASS

=====================
        PASS
=====================
```

That is the **"aha" moment**.

The agent didn't merely generate code.

> **The agent generated code that was proven to work in a real sandbox.**

---

# 58. Long-Term Architecture

Once the MVP is proven:

```
                         AVF
                         │
             ┌───────────┴───────────┐
             │                       │
       Environment Fabric       Validation Fabric
             │                       │
     ┌───────┼────────┐       ┌──────┼─────────┐
     │       │        │       │      │         │
    Web    Desktop  Mobile   UI     API       DB
     │       │        │       │      │         │
  Docker    VM     Emulator  OS   Security   Data
     │       │        │
 Kubernetes  Cloud
     │
 Data Platform
```

Interfaces:

```
VS Code
CLI
MCP
REST
CI/CD
```

External agents:

```
Claude Code
Cursor
Copilot
Codex
Gemini
...
```

---

# 59. The Strategic Moat

The moat is **not**:

```
Playwright
Docker
MCP
VS Code
```

Those are commodities/integration points.

The potential moat is the **unified environment abstraction + reproducible state + cross-environment validation + evidence model**.

Eventually:

```
Same Goal
     ↓
Same Acceptance Contract
     ↓
Different Environment
     ↓
Same Validation Semantics
     ↓
Comparable Evidence
```

That is what allows AVF to become a universal validation layer.

---

# 60. Final Architecture Principle

The entire project should be governed by one rule:

> **Do not build the intelligence that creates the software. Build the world that determines whether the software actually works.**

Therefore:

```
AI Agent
    │
    │ creates / modifies
    ▼
┌──────────────────┐
│      AVF         │
│                  │
│  Sandbox World   │
│       +          │
│  Observation     │
│       +          │
│  Validation      │
│       +          │
│  Evidence        │
│       +          │
│  Reset           │
└────────┬─────────┘
         │
         ▼
     PASS / FAIL
```

And the product evolution becomes:

```
MVP
VS Code
+
Local Web
+
Playwright
+
Deterministic Validation
+
Evidence
+
Reset

        ↓

Docker / API / DB

        ↓

Linux / Windows / macOS

        ↓

Android / iOS

        ↓

VM / MicroVM

        ↓

Kubernetes

        ↓

Kafka / Spark / Hadoop / Data Platforms

        ↓

Cloud

        ↓

Universal Agent Testing & Validation Fabric
```

**This is the correct scope.**

The MVP is small enough to build, while the architecture does not paint us into a corner.

Most importantly, **we are not trying to build the whole universal sandbox platform now**. We are
proving one invariant:

> **Can an external AI coding agent operate against a reproducible environment, receive
> deterministic validation feedback, repair its output, and reach a provably correct end state?**

If that invariant works for Web, the same abstraction can be progressively extended to every other
sandbox type.
