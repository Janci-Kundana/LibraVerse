import { runWithTenant } from '../core/tenant';
import { expireProSubscriptions } from '../modules/billing/service';
import { expirePayments } from '../modules/payments/service';

/** TC-02: unpaid requests past their window become `expired`. */
export function expireUnpaid(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, () => expirePayments(libraryId, now));
}

/** An unpaid Pro month has ended: back to Free. */
export function expireLapsedPro(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, () => expireProSubscriptions(libraryId, now));
}
