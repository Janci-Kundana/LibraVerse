import { z } from 'zod';

export const addStaffBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().trim().toLowerCase(),
  branchId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable()
    .optional(),
});
export type AddStaffInput = z.infer<typeof addStaffBody>;
