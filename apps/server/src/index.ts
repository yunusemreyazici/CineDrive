import { buildApp } from './app.js';
import { env } from './config/env.js';

const start = async () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app?.close();
    } finally {
      process.kill(process.pid, signal);
    }
  };

  try {
    app = await buildApp();
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 CineDrive Server running at http://localhost:${env.PORT}`);
  } catch (err) {
    console.error('Fatal server start error:', err);
    process.exit(1);
  }
};

void start();
