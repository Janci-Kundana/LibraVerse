import cron from 'node-cron';
import { runAsSystem } from '../core/tenant';
import { LibraryModel } from '../modules/libraries/model';
import { expireReservationHolds, sendExpiryReminders, sendLoanReminders } from './circulation';
import { expireLapsedPro, expireUnpaid } from './payments';
import { expirePlatformPayments } from '../modules/billing/service';

type PerLibraryJob = (libraryId: string, now: Date) => Promise<unknown>;

// Cron runs outside any request, so the library list is read in system context;
// each job then runs inside that library's own tenant context.
export async function forEachActiveLibrary(name: string, job: PerLibraryJob, now = new Date()) {
  const ids = await runAsSystem(`cron:${name}`, () =>
    LibraryModel.find({ status: 'active' }).distinct('_id'),
  );
  for (const id of ids) {
    try {
      await job(String(id), now);
    } catch (err) {
      console.error(`cron ${name} failed for library ${String(id)}:`, err);
    }
  }
}

const jobs: { name: string; schedule: string; run: PerLibraryJob }[] = [
  { name: 'loan-reminders', schedule: '0 9 * * *', run: sendLoanReminders }, // daily 09:00
  { name: 'expiry-reminders', schedule: '15 9 * * *', run: sendExpiryReminders },
  { name: 'reservation-holds', schedule: '0 * * * *', run: expireReservationHolds }, // hourly
  { name: 'payment-expiry', schedule: '* * * * *', run: expireUnpaid }, // every minute
  { name: 'pro-expiry', schedule: '30 0 * * *', run: expireLapsedPro }, // daily 00:30
];

export function registerJob(name: string, schedule: string, run: PerLibraryJob) {
  jobs.push({ name, schedule, run });
}

// Platform-wide jobs (no library context).
const platformJobs: { name: string; schedule: string; run: () => Promise<unknown> }[] = [
  { name: 'platform-payment-expiry', schedule: '* * * * *', run: () => expirePlatformPayments() },
];

export function startJobs() {
  for (const job of platformJobs) {
    cron.schedule(
      job.schedule,
      () => void job.run().catch((e) => console.error(`cron ${job.name}:`, e)),
      {
        timezone: 'Asia/Kolkata',
      },
    );
  }
  for (const job of jobs) {
    cron.schedule(job.schedule, () => void forEachActiveLibrary(job.name, job.run), {
      timezone: 'Asia/Kolkata',
    });
  }
  console.log(`Scheduled ${jobs.length} background jobs`);
}
