import type { LibraryStatus, PlatformPlanCode, Role } from './enums';

export interface HealthResponse {
  status: 'ok';
  db: 'connected' | 'disconnected' | 'connecting' | 'disconnecting';
  uptimeSeconds: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  libraryId: string | null;
  libraryName: string | null;
  twoFactorEnabled: boolean;
}

export type LoginResponse =
  { status: 'ok'; user: AuthUser } | { status: 'twoFactorRequired'; challengeToken: string };

/** details of a 409 LIBRARY_CHOICE_REQUIRED error from POST /api/auth/login */
export interface LibraryChoice {
  libraryId: string | null;
  libraryName: string;
  role: Role;
}

export interface PlatformPlanDto {
  id: string;
  code: PlatformPlanCode;
  name: string;
  monthlyPrice: number;
  memberLimit: number | null;
  branchLimit: number | null;
}

export interface AdminLibraryDto {
  id: string;
  name: string;
  slug: string;
  status: LibraryStatus;
  ownerName: string;
  contactEmail: string;
  planCode: PlatformPlanCode | null;
  createdAt: string;
  statusReason: string | null;
}

export interface BranchDto {
  id: string;
  name: string;
  address: string;
}
