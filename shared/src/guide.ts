import type { Role } from './enums';

/**
 * The in-app guide: what each page is for and how to do the common tasks on
 * it, per role. The help widget shows the current page's entry as instant
 * tips, and the AI guide gets the whole map for the signed-in role so it can
 * answer "how do I…?" and link to the right page.
 */
export interface GuidePage {
  /** route; `:id` segments match any value */
  path: string;
  title: string;
  summary: string;
  steps: string[];
}

const MEMBER: GuidePage[] = [
  {
    path: '/member',
    title: 'Home',
    summary: 'Your membership at a glance: card number, plan, deposit, dues and plans to buy.',
    steps: [
      'Buy or renew a plan under "Membership plans": enter a coupon if you have one, then tap "Buy for ₹…" and pay with Razorpay. The first plan also collects the security deposit.',
      'Your membership starts the moment the payment is confirmed; you will see a celebration and your new card.',
      'Buying a different plan while one is running does not cut it short: the new plan starts when the current one ends ("Then … from …" shows the date). Buying the same plan adds its days.',
      'To change your card photo, choose a new one under "Card photo" and tap "Send for approval". Staff check it; your card keeps the current photo until they approve.',
      '"Deposit and dues" shows your deposit, unpaid fines and whether your card is active or blocked.',
      'To leave the library, request a deposit refund under "Deposit refund" once every book is returned.',
    ],
  },
  {
    path: '/member/card',
    title: 'My card',
    summary: 'Your 3D membership card with the QR code staff scan at the counter.',
    steps: [
      'Show the QR on the front of the card at the counter to borrow or return books.',
      'Drag the card to turn it over; the back shows your card number and the library.',
      'Use "Download PDF" to keep a copy of the card offline.',
    ],
  },
  {
    path: '/member/loans',
    title: 'My books',
    summary: 'Books you have borrowed, their due dates, fines so far, reservations and history.',
    steps: [
      'Overdue books build up a daily fine; return them at the counter to stop it.',
      'Unpaid fines show at the top with a "Pay ₹… now" button to pay online; you can also pay in cash at the counter.',
      'Need more time? Tap "Renew" on a book before it is overdue (up to the library’s renewal limit; not if another member is waiting for it or you have unpaid fines).',
      'Reservations show when a reserved book is ready to collect.',
    ],
  },
  {
    path: '/member/payments',
    title: 'Payments',
    summary: 'Every payment you made and its status.',
    steps: [
      'Unpaid fines are paid from My books ("Pay ₹… now") or in cash at the counter.',
      'A payment is only confirmed by the library’s server after Razorpay reports it, usually within seconds.',
    ],
  },
  {
    path: '/member/catalog',
    title: 'Catalog',
    summary: 'Search the library’s books and see which are on the shelf.',
    steps: [
      'Search by title, author or ISBN, or filter by category.',
      'Open a book to see copies on the shelf, reserve it when none are free, or add it to your wishlist.',
      'Borrowing itself happens at the counter: staff scan your card and the book.',
    ],
  },
  {
    path: '/member/books/:id',
    title: 'Book details',
    summary: 'One book: availability, reviews, reserve and wishlist.',
    steps: [
      'Tap "Reserve" when every copy is out; you are told when one is held for you.',
      'Rate and review a book after you have borrowed it.',
    ],
  },
  {
    path: '/member/wishlist',
    title: 'Wishlist',
    summary: 'Books you saved for later.',
    steps: ['Add books from the catalog; open one to reserve it or check availability.'],
  },
  {
    path: '/member/events',
    title: 'Notice board',
    summary: 'Events and notices from your library.',
    steps: ['Check here for library events, holidays and announcements.'],
  },
  {
    path: '/member/assistant',
    title: 'Ask the library',
    summary: 'Chat about books, rules, fines and your own loans.',
    steps: ['Ask things like "Is Wings of Fire available?" or "When are my books due?".'],
  },
];

