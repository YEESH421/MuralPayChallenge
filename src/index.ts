import 'dotenv/config';
import { config } from './config';
import { createApp } from './app';
import { startPollingJob } from './jobs/pollTransactions';
import { initDb } from './initDb';

async function main() {
  await initDb();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
    startPollingJob();
  });
}

main().catch(console.error);
