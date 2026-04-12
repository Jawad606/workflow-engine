/**
 * Worker Server Entry Point
 * 
 * Start this with: npm run workers
 * This runs the BullMQ worker processors that handle:
 * - Route jobs (classify workflows)
 * - Decision jobs (evaluate workflows)
 * - Action jobs (execute side effects)
 */

import './workers/processor.js';
import { config } from './core/config.js';

console.log('╔════════════════════════════════════════╗');
console.log('║   Workflow Engine - Worker Processor   ║');
console.log('╚════════════════════════════════════════╝');
console.log();
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Database: ${config.databaseUrl.substring(0, 30)}...`);
console.log(`Redis: ${config.redisUrl}`);
console.log();
console.log('Workers are now running and listening for jobs...');
console.log();
