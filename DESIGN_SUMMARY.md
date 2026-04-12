# Workflow Engine - System Design Summary

## One-Page Reference

---

## 1️⃣ CORE ENTITY

### WorkflowRecord (The Object That Carries State)

```
┌─────────────────────────────────────┐
│      WorkflowRecord (JSON Stored)   │
├─────────────────────────────────────┤
│ id: UUID (primary key)              │
│ traceId: UUID (correlation)         │
│ status: enum (linear path)          │
│ contextData: JSONB (grows per step) │
│ idempotencyKey: unique string       │
│ retryCount: integer                 │
│ createdAt, updatedAt, completedAt   │
└─────────────────────────────────────┘
```

**Status Values:**
```
INITIATED → ROUTING → DECISION_PENDING → ACTION_QUEUED → COMPLETED
                     (fallback)
                        ↓
                      FAILED
```

---

## 2️⃣ STATE TRANSITIONS

### Simple Linear Machine

```
┌─────────────────────────────────────────────────────────┐
│              Workflow State Lifecycle                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Client Request                                         │
│       ↓                                                 │
│  INITIATED (API creates workflow + enqueues route job) │
│       ↓ [route job dequeued]                           │
│  ROUTING (Route Worker classifies)                      │
│       ↓ [decision job enqueued]                        │
│  DECISION_PENDING (Decision Worker approves/rejects)   │
│       ↓ [action job enqueued]                          │
│  ACTION_QUEUED (Action Worker executes side effects)   │
│       ↓ [side effects complete]                        │
│  COMPLETED (Workflow finished ✓)                        │
│                                                         │
│  [Any step fails] →                                     │
│       ↓                                                 │
│  FAILED (Error logged, retry scheduled)                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**What Triggers Transitions?**
- Job dequeuing triggers worker
- Worker processes successfully → next job enqueued
- Worker fails → error logged, retry scheduled
- All workers complete → workflow COMPLETED

---

## 3️⃣ SYSTEM STRUCTURE

### Layered Architecture

```
┌───────────────────────────────────────────────────────────┐
│  API LAYER (Express)                                      │
│  POST /workflows   →   GET /workflows/:id   →   GET /logs │
└────────────┬────────────────────────────────┬──────────────┘
             │                                │
             ↓                                ↓
┌───────────────────────────────────────────────────────────┐
│  ORCHESTRATION LAYER                                      │
│  • queryOrchestrator (startWorkflow, enqueue job)        │
│  • governanceLogService (appendLog entries)              │
└────────────┬────────────────────────────────┬──────────────┘
             │                                │
             ↓                                ↓
┌───────────────────────────┐  ┌──────────────────────────┐
│  JOB QUEUE (BullMQ)       │  │  STATE MACHINE (Memory)  │
│  └─ route queue           │  │  └─ validTransitions map │
│  └─ decision queue        │  │  └─ canTransition()      │
│  └─ action queue          │  │                          │
└───────────┬───────────────┘  └──────────────────────────┘
            │
            ↓
┌───────────────────────────────────────────────────────────┐
│  WORKER LAYER (Async Job Processors)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Route Worker │  │Decision Worker│ │Action Worker │   │
│  │- classify   │  │- evaluate     │  │- execute     │   │
│  │- route      │  │- approve      │  │- commit      │   │
│  │- risk calc  │  │- reject       │  │- side effects│   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└────────────┬────────────────────────────────┬──────────────┘
             │                                │
             ↓                                ↓
┌───────────────────────────────────────────────────────────┐
│  PERSISTENCE LAYER (PostgreSQL + Redis)                   │
│  WorkflowRecord Table  │  GovernanceLog Table  │ Redis Queue
└───────────────────────────────────────────────────────────┘
```

---

## 4️⃣ GOVERNANCE LOG (Audit Trail)

### What Is It?
```
Durable record of EVERY state transition
   WHO   (actor: "route_worker", "decision_worker", etc.)
   WHAT  (fromState → toState transition)
   WHEN  (timestamp)
   WHY   (payloadSnapshot at time of transition)
```

### Is It Stored or Derived?
**STORED** — Actively written in database, not computed on demand

### Does It Reflect System State?
**YES** — Entries written atomically with state changes
- Same database transaction
- If either fails → whole transaction rolls back
- Never edited, only appended
- Complete immutable history

### Example Entry
```json
{
  "workflowId": "550e8400-e29b-41d4-a716-446655440001",
  "traceId": "4b12280f-82a9-45d1-804e-26bf40903373",
  "fromState": "ROUTING",
  "toState": "DECISION_PENDING",
  "actor": "decision_worker",
  "createdAt": "2026-04-12T13:18:34.752Z",
  "payloadSnapshot": {
    "input": {...},
    "routingDecision": {...},
    "decision": {...}
  }
}
```

---

## 5️⃣ FAILURE HANDLING

### What Happens When Step Fails?

```
Step Execution
     ↓
