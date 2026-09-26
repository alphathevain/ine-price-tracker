import { chromium } from 'playwright';
import { SELECTORS, SCRAPE_TIMEOUTS, STORE_BASE_URL } from '../config.js';

/**
 * Headless-browser strategy — used as the auto-fallback when the http
 * strategy's assumed endpoints don't match reality yet, or forced via
 * SCRAPE_STRATEGY=playwright / the headed manual-run script.
 *
 * Critically: the price does NOT load on page load. The page shows
 * "Price locked — hover to load" and only fires the handshake/quote calls
 * once you interact with the price box (hover, or the "CHECK TODAY'S PRICE"
 * / "CHECK AGAIN" button). We click the button rather than relying on hover,
 * since hover is flaky to simulate reliably headless.
 *
 * headed: true launches a visible, slowed-down window — used by
 * scripts/manual-headed-scrape.js for the required observable run recording.
 */
export async function scrapeProductWithBrowser(productUrl, { headed = false, selectors = SELECTORS, optionLabel = null } = {}) {
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const response = await page.goto(productUrl, {
      timeout: SCRAPE_TIMEOUTS.playwrightNavMs,
      waitUntil: 'domcontentloaded',
    });
    if (!response || !response.ok()) {
      throw new Error(`Navigation responded ${response ? response.status() : 'no response'}`);
    }

    // Select the requested option (tone) before triggering the price load,
    // if one was specified and a matching button exists.
    if (optionLabel) {
      const optionBtn = page.getByRole('button', { name: optionLabel, exact: false });
      if (await optionBtn.count()) {
        await optionBtn.first().click();
      }
    }

    // Trigger the price load. Hover first — the page tracks real dwell time
    // and mouse movement as part of its own attestation, and Playwright's
    // hover/click are dispatched through the browser's real input layer
    // (genuine `isTrusted` events), not synthetic DOM events — then click.
    const trigger = page.locator(selectors.priceTriggerButton);
    if (await trigger.count()) {
      await trigger.first().hover();
      await page.waitForTimeout(400 + Math.random() * 400);
      await trigger.first().click();
    } else {
      await page.locator(selectors.priceEl).first().hover().catch(() => {});
    }

    // This is the deliberately slow leg (the anti-bot handshake + quote,
    // see config.js) — give it the full wait timeout, not the short nav one.
    await page.waitForSelector(selectors.readySelector, { timeout: SCRAPE_TIMEOUTS.playwrightWaitMs });

    const rawPrice = await page.locator(selectors.priceEl).first().innerText();
    const rawStock = await page
      .locator(selectors.stockEl)
      .first()
      .innerText()
      .catch(() => null);

    return { rawPrice: rawPrice?.trim(), rawStock: rawStock?.trim() ?? null };
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function searchWithBrowser(queryText, { headed = false, selectors = SELECTORS } = {}) {
  // Fallback of last resort — used only if the JSON listings endpoint in
  // config.js turns out to be wrong. Note: the store has no search box, and
  // this only reads whatever product cards are rendered on the first
  // "All products" page load (no pagination), so it will miss matches
  // outside that first page. searchListings() in httpStrategy.js (which
  // paginates the full 960-product catalog) is the real search path — fix
  // config.js rather than relying on this browser fallback long-term.
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(STORE_BASE_URL, { timeout: SCRAPE_TIMEOUTS.playwrightNavMs, waitUntil: 'domcontentloaded' });

    const searchInput = page.locator(selectors.searchInput);
    if (await searchInput.count()) {
      await searchInput.first().fill(queryText);
      await page.keyboard.press('Enter').catch(() => {});
    }
    // If there's no search box on this store, we're already on the "All
    // products" listing — fall through to reading whatever cards render.
    await page.waitForSelector(selectors.productCard, { timeout: SCRAPE_TIMEOUTS.playwrightWaitMs }).catch(() => {});

    const cards = await page.locator(selectors.productCard).all();
    const results = [];
    for (const card of cards) {
      const title = await card.locator(selectors.productTitle).first().innerText().catch(() => null);
      const href = await card.locator(selectors.productLink).first().getAttribute('href').catch(() => null);
      if (title && (!queryText || title.toLowerCase().includes(queryText.toLowerCase()))) {
        results.push({ title: title.trim(), url: href ? new URL(href, STORE_BASE_URL).href : null });
      }
    }
    return results;
  } finally {
    await context.close();
    await browser.close();
  }
}
