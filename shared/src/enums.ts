// Values shared by client and server. Each enum is a const tuple so it can
// feed both a TypeScript union and a Zod/Mongoose enum.

export const ROLES = ['superAdmin', 'libraryAdmin', 'librarian', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const LIBRARY_STATUSES = ['pending', 'active', 'suspended', 'rejected'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const PAYMENT_STATUSES = ['created', 'pending', 'success', 'failed', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = ['membership', 'fine', 'deposit', 'damage'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_METHODS = ['online', 'counterUpi', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARD_TIERS = ['member', 'gold', 'premium', 'elite'] as const;
export type CardTier = (typeof CARD_TIERS)[number];

export const COPY_STATUSES = ['available', 'issued', 'reserved', 'lost', 'damaged'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const STAFF_ROLES = [
  'superAdmin',
  'libraryAdmin',
  'librarian',
] as const satisfies readonly Role[];

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLATFORM_PLAN_CODES = ['free', 'pro'] as const;
export type PlatformPlanCode = (typeof PLATFORM_PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
