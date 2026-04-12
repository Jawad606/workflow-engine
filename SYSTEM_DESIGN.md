# State-Driven Multi-Step Workflow Engine
## System Design Document

**Document Version:** 1.0  
**Date:** April 12, 2026  
**Status:** Final Design

---

## 1. Core Workflow Entity

### Workflow Record

The `WorkflowRecord` is the central object that carries state through the entire system.

#### Key Fields

```typescript
WorkflowRecord {
  id: string (UUID)                          // Unique workflow identifier
  traceId: string (UUID)                     // Correlation ID for distributed tracing
  status: enum                               // Current state (see §2)
  contextData: JSONB                         // Mutable payload (grows with each step)
  idempotencyKey: string (unique)            // Prevents duplicate creation
  retryCount: integer                        // Tracks retry attempts
  createdAt: timestamp                       // Workflow creation time
  updatedAt: timestamp                       // Last state change
  completedAt: timestamp (nullable)          // When workflow finished (success or failure)
}
```

#### Context Data Evolution

Context carries information through each stage:

```json
// Stage 1: INITIATED (from API)
{
  "input": {
    "paymentAmount": 150.50,
    "userId": "user_123",
    "merchant": "Acme Corp"
  }
}

// Stage 2: After ROUTING
{
  "input": {...},
  "routingDecision": {
    "route": "PAYMENT_PROCESSING",
    "priority": "HIGH",
    "riskScore": 0.15
  }
}

// Stage 3: After DECISION
{
  "input": {...},
  "routingDecision": {...},
  "decision": {
    "approved": true,
    "reason": "Risk score within limits",
    "limits": { "dailyMax": 5000, "txnMax": 1000 }
  }
}

// Stage 4: After ACTION
{
  "input": {...},
  "routingDecision": {...},
  "decision": {...},
  "actionResult": {
    "type": "PAYMENT_PROCESSED",
    "status": "SUCCESS",
    "externalId": "TXN_12345",
    "timestamp": "2026-04-12T13:38:18.321Z"
  }
}
```

---

## 2. State Transitions

### State Machine

```
┌─────────────────────────────────────────────────────────────┐
│         WORKFLOW STATE MACHINE (Linear Flow)                │
└─────────────────────────────────────────────────────────────┘

        ┌──────────┐
        │ INITIATED│  ← Created via POST /workflows
        └────┬─────┘
             │ route job enqueued
             ↓
        ┌──────────┐
        │ ROUTING  │  ← Route Worker classifies workflow
        └────┬─────┘
             │ decision job enqueued
             ↓
        ┌────────────────┐
        │ DECISION_   │  ← Decision Worker evaluates conditions
        │ PENDING     │
        └────┬─────────┘
             │ action job enqueued
             ↓
        ┌────────────────┐
        │ ACTION_    │  ← Action Worker executes side effects
        │ QUEUED     │
        └────┬─────────┘
             │ all side effects complete
             ↓
        ┌──────────┐
        │COMPLETED │  ← Workflow succeeded
        └──────────┘

        Any failure at any stage →
             ↓
        ┌──────────┐
        │  FAILED  │  ← Workflow failed (with error logged)
        └──────────┘
             │ retry_count++
             │ (with exponential backoff)
             ↓
        ┌──────────┐
        │ INITIATED│  (may re-try from beginning or last state)
        └──────────┘
```

### State Transition Table

| From | To | Trigger | Prerequisite | Action |
|---|---|---|---|---|
| INITIATED | ROUTING | Route job starts | Workflow exists in INITIATED | Route Worker processes workflow |
| ROUTING | DECISION_PENDING | Route job completes | ROUTING state confirmed | Decision job enqueued |
| DECISION_PENDING | ACTION_QUEUED | Decision job completes | DECISION_PENDING confirmed | Action job enqueued |
| ACTION_QUEUED | COMPLETED | Action job succeeds | All side effects done | Workflow marked complete |
| Any | FAILED | Any step fails | Failed validation/execution | Error logged, retry scheduled |
| FAILED | INITIATED | Retry triggered | Max retries not exceeded | Workflow restarted (exponential backoff) |

