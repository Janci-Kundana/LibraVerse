import 'dotenv/config';
import http from 'node:http';
import { env } from './config/env';
import { connectDb, disconnectDb } from './core/db';
import { createApp } from './app';
import { runAsSystem } from './core/tenant';
import { ensureDefaultPlans } from './modules/platformPlans/service';
import { startJobs } from './jobs/scheduler';
import { attachRealtime } from './realtime/io';

async function main() {
  await connectDb(env.MONGODB_URI);
  console.log('MongoDB connected');
  await runAsSystem('startup:seed-plans', ensureDefaultPlans);

  if (env.CRON_ENABLED) startJobs();

  const server = http.createServer(createApp());
  attachRealtime(server);
  server.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
