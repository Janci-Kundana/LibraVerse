import type { Role } from '@libraverse/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` from the access token. */
      auth?: { userId: string; role: Role; libraryId: string | null };
    }
  }
}

export {};
