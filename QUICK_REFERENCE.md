# Workflow Engine - Quick Reference Guide

**Complete System Design with Diagrams & Implementation Roadmap**

---

## 📋 At a Glance

### The Problem
```
Input → Classify → Decide → Execute → Record
Multi-step workflow with full auditability and error recovery
```

### The Solution
```
State Machine Pattern + Event Queue + Immutable Audit Log
Async workers process each step independently
Full transaction consistency + comprehensive governance trail
```

---

## 🎯 Key Design Decisions

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **Linear state machine** | Simple, predictable, easy to audit | No branching/loops (adds complexity) |
| **JSONB context payload** | Flexible schema, grows with workflow | Query-ability reduces initially |
| **Immutable audit log** | Tamper-proof, compliance-ready | Cannot correct log entries |
| **Stored (not derived) logs** | Guaranteed consistency with state | Additional storage cost |
| **Exponential backoff retries** | Reduces thundering herd | May delay recovery |
| **PostgreSQL transactions** | ACID guarantees, no saga pattern | Single database bottleneck (scales to ~1000s TPS) |

---

## 🔄 The Five States

```
INITIATED
    ↓ (route job dequeued)
ROUTING
    ↓ (decision job dequeued)
DECISION_PENDING
    ↓ (action job dequeued)
ACTION_QUEUED
    ↓ (side effects complete)
COMPLETED
    ↓
(audit trail available)

ERROR PATH:
Any state → FAILED
    ↓ (retry with backoff)
INITIATED (restart)
```

---

## 📦 Data Contracts

### API Input
```json
POST /workflows
{
  "idempotencyKey": "unique-key",
  "payload": {
    "paymentAmount": 150.50,
    "userId": "user_123",
    "merchant": "Acme Corp",
    "type": "purchase"
  }
}
```

### Worker Outputs (Progressive Context)
```
Route Worker:     adds contextData.routingDecision
Decision Worker:  adds contextData.decision
Action Worker:    adds contextData.actionResult
All logged in GovernanceLog
```

---

## 🧪 Implementation Checklist

### Week 1: Foundation
- [ ] Project scaffolding (Node + Express + TypeScript + Docker)
- [ ] Database setup (PostgreSQL schema + Prisma)
- [ ] API endpoints (POST, GET status, GET logs)
- [ ] Core services (QueryOrchestrator, GovernanceLogService)

### Week 2: Async Workers
- [ ] Route Worker implementation
- [ ] Decision Worker implementation
- [ ] Action Worker implementation
- [ ] E2E testing + documentation

### Success Criteria
✅ Workflow creates in < 100ms  
✅ Each state transition < 1 second  
✅ Full audit trail persists  
✅ Retry logic handles failures  
✅ E2E test: create → complete in < 5 seconds  

---

## 📊 Governance Log Example

```json
{
  "workflowId": "550e8400-e29b-41d4-a716-446655440001",
  "traceId": "4b12280f-82a9-45d1-804e-26bf40903373",
  "logs": [
    {
      "fromState": "INITIATED",
      "toState": "ROUTING",
      "actor": "route_worker",
      "createdAt": "2026-04-12T13:18:33.414Z",
      "payloadSnapshot": {"input": {...}, "routingDecision": {...}}
    },
    {
      "fromState": "ROUTING",
      "toState": "DECISION_PENDING",
      "actor": "decision_worker",
      "createdAt": "2026-04-12T13:18:34.752Z",
      "payloadSnapshot": {"input": {...}, "routingDecision": {...}, "decision": {...}}
    },
    {
      "fromState": "DECISION_PENDING",
      "toState": "ACTION_QUEUED",
      "actor": "action_worker",
      "createdAt": "2026-04-12T13:18:35.891Z",
      "payloadSnapshot": {...}
    },
    {
      "fromState": "ACTION_QUEUED",
      "toState": "COMPLETED",
      "actor": "action_worker",
      "createdAt": "2026-04-12T13:18:36.215Z",
      "payloadSnapshot": {..., "actionResult": {...}}
    }
  ]
}
```

---

