import { env } from '../config/env.js';
import { runReminderSweep } from './reminders.js';

/**
 * Starts the in-process reminder job. It never overlaps itself, and it is safe if several servers run it
 * (every effect is idempotent). Returns a function that stops it.
 */
export function startJobs({ log = console } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stats = await runReminderSweep();
      if (stats.postReminders || stats.postsReady || stats.deadlineReminders || stats.campaignReminders || stats.followUpReminders || stats.taskReminders || stats.taskOverdue || stats.invoiceReminders || stats.invoiceOverdue) log.log(`[jobs] reminders sent: ${JSON.stringify(stats)}`);
    } catch (err) {
      log.error(`[jobs] reminder sweep failed: ${err.name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, env.REMINDER_SWEEP_SECONDS * 1000);
  timer.unref();
  setTimeout(tick, 3000).unref(); // catch up shortly after boot, once the database is connected
  return () => clearInterval(timer);
}
