# SalonBook — Server

The REST API behind **SalonBook**: an Express 5 + MongoDB service that serves the Next.js client, verifies Better Auth sessions, stores salon data and completes Stripe Checkout payments through a verified webhook.

---

## Project Links

- **Live Website Link:** [https://salonbook-client.vercel.app](https://salonbook-client.vercel.app) *(update with your live deployed URL)*
- **Client Repository Link:** [https://github.com/its-MahiOP/SalonBook-Client](https://github.com/its-MahiOP/SalonBook-Client)
- **Server Repository Link:** [https://github.com/its-MahiOP/SalonBook-Server](https://github.com/its-MahiOP/SalonBook-Server)

---

## Features

- **JWT authentication** — verifies Better Auth tokens against the client's public JWKS, then re-reads the user from MongoDB so roles and blocked accounts cannot be spoofed
- **Role enforcement** — `customer` / `admin` checks on every protected route
- **Services** — searchable catalogue, category counts and full CRUD (admin only)
- **Appointments** — booking with slot availability, unique slot locking, confirm/cancel/reschedule
- **Users** — customer directory, block/unblock, appointment counts
- **Payments** — Stripe Checkout session creation, read-only session status, and a **signature-verified webhook** that is the only code path allowed to mark an appointment as paid
- **Transactions** — payment history, populated reports and CSV export
- **Contact form** — public enquiry endpoint with light IP throttling plus an admin inbox with mark-as-read
- **Ops** — health check with database ping, security headers, request logging, graceful shutdown
- **CORS** — restricted to the configured client origins

---

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 20+ |
| Framework | Express 5 |
| Database | MongoDB (native driver, no ORM) |
| Auth | Better Auth JWT verified with `jose` against a remote JWKS |
| Payments | Stripe Checkout + webhooks |
| Validation | Small hand-rolled helpers in `src/utils/validate.js` |

---

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `DB_URI` | yes | MongoDB connection string |
| `DB_NAME` | no | Database name (default `SalonBook`) |
| `AUTH_JWKS_URL` | yes | Base URL of the Next.js app — `/api/auth/jwks` is appended |
| `CLIENT_URL` | yes | Allowed CORS origin(s), comma separated |
| `PORT` | no | API port (default `5000`) |
| `STRIPE_SECRET_KEY` | for payments | Stripe secret key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | for payments | Stripe webhook signing secret — **without it every webhook is rejected and no appointment can become `paid`** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | optional | Publishable key, reported by `/api/payments/status` |
| `STRIPE_CURRENCY` | no | Defaults to `usd` |

> Never commit `.env`. Only `.env.example` is tracked.

### 3. Seed demo data

```bash
npm run seed
```

Creates 10 demo services (skipped if the collection already has data).

### 4. Run

```bash
npm run dev     # nodemon
npm start       # plain node
```

The API answers on <http://localhost:5000>:

```json
{ "success": true, "message": "Welcome to the SalonBook API", "version": "1.0.0" }
```

---

## API reference

All responses are JSON: `{ success, message?, data?, total? }`. Errors are `{ success: false, message }`.

### Auth

| Method | Route | Access | Notes |
| --- | --- | --- | --- |
| * | Better Auth routes live on the Next.js app | — | This server only consumes them |

### Services

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/services?search=&category=&sort=&status=` | public |
| GET | `/api/services/categories` | public |
| GET | `/api/services/:id` | public |
| POST | `/api/services` | admin |
| PATCH | `/api/services/:id` | admin |
| DELETE | `/api/services/:id` | admin |

### Appointments

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/appointments/available-slots?date=YYYY-MM-DD` | public |
| GET | `/api/appointments/my` | customer |
| GET | `/api/appointments?status=` | admin |
| GET | `/api/appointments/:id` | owner or admin |
| POST | `/api/appointments` | customer |
| PATCH | `/api/appointments/:id/status` | admin |
| PATCH | `/api/appointments/:id/cancel` | customer (own, pending) |
| PATCH | `/api/appointments/:id/reschedule` | owner (pending) or admin |

### Users

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/users` | admin |
| PATCH | `/api/users/:id/block` | admin |
| GET | `/api/users/:id` | admin or owner |

### Profile

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/profile` | authenticated |
| PATCH | `/api/profile` | authenticated |
| POST | `/api/profile/password` | authenticated |

### Transactions

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/transactions` | admin |
| GET | `/api/transactions/export` | admin (CSV download) |
| GET | `/api/transactions/my` | customer |
| GET | `/api/transactions/:id` | admin or owner |

### Stats

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/stats/customer` | customer |
| GET | `/api/stats/admin` | admin |

### Payments

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/payments/checkout` | customer (confirmed, unpaid) |
| GET | `/api/payments/session/:sessionId` | owner or admin |
| GET | `/api/payments/status` | public — reports which Stripe keys are configured |
| POST | `/api/payments/webhook` | Stripe (raw body, signature verified) |

### Contact

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/contact` | public (max 5 per 10 minutes per IP) |
| GET | `/api/contact` | admin inbox (latest 100) |
| PATCH | `/api/contact/:id/read` | admin |

### Ops

| Method | Route | Access |
| --- | --- | --- |
| GET | `/` | public — service metadata |
| GET | `/api/health` | public — pings MongoDB, `503` when degraded |

---

## Stripe setup (test mode)

1. Create a Stripe account and copy the **test** secret key into `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint pointing at `https://<your-api>/api/payments/webhook` with event types:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
3. Copy the **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. Locally, forward events with the Stripe CLI:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

**Payment safety:** `paymentStatus` is set to `paid` only inside the webhook handler, after Stripe's signature is verified. If `STRIPE_WEBHOOK_SECRET` is missing the endpoint rejects every event with `503`, so a tampered or unverified request can never mark an appointment as paid.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run with nodemon |
| `npm start` | Run with node |
| `npm run seed` | Seed demo services |

---

## Project structure

```
index.js               app wiring: CORS, webhook (raw), routes, health, shutdown
src/config/env.js      environment loading and validation
src/db/mongo.js        connection, collections, indexes, graceful disconnect
src/middleware/
  auth.js              JWKS verification + role/blocked checks
  error.js             404 and error handlers
  logger.js            request logging
  security.js          security response headers
src/routes/            services, appointments, users, profile, transactions,
                       stats, payments, contact
src/utils/             validation, serializers, population, constants, ApiError
scripts/seed.js        demo service data
```

---

## Security notes

- Secrets live only in `.env`, which is git-ignored.
- JWTs are verified cryptographically; role and `isBlocked` come from the database, never from the token alone.
- The Stripe webhook is registered **before** `express.json()` so the raw body is available for signature verification.
- CORS only allows the origins listed in `CLIENT_URL`.
- Blocked users receive `403` from every protected route, including booking and payment creation.

---

## License

Built as a portfolio/assignment project. You are free to adapt it for learning purposes.
