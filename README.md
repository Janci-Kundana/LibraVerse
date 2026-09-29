# LibraVerse

Multi-tenant SaaS library management platform: every library gets an isolated, branded workspace with its own Razorpay account, real-time payments over Socket.io, and a 3D virtual membership card.

Spec: [`docs/LibraVerse_Project_Report.pdf`](docs/LibraVerse_Project_Report.pdf) · Build plan: [`docs/PHASES.md`](docs/PHASES.md)

## Stack

npm-workspaces monorepo, TypeScript everywhere.

| Workspace | What                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| `shared/` | Enums and API types used by both sides                                                        |
| `server/` | Express, Mongoose, Zod, Socket.io, Razorpay · tests: Jest + Supertest + mongodb-memory-server |
| `client/` | React + Vite, Tailwind, React Router, TanStack Query · tests: Vitest + Testing Library        |

## Getting started

Requires Node 20+ and a MongoDB connection string (MongoDB Atlas free tier, or a local `mongod`).

```bash
npm install
cp server/.env.example server/.env    # then set MONGODB_URI
cp client/.env.example client/.env    # leave VITE_API_URL empty for local dev
npm run dev                           # API on :4000, web app on :5173
```

Open http://localhost:5173. In development Vite proxies `/api` and `/socket.io` to the API, so auth cookies stay same-origin.

## Scripts (run from the root)

| Command                           | Does                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | API (tsx watch) and client (Vite) together                                                                                                               |
| `npm test`                        | Server Jest suite, then client Vitest suite. Tests use an in-memory MongoDB; no database setup needed (the first run downloads a ~85 MB `mongod` binary) |
| `npm run typecheck`               | `tsc --noEmit` in every workspace                                                                                                                        |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                                                        |
| `npm run build`                   | Bundles the API to `server/dist` (tsup) and the client to `client/dist` (Vite)                                                                           |