const STAFF: GuidePage[] = [
  {
    path: '/library',
    title: 'Dashboard',
    summary: 'Library totals, revenue and loans charts, most borrowed books and report exports.',
    steps: [
      'Amber tiles need attention: ID checks waiting, overdue loans, unpaid fines.',
      'Export payments, loans or overdue lists as Excel or PDF for any date range under "Export reports".',
    ],
  },
  {
    path: '/library/counter',
    title: 'Counter',
    summary: 'Issue and return books by scanning QR codes.',
    steps: [
      'Issue: "1. Scan the member’s card" (camera or type the card code). Check the member details and that they can borrow, then "2. Scan the book’s QR" to issue it.',
      'Return: under "Scan the returned book", scan the copy, choose its condition, add a damage charge or note if needed, then confirm. Late fines are calculated automatically.',
      'A blocked card shows why (no plan, expired, unpaid dues, deposit exhausted, ID not verified).',
      'Take money after scanning a card: under "Collect payment" choose what it is "For" (a plan or fines), then "Cash received", or show a UPI QR that confirms live. Every cash payment is written to the audit log with a receipt number.',
    ],
  },
  {
    path: '/library/loans',
    title: 'Loans',
    summary: 'Every book currently out and returned, with due dates and fines.',
    steps: [
      'Switch between the Active, Overdue, Returned and Lost tabs, and search by member name or email.',
      '"Renew" extends an active loan (within the renewals allowed); "Mark lost" charges the lost-book fee.',
    ],
  },
  {
    path: '/library/reservations',
    title: 'Reservations',
    summary: 'Books members have reserved and copies held for them.',
    steps: [
      'A held copy waits for the member for the reservation hold period, then goes to the next person.',
    ],
  },
  {
    path: '/library/members',
    title: 'Members',
    summary: 'Search members and see their plan, card, deposit and dues.',
    steps: ['Search by name or email.', 'Open a member to see their standing and history.'],
  },
  {
    path: '/library/verifications',
    title: 'ID verification',
    summary:
      'New members wait here until staff check their ID proof, and new card photos wait for approval.',
    steps: [
      'Compare the card photo with the face on the ID proof ("View ID proof"), then approve, or reject with a reason so the member can upload a new one.',
      'Only approved members can buy a plan and get a card.',
      'Under "New card photos", compare the new photo with the current one: "Approve photo" puts it on the card; "Reject" keeps the old photo and emails your reason.',
    ],
  },
  {
    path: '/library/deposit-refunds',
    title: 'Deposit refunds',
    summary: 'Members who asked for their security deposit back.',
    steps: [
      'Unpaid dues are taken from the deposit first; the rest is refunded and the membership closes.',
      'Approve in cash, or through Razorpay when the deposit was paid online. Reject with a reason if needed.',
      'You can also refund a member directly at the counter.',
    ],
  },
  {
    path: '/library/catalog',
    title: 'Catalog',
    summary: 'All books and copies, with QR labels per copy.',
    steps: [
      'Add a book with "Add a book", or import many at once from a CSV file.',
      'Open a book to add copies and print a QR sticker for each copy.',
    ],
  },
  {
    path: '/library/catalog/new',
    title: 'Add a book',
    summary: 'Create a title and its first copies.',
    steps: [
      'Fill in title, authors, ISBN and category, choose the branch and number of copies, then save.',
    ],
  },
  {
    path: '/library/catalog/import',
    title: 'Import books from CSV',
    summary: 'Add many books at once.',
    steps: [
      'Prepare a CSV with a title column (required) and optional authors, category, language, publishedYear, copies and branch columns.',
      'Upload it and check the result: each row is added or reported with its error.',
    ],
  },
  {
    path: '/library/catalog/:id',
    title: 'Book',
    summary: 'One title: its copies, their status and QR labels.',
    steps: [
      'Use "Add copies" for more stock, then "Print QR stickers" and stick one on each copy.',
    ],
  },
  {
    path: '/library/donations',
    title: 'Donations',
    summary: 'Books offered by the public through the Donate page.',
    steps: ['Accept a donation to add it to the catalog, or decline it.'],
  },
  {
    path: '/library/events',
    title: 'Events & notices',
    summary: 'Post events and announcements to the members’ notice board.',
    steps: [
      'Post an Announcement or an Event (with a date); members see it on their notice board.',
    ],
  },
  {
    path: '/library/payments',
    title: 'Payments',
    summary: 'Every payment the library received, online and in cash.',
    steps: [
      'Cash is collected at the Counter after scanning the member’s card.',
      'Online payments appear here automatically once Razorpay confirms them; admins can refund a payment from here.',
    ],
  },
  {
    path: '/library/plans',
    title: 'Plans & coupons',
    summary: 'Membership plans members can buy, and discount coupons.',
    steps: [
      'Create a plan with price, duration, books at a time, late fine per day and card tier.',
      'Create coupons with a code and discount %.',
    ],
  },
  {
    path: '/library/payment-settings',
    title: 'Online payments',
    summary: 'Connect the library’s own Razorpay account (test mode).',
    steps: [
      'Paste the Razorpay key id, key secret and webhook secret, then save; secrets are stored encrypted.',
      'Add the webhook URL shown here in the Razorpay dashboard.',
    ],
  },
  {
    path: '/library/subscription',
    title: 'Subscription',
    summary: 'The library’s LibraVerse plan and invoices.',
    steps: ['Upgrade the platform plan for more branches and members; download invoices.'],
  },
  {
    path: '/library/branches',
    title: 'Branches',
    summary: 'The library’s branches.',
    steps: ['Add a branch with name and address; books and copies belong to a branch.'],
  },
  {
    path: '/library/staff',
    title: 'Staff',
    summary: 'Librarian accounts.',
    steps: ['Add a librarian with name and email; they get an email to set their password.'],
  },
  {
    path: '/library/settings',
    title: 'Library settings',
    summary: 'Name, logo, borrowing rules, deposit and reminders.',
    steps: [
      'Set the loan period, renewals allowed, reservation hold days and lost-book charge.',
      'Set the security deposit (same for every member), the days between due reminders, and how long after the third reminder unpaid dues come out of the deposit.',
    ],
  },
  {
    path: '/library/audit',
    title: 'Audit log',
    summary: 'A permanent record of cash payments, approvals, issues, returns and refunds.',
    steps: ['Every entry shows who did what and when. Entries can never be edited or deleted.'],
  },
  {
    path: '/library/security',
    title: 'Security',
    summary: 'Two-factor sign-in for your account.',
    steps: ['Turn on two-factor sign-in to require a code emailed to you at each sign-in.'],
  },
];