## 🛡️ Failure Recovery

### Automatic (< 5 seconds)
1. Exception caught
2. Transaction rolled back
3. Error logged
4. Job re-enqueued with exponential backoff
5. Worker retries after delay

### Manual (> 5 seconds)
1. Operator reviews governance log
2. Fixes root cause
3. Calls `POST /workflows/:id/retry`
4. Workflow restarts from first state

---

## 🏗️ Tech Stack

```
Runtime:     Node.js 20 LTS
Framework:   Express 5.1
Language:    TypeScript 5.8
Database:    PostgreSQL 15
Queue:       BullMQ + Redis 7
ORM:         Prisma 6.19
Testing:     Jest + Supertest
Deployment:  Docker + Docker Compose
```

---

## 📈 Performance Expectations

| Metric | Target | Notes |
|--------|--------|-------|
| Create workflow | < 100ms | Sync API hit |
| Route job | < 500ms | Routing logic |
| Decision job | < 500ms | Policy evaluation |
| Action job | < 1s | External calls dominant |
| E2E (create to complete) | < 3s | All jobs + overhead |
| Audit trail query | < 200ms | Indexed by workflowId |

---

## 🚀 Deployment

### Local Development
```bash
docker-compose up -d          # PostgreSQL + Redis
npm install                   # Dependencies
npm run prisma:migrate        # Database schema
npm run dev                   # API server on :8000
npm run workers               # Worker processor
```

### Production
1. Managed PostgreSQL (RDS/GCP Cloud SQL)
2. Managed Redis (ElastiCache/GCP MemoryStore)
3. Kubernetes/Docker orchestration
4. Monitoring (DataDog/New Relic)
5. Alerting (PagerDuty)

---

## 📚 Related Documents

- **`SYSTEM_DESIGN.md`** — Full 7-section design with all details
- **`WORKERS_IMPLEMENTATION_COMPLETE.md`** — Worker code details
- **`API_DOCUMENTATION.md`** — HTTP endpoint specifications
- **`REQUIREMENTS_FULFILLMENT.md`** — Requirement mapping

---

## 🎓 Key Learning: Why This Design Works

### Problem: Multi-step workflows are hard
- State confusion (what's the current step?)
- Partial failures (what if step 2 fails?)
- Auditability (who did what when?)

### Solution: State machine + decoupled async processing
- **Explicit states** prevent confusion
- **Durable job queue** ensures at-least-once delivery
- **Immutable audit log** proves what happened
- **Transactional updates** prevent lost state
- **Exponential backoff** handles transient failures
- **Idempotency keys** prevent duplicate creation

### Result
- ✅ Reliable (recovers from any failure)
- ✅ Auditable (complete history)
- ✅ Observable (can trace any workflow)
- ✅ Scalable (workers can be distributed)
- ✅ Simple (linear flow, no branching)

---

## 🔗 Visual Diagrams

**See diagrams in this project:**

1. **State Machine** — Show all states and transitions
2. **System Architecture** — Show layers (API → Orchestration → Queue → Workers → DB)
3. **Execution Sequence** — Show timing of each step
4. **Data Evolution** — Show how contextData grows
5. **Error Handling** — Show retry logic and fallbacks

---

## 💡 Next Steps

1. **Review design** — Validate approach with stakeholders
2. **Scaffold project** — Initialize repository
3. **Implement Week 1** — API + core services
4. **Implement Week 2** — Workers + testing
5. **Deploy locally** — Verify end-to-end
6. **Deploy to prod** — Managed infrastructure
7. **Monitor** — Set up observability

---

## 📞 Questions & Decisions

| Question | Decision | Source |
|----------|----------|--------|
| How do we prevent duplicates? | Idempotency keys (unique constraint) | API layer |
| How do we handle failures? | Exponential backoff + manual retry | Worker layer |
| How do we audit? | Immutable governance log table | Orchestration layer |
| How do we scale? | Distributed workers (horizontal) | Worker layer |
| How do we monitor? | Trace ID + logs + metrics | Observability layer (future) |

---

**Status:** ✅ Design Complete, Ready for Implementation

