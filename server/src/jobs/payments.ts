import { runWithTenant } from '../core/tenant';
import { expirePayments } from '../modules/payments/service';

/** TC-02: unpaid requests past their window become `expired`. */
export function expireUnpaid(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, () => expirePayments(libraryId, now));
}
