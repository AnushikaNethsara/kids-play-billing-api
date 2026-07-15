# Kids' Play Area Billing API

Backend for an indoor kids' play-area billing and management system. Serves both the
cashier Android (React Native) app and the Next.js admin back-office over a single REST
API.

## Stack

Node.js, TypeScript, Express, MongoDB/Mongoose, JWT auth, Zod validation, Pino logging,
Swagger/OpenAPI docs, Vitest tests. Designed to run entirely on free tiers (MongoDB
Atlas M0 + Render/Railway/Koyeb/Fly.io).

## Architecture at a glance

- **Money** is stored as integer minor units (LKR cents) everywhere - never floats.
- **Bill numbers** (`KPA-20260715-0001`) come from an atomic per-day counter
  (`findOneAndUpdate($inc)`), safe under concurrent cashiers without transactions.
- **Bill completion** is a compare-and-set (`DRAFT` -> `PAID` in one atomic update), so
  it can never run twice for the same bill. An optional `Idempotency-Key` header adds
  exact-response replay for client retries on top of that guarantee.
- **Dashboard aggregations** always bucket dates using `BusinessSettings.timezone`
  (default `Asia/Colombo`), never server-local time.
- **Receipts** are returned as structured JSON and as pre-formatted plain text (32/48
  column widths for 58mm/80mm paper) - the mobile app converts either into ESC/POS
  commands for the Bluetooth thermal printer. No PDF generation.

## Project layout

```text
src/
  config/           env validation (Zod), app-wide constants
  database/         Mongoose connection with retry
  common/           errors, logger, utils (money, pagination, date ranges), constants, shared types
  middleware/        auth, validation, error handling, security, rate limiting, request id
  modules/
    auth/            login, refresh, logout, me
    users/           admin-only cashier/admin account management
    play-packages/   pricing configuration
    customers/       optional parent/child records
    bills/           the core billing lifecycle
    dashboard/       admin-only revenue & stats aggregations
    settings/        business-wide configuration
    audit-logs/      trail of sensitive actions
  routes/            mounts all module routers under /api/v1
  docs/              Swagger/OpenAPI setup
  app.ts / server.ts
scripts/seed.ts       creates the default admin/cashier/packages
tests/                integration tests (Vitest + Supertest + mongodb-memory-server)
```

## Getting started (local)

```bash
npm install
cp .env.example .env
# Fill in MONGODB_URI (local Mongo or Atlas), JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
# Generate strong secrets with: openssl rand -hex 64

npm run seed   # creates admin@example.com / cashier@example.com, password ChangeMe123!
npm run dev    # http://localhost:4000, docs at http://localhost:4000/api/docs
```

Run tests:

```bash
npm test
```

Lint, format, and typecheck:

```bash
npm run lint
npm run format
npm run typecheck
```

## Seeded accounts

| Role    | Email                | Password       |
|---------|-----------------------|----------------|
| ADMIN   | admin@example.com     | ChangeMe123!   |
| CASHIER | cashier@example.com   | ChangeMe123!   |

**Change these passwords immediately outside of local development** (`POST
/api/v1/users/:id/reset-password`).

## Health checks

- `GET /health` - process is up.
- `GET /ready` - process is up **and** the MongoDB connection is established.

## Deploying on a free tier

1. **MongoDB Atlas** - create a free M0 cluster, a database user, and allow network
   access from your host platform (or `0.0.0.0/0` if the platform uses dynamic egress
   IPs, e.g. Render). Copy the connection string into `MONGODB_URI`.
2. **Render / Railway / Koyeb / Fly.io** - deploy this repo as a Docker service (the
   included `Dockerfile` is a multi-stage build producing a small production image), or
   as a plain Node service using `npm run build && npm start`.
3. Set the environment variables from `.env.example` in the platform's dashboard -
   never commit real secrets. `CORS_ORIGINS` should list your deployed Next.js admin
   app's origin (comma-separated if you need more than one, e.g. local + deployed).
4. Point the platform's health check at `GET /health` (or `/ready` once you want it to
   gate on DB connectivity too).
5. Run `npm run seed` once against the deployed database (e.g. via a one-off job or
   locally with `MONGODB_URI` pointed at Atlas) to create the initial admin account,
   then change its password immediately.

No AWS, paid queues, or paid storage are required - this is a single stateless Node
process plus MongoDB Atlas.

## API documentation

Interactive Swagger UI: `GET /api/docs`. Raw OpenAPI JSON: `GET /api/docs.json`.

## Docker

```bash
docker build -t kpa-billing-api .
docker run --env-file .env -p 4000:4000 kpa-billing-api
```

Or with a local Mongo for development:

```bash
JWT_ACCESS_SECRET=$(openssl rand -hex 64) JWT_REFRESH_SECRET=$(openssl rand -hex 64) docker compose up --build
```
