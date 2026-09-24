import fs from 'node:fs';
import { e2eRuntimeRoot } from './env.js';
import { seedE2EDatabase } from './seed.js';

const start = async () => {
  await seedE2EDatabase();
  // Import only after changing cwd: production services resolve their caches at
  // startup. Run the real entry point without adding test-only application APIs.
  fs.mkdirSync(e2eRuntimeRoot, { recursive: true });
  process.chdir(e2eRuntimeRoot);
  await import('../apps/server/src/index.js');
};

void start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
