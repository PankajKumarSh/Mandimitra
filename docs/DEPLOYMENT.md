# MandiMitra AI — Setup & Deployment

## 1. Local development

### Prerequisites
| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 24 | `node -v` |
| npm | ≥ 11 | `npm -v` |
| Git | any | `git --version` |
| Docker Desktop | optional | `docker info` |

Docker is **optional**. `npm run db:start` runs a real PostgreSQL 17 server from npm-shipped native binaries (`embedded-postgres`). Use it on machines without Docker/WSL.

MandiMitra's local Postgres listens on **port 5433**, so it never collides with any other PostgreSQL already on 5432.

### Steps
```bash
# 1. Install workspace dependencies (runs only allow-listed install scripts)
npm install

# 2. Environment files (both git-ignored)
cp .env.example database/.env
cp .env.example backend/.env
#    then set JWT_ACCESS_SECRET in backend/.env to a random value:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Start PostgreSQL 17 on :5433 — pick ONE
npm run db:start                       # embedded binaries; keep this terminal open (Ctrl+C stops)
npm run db:up                          # or Docker

# 4. Schema + base data (permissions, roles, plans)
npm run db:deploy                      # apply migrations
npm run db:generate                    # generate Prisma client
npm run db:seed                        # idempotent; safe to re-run

# 5. Optional demo data (refuses to run when NODE_ENV=production)
npm run seed:demo -w @mandimitra/backend   # login: 99999 00001 / Demo@2026

# 6. Run API + web (two terminals)
npm run dev:api                        # http://localhost:4000 ; curl /readyz → {"status":"ready"}
npm run dev:web                        # http://localhost:3000 ; /api/* is proxied to the API
#   port 3000 busy? → npx next dev --port 3001 (in frontend/)
#   API elsewhere?  → set API_ORIGIN=http://host:4000 for the web server

# 7. Tests & checks
npm test                               # backend (own throwaway Postgres on :54329) + frontend unit tests
npm run typecheck
npm run build:web                      # production Next.js build
```

The browser only ever talks to the web origin. `next.config.ts` rewrites `/api/*` to `API_ORIGIN`, so the HttpOnly session cookies are first-party and no CORS is involved. In production, put both behind the same domain, or keep this rewrite.

> **UTF-8 is mandatory.** On Windows, `initdb` defaults to WIN1252, which **cannot store Hindi**. The embedded runner and test setup force `--encoding=UTF8 --locale=C`. The API refuses to start if `SHOW server_encoding` is not `UTF8`. For managed databases, create them with `ENCODING 'UTF8'`.

Useful commands (from `database/`):
```bash
npx prisma validate                    # schema check
npx prisma migrate status              # applied vs pending
npx prisma migrate dev --create-only --name <change>   # new migration; edit SQL before applying
npx prisma migrate reset               # DEV ONLY — drops & recreates the DB
```

> **npm 11 `allowScripts`:** the root `package.json` allow-lists install scripts for `prisma`, `@prisma/engines` (downloads the migration engine), `esbuild` (used by `tsx`) and `@embedded-postgres/windows-x64` (restores symlinks inside its own package). Any new package with an install script must be reviewed and approved with `npm approve-scripts <pkg>`.

> **Patti PDFs** need a Chromium-family browser and Devanagari fonts on the API host. On Windows and macOS an installed Edge/Chrome is found automatically. On Linux or in containers, install `chromium` and `fonts-noto-core` (or `fonts-noto`) and set `PDF_BROWSER_PATH=/usr/bin/chromium`. Without a browser, `/patti/:id/pdf` returns `422 PDF_UNAVAILABLE`, but the print view (`/patti/:id/print`) still works and the browser's "Save as PDF" produces the same document.

> **Security override:** the Prisma 7.10.1 CLI pins `effect@3.20.0`, which has a high-severity ReDoS advisory (GHSA-7589-6fvf-x4pw). The root `package.json` overrides it to the patched `effect@3.22.5`, a patch release in the same major, and `database/package.json` declares it explicitly. Verify with `npm audit` (0 vulnerabilities). Remove the override once Prisma ships a fixed pin.

> **Testing over curl on Windows:** Git Bash re-encodes non-ASCII command-line arguments, so `curl -d '{"x":"हिंदी"}'` sends `?` characters. Write the JSON body to a UTF-8 file and use `--data-binary @file`. Browsers and the test suite are unaffected.

