import type { Notice } from '../../core/notify';
import { rupees } from '../circulation/rules';

// Dues and deposit messages (sent through notify(): email, in-app, push).
// Every value is filled in from the member's records.

const day = (d: Date) =>
  d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

interface WarningData {
  name: string;
  library: string;
  due: number;
  deposit: number;
  nextWarningAt?: Date | null;
  deductionAt?: Date | null;
}

const ORDINAL = ['', 'First', 'Second', 'Third'] as const;

export function warning(n: 1 | 2 | 3 | number, d: WarningData): Notice {
  const lines = [
    `Hi ${d.name},`,
    '',
    `${ORDINAL[n] ?? `Warning ${n}`} reminder: you have unpaid dues of ${rupees(d.due)} at ${d.library} for late, damaged or lost books.`,
    'This amount is fixed now that the book is back: it will not grow.',
    '',
    'Pay it in LibraVerse (My books → Pay now) or at the library counter.',
  ];
  if (n < 3 && d.nextWarningAt)
    lines.push(`If it is still unpaid, we will remind you again on ${day(d.nextWarningAt)}.`);
  if (n === 3 && d.deductionAt) {
    lines.push(
      '',
      `This is the last reminder. If the dues are still unpaid on ${day(d.deductionAt)}, ${rupees(Math.min(d.deposit, d.due))} will be deducted from your security deposit (current balance ${rupees(d.deposit)}).`,
    );
    if (d.deposit < d.due) {
      lines.push(
        `Your deposit does not cover the full amount, so ${rupees(d.due - d.deposit)} would still be owed and your card would be blocked until it is paid.`,
      );
    }
  }
  return {
    type: `dues.warning${n}`,
    subject: `${ORDINAL[n] ?? 'Another'} reminder: ${rupees(d.due)} unpaid at ${d.library}`,
    text: lines.join('\n'),
  };
}

export function deductionTomorrow(d: {
  name: string;
  library: string;
  due: number;
  deposit: number;
  deduct: number;
  at: Date;
}): Notice {
  const remaining = d.due - d.deduct;
  return {
    type: 'dues.deductionTomorrow',
    subject: `${rupees(d.deduct)} will be deducted from your deposit tomorrow`,
    text: [
      `Hi ${d.name},`,
      '',
      `Your dues of ${rupees(d.due)} at ${d.library} are still unpaid.`,
      `On ${day(d.at)} we will deduct ${rupees(d.deduct)} from your security deposit.`,
      `Current deposit balance: ${rupees(d.deposit)}. Balance after the deduction: ${rupees(d.deposit - d.deduct)}.`,
      remaining > 0
        ? `Your deposit does not cover everything: ${rupees(remaining)} will still be owed and your card will be blocked until you pay it.`
        : 'This will clear your dues in full.',
      '',
      'Pay before then (My books → Pay now, or at the counter) and nothing will be deducted.',
    ].join('\n'),
  };
}

export function deducted(d: {
  name: string;
  library: string;
  deducted: number;
  dueBefore: number;
  dueAfter: number;
  deposit: number;
  at: Date;
}): Notice {
  const lines = [
    `Hi ${d.name},`,
    '',
    d.deducted > 0
      ? `On ${day(d.at)} we deducted ${rupees(d.deducted)} from your security deposit at ${d.library}.`
      : `Your dues at ${d.library} could not be deducted on ${day(d.at)} because your security deposit is empty.`,
    `Reason: dues unpaid after three reminders (late, damaged or lost books).`,
    `Original due: ${rupees(d.dueBefore)}.`,
    `Remaining deposit: ${rupees(d.deposit)}.`,
  ];
  if (d.dueAfter > 0) {
    lines.push(
      `Still owed: ${rupees(d.dueAfter)}.`,
      '',
      'Your membership card is blocked until the remaining amount is paid. Pay it in LibraVerse (My books → Pay now) or at the counter.',
    );
  } else {
    lines.push('', 'Your dues are now fully cleared.');
  }
  return {
    type: 'dues.deducted',
    subject:
      d.dueAfter > 0
        ? `Card blocked: ${rupees(d.dueAfter)} still owed`
        : `${rupees(d.deducted)} deducted from your deposit`,
    text: lines.join('\n'),
  };
}
