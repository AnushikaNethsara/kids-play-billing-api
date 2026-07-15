# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Backend API for a kids' play-area billing and management system (Node/TypeScript/
Express/Mongoose/MongoDB). Serves two separate frontends that do not live in this repo:
a React Native cashier app (creates bills, prints ESC/POS receipts over Bluetooth) and a
Next.js admin back-office (pricing, dashboard, user management). Both consume the same
`/api/v1/*` REST API.

## Commands

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm run seed               # creates admin@example.com / cashier@example.com (ChangeMe123!) + 3 play packages
npm run dev                 # tsx watch, http://localhost:4000, docs at /api/docs
npm run build                # tsc -p tsconfig.build.json -> dist/
npm start                     # node dist/server.js (run build first)
npm run typecheck
npm run lint / npm run lint:fix
npm run format / npm run format:check
npm test                      # vitest run (spins up mongodb-memory-server, see tests/setup.ts)
npm run test:watch
```

Run a single test file or a single test by name:

```bash
npx vitest run tests/bills.test.ts
npx vitest run -t "prevents completing the same bill twice"
```

Pure unit tests (no DB) live next to their source, e.g.
`src/modules/bills/billCalculator.test.ts`. Integration tests (Supertest against the
real Express app + an in-memory Mongo) live in `tests/`.

## Architecture

Feature-based modules under `src/modules/<name>/`, each typically containing
`*.model.ts` (Mongoose schema), `*.repository.ts` (data access), `*.service.ts`
(business logic - this is where validation/calculation/audit logging happens, never in
controllers), `*.controller.ts` (thin, maps req/res to service calls), `*.validation.ts`
(Zod schemas), `*.routes.ts` (Express router + inline `@openapi` JSDoc), `*.types.ts`.

Modules: `auth`, `users`, `play-packages`, `customers`, `bills`, `dashboard`,
`settings`, `audit-logs`. `src/routes/index.ts` mounts all of them under `/api/v1`.
Cross-cutting code lives in `src/common/` (errors, logger, money/pagination/date-range
utils, constants) and `src/middleware/` (auth, RBAC, Zod validation, rate limiting,
error handling, request-id, CORS/helmet).

Every module's service functions accept the authenticated actor
(`req.user: { id, role, name, email }`, set by `middleware/auth.ts`) explicitly, rather
than reading it off a global - controllers pull it off `req.user` and pass it down.

### Money

All monetary fields are integer minor units (LKR cents - `LKR 800.00` is stored as
`80000`), never floats. Helpers in `src/common/utils/money.ts`. Never trust totals from
the client: `bill.service.ts` always recomputes subtotal/discount/tax/grandTotal
server-side from package price snapshots, both at draft creation and again at
completion (`billCalculator.ts` holds the pure calculation functions, unit-tested
independently of Mongo).

### Bills lifecycle (the core of the system)

`DRAFT -> PAID -> REFUNDED`, or `DRAFT -> CANCELLED` / `PAID -> CANCELLED` (admin only).
Each `Bill.items[]` entry snapshots the package's name/duration/price at billing time -
reports must never recompute from the current `PlayPackage` price.

- **Bill numbers** (`KPA-20260715-0001`): atomic per-business-day counter in
  `bills/counter.model.ts` + `billNumber.service.ts` via `findOneAndUpdate($inc)`. No
  transactions involved, so this works against any Mongo topology.
- **Completion is idempotent two ways**: `bill.repository.ts#completeIfDraft` and
  `#transitionIfStatusIn` do an atomic compare-and-set on `status`, so a bill can never
  be completed/cancelled/refunded twice even without any header. On top of that,
  `bills/idempotency.service.ts` + the `Idempotency-Key` request header give exact
  response replay for client retries (used by `POST /bills/:id/complete`).
- **Discount cap**: `billCalculator.ts#validateDiscountPermission` caps cashiers at
  `BusinessSettings.maximumCashierDiscountPercentage`; admins are uncapped. Discounts
  above that threshold get an audit log entry regardless of role.

### Dashboard aggregations

`dashboard.service.ts` runs Mongo aggregation pipelines directly against `BillModel`.
All date bucketing/filtering uses `BusinessSettings.timezone` (default `Asia/Colombo`),
resolved via `common/utils/dateRange.ts#resolveDateRange` - never server-local time.
"Revenue recognized" bills are `PAID` + `REFUNDED` (a refund is a reversal of a real
transaction, not its absence); `netRevenue = grossRevenue(sum subtotal) - discounts -
refunds`.

### Receipts

`bills/receipt.service.ts` builds one canonical receipt model from a paid `Bill` +
`BusinessSettings`, then two renderers sit on top: JSON (`GET /bills/:id/receipt`,
`/print-data`) and monospace plain text sized to 32 (58mm) or 48 (80mm) columns
(`GET /bills/:id/receipt/text`, via `receiptText.ts` helpers). No PDF generation - the
RN app converts either into ESC/POS commands itself.

### Auth

JWT access token (short-lived) + refresh token. Only a SHA-256 hash of the refresh token
is ever persisted (`auth/refreshToken.model.ts`); refresh rotates the token (old one is
revoked, marked `replacedByTokenHash`) so replay of a stolen token is detectable.

### Errors and responses

All errors extend `common/errors/AppError` (see `errorTypes.ts` for the set:
`ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`,
`DuplicateResourceError`, `InvalidStateError`, `PaymentError`, `RateLimitError`) and are
caught centrally by `middleware/errorHandler.ts`, which shapes every response as
`{ success, data|error, message? }`. Controllers should throw these rather than
constructing HTTP responses by hand.

### Swagger

Route docs are inline `@openapi` JSDoc comments in each `*.routes.ts` file, collected by
`src/docs/swagger.ts` into `/api/docs` (UI) and `/api/docs.json` (raw spec). **Gotcha**:
`swagger-jsdoc`'s glob resolution silently returns zero paths when given Windows
backslash paths - the apis glob in `swagger.ts` is deliberately normalized to forward
slashes. If `/api/docs.json` ever shows an empty `paths: {}` again on Windows, check
that normalization hasn't regressed.

## Testing setup

`tests/setup.ts` starts a `mongodb-memory-server` instance and connects `mongoose`
directly to it - independent of `MONGODB_URI`/`connectDatabase()`, so `env.ts`'s
required env vars just need placeholder values that pass Zod validation.
`vitest.config.ts` sets `isolate: false` (required - without it, Mongoose re-registers
models per test file and throws `OverwriteModelError`). `tests/helpers/factories.ts` has
`createAdmin()` / `createCashier()` (creates a user + logs in for a real JWT) and
`createPlayPackage()`.
