import type { LoanDto } from '@libraverse/shared';
import { StatusPill } from '../../components/ui';
import { formatDate, rupees } from '../../lib/format';

export function LoanSummary({ loan, showMember = false }: { loan: LoanDto; showMember?: boolean }) {
  const owed = loan.fineAmount + loan.damageCharge;
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{loan.bookTitle}</p>
      <p className="text-sm text-gray-400">
        {showMember && `${loan.memberName} · `}
        {loan.status === 'active'
          ? `Due ${formatDate(loan.dueAt)}`
          : `Returned ${formatDate(loan.returnedAt)}`}
        {loan.renewals > 0 && ` · renewed ${loan.renewals}×`}
        <span className="font-mono text-xs text-gray-500"> · {loan.copyCode}</span>
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {loan.status === 'active' && loan.overdueDays > 0 && (
          <StatusPill tone="red">
            {loan.overdueDays} day{loan.overdueDays > 1 ? 's' : ''} overdue ·{' '}
            {rupees(loan.fineAmount)} so far
          </StatusPill>
        )}
        {loan.status !== 'active' && owed > 0 && (
          <StatusPill tone={loan.duesPaid ? 'green' : 'red'}>
            {rupees(owed)} {loan.chargeNote ? `(${loan.chargeNote.toLowerCase()})` : 'late fine'} ·{' '}
            {loan.duesPaid ? 'paid' : 'unpaid'}
          </StatusPill>
        )}
        {loan.status === 'lost' && <StatusPill tone="gray">lost</StatusPill>}
      </div>
    </div>
  );
}
