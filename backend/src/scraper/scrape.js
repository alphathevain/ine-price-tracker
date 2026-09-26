import crypto from 'node:crypto';
import { query } from '../db.js';
import { STRATEGY_HINT, RETRY, SCRAPE_TIMEOUTS } from '../config.js';
import { fetchQuote } from './httpStrategy.js';
import { scrapeProductWithBrowser } from './playwrightStrategy.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalizes whatever raw shape a strategy returned into { price:number, stock:string } */
function normalize(raw) {
  let price = null;
  let stock = null;

  if (raw == null) throw new Error('Strategy returned no data');

  if (typeof raw === 'object' && !('rawPrice' in raw)) {
    // Quote API JSON shape — field names guessed from what's visible on the
    // page (price, originalPrice/mrp, stock/available count, seller, delivery,
    // rating). Confirm exact field names via the quote response in DevTools
    // and adjust the accessors below if they differ.
    const p = raw.price ?? raw.currentPrice ?? raw.salePrice ?? raw.data?.price;
    price = p != null ? Number(p) : null;

    const s = raw.stock ?? raw.available ?? raw.availableCount ?? raw.stockCount ?? raw.data?.stock;
    stock = s != null ? String(s) : null;
  } else {
    // HTML / Playwright shape: { rawPrice: "₹5,672", rawStock: "AVAILABLE (32)" }
    const cleaned = String(raw.rawPrice).replace(/[^0-9.]/g, '');
    price = cleaned ? Number(cleaned) : NaN;
    stock = raw.rawStock ? String(raw.rawStock).trim() : null;
  }

  return { price, stock };
}

/** Throws if the extracted data is not trustworthy enough to store as a success. */
function validate({ price, stock }) {
  if (price == null || Number.isNaN(price) || price <= 0) {
    throw new Error(`Invalid price extracted (got: ${price})`);
  }
  if (stock == null || stock === '') {
    throw new Error('Stock value missing or empty');
  }
  return { price, stock: normalizeStock(stock) };
}

function normalizeStock(raw) {
  const s = raw.toLowerCase();
  if (/out of stock|unavailable|sold out/.test(s)) return 'out_of_stock';
  // Matches the observed "AVAILABLE (32)" format -> keep the count.
  const availableMatch = raw.match(/available\s*\(?(\d+)\)?/i);
  if (availableMatch) return availableMatch[1];
  if (/in stock|available/.test(s)) return 'in_stock';
  const num = Number(raw.replace(/[^0-9]/g, ''));
  if (!Number.isNaN(num) && num >= 0 && /\d/.test(raw)) return String(num);
  return raw; // keep the raw text rather than silently discarding an unexpected format
}

async function logAttempt({ trackedProductId, runId, attemptNumber, startedAt, outcome, httpStatus, error, strategy }) {
  await query(
    `insert into scrape_log
      (tracked_product_id, attempt_number, run_id, started_at, finished_at, duration_ms, outcome, http_status, error_message, strategy)
     values ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9)`,
    [
      trackedProductId,
      attemptNumber,
      runId,
      startedAt,
      Date.now() - startedAt.getTime(),
      outcome,
      httpStatus ?? null,
      error ?? null,
      strategy,
    ]
  );
}

async function recordRunResult({ trackedProductId, runId, outcome, price, stock, attemptCount, error }) {
  await query(
    `insert into price_history
      (tracked_product_id, run_id, scraped_at, price, stock, outcome, attempt_count, error_message)
     values ($1,$2, now(), $3,$4,$5,$6,$7)`,
    [trackedProductId, runId, price ?? null, stock ?? null, outcome, attemptCount, error ?? null]
  );
}

/**
 * One attempt, one strategy. Returns validated { price, stock } or throws.
 * The 'http-json' strategy is intentionally unsupported for the quote leg
 * (see config.js) and exists only so choosing it explicitly fails fast with
 * a clear reason. product.option_label (the tracked tone/option, e.g.
 * "Neutral white") drives which option the Playwright strategy selects on
 * the real page before triggering the price load.
 */
