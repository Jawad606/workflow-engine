# State-Driven Workflow Engine

Starter scaffold for a Node.js + Express + Prisma + PostgreSQL + BullMQ backend.

Base URL (local): `http://localhost:8000`

## Local stack

1. Copy `.env.example` to `.env`
2. Start PostgreSQL and Redis with `docker compose up -d`
3. Run `npm install`
4. Generate Prisma client with `npm run prisma:generate`
5. Apply migrations with `npm run prisma:migrate`
6. Start the API with `npm run dev`

## Entry points

- `POST /api/v1/workflows`
- `GET /api/v1/workflows/:id`
- `GET /api/v1/workflows/:id/logs`

## API Quick Reference

### Health

- `GET /health`
- Response: `200 OK`

```json
{ "ok": true }
```

### Create workflow

- `POST /api/v1/workflows`
- Required header: `Idempotency-Key`
- Body: JSON payload (stored as `contextData.input`)
- Response: `202 Accepted`

```bash
curl -X POST http://localhost:8000/api/v1/workflows \
	-H "Content-Type: application/json" \
	-H "Idempotency-Key: demo-key-001" \
	-d '{
		"paymentAmount": 150.5,
		"userId": "user_123",
		"merchant": "Acme Corp",
		"type": "purchase"
	}'
```

Common errors:

- `400 Bad Request` if `Idempotency-Key` header is missing

### Get workflow by id

- `GET /api/v1/workflows/:id`
- Response: `200 OK`

```bash
curl http://localhost:8000/api/v1/workflows/<workflow-id>
```

Common errors:

- `404 Not Found` if workflow does not exist

### Get governance logs

- `GET /api/v1/workflows/:id/logs`
- Response: `200 OK` (ordered ascending by `createdAt`)

```bash
curl http://localhost:8000/api/v1/workflows/<workflow-id>/logs
```