import 'dotenv/config';

/**
 * ===========================================================================
 * SITE-SPECIFIC CONFIG — confirmed from live DevTools capture
 * ===========================================================================
 * Confirmed flow against https://demo.inelabteamdev.com/:
 *
 *  1. Listings (search/browse), no auth needed:
 *       GET /api/v2/listings?page=1&limit=20[&search=...]
 *     The store's own UI has no search box, so `&search=` is untested from
 *     the UI's perspective. searchListings() in httpStrategy.js tries it
 *     opportunistically and falls back to paginating the full ~960-product
 *     catalog and filtering client-side either way.
 *
 *  2. Product detail, no auth needed:
 *       GET /api/v2/items/:id     (e.g. /api/v2/items/2519)
 *
 *  3. Price/stock is NOT in the product detail response and is gated behind
 *     a real anti-bot challenge — confirmed from a live capture:
 *       a. GET  /api/v2/handshake
 *          -> { salt, difficulty, wasm (base64 WASM module), ts, ... }
 *       b. The client must: brute-force a `nonce` meeting the PoW
 *          `difficulty`, execute the WASM module to get `wasmOut`, and
 *          collect an attestation blob (`att`) containing a canvas
 *          fingerprint hash, a WebGL fingerprint hash, `hardwareConcurrency`,
 *          screen resolution/DPR, requestAnimationFrame timing samples, and
 *          — critically — a REAL mouse-movement history with timestamps
 *          carrying `trusted: true`.
 *       c. POST /api/v2/handshake with { salt, ts, difficulty, csig, wasm,
 *          nonce, derived, wasmOut, att, itemId, option } -> a signed,
 *          scoped Bearer token (decodes to
 *          "GET|/api/v2/items/:id/quote|id:opt|<hash>|<ts>", HMAC-signed).
 *       d. GET /api/v2/items/:id/quote?opt=<code>
 *          with `Authorization: Bearer <token>` -> price, stock, etc.
 *
 *     `trusted: true` on the mouse events is the key detail: genuine
 *     `isTrusted` DOM events can only be produced by a real browser's input
 *     layer — no plain-HTTP client, and no JS-dispatched synthetic event,
 *     can fake that. Reimplementing the PoW + WASM execution + fingerprint
 *     spoofing over plain HTTP would mean building a bot-detection bypass
 *     from scratch — disproportionate engineering and a fragile thing to
 *     depend on for "reliable across many unattended runs."
 *
 *     This is exactly the case the assignment brief means by "reach for a
 *     headless browser only where the page genuinely requires it": drive the
 *     real page with Playwright, let the page's own JS solve its own
 *     challenge using real, browser-native input events, and just read the
 *     rendered result. See scraper/playwrightStrategy.js — that is the ONLY
 *     supported path for price/stock on this store. The `fetchQuote` stub in
 *     httpStrategy.js documents this decision and throws a clear error if
 *     ever selected, rather than being silently unavailable.
 * ===========================================================================
 */

export const STORE_BASE_URL = process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com';

// 'playwright' | 'http' (http is intentionally unsupported for the quote
// leg — see the note above — kept only so choosing it explicitly fails
// fast with a clear explanation rather than hanging).
export const STRATEGY_HINT = process.env.SCRAPE_STRATEGY || 'playwright';

export const API = {
  listingsEndpoint: (page = 1, limit = 20, search = null) =>
    `${STORE_BASE_URL}/api/v2/listings?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
  productEndpoint: (id) => `${STORE_BASE_URL}/api/v2/items/${id}`,
};

export const QUOTE_REQUIRES_BROWSER = true;

export const SELECTORS = {
  // The store's UI has no search box — searching is done via the listings
  // API pagination instead (see httpStrategy.js). This selector is only
  // used by the last-resort browser search fallback.
  searchInput: 'input[type="search"], input[name="search"], input[placeholder*="Search" i]',
  productCard: '.product-card, [class*="product"]',
  productLink: 'a',
  productTitle: 'h1',
  // TODO: confirm the exact button text/selector by inspecting the real
  // element — seen in the UI as "CHECK TODAY'S PRICE" / "CHECK AGAIN".
  priceTriggerButton: `button:has-text("CHECK TODAY'S PRICE"), button:has-text("CHECK AGAIN")`,
  // Confirmed visually: price renders as "₹5,672" style text.
  priceEl: 'text=/₹[0-9,]+/',
  // Confirmed visually: "AVAILABLE (32)" / presumably "OUT OF STOCK".
  stockEl: 'text=/AVAILABLE|OUT OF STOCK/i',
  optionButtons: '[data-testid="option"], button', // tone buttons: "Warm white" / "Neutral white" / "Tunable white"
  readySelector: 'text=/₹[0-9,]+/',
};

export const SCRAPE_TIMEOUTS = {
  perAttemptMs: 12000,     // fast calls: listings, product detail
  perRunMs: 180000,        // ceiling across all retries for one product (3 min)
  playwrightNavMs: 15000,
  // The handshake's PoW + WASM computation plus the quote round-trip can
  // legitimately take a while (observed waterfall spanning tens of seconds)
  // — this needs to be generous, not treated as a hung request.
  playwrightWaitMs: 60000,
};

export const RETRY = {
  maxAttempts: 3,
  baseBackoffMs: 1500,
};
