import { Queue } from 'bullmq';
import { config } from './config.js';

export const connection = {
  url: config.redisUrl
};

export const workflowQueue = new Queue('workflows', {
  connection
});