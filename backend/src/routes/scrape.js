import { Router } from 'express';
import { requireCronSecret } from '../middleware/auth.js';
import { scrapeAllActiveProducts, scrapeOneProduct } from '../scraper/scrape.js';
import { query } from '../db.js';

const router = Router();

// Simple in-memory lock so an overlapping cron trigger (e.g. after a slow cold
// start) can't run two full scrape passes concurrently against the store.
let scrapeRunning = false;

// POST /internal/scrape-all — hit by cron-job.org every 2 hours
router.post('/scrape-all', requireCronSecret, async (_req, res) => {
  if (scrapeRunning) {
    return res.status(409).json({ error: 'A scrape run is already in progress' });
  }
  scrapeRunning = true;
  try {
    const results = await scrapeAllActiveProducts({ concurrency: 2 });
    res.json({ triggeredAt: new Date().toISOString(), count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Scrape run failed', detail: err.message });
  } finally {
    scrapeRunning = false;
  }
});

// POST /internal/scrape-one/:id — manual re-scrape of a single product from the dashboard
router.post('/scrape-one/:id', async (req, res) => {
  const { rows } = await query('select * from tracked_products where id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
  const result = await scrapeOneProduct(rows[0]);
  res.json(result);
});

// GET /internal/health — cheap endpoint to pre-warm the Render instance
router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

export default router;
