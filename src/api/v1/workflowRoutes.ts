import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/db.js';
import { startWorkflow } from '../../services/queryOrchestrator.js';
import { buildWorkflowSummary, mapLogStage } from '../../services/governanceLogService.js';

export const workflowRoutes = Router();

const createWorkflowSchema = z.object({
  idempotencyKey: z.string().min(1),
  payload: z.object({
    symptom: z.string().min(1),
    pain_level: z.number().int().min(0).max(10),
    duration: z.string().min(1),
    red_flags: z.boolean(),
    age: z.number().int().positive(),
    patient_id: z.string().min(1),
    failed_pt_history: z.boolean().optional()
  })
});

workflowRoutes.post('/workflows', async (request: Request, response: Response, next: NextFunction) => {
  try {
    const parsed = createWorkflowSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'Invalid workflow request payload',
        details: parsed.error.flatten()
      });
      return;
    }

    const { idempotencyKey, payload } = parsed.data;

    const workflow = await startWorkflow(
      {
        idempotencyKey,
        payload
      },
      prisma
    );

    response.status(202).json({
      workflow_id: workflow.id,
      status: workflow.status
    });
  } catch (error) {
    next(error);
  }
});

workflowRoutes.get('/workflows/:id', async (request: Request, response: Response, next: NextFunction) => {
  try {
    const workflow = await prisma.workflowRecord.findUnique({
      where: { id: String(request.params.id) }
    });

    if (!workflow) {
      response.status(404).json({ error: 'Workflow not found' });
      return;
    }

    response.json({
      id: workflow.id,
      status: workflow.status,
      pathway_selected: workflow.recommendedPathway,
      recommended_care: workflow.recommendedCare,
      is_adhered: workflow.isAdhered,
      is_leakage: workflow.isLeakage,
      is_overridden: workflow.isOverridden,
      contextData: workflow.contextData,
      createdAt: workflow.createdAt,
      completedAt: workflow.completedAt
    });
  } catch (error) {
    next(error);
  }
});

workflowRoutes.get('/workflows/:id/logs', async (request: Request, response: Response, next: NextFunction) => {
  try {
    const workflowId = String(request.params.id);
    const workflow = await prisma.workflowRecord.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      response.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const logs = await prisma.governanceLog.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'asc' }
    });

    response.json({
      workflowId: workflow.id,
      traceId: workflow.traceId,
      timeline: logs.map((log) => ({
        timestamp: log.createdAt,
        stage: mapLogStage(log),
        narrative: log.narrative
      })),
      summary: buildWorkflowSummary(workflow, logs)
    });
  } catch (error) {
    next(error);
  }
});