### What Triggers Movement

1. **INITIATED → ROUTING**: Route job added to queue (`queryOrchestrator.startWorkflow()`)
2. **ROUTING → DECISION_PENDING**: Route worker completes successfully
3. **DECISION_PENDING → ACTION_QUEUED**: Decision worker completes successfully
4. **ACTION_QUEUED → COMPLETED**: Action worker completes successfully + all side effects committed
5. **Any → FAILED**: Exception caught in transaction, error logged with actor info
6. **FAILED → INITIATED**: Manual retry request or scheduled retry with backoff

---

## 3. System Structure

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     API LAYER (Express)                         │
│  POST   /workflows              (create workflow + enqueue)      │
│  GET    /workflows/:id          (get current status)             │
│  GET    /workflows/:id/logs     (get audit trail)                │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│               ORCHESTRATION LAYER                               │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │  Query Orchestrator      │  │  Governance Log Service  │    │
│  │  - startWorkflow()       │  │  - appendLog()           │    │
│  │  - triggers job          │  │  - records transitions   │    │
│  │  - validates transitions │  │  - stores audit trail    │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
└────────────────┬───────────────────────────────┬─────────────────┘
                 │                               │
┌────────────────▼──────────────┐   ┌───────────▼──────────────┐
│     JOB QUEUE LAYER (BullMQ)  │   │  STATE MACHINE (Memory)  │
│  ┌────────────────────────┐   │   │  - validTransitions map  │
│  │ 'route' job queue      │───┼───▶─ canTransition()         │
│  │ 'decision' job queue   │   │   └──────────────────────────┘
│  │ 'action' job queue     │   │
│  └────────────────────────┘   │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│          WORKER LAYER (Async Job Processing)                    │
│  ┌────────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Route Worker       │  │ Decision Worker │  │ Action Worker│ │
│  │ - classifies type  │  │ - evaluates     │  │ - executes   │ │
│  │ - sets priority    │  │   conditions    │  │   side fx    │ │
│  │ - calculates risk  │  │ - approves/     │  │ - commits    │ │
│  │                    │  │   rejects       │  │   external   │ │
│  └────────────────────┘  └─────────────────┘  └──────────────┘ │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│            PERSISTENCE LAYER (PostgreSQL + Redis)                │
│  ┌───────────────────────────┐  ┌──────────────────────────────┐ │
│  │ Workflow Records Table    │  │ Governance Logs Table        │ │
│  │ - stores workflow state   │  │ - audit trail entries        │ │
│  │ - tracks context data     │  │ - state transitions           │ │
│  │ - manages retries         │  │ - who + when + what          │ │
│  └───────────────────────────┘  └──────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────┤
│  │ Redis Queue                                                   │
│  │ - holds pending jobs for workers                              │
│  │ - ensures at-least-once delivery                              │
│  └───────────────────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Component | Responsibility |
|-------|-----------|-----------------|
| API | Express Routes | Accept HTTP, validate input, return responses |
| Orchestration | queryOrchestrator | Enter workflow, enqueue first job |
| Orchestration | governanceLogService | Write audit trail entries |
| Queue | BullMQ | Reliable job delivery |
| Worker | Route/Decision/Action | Execute business logic, update state |
| State | workflow-state.ts | Enforce valid transitions |
| Persistence | PostgreSQL | Store workflows + logs durably |
| Persistence | Redis | Queue jobs for delivery |

---

## 4. Governance Log

### What Is It?

A **durable audit trail** that records every state transition in a workflow, capturing:
- WHO made the change (worker actor)
- WHAT changed (from state → to state)
- WHEN it changed (timestamp)
- WHY it changed (payload snapshot)

### Data Model

```typescript
GovernanceLog {
  id: string (UUID)                    // Unique log entry ID
  workflowId: string (FK)              // Which workflow
  traceId: string                      // Correlation ID (same as workflow)
  fromState: enum                      // Previous state
  toState: enum                        // New state
  actor: string                        // Who caused change ("route_worker", "decision_worker", etc.)
  payloadSnapshot: JSONB               // Complete context at time of transition
  createdAt: timestamp                 // When transition occurred
}
```

