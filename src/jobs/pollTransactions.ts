import cron from 'node-cron';
import { matchDeposits } from '../services/orderService';

let isRunning = false;

export function startPollingJob(): void {
  // Run every 60 seconds as a backup to webhooks
  cron.schedule('* * * * *', async () => {
    if (isRunning) return; // skip if previous run is still in progress
    isRunning = true;
    try {
      await matchDeposits();
    } catch (err) {
      console.error('[poll] Transaction poll failed:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log('[poll] Backup transaction polling started (every 60s)');
}
