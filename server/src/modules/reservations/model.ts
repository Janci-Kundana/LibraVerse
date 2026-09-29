import { Schema, model, type InferSchemaType } from 'mongoose';
import { RESERVATION_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Hold queue per book. Queue order is createdAt; `position` is derived on read.
// When a copy comes back, the first waiting reservation becomes `ready` and the
// copy is held (status `reserved`) until holdUntil.
const reservationSchema = new Schema(
  {
    libraryId: libraryIdPath,
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: RESERVATION_STATUSES, default: 'waiting' },
    copyId: { type: Schema.Types.ObjectId, ref: 'BookCopy', default: null },
    readyAt: { type: Date, default: null },
    holdUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

reservationSchema.plugin(tenantPlugin);
reservationSchema.index({ libraryId: 1, bookId: 1, status: 1, createdAt: 1 });
// One open reservation per member per book.
reservationSchema.index(
  { libraryId: 1, bookId: 1, memberId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['waiting', 'ready'] } } },
);

export type Reservation = InferSchemaType<typeof reservationSchema>;
export const ReservationModel = model('Reservation', reservationSchema, 'reservations');
