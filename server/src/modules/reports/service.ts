import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { runAsSystem } from '../../core/tenant';
import { BookModel } from '../books/model';
import { BookCopyModel } from '../copies/model';
import { LibraryModel } from '../libraries/model';
import { LoanModel } from '../loans/model';
import { MemberProfileModel } from '../members/model';
import { PaymentModel } from '../payments/model';
import { PlatformPaymentModel } from '../billing/model';
import { UserModel } from '../users/model';

// FR-11 (library reports) and FR-07 (platform analytics). Money in paise.

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function lastMonths(n: number, now = new Date()) {
  const out: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = n - 1; i >= 0; i--)
    out.push(monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
  return out;
}

function fillMonths(rows: { _id: string; value: number }[], months: string[]) {
  const map = new Map(rows.map((r) => [r._id, r.value]));
  return months.map((m) => ({ month: m, value: map.get(m) ?? 0 }));
}

/** Library dashboard (tenant context). */
export async function libraryDashboard() {
  const now = new Date();
  const months = lastMonths(12, now);
  const since = new Date(`${months[0]}-01T00:00:00Z`);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [
    members,
    pending,
    titles,
    copies,
    activeLoans,
    overdue,
    revenueRows,
    loansRows,
    popular,
    dues,
  ] = await Promise.all([
    UserModel.countDocuments({ role: 'member', status: 'active' }),
    MemberProfileModel.countDocuments({ verificationStatus: 'pending' }),
    BookModel.countDocuments(),
    BookCopyModel.countDocuments({ status: { $ne: 'lost' } }),
    LoanModel.countDocuments({ status: 'active' }),
    LoanModel.countDocuments({ status: 'active', dueAt: { $lt: now } }),
    PaymentModel.aggregate<{ _id: string; value: number }>([
      { $match: { status: 'success', paidAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
          value: { $sum: { $subtract: ['$amount', { $ifNull: ['$refund.amount', 0] }] } },
        },
      },
    ]),
    LoanModel.aggregate<{ _id: string; value: number }>([
      { $match: { issuedAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$issuedAt' } },
          value: { $sum: 1 },
        },
      },
    ]),
    BookModel.find({ borrowCount: { $gt: 0 } })
      .sort({ borrowCount: -1 })
      .limit(10)
      .select('title borrowCount')
      .lean(),
    LoanModel.aggregate<{ total: number }>([
      { $match: { duesPaidAt: null, status: { $in: ['returned', 'lost'] } } },
      { $group: { _id: null, total: { $sum: { $add: ['$fineAmount', '$damageCharge'] } } } },
    ]),
  ]);

  const days: string[] = [];
  for (let i = 29; i >= 0; i--)
    days.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  const loanMap = new Map(loansRows.map((r) => [r._id, r.value]));
  const revenue = fillMonths(revenueRows, months);

  return {
    totals: {
      members,
      pendingVerifications: pending,
      titles,
      copies,
      activeLoans,
      overdueLoans: overdue,
      revenueThisMonth: revenue.at(-1)?.value ?? 0,
      outstandingDues: dues[0]?.total ?? 0,
    },
    revenueByMonth: revenue,
    loansByDay: days.map((d) => ({ day: d, value: loanMap.get(d) ?? 0 })),
    popularBooks: popular.map((b) => ({
      id: String(b._id),
      title: b.title,
      borrows: b.borrowCount,
    })),
  };
}

/**
 * Platform analytics for the Super Admin (FR-07). System context. Only
 * library-level totals: counts per library, never member or book records.
 */
export function platformDashboard() {
  return runAsSystem('superAdmin:platform-totals', async () => {
    const months = lastMonths(12);
    const since = new Date(`${months[0]}-01T00:00:00Z`);
    const [byStatus, newRows, revenueRows, memberCounts, libs] = await Promise.all([
      LibraryModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      LibraryModel.aggregate<{ _id: string; value: number }>([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            value: { $sum: 1 },
          },
        },
      ]),
      PlatformPaymentModel.aggregate<{ _id: string; value: number }>([
        { $match: { status: 'success', paidAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
            value: { $sum: { $subtract: ['$amount', { $ifNull: ['$refund.amount', 0] }] } },
          },
        },
      ]),
      UserModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { role: 'member', status: 'active' } },
        { $group: { _id: '$libraryId', count: { $sum: 1 } } },
      ]),
      LibraryModel.find({ status: 'active' }).select('name').lean(),
    ]);
    const members = new Map(memberCounts.map((m) => [String(m._id), m.count]));
    return {
      librariesByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
      totalMembers: memberCounts.reduce((s, m) => s + m.count, 0),
      newLibrariesByMonth: fillMonths(newRows, months),
      revenueByMonth: fillMonths(revenueRows, months),
      topLibraries: libs
        .map((l) => ({ id: String(l._id), name: l.name, members: members.get(String(l._id)) ?? 0 }))
        .sort((a, b) => b.members - a.members)
        .slice(0, 10),
    };
  });
}

