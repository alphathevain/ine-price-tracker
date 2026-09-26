# INE Price Tracker

Tracks prices/stock for products on INE's mock storefront (`https://demo.inelabteamdev.com`)
on a fixed 2-hour schedule, with a dashboard showing price history, a per-product
scrape log, and CSV export.

```
frontend/   React + Vite dashboard        → deploy to Vercel
backend/    Node/Express API + scraper    → deploy to Render
db/         Supabase Postgres schema
```

## 0. Confirmed store behavior (do not skip this)

DevTools inspection (with a live capture) confirmed the real flow:

1. `GET /api/v2/listings?page=1&limit=20` — catalog browsing (960 products,
   20/page). **No search box exists in the store's UI**, so `searchListings()`
   in `backend/src/scraper/httpStrategy.js` treats "paginate the full catalog
   and filter client-side by name" as the primary path (it opportunistically
   tries a `search=` param first, in case the API supports it without a UI
   for it, but doesn't depend on that working).
2. `GET /api/v2/items/:id` — product detail. No auth needed.
3. **Price/stock is gated behind a real anti-bot challenge**, not just a
   delay. A live capture showed:
   - `GET /api/v2/handshake` returns a proof-of-work challenge: a `salt`, a
     `difficulty`, and a base64-encoded **WebAssembly module**.
   - The client must brute-force a `nonce` meeting the PoW difficulty,
     execute the WASM module for a `wasmOut` value, and collect a browser
     **attestation blob**: canvas fingerprint hash, WebGL fingerprint hash,
     `hardwareConcurrency`, screen resolution, animation-frame timing
     samples, and — critically — a **real mouse-movement history with
     `trusted: true`**.
   - `POST /api/v2/handshake` with all of that returns a signed, scoped
     Bearer token.
   - `GET /api/v2/items/:id/quote?opt=<code>` with that token returns the
     actual price/stock.

   `trusted: true` on the mouse events is the tell: genuine `isTrusted` DOM
   events can only come from a real browser's input layer. Reimplementing
   the PoW + WASM + fingerprint spoofing over plain HTTP would mean building
   a bot-detection bypass from scratch. **This is exactly the case the
   assignment brief means by "reach for a headless browser only where the
   page genuinely requires it."** So: listings and product detail run over
   plain HTTP (fast, no browser), and price/stock always runs through
   Playwright, which drives the real page and lets its own JS solve its own
   challenge using genuine browser input events. `SCRAPE_STRATEGY=playwright`
   is the default and the only supported path for price — see the long
   comment in `backend/src/config.js` for the full writeup.

Two things still worth confirming/adjusting once you can watch a real headed
run: the exact `priceTriggerButton` / `priceEl` / `stockEl` selectors in
`config.js` (best-guess from the visible UI text, not yet DOM-inspected),
and whether the store ever serves an out-of-stock product to see that text
format for `normalizeStock()` in `scrape.js`.

## 1. Local setup

### Database (Supabase)
1. Create a free project at supabase.com.
2. Open the SQL editor, paste and run `db/schema.sql`.
3. Project Settings → Database → Connection string → URI. Copy it for `DATABASE_URL`.

### Backend
```bash
cd backend
cp .env.example .env    # fill in DATABASE_URL, CRON_SECRET, ALLOWED_ORIGINS
npm install
npx playwright install --with-deps chromium   # only needed if you'll use the playwright strategy
npm run dev              # http://localhost:4000
```

### Frontend
```bash
cd frontend
cp .env.example .env     # VITE_API_BASE_URL=http://localhost:4000
npm install
npm run dev               # http://localhost:5173
```

### Headed run (for the required screen recording)
```bash
cd backend
npm run scrape:manual              # scrapes all tracked products, visible browser
npm run scrape:manual -- <db-id>   # scrapes one specific tracked product
```
This forces the Playwright strategy and launches a visible, slowed-down browser
so retry/backoff behavior on a slow or failing response is watchable. Record
your screen while running this against at least one product that you can see
hit a retry (re-run a couple of times if the store's error injection doesn't
trigger on the first try).

