import { Router } from 'express';
import { query } from '../db.js';
import { STRATEGY_HINT } from '../config.js';
import { searchListings, fetchProductDetail } from '../scraper/httpStrategy.js';
import { searchWithBrowser } from '../scraper/playwrightStrategy.js';

const router = Router();

// GET /api/search?q=partial+or+full+name
// Searches the live store (not the DB) so the user can pick something new to track.
// Tries the listings JSON API first (fast); falls back to a headless browser
// pass only if that's not configured yet or fails.
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q query param is required' });

  try {
    let results;
    if (STRATEGY_HINT === 'playwright') {
      results = await searchWithBrowser(q, { headed: false });
    } else {
      try {
        const items = await searchListings(q);
        results = items.map((p) => ({
          storeProductId: p.id ?? p.sku ?? p.productId,
          title: p.name ?? p.title,
          url: p.url ?? null,
        }));
      } catch (err) {
        if (STRATEGY_HINT === 'http') throw err;
        results = await searchWithBrowser(q, { headed: false });
      }
    }
    res.json({ query: q, results });
  } catch (err) {
    res.status(502).json({ error: 'Store search failed', detail: err.message });
  }
});

// GET /api/products/:storeProductId/options — fetches product detail from the
// store so the frontend can show the real option list (with opt codes) for
// the user to pick before tracking. Falls back to a single "default" option
// if the detail response doesn't expose option codes yet (see config.js TODOs).
router.get('/products/:storeProductId/options', async (req, res) => {
  try {
    const detail = await fetchProductDetail(req.params.storeProductId);
    const options = detail.options ?? detail.variants ?? detail.tones ?? [
      { label: 'default', optCode: null },
    ];
    res.json({ productName: detail.name ?? detail.title, options, productUrl: detail.url ?? null });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch product options', detail: err.message });
  }
});

// POST /api/tracked-products  { storeProductId, productName, optionLabel, optionId, productUrl, scrapeFrequencyMinutes }
router.post('/tracked-products', async (req, res) => {
  const { storeProductId, productName, optionLabel, optionId, productUrl, scrapeFrequencyMinutes } = req.body;
  if (!storeProductId || !productName || !optionLabel) {
    return res.status(400).json({ error: 'storeProductId, productName and optionLabel are required' });
  }
  try {
    const { rows } = await query(
      `insert into tracked_products (store_product_id, product_name, option_label, option_id, product_url, scrape_frequency_minutes)
       values ($1,$2,$3,$4,$5,coalesce($6,120))
       on conflict (store_product_id, option_label) do update set is_active = true
       returning *`,
      [storeProductId, productName, optionLabel, optionId ?? null, productUrl ?? null, scrapeFrequencyMinutes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to track product', detail: err.message });
  }
});

// GET /api/tracked-products — dashboard list, each with its latest price/stock
router.get('/tracked-products', async (_req, res) => {
  const { rows } = await query(`
    select tp.*,
      ph.price as latest_price, ph.stock as latest_stock, ph.outcome as latest_outcome, ph.scraped_at as latest_scraped_at
    from tracked_products tp
    left join lateral (
      select price, stock, outcome, scraped_at from price_history
      where tracked_product_id = tp.id order by scraped_at desc limit 1
    ) ph on true
    where tp.is_active = true
    order by tp.created_at desc
  `);
  res.json(rows);
});

router.delete('/tracked-products/:id', async (req, res) => {
  await query('update tracked_products set is_active = false where id = $1', [req.params.id]);
  res.status(204).end();
});

// PATCH /api/tracked-products/:id  { scrapeFrequencyMinutes }
router.patch('/tracked-products/:id', async (req, res) => {
  const { scrapeFrequencyMinutes } = req.body;
  const { rows } = await query(
    'update tracked_products set scrape_frequency_minutes = coalesce($1, scrape_frequency_minutes) where id = $2 returning *',
    [scrapeFrequencyMinutes ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// GET /api/tracked-products/:id/history — for the chart/table
router.get('/tracked-products/:id/history', async (req, res) => {
  const { rows } = await query(
    'select * from price_history where tracked_product_id = $1 order by scraped_at asc',
    [req.params.id]
  );
  res.json(rows);
});

// GET /api/tracked-products/:id/log — per-product scrape attempt log
router.get('/tracked-products/:id/log', async (req, res) => {
  const { rows } = await query(
    'select * from scrape_log where tracked_product_id = $1 order by started_at desc limit 200',
    [req.params.id]
  );
  res.json(rows);
});

export default router;