### How It Is Generated

**Stored (not derived)** — Entries are actively written during each state transition.

```typescript
// Inside each worker's transaction
await appendGovernanceLog({
  prisma: transactionClient,
  workflowId: workflow.id,
  traceId: workflow.traceId,
  fromState: 'ROUTING',
  toState: 'DECISION_PENDING',
  actor: 'decision_worker',
  payloadSnapshot: updatedWorkflow.contextData
});
```

### Sample Audit Trail

For a single workflow:

```
Entry 1:
  fromState: INITIATED
  toState: ROUTING
  actor: route_worker
  createdAt: 2026-04-12T13:18:33.414Z
  payloadSnapshot: { input: {...}, routingDecision: {...} }

Entry 2:
  fromState: ROUTING
  toState: DECISION_PENDING
  actor: decision_worker
  createdAt: 2026-04-12T13:18:34.752Z
  payloadSnapshot: { input: {...}, routingDecision: {...}, decision: {...} }

Entry 3:
  fromState: DECISION_PENDING
  toState: ACTION_QUEUED
  actor: action_worker
  createdAt: 2026-04-12T13:18:35.891Z
  payloadSnapshot: { ..., decision: {...} }

Entry 4:
  fromState: ACTION_QUEUED
  toState: COMPLETED
  actor: action_worker
  createdAt: 2026-04-12T13:18:36.215Z
  payloadSnapshot: { ..., actionResult: {...} }
```

### How It Reflects System State

- **Consistency**: Governed Log entries are written in the same database transaction as state updates → guaranteed consistency
- **Immutability**: Entries are never edited, only appended → tamper-proof audit trail
- **Completeness**: Every state transition (including failures) is logged → no gaps
- **Traceability**: traceId links all entries to original workflow → end-to-end visibility

---

## 5. Failure Handling

### Failure Scenarios

**Scenario 1: Worker Fails During Processing**
```
Route Worker attempts routing logic
  → Throws exception (e.g., invalid input)
  → Transaction rolled back
  → workflowRecord.status remains INITIATED (or reverts to last good state)
  → Governance log entry: INITIATED → FAILED (logged in same transaction)
  → retryCount incremented
  → Job marked failed in BullMQ
```

**Scenario 2: Database Becomes Unavailable**
```
Decision Worker tries to update workflow
  → Database connection timeout
  → Transaction fails
  → Job remains in queue (not acknowledged)
  → BullMQ retries after delay
  → Worker processes again when DB recovers
```

**Scenario 3: External API Call Fails**
```
Action Worker calls payment processor
  → External API returns 5xx error
  → Transaction not committed
  → Workflow stays in ACTION_QUEUED
  → Job marked failed
  → Retry with exponential backoff
  → After max retries → state = FAILED
```

### Retry Strategy

```
Retry Policy (Exponential Backoff):
─────────────────────────────────────

Attempt 1: Immediate    (0 second delay)
Attempt 2: 5 seconds    → if retryCount < max
Attempt 3: 25 seconds   → if retryCount < max
Attempt 4: 2 minutes    → if retryCount < max
Attempt 5: 10 minutes   → if retryCount < max
Attempt 6: FAIL         → mark workflow FAILED, notify

Formula: delay = min(maxDelay, baseDelay * (2 ^ attempt))

Max Retries: 5 (configurable)
```

### Recovery Approaches

**Option A: Automatic Retry** (default)
- Worker catches error
- Logs error in governance trail
- Job re-enqueued with backoff
- Workflow remains in current state
- On success → continue to next step

**Option B: Manual Retry** (operator intervention)
- After max retries → workflow in FAILED state
- Operator reviews governance log
- Fixes underlying issue (e.g., updates external system)
- Calls `POST /workflows/:id/retry`
- Workflow restarted from beginning or last checkpoint

**Option C: Checkpoint Recovery** (future enhancement, not part of current MVP)
- Worker saves checkpoint before external call
- If call fails → rewind to checkpoint
- Retry from known-good state
- Reduces duplicate work on repeated failures

---

