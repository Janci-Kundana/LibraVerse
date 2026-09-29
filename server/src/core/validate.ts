import type { RequestHandler } from 'express';
import type { z } from 'zod';

/** Parses req.body with `schema`, replacing it with the parsed value; a ZodError becomes a 400. */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}
