import cron from 'node-cron';
import { runAsSystem } from '../core/tenant';
import { LibraryModel } from '../modules/libraries/model';
import { expireReservationHolds, sendExpiryReminders, sendLoanReminders } from './circulation';

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
];

export function registerJob(name: string, schedule: string, run: PerLibraryJob) {
  jobs.push({ name, schedule, run });
}

export function startJobs() {
  for (const job of jobs) {
    cron.schedule(job.schedule, () => void forEachActiveLibrary(job.name, job.run), {
      timezone: 'Asia/Kolkata',
    });
  }
  console.log(`Scheduled ${jobs.length} background jobs`);
}
