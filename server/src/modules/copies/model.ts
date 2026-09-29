import { Schema, model, type InferSchemaType } from 'mongoose';
import { COPY_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// One physical copy. Its QR code is a random, unguessable code printed on a
// sticker; scanning looks it up inside the librarian's own library.
const bookCopySchema = new Schema(
  {
    libraryId: libraryIdPath,
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    qrCode: { type: String, required: true },
    shelf: { type: String, default: '', trim: true },
    status: { type: String, enum: COPY_STATUSES, default: 'available' },
  },
  { timestamps: true },
);

bookCopySchema.plugin(tenantPlugin);
bookCopySchema.index({ libraryId: 1, qrCode: 1 }, { unique: true });
bookCopySchema.index({ libraryId: 1, bookId: 1, status: 1 });

export type BookCopy = InferSchemaType<typeof bookCopySchema>;
export const BookCopyModel = model('BookCopy', bookCopySchema, 'bookCopies');