async function attemptOnce(product, strategy, { headed = false } = {}) {
  let raw;
  if (strategy === 'http-json') {
    // Deliberately unsupported for the quote leg — see httpStrategy.js and
    // the long comment in config.js. Throws a clear, immediate error.
    raw = await fetchQuote();
  } else if (strategy === 'playwright') {
    raw = await scrapeProductWithBrowser(product.product_url, { headed, optionLabel: product.option_label });
  } else {
    throw new Error(`Unknown strategy: ${strategy}`);
  }
  return validate(normalize(raw));
}

function strategyChainFor(hint) {
  // The quote/price leg requires a real browser (anti-bot PoW+WASM+
  // attestation gate — see config.js). 'http' is kept only so an explicit
  // choice fails fast with a clear reason; 'playwright' (the default) and
  // any other value all route to the browser strategy.
  if (hint === 'http') return ['http-json'];
  return ['playwright'];
}

/**
 * Scrapes one tracked product with retries + exponential backoff, logging
 * every attempt honestly (success / retried / failed) and never writing
 * unvalidated data to price_history.
 */
export async function scrapeOneProduct(product, { hint = STRATEGY_HINT, headed = false } = {}) {
  const runId = crypto.randomUUID();
  const chain = strategyChainFor(hint);
  const runDeadline = Date.now() + SCRAPE_TIMEOUTS.perRunMs;

  let lastError = null;
  let attemptNumber = 0;

  for (let i = 0; i < RETRY.maxAttempts; i++) {
    if (Date.now() > runDeadline) {
      lastError = lastError || new Error('Per-run timeout exceeded');
      break;
    }
    attemptNumber += 1;
    const strategy = chain[Math.min(i, chain.length - 1)];
    const startedAt = new Date();

    try {
      // Hard ceiling per attempt = the browser wait timeout + a little slack,
      // since the anti-bot handshake+quote leg is the slowest legitimate
      // part of a scrape.
      const result = await Promise.race([
        attemptOnce(product, strategy, { headed }),
        sleep(SCRAPE_TIMEOUTS.playwrightWaitMs + 10000).then(() => {
          throw new Error('Attempt exceeded hard timeout');
        }),
      ]);

      const outcome = attemptNumber === 1 ? 'success' : 'retried';
      await logAttempt({ trackedProductId: product.id, runId, attemptNumber, startedAt, outcome, strategy });
      await recordRunResult({
        trackedProductId: product.id,
        runId,
        outcome,
        price: result.price,
        stock: result.stock,
        attemptCount: attemptNumber,
      });
      return { ok: true, price: result.price, stock: result.stock, attempts: attemptNumber };
    } catch (err) {
      lastError = err;
      await logAttempt({
        trackedProductId: product.id,
        runId,
        attemptNumber,
        startedAt,
        outcome: 'attempt_failed',
        error: err.message,
        strategy,
      });
      if (i < RETRY.maxAttempts - 1) {
        const backoff = RETRY.baseBackoffMs * 2 ** i + Math.random() * 300;
        await sleep(backoff);
      }
    }
  }

  // Every attempt exhausted — record an honest failure, never fabricate data.
  await recordRunResult({
    trackedProductId: product.id,
    runId,
    outcome: 'failed',
    price: null,
    stock: null,
    attemptCount: attemptNumber,
    error: lastError?.message ?? 'Unknown error',
  });
  return { ok: false, error: lastError?.message, attempts: attemptNumber };
}

export async function scrapeAllActiveProducts({ concurrency = 2 } = {}) {
  const { rows: products } = await query('select * from tracked_products where is_active = true');
  const results = [];
  const queue = [...products];
  async function worker() {
    while (queue.length) {
      const product = queue.shift();
      const result = await scrapeOneProduct(product);
      results.push({ productId: product.id, ...result });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, worker));
  return results;
}
