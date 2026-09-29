import { Types } from 'mongoose';
import { AppError } from './errors';

/** Parses a route id; a malformed one is a 404, same as a missing document. */
export function parseId(value: unknown, what = 'Resource'): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || value.length !== 24) {
    throw new AppError(404, 'NOT_FOUND', `${what} not found`);
  }
  return new Types.ObjectId(value);
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const isDuplicateKey = (err: unknown) => (err as { code?: unknown }).code === 11000;
