# State-Driven Workflow Engine — API Documentation

## Base URL

```
http://localhost:8000/api/v1
```

---

## Overview

The Workflow Engine is a multi-step, auditable workflow system that processes requests through a series of state transitions: **Route → Decision → Action → Governance Log**.

Each workflow:
- Starts in `INITIATED` state
- Moves through `ROUTING` → `DECISION_PENDING` → `ACTION_QUEUED`
- Ends in either `COMPLETED` or `FAILED`
- Is fully auditable via the Governance Log

---

## Authentication

Currently, the API uses **Idempotency-Key** headers for request deduplication. Future versions will add JWT authentication.

---

## Endpoints

### 1. Create a Workflow

**POST** `/workflows`

Creates a new workflow. Returns `202 Accepted` immediately. The workflow is queued for async processing.

#### Request

```bash
POST /api/v1/workflows
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "input": "Your workflow input data",
  "metadata": {
    "source": "mobile_app",
    "userId": "user_123"
  }
}
```

**Headers:**
- `Content-Type: application/json` (required)
- `Idempotency-Key: <UUID>` (required) — prevents duplicate workflow creation on network retries

**Body:**
- `payload` (any JSON) — the input data for the workflow

#### Response

**Status 202 Accepted**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "traceId": "550e8400-e29b-41d4-a716-446655440002",
  "status": "INITIATED",
  "contextData": {
    "input": "Your workflow input data",
    "metadata": {
      "source": "mobile_app",
      "userId": "user_123"
    }
  },
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "retryCount": 0,
  "createdAt": "2026-04-12T10:30:00Z",
  "updatedAt": "2026-04-12T10:30:00Z",
  "completedAt": null
}
```

**Error: 400 Bad Request**

Missing or invalid `Idempotency-Key` header:

```json
{
  "error": "Idempotency-Key header is required"
}
```

---

### 2. Get Workflow Status

**GET** `/workflows/{id}`

Retrieve the current state of a workflow.

#### Request

```bash
GET /api/v1/workflows/550e8400-e29b-41d4-a716-446655440001
Content-Type: application/json
```

#### Response

**Status 200 OK**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "traceId": "550e8400-e29b-41d4-a716-446655440002",
  "status": "DECISION_PENDING",
  "contextData": {
    "input": "Your workflow input data",
    "metadata": {
      "source": "mobile_app",
      "userId": "user_123"
    },
    "routeResult": {
      "path": "premium",
      "priority": 1
    },
    "decisionOutput": {
      "recommendation": "approve"
    }
  },
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "retryCount": 0,
  "createdAt": "2026-04-12T10:30:00Z",
  "updatedAt": "2026-04-12T10:30:05Z",
  "completedAt": null
}
```

**Error: 404 Not Found**

```json
{
  "error": "Workflow not found"
}
```

---

### 3. Get Workflow Audit Log

**GET** `/workflows/{id}/logs`

Retrieve the complete governance log for a workflow. This shows every state transition and the data at each step.

#### Request

```bash
GET /api/v1/workflows/550e8400-e29b-41d4-a716-446655440001/logs
Content-Type: application/json
```

#### Response

**Status 200 OK**

```json
[
  {
    "id": "log_001",
    "workflowId": "550e8400-e29b-41d4-a716-446655440001",
    "traceId": "550e8400-e29b-41d4-a716-446655440002",
    "fromState": "INITIATED",
    "toState": "ROUTING",
    "actor": "api_gateway",
    "payloadSnapshot": {
      "input": "Your workflow input data",
      "metadata": {
        "source": "mobile_app",
        "userId": "user_123"
      }
    },
    "createdAt": "2026-04-12T10:30:00Z"
  },
  {
    "id": "log_002",
    "workflowId": "550e8400-e29b-41d4-a716-446655440001",
    "traceId": "550e8400-e29b-41d4-a716-446655440002",
    "fromState": "ROUTING",
    "toState": "DECISION_PENDING",
    "actor": "route_worker",
    "payloadSnapshot": {
      "input": "Your workflow input data",
      "metadata": {
        "source": "mobile_app",
        "userId": "user_123"
      },
      "routeResult": {
        "path": "premium",
        "priority": 1
      }
    },
    "createdAt": "2026-04-12T10:30:02Z"
  },
  {
    "id": "log_003",
    "workflowId": "550e8400-e29b-41d4-a716-446655440001",
    "traceId": "550e8400-e29b-41d4-a716-446655440002",
    "fromState": "DECISION_PENDING",
    "toState": "ACTION_QUEUED",
    "actor": "decision_worker",
    "payloadSnapshot": {
      "input": "Your workflow input data",
      "metadata": {
        "source": "mobile_app",
        "userId": "user_123"
      },
      "routeResult": {
        "path": "premium",
        "priority": 1
      },
      "decisionOutput": {
        "recommendation": "approve"
      }
    },
    "createdAt": "2026-04-12T10:30:04Z"
  }
]
```

---

## Workflow States

| State | Description | Next Possible States |
|---|---|---|
| `INITIATED` | Workflow created, awaiting routing | `ROUTING`, `FAILED` |
| `ROUTING` | Route worker is determining the path | `DECISION_PENDING`, `FAILED` |
| `DECISION_PENDING` | Decision engine is processing the request | `ACTION_QUEUED`, `FAILED` |
| `ACTION_QUEUED` | Action worker is executing side effects | `COMPLETED`, `FAILED` |
| `COMPLETED` | Workflow finished successfully | (terminal) |
| `FAILED` | Workflow encountered an unrecoverable error | (terminal) |

