/**
 * Run a headed (visible-browser) scrape against one or more tracked products,
 * so its behavior — including retries on a slow/failing response — can be
 * watched and screen-recorded.
 *
 * Usage:
 *   npm run scrape:manual                 # scrapes all active tracked products, headed
 *   npm run scrape:manual -- <product-id>  # scrapes a single tracked product by its DB id
 */
import 'dotenv/config';
import { query, pool } from '../src/db.js';
import { scrapeOneProduct } from '../src/scraper/scrape.js';

async function main() {
  const targetId = process.argv[2];

  // Force the playwright path so the run is actually visible and demonstrates
  // wait/retry behavior even if the http strategy would otherwise succeed silently.
  process.env.SCRAPE_STRATEGY = 'playwright';

  const { rows } = targetId
    ? await query('select * from tracked_products where id = $1', [targetId])
    : await query('select * from tracked_products where is_active = true');

  if (!rows.length) {
    console.log('No tracked products found. Track at least one product first via the dashboard/API.');
    await pool.end();
    return;
  }

  console.log(`Running headed scrape on ${rows.length} product(s)...`);
  for (const product of rows) {
    console.log(`\n--- Scraping: ${product.product_name} (${product.option_label}) ---`);
    const result = await scrapeOneProduct(product, { hint: 'playwright', headed: true });
    console.log('Result:', result);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('Manual scrape script failed:', err);
  await pool.end();
  process.exit(1);
});
