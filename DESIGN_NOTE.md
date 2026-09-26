# Design Note

*(This reflects the actual architecture and a real discovery made while
building this — fill in the remaining bracketed parts with your own
specifics before submitting.)*

## How I made scraping reliable

- **Confirmed the store's real behavior with DevTools before writing scraper
  code**, rather than guessing. Listings (`/api/v2/listings`) and product
  detail (`/api/v2/items/:id`) are plain, unauthenticated JSON — those run
  over lightweight HTTP. Price/stock (`/api/v2/quote`) is gated behind a
  genuine anti-bot challenge: a proof-of-work puzzle, a WebAssembly module
  the client must execute, and a browser-attestation blob that includes a
  real mouse-movement history carrying `trusted: true`. Since that flag can
  only be produced by a real browser's input layer, I made price/stock
  scraping go exclusively through Playwright — it drives the real page and
  lets the page's own JS solve its own challenge, rather than me attempting
  to reimplement a bot-detection bypass over plain HTTP (fragile, and a lot
  of surface area to get wrong across "many unattended runs"). Full writeup
  in `backend/src/config.js`.
- **Layered strategy, cheapest first where it's actually viable.** Search
  and product lookup stay on fast HTTP; only the leg that genuinely needs a
  browser uses one.
- **Every scrape run gets up to 3 attempts with exponential backoff + jitter**
  (`RETRY.maxAttempts`, `RETRY.baseBackoffMs` in `config.js`), matching the
  store's own UI, which shows a "Loaded in N attempt(s)" / "Check again"
  affordance -- i.e. the store itself expects this leg to need retries.
- **Explicit, generous timeouts on the slow leg specifically**
  (`SCRAPE_TIMEOUTS.playwrightWaitMs`), separate from the fast calls, since
  the PoW computation + quote round-trip legitimately takes much longer than
  a normal page load and shouldn't be treated as a hang.
- **Validation gate before anything is stored as a success**
  (`validate()` in `scrape.js`): a price that's missing, non-numeric, or <= 0,
  or a stock value that's empty, is treated as a failed attempt and retried —
  never written to `price_history` as if it succeeded.
- **Honest, granular logging.** `scrape_log` records every individual attempt
  with outcome, duration, and error message; `price_history` records the
  final outcome per run, with `price`/`stock` left `NULL` on failure — which
  the CSV export surfaces as empty cells, exactly per spec.
- **A run-level lock** (`scrapeRunning` flag in `routes/scrape.js`) prevents
  an overlapping cron trigger from launching a second full scrape pass
  concurrently.

## Trade-offs I made

- Chose not to reimplement the PoW/WASM/fingerprint challenge over plain
  HTTP even though it's theoretically partly solvable (the PoW and WASM
  execution are; the trusted-event mouse-movement attestation realistically
  isn't, without a real browser). Trade-off: every price scrape now costs a
  full browser launch instead of a cheap fetch, which is slower and heavier
  — but far more robust than depending on a token-forgery scheme that could
  break the moment the store's attestation checks get stricter.
- Bounded concurrency of 2 when scraping all products in one batch, to avoid
  launching too many concurrent Chromium instances on a free-tier Render
  dyno and to avoid hammering the store's PoW endpoint.
- Kept `price_history` and `scrape_log` as two tables instead of one, so
  intra-run retry attempts have their own audit trail without bloating the
  price-history table used for charts/export.
- Search paginates the full ~960-product catalog and filters client-side,
  since the store has no search UI to confirm a server-side `search` param
  against. This costs ~48 small requests per search instead of one, but each
  is fast (~30ms observed), so a full search stays under ~2 seconds.

## What my AI tools got wrong on the first attempt, and how I corrected it

- The first version of the scraper treated the `handshake` calls as a plain
  two-step session/cookie exchange and tried to replicate it over HTTP —
  reasonable-looking code that would never actually have worked, because it
  didn't account for the PoW/WASM/attestation requirements until I captured
  the real requests and inspected the POST body. The fix wasn't really a
  code fix so much as a design change: move the entire price-fetch path to
  Playwright and stop trying to fetch the quote via HTTP at all.
- An early version guessed at REST-ish endpoint paths (`/api/products/:id`,
  `/api/quote?opt=`) instead of the real ones (`/api/v2/items/:id`,
  `/api/v2/items/:id/quote?opt=`). Fixed by capturing real requests with
  DevTools' "Copy as fetch" rather than guessing from convention.
- [Add your own specifics here: what you saw the first time you ran the
  scraper for real, any selector mismatches once you actually inspected the
  live DOM for `priceTriggerButton`/`priceEl`/`stockEl`, and what the
  out-of-stock text format turned out to be.]

## AI tool usage disclosure

[State plainly which AI tools you used (e.g. Claude, ChatGPT, Copilot), for
which parts (scaffolding, scraper logic, debugging, the DevTools-driven
protocol reverse-engineering, README), and confirm you reviewed, tested, and
understand the resulting code — since you may be asked to modify it live in
the interview.]
