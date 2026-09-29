import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

const branchSchema = new Schema(
  {
    libraryId: libraryIdPath,
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

branchSchema.plugin(tenantPlugin);
branchSchema.index({ libraryId: 1, name: 1 }, { unique: true });

export type Branch = InferSchemaType<typeof branchSchema>;
export const BranchModel = model('Branch', branchSchema, 'branches');
