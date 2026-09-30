import { z } from 'zod';
import { chatBody } from '../assistant/service';

/** A question for the in-app guide, with the page the user is on. */
export const guideBody = chatBody.safeExtend({
  page: z
    .string()
    .max(120)
    .regex(/^\/[A-Za-z0-9/_-]*$/, 'page must be an app path'),
});
export type GuideBody = z.infer<typeof guideBody>;