## 6. Data Contracts

### Data Flow Between Steps

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: API Input Contract                                  │
├─────────────────────────────────────────────────────────────┤
│ From: Client (HTTP POST)                                    │
│ To: queryOrchestrator.startWorkflow()                       │
│                                                             │
│ Input:                                                      │
│ {                                                           │
│   "idempotencyKey": "unique-string",                        │
│   "payload": {                                              │
│     "paymentAmount": number,                                │
│     "userId": string,                                       │
│     "merchant": string,                                     │
│     "type": "purchase" | "subscription" | "refund"          │
│   }                                                         │
│ }                                                           │
│                                                             │
│ Stored in: contextData.input                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Step 2: Route Worker Output Contract                        │
├─────────────────────────────────────────────────────────────┤
│ From: Route Worker (processes 'route' job)                  │
│ To: Workflow contextData (stored for Decision Worker)       │
│                                                             │
│ Output:                                                     │
│ contextData.routingDecision = {                             │
│   "route": "PAYMENT_PROCESSING",                            │
│   "priority": "HIGH" | "NORMAL" | "LOW",                    │
│   "riskScore": 0.0-1.0,                                     │
│   "country": "US",                                          │
│   "routingReason": "Based on payment amount > threshold"    │
│ }                                                           │
│                                                             │
│ State: INITIATED → ROUTING                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Step 3: Decision Worker Output Contract                     │
├─────────────────────────────────────────────────────────────┤
│ From: Decision Worker (processes 'decision' job)            │
│ To: Workflow contextData (stored for Action Worker)         │
│                                                             │
│ Output:                                                     │
│ contextData.decision = {                                    │
│   "approved": true | false,                                 │
│   "reason": "Risk within limits",                           │
│   "limits": {                                               │
│     "dailyMax": number,                                     │
│     "txnMax": number                                        │
│   },                                                        │
│   "conditions": [                                           │
│     "require_3ds",                                          │
│     "notify_customer"                                       │
│   ]                                                         │
│ }                                                           │
│                                                             │
│ State: ROUTING → DECISION_PENDING                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Step 4: Action Worker Output Contract                       │
├─────────────────────────────────────────────────────────────┤
│ From: Action Worker (processes 'action' job)                │
│ To: Workflow contextData (stored for audit)                 │
│                                                             │
│ Output:                                                     │
│ contextData.actionResult = {                                │
│   "type": "PAYMENT_PROCESSED",                              │
│   "status": "SUCCESS" | "PENDING" | "FAILED",               │
│   "externalId": "TXN_12345",                                │
│   "amount": number,                                         │
│   "timestamp": "2026-04-12T13:38:18.321Z",                  │
│   "details": {                                              │
│     "message": "Payment successfully processed",            │
│     "merchant_ref": "..."                                   │
│   }                                                         │
│ }                                                           │
│                                                             │
│ State: DECISION_PENDING → ACTION_QUEUED → COMPLETED         │
└─────────────────────────────────────────────────────────────┘
```

### Consistency Guarantees

**Transactional Consistency**
- Each worker's state change + governance log entry are written atomically
- If either fails → entire transaction rolls back
- No partial state changes

**Version Consistency**
- Each workflow has `updatedAt` timestamp
- Workers validate `updatedAt` hasn't changed since job was enqueued
- Prevents lost updates due to concurrent modifications

**Immutable History**
- Governance log entries are never edited
- Complete audit trail available for compliance/debugging
- Can trace any workflow's exact path through system

---

## 7. Initial Implementation Approach (1-2 Weeks)

### Week 1: Foundation

**Day 1-2: Setup**
- [ ] Initialize Node.js + Express + TypeScript
- [ ] Set up PostgreSQL + Prisma ORM
- [ ] Set up Redis + BullMQ
- [ ] Create database schema (WorkflowRecord, GovernanceLog)
- [ ] Configure environment (docker-compose for locals)

**Day 3-4: API Layer**
- [ ] `POST /workflows` endpoint (create workflow, enqueue route job)
- [ ] `GET /workflows/:id` endpoint (get workflow status)
- [ ] `GET /workflows/:id/logs` endpoint (get audit trail)
- [ ] Input validation (idempotencyKey, payload schema)
- [ ] Error responses (400, 404, 500)


**Day 5: State Machine + Core Services**
- [ ] Define state enum (INITIATED, ROUTING, DECISION_PENDING, ACTION_QUEUED, COMPLETED, FAILED)
- [ ] Define validTransitions map
- [ ] Implement `canTransition()` validator
- [ ] Implement `queryOrchestrator.startWorkflow()`
- [ ] Implement `governanceLogService.appendLog()`

### Week 2: Workers + Testing

**Day 6-7: Route Worker**
- [ ] Implement route worker (classifies workflow by type)
- [ ] Implement routing logic (simple: check paymentAmount, set route)
- [ ] Register worker with BullMQ
- [ ] Handle state transitions + logging
- [ ] Add error handling

**Day 8-9: Decision + Action Workers**
- [ ] Implement decision worker (approves/rejects based on risk)
- [ ] Implement action worker (simulates payment processing)
- [ ] Register both with BullMQ
- [ ] Implement state transitions + logging for both
- [ ] Add error handling + retry logic

**Day 10: Integration Testing + Documentation**
- [ ] E2E test: create workflow → watch it flow through all states
- [ ] Verify governance log populated at each step
- [ ] Test error scenarios (invalid state transitions)
- [ ] Test retry logic
- [ ] Generate API documentation + README

### What to Defer (Add Later)

| Feature | Why Defer | Estimate |
|---------|-----------|----------|
| Parallel workflows | Complexity; linear flow sufficient for MVP | Week 3-4 |
| Manual workflow triggers | Requires UI; API-first in MVP | Week 4 |
| Scheduled retries | Add cron jobs; exponential backoff sufficient | Week 3 |
| Dead letter queue | Handle after retry exhaustion flow is solid | Week 3 |
| Metrics/tracing | Add APM later; logging sufficient for now | Week 4 |
| Advanced persistence (read replicas) | Add if scale becomes issue | Week 5+ |
| Workflow versioning | Not needed if schema rarely changes | Later |

### Simplifications for MVP

1. **Single route/decision logic** — Hardcoded rules, not configurable
2. **No complex branching** — Linear path only (no sub-workflows)
3. **No workflow UI** — REST API only
4. **In-memory caching** — No Redis cache layer yet
5. **Local server testing** — No distributed deployment yet
6. **Basic error handling** — Log and fail; no automatic healing
7. **No rate limiting** — Add if abuse discovered

### Tech Stack

```
Runtime:     Node.js 20+ LTS
Framework:   Express 5.1
Language:    TypeScript 5.8
Database:    PostgreSQL 15
Queue:       BullMQ + Redis 7
ORM:         Prisma 6.19
Testing:     Jest + Supertest (E2E)
Deployment:  Docker + Docker Compose (local)
```

### Success Criteria (MVP)

✅ Workflow creation with idempotency key  
✅ Route worker classifies workflows  
✅ Decision worker approves/rejects  
✅ Action worker executes side effects  
✅ All state transitions logged in governance trail  
✅ E2E test: create workflow → see it reach COMPLETED in < 5 seconds  
✅ Error workflow: failed step → FAILED state → logged  
✅ API documentation (3 endpoints, all examples)  

---

## Summary

| Aspect | Decision |
|--------|----------|
| **Architecture** | Layered (API → Orchestration → Queue → Workers → Persistence) |
| **Consistency** | ACID transactions per step |
| **Audit Trail** | Immutable stored log (not derived) |
| **Retries** | Exponential backoff, max 5 attempts |
| **State Model** | Linear flow with fallback to FAILED |
| **Implementation** | 1-2 weeks, MVP features only |

---

## Next Steps

1. **Approve design** — Confirm state transitions and data contracts
2. **Scaffold project** — Initialize repo with tech stack
3. **Build Week 1 items** — API layer + core services
4. **Build Week 2 items** — Workers + integration tests
5. **Deploy locally** — Docker Compose for testing
6. **Deliver** — API docs + test suite + README