> **Runtime:** in development the backend runs TypeScript via `tsx` (Prisma 7's generator emits `.ts` ESM sources). For production, `npm run build:api` bundles `backend/dist/server.js` and `backend/dist/worker.js` with esbuild. The workspace packages and the generated Prisma client are bundled in; npm dependencies stay external. Run them with `npm run start:prod -w @mandimitra/backend` and `npm run worker:prod -w @mandimitra/backend`.

> **Prisma 7 notes:** the DB URL is read from `prisma.config.ts` (env `DATABASE_URL`), not from `schema.prisma`. The client is generated into `database/generated/prisma` and must be built with a driver adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.

## 2. Environments

| Env | Purpose | Data |
|---|---|---|
| `development` | Local | Seeded demo data (`SEED_DEMO=true`) |
| `test` | CI + local integration tests | Throwaway DB `mandimitra_test`, truncated per test file |
| `staging` | Pre-release verification | Anonymised or synthetic data only |
| `production` | Customers | Real data. Demo seeding refuses to run |

## 3. Production

### 3.1 Topology (recommended, India region)

```
Cloudflare (DNS, WAF, TLS)
   └─ app.mandimitra.in ──► Next.js (container, ≥2 replicas)
                               └─ /api/v1/* rewrite ──► Express API (container, ≥2 replicas, private)
                                                          ├─ Managed PostgreSQL 17 (Mumbai, HA, PITR 7–30 days)
                                                          ├─ worker: dist/worker.js (same image; API runs with JOBS_MODE=worker)
                                                          └─ S3-compatible bucket (private, SSE)
```
Suggested providers (any equivalent works): AWS ap-south-1 (ECS Fargate + RDS + S3), or Railway/Render + Neon/Supabase Postgres (Mumbai) for an early-stage budget. Keeping data in India also helps with DPDP Act 2023 expectations.

### 3.2 Build & run

```bash
# Images (build context = repository root)
docker build -f backend/Dockerfile -t mandimitra-api .                        # API + worker (Chromium + Noto fonts for PDFs)
docker build -f backend/Dockerfile --target migrate -t mandimitra-migrate .   # one-shot: prisma migrate deploy
docker build -f frontend/Dockerfile --build-arg API_ORIGIN=http://api:4000 \
  --build-arg APP_URL=https://app.example.in -t mandimitra-web .             # API_ORIGIN / APP_URL are baked in at build time

# Single-server example (managed Postgres elsewhere; a TLS proxy in front of :3000)
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

| Process | Command | Notes |
|---|---|---|
| API | `node dist/server.js` | `/healthz` liveness, `/readyz` DB ping |
| Worker | `node dist/worker.js` | One or more replicas. Jobs use SKIP LOCKED and cron fires on a single instance |
| Web | `node frontend/server.js` | Next.js standalone output |

> **Not yet verified here:** the Dockerfiles, `docker-compose.prod.yml` and the GitHub Actions workflow (`.github/workflows/ci.yml`) were written but **not executed** — this machine has no Docker and the repository has no remote. The production bundles themselves were built and run locally (`dist/server.js`, `dist/worker.js`, the `next build` standalone server). Do a first `docker build` and CI run before relying on them.

### 3.3 Release process
1. CI on every PR: typecheck → lint → unit → integration (Postgres service container) → build.
2. On merge to `main`: build images → deploy to staging → `prisma migrate deploy` → smoke E2E.
3. Production deploy is a manual approval: `prisma migrate deploy` runs **before** the new API version starts. Migrations must be backward-compatible (expand → migrate → contract).

### 3.4 Secrets
Stored in the platform's secret manager, never in the repo or images: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `FIELD_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `WHATSAPP_*`, `RAZORPAY_*`, `S3_*`, `SENTRY_DSN`.

> **Back up `FIELD_ENCRYPTION_KEY` separately from the database.** It encrypts farmer bank account numbers: losing it makes them unrecoverable, and rotating it needs a re-encryption script that does not exist yet. Changing `JWT_ACCESS_SECRET` logs everyone out (single-key verification).

**The API refuses to start in production** if `WHATSAPP_PROVIDER=mock`, `BILLING_PROVIDER=mock`, `APP_URL` is not https, the JWT secret is still the placeholder, or the Razorpay / S3 settings for the chosen driver are incomplete.

### 3.5 Backups & recovery
- Managed PITR (RPO ≤ 5 min).
- Nightly `pg_dump` to a separate account/bucket, kept 35 days.
- Monthly restore drill into staging. Ledger-vs-cache consistency check after the restore.
- Target RTO: 1 hour.

### 3.6 Monitoring
- Set `SENTRY_DSN` on the API and worker. Only unexpected errors are reported; cookies, headers, bodies, query strings and user info are never sent.
- Uptime checks on `/healthz` and `/readyz`.
- Alert on:
  - the 5xx rate and p95 latency;
  - DB connections;
  - the pg-boss backlog (`SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2`);
  - any `ledger.drift_detected` log line (must never happen);
  - `billing.webhook.amount_mismatch`.

### 3.7 File storage
- Production: `STORAGE_DRIVER=s3` with a **private** bucket (AWS S3 `ap-south-1`, Cloudflare R2, MinIO, DigitalOcean Spaces). Files are only served through the API after a tenant check.
- On AWS, objects are written with SSE-S3. Other providers encrypt at rest through their own bucket settings.
- `STORAGE_DRIVER=local` is fine only on a single server with a persistent volume (`UPLOAD_DIR`).

### 3.8 Go-live checklist
1. **Database:** managed Postgres created with `ENCODING 'UTF8'`, PITR on, migrations applied with the `migrate` image.
2. **Config:** secrets set; `NODE_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY` = number of proxies in front, `JOBS_MODE=worker` on the API, and a worker running.
3. **Razorpay:** live keys and webhook (section 4). First do one complete payment on staging with test keys.
4. **WhatsApp:** `cloud` with approved templates, or `disabled` until they are approved.
5. **Storage:** a private bucket and `STORAGE_DRIVER=s3`.
6. **Super Admin:** the first one granted with `admin:grant`.
7. **Monitoring:** Sentry DSN set; uptime checks on.
8. **Recovery:** one restore drill done on staging.

## 4. Integrations

### WhatsApp Business Platform (Phase 6, as built)

**Until credentials exist, `WHATSAPP_PROVIDER=mock`** (the default):
- Every send runs the full flow (consent → PDF → template → message record), but nothing leaves the server.
- Messages are recorded as DELIVERED, and the UI says "Test mode".
- **Production refuses `mock`.** Until Meta approves your templates, run with `WHATSAPP_PROVIDER=disabled`: send buttons then return a clear "not set up" message instead of pretending.
- Temporary Cloud API failures (network, 5xx, rate limits) are retried by the worker with backoff (5 attempts) and show as QUEUED meanwhile.

**Going live:**
1. Meta Business Manager → WhatsApp → add a business phone number. Note the **Phone number ID** and create a **permanent System User token** with `whatsapp_business_messaging`.
2. Submit these **UTILITY** templates, language **Hindi (`hi`)**, with names and variable order exactly as below. The values come from MandiMitra's backend only, never from AI output.

| Template name | Header | Body (suggested wording) | Variables |
|---|---|---|---|
| `patti_ready_hi` | Document | राम राम {{1}} जी, {{2}} की ओर से आपकी पट्टी {{3}} तैयार है। देय राशि: {{4}}। पट्टी संलग्न है। | farmer name, firm, patti no., net payable |
| `statement_hi` | Document | {{1}} जी, {{2}} के साथ आपके खाते का विवरण संलग्न है। वर्तमान बकाया: {{3}}। | party name, firm, balance |
| `payment_received_hi` | Document | {{1}} जी, {{2}} को आपका भुगतान {{3}} प्राप्त हुआ। रसीद संलग्न है। धन्यवाद। | buyer name, firm, amount |
| `payment_made_hi` | Document | {{1}} जी, {{2}} ने आपको {{3}} का भुगतान किया है। वाउचर संलग्न है। | farmer name, firm, amount |
| `payment_reminder_hi` | — | नमस्ते {{1}} जी, {{2}} की ओर से विनम्र निवेदन: आपकी बकाया राशि {{3}} है। कृपया सुविधानुसार भुगतान करें। धन्यवाद। | buyer name, firm, outstanding |

3. **Webhook:**
   - Callback URL: `https://<your-domain>/api/v1/webhooks/whatsapp`.
   - Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   - Subscribe to the **messages** field.
   - Status callbacks (sent/delivered/read/failed) update each message, and only ever move forward.
   - A reply of `STOP` / `बंद` opts that number out in every business that messaged it.
4. **Configure and restart:** set `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` (the app secret; used to verify `X-Hub-Signature-256`) and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. `WHATSAPP_GRAPH_VERSION` defaults to `v23.0`; set it to the version your Meta app uses. Startup refuses `cloud` mode if any of these are missing.
5. **Test before go-live:** send one patti to your own number. The Cloud API calls follow Meta's documented request shapes but have **not yet been exercised against a live Meta account**.

**Consent:**
- A message is sent only if the farmer or buyer record has WhatsApp consent = **Opted in** (set on their form; the date is recorded).
- Business-initiated messages must use approved templates. The AI-written reminder text is for the user to send from **their own** WhatsApp (click-to-chat) or to edit; the official send always uses `payment_reminder_hi`.

### AI assistant (Phase 6)

**Enabling it:**
- Set `ANTHROPIC_API_KEY` in `backend/.env` and restart. `AI_PROVIDER` becomes `anthropic` automatically.
- Without a key the assistant page shows "not configured" and every AI endpoint returns `503 AI_NOT_CONFIGURED`. Nothing else is affected.

**Model and settings:**
- `AI_MODEL=claude-opus-5-5` (default) and `AI_EFFORT=medium` (default). Opus 5.5 always thinks, so effort is the cost and depth control.
- Every request sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): if the model declines on safety grounds, Anthropic re-runs the request on its recommended fallback model.
- `AI_MAX_TOOL_ROUNDS=6` caps tool calls per question.

