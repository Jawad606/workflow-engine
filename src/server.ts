import { buildApp } from './app.js';
import { config } from './core/config.js';

const app = buildApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Workflow engine listening on port ${config.port}`);
});