## 2. Environment variables

### Backend (`backend/.env`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string |
| `PORT` | Local port (Render sets this itself in production) |
| `CRON_SECRET` | Shared secret cron-job.org sends to authorize scrape triggers |
| `STORE_BASE_URL` | The mock store URL |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins (CORS) |
| `SCRAPE_STRATEGY` | `http` \| `playwright` \| `auto` |
| `SENDGRID_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | Optional, for price-drop/back-in-stock email alerts |

### Frontend (`frontend/.env`)
| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | URL of the deployed backend |

## 3. Scraping schedule

Every tracked product is scraped **once every 2 hours** by default
(`scrape_frequency_minutes = 120`, configurable per product from the dashboard
as a bonus feature — the schedule column exists in the DB but the actual
trigger cadence is controlled externally, see below).

Because free-tier Render dynos sleep when idle, scraping is **not** run from an
in-process timer/loop. Instead:

1. Deploy the backend to Render.
2. Create a free account at cron-job.org.
3. Create a job:
   - URL: `https://<your-backend>.onrender.com/internal/scrape-all`
   - Method: `POST`
   - Header: `X-Cron-Secret: <same value as backend's CRON_SECRET>`
   - Schedule: every 2 hours
   - Timeout: set generously (60s+) to absorb a cold start
4. (Optional but recommended) add a second cron-job.org job hitting
   `GET /internal/health` a few minutes before each scrape, to pre-warm the
   Render instance so the real scrape request doesn't itself time out on a cold start.

## 4. Deployment

### Database — Supabase
Already covered in step 1. Note the pooled connection string (Session or
Transaction pooler) works more reliably from Render than the direct connection.

### Backend — Render
1. Push this repo to GitHub.
2. Render dashboard → New → Web Service → connect the repo, root directory `backend`.
3. Build command: `npm install && npx playwright install --with-deps chromium`
   (Render's `render.yaml` in `backend/` sets this automatically if you use
   "New → Blueprint" instead and point it at the repo).
4. Start command: `npm start`.
5. Add the environment variables from the table above.
6. Deploy. Confirm `GET https://<your-service>.onrender.com/` returns `{ ok: true, ... }`.

### Frontend — Vercel
1. Vercel dashboard → New Project → import the repo, root directory `frontend`.
2. Framework preset: Vite (auto-detected).
3. Add environment variable `VITE_API_BASE_URL` = your Render backend URL.
4. Deploy. Once live, go back to Render and set `ALLOWED_ORIGINS` to include
   the Vercel URL, then redeploy the backend so CORS allows it.

### Cron — cron-job.org
Set up as described in section 3, pointed at the live Render URL.

## 5. Live dashboard requirement

Before submission, make sure at least 2–3 products are tracked on the live
dashboard and have accumulated real scrape history from the actual cron
schedule (not just manually triggered runs) — let it run for at least a day
after deployment before recording the final walkthrough.

## 6. API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search?q=` | Search the live store by partial/full name |
| POST | `/api/tracked-products` | Track a product + option |
| GET | `/api/tracked-products` | List tracked products with latest price/stock |
| PATCH | `/api/tracked-products/:id` | Update scrape frequency |
| DELETE | `/api/tracked-products/:id` | Untrack (soft delete) |
| GET | `/api/tracked-products/:id/history` | Price/stock history |
| GET | `/api/tracked-products/:id/log` | Scrape attempt log |
| GET | `/api/export.csv` | Full CSV export |
| POST | `/internal/scrape-all` | Cron-triggered, requires `X-Cron-Secret` |
| POST | `/internal/scrape-one/:id` | Manual re-scrape from the dashboard |
| GET | `/internal/health` | Warm-up ping |
"# ine-price-tracker" 
"# ine-price-tracker" 