**Cost and limits:**
- Each question is one or more API calls billed to your Anthropic account.
- Plan quotas (`maxMonthlyAiQueries`: Professional 300, Business 1,500) count questions, drafts and reminders per business per month.
- There's also a per-user rate limit of 20 AI requests per minute.

**Privacy:**
- Only the minimum fields the tools return are sent to the model (names, codes, villages, balances). Bank details and mobile numbers are never sent.
- Voice is transcribed **in the browser** (Web Speech API); only the text reaches the server.
- Photos of pattis are stored in `UPLOAD_DIR` (local disk in development) and sent to the model for that one extraction.

### Razorpay subscription billing (Phase 7, as built)
**Without keys (`BILLING_PROVIDER=mock`, the development default):**
- The billing page shows "टेस्ट मोड".
- "भुगतान करें" opens a local test dialog that signs exactly like Razorpay, so the real server-side verification runs. No money moves.
- Production refuses this mode.

**Going live:**
1. Razorpay Dashboard → *Account & Settings → API keys*: generate a **Key ID** and **Key Secret** (test keys first, on staging).
2. *Webhooks → Add new webhook*:
   - URL: `https://<your-domain>/api/v1/webhooks/razorpay`
   - a strong secret
   - events: `payment.captured`, `payment.failed`, `order.paid`
3. Set `BILLING_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, then restart.
4. Pay for a plan once with test keys. Check that `/billing` shows the plan active and that a re-delivered webhook is ignored.

The order, checkout-signature and webhook code follow Razorpay's documented API and signature scheme and are covered by tests, but **have not yet been exercised against a live Razorpay account.**

**What customers get:**
- Prepaid 30-day periods, paid with UPI, card or netbanking through Razorpay Checkout.
- Nothing is charged automatically. In-app reminders appear 3 days and 1 day before the end.
- Plan prices come from the `SubscriptionPlan` table (seeded: ₹499 / ₹799 / ₹1,499).
- The receipt is a **payment receipt, not a GST tax invoice.** Tax invoices need your company's GSTIN, a decision on whether prices include GST, and invoice numbering. That is a business decision and is not built yet.

**Super Admin:**
- After the person has registered, run `npm run admin:grant -w @mandimitra/backend -- 98XXXXXXXX`. Revoke with `--revoke`.
- They see "सुपर एडमिन" in the profile menu, or land on `/admin` directly if they own no business.

### Anthropic (Phase 6)
`ANTHROPIC_API_KEY` is read server-side only. It must never be exposed through `NEXT_PUBLIC_*`.
