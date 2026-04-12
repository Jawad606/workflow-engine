import { Worker } from 'bullmq';
import { workflowQueue } from '../core/queue.js';
import { processRoute } from './routeWorker.js';
import { processDecision } from './decisionWorker.js';
import { processAction } from './actionWorker.js';

/**
 * Unified Worker Processor
 * 
 * Single worker handles all job types and dispatches to appropriate handler
 */

const workerConnectionOptions = {
  host: process.env.SE_REDIS_HOST || 'localhost',
  port: parseInt(process.env.SE_REDIS_PORT || '6379', 10),
};

console.log('[WORKERS] Initializing workflow processors...');

// Single unified worker that processes all job types
const workflowWorker = new Worker('workflows', 
  async (job) => {
    console.log(`[WORKER] Processing ${job.name} job: ${job.id}`);
    
    switch (job.name) {
      case 'route':
        return await processRoute(job as any);
      case 'decision':
        return await processDecision(job as any);
      case 'action':
        return await processAction(job as any);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: workerConnectionOptions,
    concurrency: 5,
  }
);

workflowWorker.on('completed', (job) => {
  console.log(`[WORKER] Job ${job.id} (${job.name}) completed successfully`);
});

workflowWorker.on('failed', (job, error) => {
  console.error(`[WORKER] Job ${job?.id} (${job?.name}) failed:`, error.message);
});

console.log('[WORKERS] Route, Decision, and Action workers registered');

// Global error handling
process.on('SIGTERM', async () => {
  console.log('[WORKERS] SIGTERM received, gracefully shutting down...');
  await workflowWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[WORKERS] SIGINT received, gracefully shutting down...');
  await workflowWorker.close();
  process.exit(0);
});

console.log('[WORKERS] All workflow processors started and listening');
console.log('[WORKERS] Waiting for jobs from queue "workflows"...');