// ---------------------------------------------------------------- exports

export const REPORT_TYPES = ['payments', 'loans', 'overdue'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

interface Table {
  title: string;
  columns: { header: string; key: string; width: number }[];
  rows: Record<string, string | number>[];
}

const rs = (paise: number) => Number((paise / 100).toFixed(2));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

async function names(ids: unknown[]) {
  const users = await UserModel.find({ _id: { $in: ids } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

export async function reportTable(type: ReportType, from: Date, to: Date): Promise<Table> {
  if (type === 'payments') {
    const list = await PaymentModel.find({ createdAt: { $gte: from, $lte: to } })
      .sort({ createdAt: 1 })
      .lean();
    const who = await names([...list.map((p) => p.memberId), ...list.map((p) => p.collectedBy)]);
    return {
      title: 'Payments',
      columns: [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Member', key: 'member', width: 24 },
        { header: 'Purpose', key: 'purpose', width: 12 },
        { header: 'Method', key: 'method', width: 12 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Amount (Rs)', key: 'amount', width: 12 },
        { header: 'Refunded (Rs)', key: 'refunded', width: 13 },
        { header: 'Receipt', key: 'receipt', width: 24 },
        { header: 'Collected by', key: 'collectedBy', width: 20 },
      ],
      rows: list.map((p) => ({
        date: day(p.paidAt ?? p.createdAt),
        member: who.get(String(p.memberId)) ?? '',
        purpose: p.purpose,
        method: p.method,
        status: p.status,
        amount: rs(p.amount),
        refunded: rs(p.refund?.amount ?? 0),
        receipt: p.receiptNo ?? '',
        collectedBy: p.collectedBy ? (who.get(String(p.collectedBy)) ?? '') : '',
      })),
    };
  }
  const filter =
    type === 'overdue'
      ? { status: 'active', dueAt: { $lt: new Date() } }
      : { issuedAt: { $gte: from, $lte: to } };
  const loans = await LoanModel.find(filter).sort({ issuedAt: 1 }).lean();
  const [who, books] = await Promise.all([
    names(loans.map((l) => l.memberId)),
    BookModel.find({ _id: { $in: loans.map((l) => l.bookId) } })
      .select('title')
      .lean(),
  ]);
  const title = new Map(books.map((b) => [String(b._id), b.title]));
  return {
    title: type === 'overdue' ? 'Overdue loans' : 'Loans',
    columns: [
      { header: 'Book', key: 'book', width: 34 },
      { header: 'Member', key: 'member', width: 24 },
      { header: 'Issued', key: 'issued', width: 12 },
      { header: 'Due', key: 'due', width: 12 },
      { header: 'Returned', key: 'returned', width: 12 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Fine (Rs)', key: 'fine', width: 10 },
    ],
    rows: loans.map((l) => ({
      book: title.get(String(l.bookId)) ?? '',
      member: who.get(String(l.memberId)) ?? '',
      issued: day(l.issuedAt),
      due: day(l.dueAt),
      returned: day(l.returnedAt),
      status: l.status,
      fine: rs(l.fineAmount + l.damageCharge),
    })),
  };
}

export async function toXlsx(t: Table, libraryName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LibraVerse';
  const ws = wb.addWorksheet(t.title);
  ws.columns = t.columns;
  ws.getRow(1).font = { bold: true };
  ws.addRows(t.rows);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  wb.title = `${libraryName}: ${t.title}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(t: Table, libraryName: string, range: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  doc.font('Helvetica-Bold').fontSize(14).text(`${libraryName}: ${t.title}`);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#555')
    .text(`${range} · ${t.rows.length} rows`)
    .fillColor('#000');
  doc.moveDown();

  const totalW = t.columns.reduce((s, c) => s + c.width, 0);
  const usable = doc.page.width - 60;
  const widths = t.columns.map((c) => (c.width / totalW) * usable);
  const drawRow = (cells: string[], bold = false) => {
    if (doc.y > doc.page.height - 50) doc.addPage();
    const y = doc.y;
    let x = 30;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((cell, i) => {
      doc.text(cell, x, y, { width: widths[i]! - 4, height: 11, ellipsis: true, lineBreak: false });
      x += widths[i]!;
    });
    doc.y = y + 13;
  };
  drawRow(
    t.columns.map((c) => c.header),
    true,
  );
  for (const r of t.rows) drawRow(t.columns.map((c) => String(r[c.key] ?? '')));
  doc.end();
  return done;
}
