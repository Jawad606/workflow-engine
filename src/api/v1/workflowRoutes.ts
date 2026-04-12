import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../../core/db.js';
import { startWorkflow } from '../../services/queryOrchestrator.js';

export const workflowRoutes = Router();

workflowRoutes.post('/workflows', async (request: Request, response: Response, next: NextFunction) => {
  try {
    const idempotencyKey = String(request.header('Idempotency-Key') ?? '');

    if (!idempotencyKey) {
      response.status(400).json({ error: 'Idempotency-Key header is required' });
      return;
    }

    const workflow = await startWorkflow(
      {
        idempotencyKey,
        payload: request.body
      },
      prisma
    );

    response.status(202).json(workflow);
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

    response.json(workflow);
  } catch (error) {
    next(error);
  }
});

workflowRoutes.get('/workflows/:id/logs', async (request: Request, response: Response, next: NextFunction) => {
  try {
    const logs = await prisma.governanceLog.findMany({
      where: { workflowId: String(request.params.id) },
      orderBy: { createdAt: 'asc' }
    });

    response.json(logs);
  } catch (error) {
    next(error);
  }
});