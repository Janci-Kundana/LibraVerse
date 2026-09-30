import type {
  CardTier,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  CopyStatus,
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
  active: boolean;
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
  /** Pro payment made to the platform, if any */
  proPayment: 'paid' | 'refunded' | null;
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

export interface CirculationSettings {
  loanDays: number;
  maxRenewals: number;
  /** days a returned copy is held for the next reservation */
  holdDays: number;
  /** paise charged when a borrowed copy is lost */
  lostBookCharge: number;
  /** security deposit every member pays with their first membership (paise, > 0) */
  depositAmount: number;
  /** days between due warnings (3 warnings) */
  warningIntervalDays: number;
  /** days after the third warning before the deposit is deducted */
  deductionGraceDays: number;
}

export interface LibrarySettingsDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  cardColours: string[];
  circulation: CirculationSettings;
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

export interface BookDto {
  id: string;
  title: string;
  authors: string[];
  isbn: string | null;
  category: string;
  language: string;
  description: string;
  publishedYear: number | null;
  coverUrl: string | null;
  ebookUrl: string | null;
  createdAt: string;
  copies: { total: number; available: number };
  ratingAvg: number | null;
  ratingCount: number;
  donatedBy: string | null;
}

export interface CopyDto {
  id: string;
  bookId: string;
  branchId: string;
  branchName: string | null;
  qrCode: string;
  shelf: string;
  status: CopyStatus;
}

export interface BookDetailDto extends BookDto {
  copyList: CopyDto[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A book as a member sees it in search. */
export interface CatalogBookDto extends BookDto {
  inWishlist: boolean;
}

export interface ReviewDto {
  id: string;
  memberName: string;
  rating: number;
  text: string;
  createdAt: string;
  mine: boolean;
}

export interface CatalogBookDetailDto extends CatalogBookDto {
  reviews: ReviewDto[];
  availability: { branchName: string; available: number }[];
}

export interface CatalogFacetsDto {
  categories: string[];
  languages: string[];
}

export interface IsbnLookupDto {
  isbn: string;
  title: string;
  authors: string[];
  publishedYear: number | null;
  category: string | null;
  coverUrl: string | null;
  description: string;
}

export interface CsvImportResultDto {
  created: number;
  copiesCreated: number;
  errors: { row: number; message: string }[];
}

export const LOAN_STATUSES = ['active', 'returned', 'lost'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const RESERVATION_STATUSES = [
  'waiting',
  'ready',
  'fulfilled',
  'cancelled',
  'expired',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface LoanDto {
  id: string;
  bookId: string;
  bookTitle: string;
  copyCode: string;
  memberId: string;
  memberName: string;
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: LoanStatus;
  renewals: number;
  overdueDays: number;
  /** paise */
  fineAmount: number;
  damageCharge: number;
  /** paise already paid towards fineAmount + damageCharge (payments or deposit) */
  duesPaidAmount: number;
  chargeNote: string | null;
  duesPaid: boolean;
}

/** What the counter sees after scanning a member card (FR-15, TC-05). */
export interface MemberScanDto {
  memberId: string;
  profileId: string;
  name: string;
  email: string;
  phone: string | null;
  /** staff-only URL of the member's profile picture */
  photoUrl: string | null;
  libraryName: string;
  /** when the card (membership number) was issued */
  cardIssuedAt: string | null;
  /** start of the current paid membership */
  membershipStartedAt: string | null;
  depositBalance: number;
  cardStatus: CardStatus;
  dueStatus: DueStatus;
  membershipNo: string | null;
  planName: string | null;
  bookLimit: number;
  validTill: string | null;
  membershipStatus: 'active' | 'expired' | 'none' | 'unverified';
  activeLoans: LoanDto[];
  /** paise owed: unpaid late fines and lost/damage charges */
  pendingDues: number;
  canBorrow: boolean;
  blockedReason: string | null;
  readyReservations: { bookTitle: string; copyCode: string }[];
}

export interface ReturnResultDto {
  loan: LoanDto;
  /** who the copy is now held for, if someone reserved the book */
  heldFor: string | null;
}

export interface ReservationDto {
  id: string;
  bookId: string;
  bookTitle: string;
  memberName: string;
  status: ReservationStatus;
  position: number | null;
  holdUntil: string | null;
  copyCode: string | null;
  createdAt: string;
}

export interface MemberCardDto {
  name: string;
  libraryName: string;
  libraryInitial: string;
  logoUrl: string | null;
  cardColours: string[];
  membershipNo: string;
  memberSince: string;
  validTill: string | null;
  tier: CardTier;
  status: 'active' | 'expired' | 'blocked';
  /** the signed token encoded in the QR */
  qrToken: string;
  /** PNG data URL of the QR */
  qrDataUrl: string;
  revealed: boolean;
  /** GET /api/member/photo returns it */
  hasPhoto: boolean;
}

export interface MemberLoansDto {
  current: LoanDto[];
  history: LoanDto[];
  pendingDues: number;
  reservations: ReservationDto[];
}

export interface PaymentSettingsDto {
  keyId: string | null;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  /** paste this into the Razorpay dashboard's webhook settings */
  webhookUrl: string;
}

export interface PaymentDto {
  id: string;
  memberId: string;
  memberName: string;
  purpose: PaymentPurpose;
  /** paise, after any coupon */
  amount: number;
  discount: number;
  couponCode: string | null;
  planName: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  receiptNo: string | null;
  collectedByName: string | null;
  refund: { amount: number; reason: string; refundedAt: string } | null;
  lateCaptureRefunded: boolean;
}

/** What the browser needs to open Razorpay Checkout for a payment request. */
export interface CheckoutDto {
  payment: PaymentDto;
  orderId: string;
  keyId: string;
  libraryName: string;
  prefill: { name: string; email: string };
}

/** Counter UPI QR: the member scans a link to /pay/:token on their phone. */
export interface CounterRequestDto {
  payment: PaymentDto;
  /** null for cash, which succeeds immediately */
  payUrl: string | null;
  payQrDataUrl: string | null;
}

/** Public view of a payment for /pay/:token. */
export interface PublicPayDto {
  paymentId: string;
  libraryName: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  expiresAt: string;
  orderId: string | null;
  keyId: string | null;
}

/** Pushed over Socket.io when a payment changes state. */
export interface PaymentUpdatedEvent {
  paymentId: string;
  status: PaymentStatus;
  purpose: PaymentPurpose;
  amount: number;
  memberId: string;
  memberName: string;
}

/** Card state derived on the server: expired wins over blocked. */
export type CardStatus = 'active' | 'expired' | 'blocked' | 'none' | 'unverified';

/** Unpaid-dues state derived on the server (never set by a client). */
export type DueStatus = 'none' | 'pending' | 'deductionScheduled' | 'deducted' | 'blocked' | 'paid';

export interface DepositTransactionDto {
  id: string;
  type: 'collected' | 'deduction';
  amount: number;
  balanceAfter: number;
  dueBefore: number | null;
  dueAfter: number | null;
  reason: string;
  createdAt: string;
}

export interface MemberStandingDto {
  cardStatus: CardStatus;
  dueStatus: DueStatus;
  outstandingDues: number;
  depositBalance: number;
  depositAmount: number;
  warningsSent: number;
  deductionScheduledFor: string | null;
  history: DepositTransactionDto[];
}

export interface CelebrationDto {
  paymentId: string;
  planName: string;
  tier: CardTier;
  validTill: string | null;
  amount: number;
  depositCollected: number;
  renewal: boolean;
}

/** Staff members list row. */
export interface MemberRowDto {
  profileId: string;
  name: string;
  email: string;
  phone: string | null;
  accountStatus: UserStatus;
  verificationStatus: VerificationStatus;
  membershipNo: string | null;
  planName: string | null;
  validTill: string | null;
  outstandingDues: number;
  depositBalance: number;
  cardStatus: CardStatus;
  dueStatus: DueStatus;
  hasPhoto: boolean;
}
