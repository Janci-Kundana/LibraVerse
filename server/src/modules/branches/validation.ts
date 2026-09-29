import { z } from 'zod';

export const branchBody = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(300).default(''),
});
export type BranchInput = z.infer<typeof branchBody>;
