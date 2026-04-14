# MSK Clinical Workflow Engine

State-driven clinical workflow engine for:

User reports lower back pain -> routed to MSK -> decision PT-first -> referral created.

Base URL (local): `http://localhost:8000`

## Quick Start

1. Copy `.env.example` to `.env`.
2. Start dependencies:

```bash
docker-compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Run database migrations:

```bash
npm run prisma:migrate
```

5. Start API server:

```bash
npm run dev
```

6. Start workers (in a separate terminal):

```bash
npm run workers
```

## Endpoints

- `POST /api/v1/workflows`
- `GET /api/v1/workflows/:id`
- `GET /api/v1/workflows/:id/logs`

## Example: Create MSK Workflow

```bash
curl -X POST http://localhost:8000/api/v1/workflows \
	-H "Content-Type: application/json" \
	-d '{
		"idempotencyKey": "user_456_20260414",
		"payload": {
			"symptom": "lower back pain",
			"pain_level": 3,
			"duration": "2 weeks",
			"red_flags": false,
			"age": 34,
			"patient_id": "patient_001"
		}
	}'
```

Expected response (`202 Accepted`):

```json
{
	"workflow_id": "wf_001",
	"status": "INITIATED"
}
```

## Example: Get Workflow State

```bash
curl http://localhost:8000/api/v1/workflows/wf_001
```

Sample response after completion:

```json
{
	"id": "wf_001",
	"status": "COMPLETED",
	"pathway_selected": "MSK",
	"recommended_care": "physical_therapy",
	"is_adhered": true,
	"is_leakage": false,
	"is_overridden": false,
	"contextData": {
		"input": {
			"symptom": "lower back pain",
			"pain_level": 3,
			"duration": "2 weeks",
			"red_flags": false,
			"age": 34,
			"patient_id": "patient_001"
		},
		"pathway_selected": "MSK",
		"routingDecision": {
			"recommended_pathway": "MSK",
			"confidence": "high",
			"rule_matched": "musculoskeletal_symptoms_no_red_flags",
			"override": null
		},
		"decision": {
			"recommended_care": "physical_therapy",
			"care_type": "telehealth",
			"urgency": "routine",
			"conditions_met": [
				"pain_level <= 4",
				"no_red_flags",
				"MSK_pathway",
				"no_failed_pt_history"
			],
			"override": null,
			"is_adhered": null
		},
		"actionResult": {
			"action": "referral_created",
			"provider": "City PT Clinic",
			"provider_type": "telehealth",
			"in_network": true,
			"is_leakage": false,
			"referral_id": "ref_1713090120000",
			"navigator_notified": true
		},
		"adherence": {
			"is_adhered": true,
			"calculated_at": "2026-04-14T09:00:03.000Z"
		}
	},
	"createdAt": "2026-04-14T09:00:00.000Z",
	"completedAt": "2026-04-14T09:00:03.000Z"
}
```

## Example: Get Governance Timeline

```bash
curl http://localhost:8000/api/v1/workflows/wf_001/logs
```

Sample response:

```json
{
	"workflowId": "wf_001",
	"traceId": "trace_abc123",
	"timeline": [
		{
			"timestamp": "2026-04-14T09:00:00.000Z",
			"stage": "Intake",
			"narrative": "Patient reported lower back pain (pain level 3/10, red flags: no). Workflow created and queued for routing."
		},
		{
			"timestamp": "2026-04-14T09:00:01.000Z",
			"stage": "Route",
			"narrative": "Symptoms matched MSK Pathway criteria. No red flags detected. Patient assigned to MSK Spine Pathway automatically."
		},
		{
			"timestamp": "2026-04-14T09:00:02.000Z",
			"stage": "Decision",
			"narrative": "PT-first pathway selected. Pain score mild (3/10), no red flags, no prior failed PT on record. Telehealth Physical Therapy recommended as first line of care."
		},
		{
			"timestamp": "2026-04-14T09:00:03.000Z",
			"stage": "Action",
			"narrative": "Referral created for City PT Clinic (Telehealth, In-Network). Care navigator notified. Workflow completed. No overrides. Pathway adhered."
		}
	],
	"summary": {
		"pathway_selected": "MSK",
		"recommended_care": "physical_therapy",
		"action_taken": "referral_created",
		"is_adhered": true,
		"is_overridden": false,
		"is_leakage": false,
		"logs_count": 4
	}
}
```