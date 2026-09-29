import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

const reviewSchema = new Schema(
  {
    libraryId: libraryIdPath,
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

reviewSchema.plugin(tenantPlugin);
reviewSchema.index({ libraryId: 1, bookId: 1, memberId: 1 }, { unique: true });
reviewSchema.index({ libraryId: 1, bookId: 1, createdAt: -1 });

export type Review = InferSchemaType<typeof reviewSchema>;
export const ReviewModel = model('Review', reviewSchema, 'reviews');
