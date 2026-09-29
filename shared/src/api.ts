import type {
  CardTier,
  LibraryStatus,
  PlatformPlanCode,
  Role,
  UserStatus,
  VerificationStatus,
} from './enums';

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

export interface PublicLibraryDto {
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface LibrarySettingsDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  cardColours: string[];
  planCode: PlatformPlanCode | null;
  branchLimit: number | null;
}

export interface StaffDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  branchId: string | null;
}

export interface MembershipPlanDto {
  id: string;
  name: string;
  /** paise */
  price: number;
  durationDays: number;
  bookLimit: number;
  /** paise per day late */
  finePerDay: number;
  tier: CardTier;
  active: boolean;
}

export interface CouponDto {
  id: string;
  code: string;
  discountPercent: number;
  validTill: string;
  active: boolean;
}

/** A member's own profile, as the member sees it. */
export interface MemberProfileDto {
  id: string;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  membershipNo: string | null;
  planId: string | null;
  planName: string | null;
  validTill: string | null;
  cardTier: CardTier;
  walletBalance: number;
  badges: string[];
}

/** One row of the librarian's ID-verification queue. */
export interface VerificationItemDto {
  profileId: string;
  name: string;
  email: string;
  phone: string | null;
  status: VerificationStatus;
  note: string | null;
  submittedAt: string;
}
