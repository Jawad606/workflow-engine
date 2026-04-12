import { Router } from 'express';
import { workflowRoutes } from './workflowRoutes.js';

export const apiV1 = Router();

apiV1.use(workflowRoutes);