[Exception Caught]
     ↓
Transaction Rolled Back
     ↓
Write Error to GovernanceLog (CURRENT_STATE → FAILED)
     ↓
Increment retryCount
     ↓
Re-enqueue job with exponential backoff
     ↓
Delay: 5s × (2 ^ attempt)
     ↓
[Retry after delay]
```

### Retry Strategy

```
Attempt 1: Immediate     (0 second delay)
Attempt 2: 5 seconds
Attempt 3: 25 seconds
Attempt 4: 2 minutes
Attempt 5: 10 minutes
Attempt 6: FAILED → Manual Intervention
```

### Recovery Options

**Automatic (Built-in)**
- Job marked failed
- Automatically re-enqueued with backoff
- No operator needed

**Manual (After Max Retries)**
- Operator reviews governance log
- Fixes root cause
- Calls `POST /workflows/:id/retry`
- Workflow restarts

---

## 6️⃣ DATA CONTRACTS

### What Flows Between Steps?

```
┌─────────────────────────────────────────────────────────┐
│  API Input (from Client)                                │
├─────────────────────────────────────────────────────────┤
│ {                                                       │
│   "idempotencyKey": "unique-123",                       │
│   "payload": {                                          │
│     "paymentAmount": 150.50,                            │
│     "userId": "user_123",                               │
│     "merchant": "Acme Corp"                             │
│   }                                                     │
│ }                                                       │
│                                                         │
│ Stored in: contextData.input                            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Route Worker Output                                    │
├─────────────────────────────────────────────────────────┤
│ Adds to contextData:                                    │
│ {                                                       │
│   "routingDecision": {                                  │
│     "route": "PAYMENT_PROCESSING",                      │
│     "priority": "HIGH",                                 │
│     "riskScore": 0.15                                   │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Decision Worker Output                                 │
├─────────────────────────────────────────────────────────┤
│ Adds to contextData:                                    │
│ {                                                       │
│   "decision": {                                         │
│     "approved": true,                                   │
│     "reason": "Risk within limits",                     │
│     "limits": {...}                                     │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│  Action Worker Output                                   │
├─────────────────────────────────────────────────────────┤
│ Adds to contextData:                                    │
│ {                                                       │
│   "actionResult": {                                     │
│     "type": "PAYMENT_PROCESSED",                        │
│     "status": "SUCCESS",                                │
│     "externalId": "TXN_12345"                           │
│   }                                                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘

Each step preserves ALL previous data + adds new section
→ Complete immutable history in metadata
```

### Consistency Approach

- **Atomic Updates**: State change + log entry in same transaction
- **Idempotency Keys**: Prevent duplicate creation
- **Version Checking**: Detect concurrent modifications
- **Immutable Logs**: No edits, only appends

---

## 7️⃣ IMPLEMENTATION ROADMAP

### Week 1: Core Infrastructure
```
Day 1-2:  Setup (Node, DB, Redis, Docker)
Day 3-4:  API endpoints (3x)
Day 5:    State machine + services
```

### Week 2: Workers & Testing
```
Day 6-7:  Route Worker
Day 8-9:  Decision Worker + Action Worker
Day 10:   E2E testing + docs
```

### What to Defer
- Parallel workflows (Week 3)
- UI dashboard (Week 4)
- Advanced metrics (Week 4)
- Read replicas (Week 5)

### Tech Stack
```
Node.js 20  |  Express 5  |  TypeScript 5.8
PostgreSQL 15  |  Redis 7  |  BullMQ
Prisma 6  |  Docker Compose
```

---

## ✅ Success Criteria (MVP)

```
□ Workflow creation < 100ms
□ Route worker classifies in < 500ms
□ Decision worker evaluates in < 500ms
□ Action worker executes in < 1s
□ E2E complete in < 5s
□ Full audit trail persisted
□ Error retry working
□ API docs complete
```

---

## 📊 Design Rationale Summary

| Why This Design | Benefits | Trade-offs |
|---|---|---|
| **State Machine** | Clear, auditable flow | No branching (yet) |
| **Async Workers** | Decoupled, scalable | Operational complexity |
| **Immutable Logs** | Compliance-ready | Storage cost |
| **Stored Logs** | Guaranteed consistency | Cannot recompute |
| **Exp. Backoff** | Handles transients | May delay recovery |
| **PostgreSQL** | ACID guarantees | Single-DB bottleneck |

---

**Status:** ✅ Design Complete → Ready for Implementation

