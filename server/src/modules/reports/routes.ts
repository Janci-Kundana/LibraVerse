import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../core/errors';
import { AuditLogModel } from '../audit/model';
import { verifyAuditChain } from '../audit/service';
import { authenticate, libraryOf, requireRole } from '../auth/middleware';
import { LibraryModel } from '../libraries/model';
import { UserModel } from '../users/model';
import * as reports from './service';

export const reportRoutes = Router();
reportRoutes.use(authenticate, requireRole('libraryAdmin'));

reportRoutes.get('/dashboard', async (_req, res) => {
  res.json(await reports.libraryDashboard());
});

const exportQuery = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86_400_000)),
  to: z.coerce.date().default(() => new Date()),
});

reportRoutes.get('/:type.:format', async (req, res) => {
  const type = req.params.type as reports.ReportType;
  const format = req.params.format;
  if (!reports.REPORT_TYPES.includes(type) || !['pdf', 'xlsx'].includes(format)) {
    throw new AppError(404, 'NOT_FOUND', 'Unknown report');
  }
  const { from, to } = exportQuery.parse(req.query);
  to.setHours(23, 59, 59, 999);
  const lib = await LibraryModel.findById(libraryOf(req)).select('name').lean();
  const table = await reports.reportTable(type, from, to);
  const name = `${type}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}`;
  if (format === 'xlsx') {
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .set('Content-Disposition', `attachment; filename="${name}.xlsx"`)
      .send(await reports.toXlsx(table, lib?.name ?? ''));
  } else {
    const range =
      type === 'overdue'
        ? `As of ${new Date().toISOString().slice(0, 10)}`
        : `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
    res
      .type('application/pdf')
      .set('Content-Disposition', `attachment; filename="${name}.pdf"`)
      .send(await reports.toPdf(table, lib?.name ?? '', range));
  }
});

/** FR-11: the library's append-only audit log, with chain verification. */
export const auditRoutes = Router();
auditRoutes.use(authenticate, requireRole('libraryAdmin'));
auditRoutes.get('/', async (req, res) => {
  const q = z
    .object({
      action: z.string().trim().max(60).optional(),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const filter = q.action
    ? { action: { $regex: `^${q.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }
    : {};
  const pageSize = 50;
  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort({ seq: -1 })
      .skip((q.page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  const actors = await UserModel.find({ _id: { $in: items.map((i) => i.actorId).filter(Boolean) } })
    .select('name')
    .lean();
  const actorName = new Map(actors.map((a) => [String(a._id), a.name]));
  res.json({
    total,
    page: q.page,
    pageSize,
    items: items.map((i) => ({
      seq: i.seq,
      action: i.action,
      actorName: i.actorId ? (actorName.get(String(i.actorId)) ?? 'Platform admin') : 'System',
      actorRole: i.actorRole,
      target: i.target,
      details: i.details,
      createdAt: i.createdAt.toISOString(),
    })),
  });
});
auditRoutes.get('/verify', async (req, res) => {
  const broken = await verifyAuditChain(libraryOf(req));
  res.json({ intact: broken === null, brokenAtSeq: broken });
});

export const platformReportRoutes = Router();
platformReportRoutes.use(authenticate, requireRole('superAdmin'));
platformReportRoutes.get('/dashboard', async (_req, res) => {
  res.json(await reports.platformDashboard());
});
