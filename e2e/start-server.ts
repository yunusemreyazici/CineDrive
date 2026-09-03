import fs from 'node:fs';
import { e2eRuntimeRoot } from './env.js';

// Import only after changing cwd: production services resolve their caches at
// startup. Run the real entry point without adding test-only application APIs.
fs.mkdirSync(e2eRuntimeRoot, { recursive: true });
process.chdir(e2eRuntimeRoot);
void import('../apps/server/src/index.js').catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