const ADMIN_ONLY = new Set([
  '/library/payments',
  '/library/plans',
  '/library/payment-settings',
  '/library/subscription',
  '/library/branches',
  '/library/staff',
  '/library/settings',
  '/library/audit',
]);

const SUPER: GuidePage[] = [
  {
    path: '/admin',
    title: 'Libraries',
    summary: 'Every library on the platform and its status.',
    steps: [
      'Approve newly registered libraries, or suspend and reactivate them.',
      'You see library-level totals only, never a library’s members or books.',
    ],
  },
  {
    path: '/admin/analytics',
    title: 'Analytics',
    summary: 'Platform totals: libraries, members and revenue over time.',
    steps: ['Use the charts to follow platform growth; open "Show as table" for exact numbers.'],
  },
  {
    path: '/admin/plans',
    title: 'Plans',
    summary: 'The subscription plans libraries pay for.',
    steps: ['Create or edit a plan’s monthly price, branch limit and member limit.'],
  },
  {
    path: '/admin/security',
    title: 'Security',
    summary: 'Two-factor sign-in for your account.',
    steps: ['Turn on two-factor sign-in to require a code emailed to you at each sign-in.'],
  },
];

export const GUIDE: Record<Role, GuidePage[]> = {
  member: MEMBER,
  librarian: STAFF.filter((p) => !ADMIN_ONLY.has(p.path)),
  libraryAdmin: STAFF,
  superAdmin: SUPER,
};

function matches(pattern: string, path: string) {
  const a = pattern.split('/');
  const b = path.replace(/\/+$/, '').split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

/** The guide entry for the page the user is on, if there is one. */
export function guideFor(role: Role, path: string): GuidePage | undefined {
  return GUIDE[role].find((p) => matches(p.path, path || '/'));
}

/** True when `path` is a page this role can open (used to keep AI links safe). */
export function isGuidePath(role: Role, path: string): boolean {
  return guideFor(role, path) !== undefined;
}
