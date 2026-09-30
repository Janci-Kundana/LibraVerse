import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { notFound, parseId } from '../../core/ids';
import { notify } from '../../core/notify';
import { validateBody } from '../../core/validate';
import { authenticate, libraryOf, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import { UserModel } from '../users/model';
import { EventModel } from './model';

const body = z.object({
  kind: z.enum(['event', 'announcement']),
  title: z.string().trim().min(2).max(150),
  date: z.coerce.date().nullable().optional(),
  description: z.string().trim().max(5000).default(''),
  notifyMembers: z.boolean().default(false),
});

const toDto = (e: {
  _id: Types.ObjectId;
  kind: string;
  title: string;
  date?: Date | null;
  description: string;
  createdAt: Date;
}) => ({
  id: String(e._id),
  kind: e.kind,
  title: e.title,
  date: e.date ? e.date.toISOString() : null,
  description: e.description,
  createdAt: e.createdAt.toISOString(),
});

/** Upcoming events and recent announcements. */
async function board() {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const list = await EventModel.find({
    $or: [
      { kind: 'event', date: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      { kind: 'announcement', createdAt: { $gte: since } },
    ],
  })
    .sort({ kind: 1, date: 1, createdAt: -1 })
    .limit(100)
    .lean();
  return list.map(toDto);
}

export const eventRoutes = Router();
eventRoutes.use(authenticate, requireRole('librarian'));
eventRoutes.get('/', async (_req, res) => {
  res.json((await EventModel.find().sort({ createdAt: -1 }).limit(200).lean()).map(toDto));
});
eventRoutes.post('/', validateBody(body), async (req, res) => {
  const { notifyMembers, ...fields } = req.body as z.infer<typeof body>;
  const e = await EventModel.create({
    ...fields,
    date: fields.date ?? null,
    createdBy: new Types.ObjectId(req.auth!.userId),
  });
  if (notifyMembers) {
    const libraryId = libraryOf(req);
    const members = await UserModel.find({ role: 'member', status: 'active' })
      .select('email')
      .lean();
    for (const m of members) {
      await notify(
        { libraryId, userId: String(m._id), email: m.email },
        { type: `library.${e.kind}`, subject: e.title, text: e.description || e.title },
      );
    }
  }
  res.status(201).json(toDto(e));
});
eventRoutes.delete('/:id', async (req, res) => {
  const r = await EventModel.deleteOne({ _id: parseId(req.params.id, 'Event') });
  if (r.deletedCount === 0) throw notFound('Event');
  res.status(204).end();
});

export const memberEventRoutes = Router();
memberEventRoutes.use(authenticate, requireRole('member'), requireVerifiedMember);
memberEventRoutes.get('/', async (_req, res) => {
  res.json(await board());
});