---

## Idempotency & Retries

### Idempotency Key

Every request **must** include an `Idempotency-Key` header (a UUID). If the same key is sent twice:

1. **First request:** A new workflow is created
2. **Second request:** The existing workflow is returned (no duplicate created)

Example:

```bash
# Request 1
POST /api/v1/workflows
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
{ "input": "data" }
→ Returns new workflow, status 202

# Request 2 (network retry with same key)
POST /api/v1/workflows
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
{ "input": "data" }
→ Returns same workflow, status 202 (no duplicate)
```

### Automatic Worker Retries

If a worker fails, it automatically retries with exponential backoff:
- Retry 1: 2 seconds
- Retry 2: 8 seconds
- Retry 3: 30 seconds

After 3 failed attempts, the workflow transitions to `FAILED`.

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Example |
|---|---|---|
| `202` | Workflow created and queued for processing | New workflow created |
| `200` | Request successful | Workflow retrieved, logs retrieved |
| `400` | Bad request (missing headers, invalid format) | Missing `Idempotency-Key` |
| `404` | Workflow not found | Workflow ID does not exist |
| `500` | Internal server error | Unexpected system failure |

### Workflow Failure Reasons

When a workflow reaches `FAILED` state, the `contextData` includes a `failureReason`:

```json
{
  "status": "FAILED",
  "contextData": {
    "input": "...",
    "failureReason": {
      "stage": "decision_worker",
      "error": "External API timeout",
      "retryAttempts": 3,
      "timestamp": "2026-04-12T10:30:30Z"
    }
  }
}
```

---

## Testing the API

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL and Redis)
- cURL or Postman

### 1. Start the Local System

```bash
# Start PostgreSQL and Redis
docker compose up -d db redis

# Run migrations
npm run prisma:migrate

# Start the API
npm run dev
```

The API will be available at `http://localhost:8000`.

### 2. Health Check

```bash
curl http://localhost:8000/health
```

**Response:**

```json
{
  "ok": true
}
```

### 3. Create a Workflow

```bash
curl -X POST http://localhost:8000/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "input": "test workflow",
    "metadata": {
      "clientId": "test-client"
    }
  }'
```

Save the `id` from the response.

### 4. Poll for Workflow Status

```bash
# Replace {id} with the workflow ID from step 3
curl http://localhost:8000/api/v1/workflows/{id}
```

Repeat every 1-2 seconds to watch the workflow progress through states.

### 5. View the Audit Log

```bash
curl http://localhost:8000/api/v1/workflows/{id}/logs
```

This shows every state transition with a snapshot of the data at each step.

### 6. Test Idempotency

Send the same request twice with the same `Idempotency-Key`:

```bash
# First request
curl -X POST http://localhost:8000/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123-def-456" \
  -d '{ "input": "test" }'

# Second request (same key)
curl -X POST http://localhost:8000/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc-123-def-456" \
  -d '{ "input": "test" }'
```

Both requests return the same workflow ID.

---

## Example Workflow Lifecycle

### Step 1: Create Workflow

```bash
curl -X POST http://localhost:8000/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{
    "paymentAmount": 100,
    "userId": "user_123"
  }'

# Response (202 Accepted)
{
  "id": "wf_001",
  "status": "INITIATED",
  "contextData": {
    "paymentAmount": 100,
    "userId": "user_123"
  }
}
```

### Step 2: Status After 1 Second

```bash
curl http://localhost:8000/api/v1/workflows/wf_001

# Response
{
  "id": "wf_001",
  "status": "ROUTING",
  "contextData": {
    "paymentAmount": 100,
    "userId": "user_123",
    "route": "standard"
  }
}
```

### Step 3: Status After 3 Seconds

```bash
curl http://localhost:8000/api/v1/workflows/wf_001

# Response
{
  "id": "wf_001",
  "status": "DECISION_PENDING",
  "contextData": {
    "paymentAmount": 100,
    "userId": "user_123",
    "route": "standard",
    "decision": "approved"
  }
}
```

### Step 4: Status After 5 Seconds

```bash
curl http://localhost:8000/api/v1/workflows/wf_001

# Response
{
  "id": "wf_001",
  "status": "COMPLETED",
  "contextData": {
    "paymentAmount": 100,
    "userId": "user_123",
    "route": "standard",
    "decision": "approved",
    "actionResult": {
      "transactionId": "txn_789",
      "timestamp": "2026-04-12T10:30:10Z"
    }
  },
  "completedAt": "2026-04-12T10:30:10Z"
}
```

### Step 5: View Full Audit Trail

```bash
curl http://localhost:8000/api/v1/workflows/wf_001/logs

# Response: array of 4 log entries showing:
# 1. INITIATED → ROUTING
# 2. ROUTING → DECISION_PENDING
# 3. DECISION_PENDING → ACTION_QUEUED
# 4. ACTION_QUEUED → COMPLETED
```

---

## Design Principles

1. **Durable State** — Workflows survive service crashes. The database is authoritative.
2. **Immutable Audit Trail** — The Governance Log is append-only and tamper-resistant.
3. **Async by Default** — API returns 202 immediately; work happens in background workers.
4. **Idempotent Operations** — Retries and double-clicks never create duplicates.
5. **No Direct API Side Effects** — APIs only queue work; workers execute it atomically.

---

## Support & Questions

For issues, feature requests, or questions:
- Check the GitHub Issues: [link to repo]
- Email: [support email]
- Chat: [Slack/Discord link]

---

**Generated:** April 12, 2026  
**API Version:** 0.1.0  
**Stability:** Experimental
