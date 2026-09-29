import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// A title in the catalog; each physical copy is a bookCopies document.
const bookSchema = new Schema(
  {
    libraryId: libraryIdPath,
    title: { type: String, required: true, trim: true },
    authors: { type: [String], default: [] },
    isbn: { type: String, default: null },
    category: { type: String, default: 'General', trim: true },
    language: { type: String, default: 'English', trim: true },
    description: { type: String, default: '' },
    publishedYear: { type: Number, default: null },
    coverUrl: { type: String, default: null },
    ebookUrl: { type: String, default: null },
    donationId: { type: Schema.Types.ObjectId, ref: 'Donation', default: null },
    donatedBy: { type: String, default: null }, // display credit, "Anonymous" allowed
    // Denormalised for sorting and filters; kept in sync by the services.
    ratingAvg: { type: Number, default: null },
    ratingCount: { type: Number, default: 0 },
    borrowCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bookSchema.plugin(tenantPlugin);
bookSchema.index(
  { libraryId: 1, isbn: 1 },
  { unique: true, partialFilterExpression: { isbn: { $type: 'string' } } },
);
bookSchema.index({ libraryId: 1, createdAt: -1 });
bookSchema.index({ libraryId: 1, category: 1 });

export type Book = InferSchemaType<typeof bookSchema>;
export const BookModel = model('Book', bookSchema, 'books');
