# MandiMitra AI

**आढ़ती का पूरा हिसाब, एक ही जगह।**

A multi-tenant SaaS mandi management ERP for Indian commission agents (आढ़ती), grain traders and their munims. It covers lots, partial sales, patti, farmer and buyer ledgers, payments, expenses, reports, a Hindi AI assistant and WhatsApp sharing.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Architecture, schema, project structure, DB setup | ✅ Done |
| 2 | Auth, business registration, tenant isolation, RBAC | ✅ Done |
| 3 | Next.js app, dashboard, farmers, buyers, commodities, staff & settings UI | ✅ Done |
| 4 | Lots, partial sales, purchases, commission engine, patti (A4 PDF / print / WhatsApp share), approvals | ✅ Done |
| 5 | Farmer & buyer ledgers/statements, payments & receipts, expenses, 10 reports (PDF + Excel) | ✅ Done |
| 6 | AI assistant (read-only tools), voice/photo drafts, AI reminders, WhatsApp Business (mock + Cloud API), notifications | ✅ Done |
| 7 | Razorpay subscription billing, Super Admin console, pg-boss jobs (sweep, drift check, WhatsApp retries), S3 storage, security headers & production guards, esbuild bundle, Sentry, Docker + CI | ✅ Done, awaiting approval |

## Stack
Next.js 16 · React 19 · TypeScript 6 · Tailwind 4 · Redux Toolkit · React Hook Form + Zod 4 ‖ Node 24 · Express 5 · Prisma 7 · PostgreSQL 17 · pg-boss ‖ Anthropic Claude · WhatsApp Cloud API · Razorpay

## Quick start
```bash
npm install
cp .env.example database/.env && cp .env.example backend/.env   # set JWT_ACCESS_SECRET
npm run db:start     # PostgreSQL 17 on :5433 (no Docker needed); or `npm run db:up`
npm run db:deploy && npm run db:seed
npm run seed:demo -w @mandimitra/backend   # optional, dev only: demo firm, 16 farmers, 7 buyers
npm run dev:api      # API  → http://localhost:4000
npm run dev:web      # Web  → http://localhost:3000  (proxies /api to the API)
npm test             # 305 tests: 289 backend (throwaway real Postgres) + 16 frontend
npm run build:api && npm run build:web   # production bundles (see docs/DEPLOYMENT.md §3)
```
Demo login (after `seed:demo`): mobile **99999 00001**, password **Demo@2026**.
Super Admin: `npm run admin:grant -w @mandimitra/backend -- <mobile>` → `/admin`. Billing runs in test mode until Razorpay keys are set.
Full instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Documentation
- [PRD](docs/PRD.md): users, assumptions, feature breakdown, plans
- [Architecture](docs/ARCHITECTURE.md): system design, tenancy, auth, financial core, AI safety
- [Database](docs/DATABASE.md): ER diagrams, design decisions, constraints
- [API](docs/API.md): conventions and endpoint catalogue
- [Deployment](docs/DEPLOYMENT.md): local setup, environments, production

## Repository layout
```
database/          Prisma schema, migrations, seed, local Postgres runner
backend/           Express API + worker: routes, services, jobs (pg-boss), Dockerfile
packages/shared/   Zod schemas, permission matrix, plans, bilingual error catalogue
frontend/          Next.js 16 app: app/ routes, components/, features/, services/ (RTK Query), store/, lib/
docs/
```
