# LibraVerse

Multi-tenant SaaS library management platform (academic major project + resume project). The spec is `docs/LibraVerse_Project_Report.pdf`. Read its relevant section before building a feature: FR-xx requirements, the Database Design fields, the role screen maps, and the TC-xx test cases.

## Working agreement

Work **phase by phase** (the phase plan lives in `docs/PHASES.md`). A phase is done when:

1. all tests pass (`npm test` at the root), with output shown;
2. the user has exact steps to run and try the feature;
3. what's left is listed;
4. then **stop and wait** for the user's go-ahead. Never start the next phase unprompted.

## Stack (fixed; ask before adding a dependency outside it)

- npm-workspaces monorepo: `client/`, `server/`, TypeScript everywhere.
- client: React + Vite, Tailwind, React Router, TanStack Query, Framer Motion, React Three Fiber + Drei, socket.io-client, html5-qrcode, vite-plugin-pwa. Tests: Vitest.
- server: Express, Mongoose (MongoDB Atlas), Socket.io, Zod, JWT access + refresh tokens in httpOnly cookies, bcrypt, Razorpay Node SDK, node-cron, Cloudinary, Nodemailer, PDFKit, qrcode. Tests: Jest + Supertest.

## Non-negotiable rules

1. **Tenant isolation.** Every tenant-owned document carries `libraryId`. The tenant Mongoose plugin scopes every query, update, delete, aggregate and save to the current request's `libraryId`, and throws when no tenant context exists. Only code explicitly marked as system context (Super Admin platform totals, webhooks, cron) may bypass it. Unique indexes on tenant data are compound with `libraryId`. A test proves Library A cannot read or change Library B's data (TC-07); keep it green and extend it for every new tenant collection.
2. **Payments are confirmed only by the server, never by the browser or a client callback**: either a verified Razorpay webhook (HMAC-SHA256 over the raw body, constant-time compare) or a server-to-server check of the order's payments through the Razorpay API with the library's own keys (`verify` endpoints and the every-minute reconciliation job), so payments confirm even when the webhook cannot reach the server. Both go through the same settle step: amount must match, and a capture after `expiresAt` is refunded, never activated. States: `created → pending → success | failed | expired`, with `expiresAt`. Transitions go through one state-machine function; terminal states never change. A cron job marks unpaid requests `expired`. Money is stored as integer paise.
3. **Per-library Razorpay key secret and webhook secret are encrypted at rest** with AES-256-GCM (key from an env var, random IV per value, auth tag stored). Decrypt only at the point of use; never return them from an API or log them.
4. **Card QR holds a signed token**: HMAC of memberId + libraryId, verified server-side on scan, so a forged QR is rejected. Each book copy has its own QR.
5. **Audit log is append-only.** Every cash payment, approval, issue, return and refund writes an `auditLogs` entry (actor, action, target, details, createdAt). The model rejects updates and deletes.
6. **RBAC on every route** via middleware (roles: `superAdmin`, `libraryAdmin`, `librarian`, `member`; libraryAdmin inherits librarian permissions), with matching route guards on the client. Super Admin never reads a library's members or books, only library-level totals.
7. **No secrets in code.** Config comes from `.env`, validated with Zod at startup; update `.env.example` whenever a variable is added. Razorpay runs in **test mode**.
8. **Modular by feature**: `server/src/modules/<feature>/{model,routes,controller,service,validation}.ts`. Controllers stay thin; business logic lives in services; request bodies are validated with Zod.

## Real-time

Socket.io handshake is authenticated with the JWT. Rooms: `library:<id>`, `user:<id>`, `payment:<id>`; a socket may join a `payment:` room only if it owns that payment or is staff of its library. On a verified webhook, emit `payment:updated` so the admin sees "Payment Successful" and the member sees "Membership Activated" at the same moment.
