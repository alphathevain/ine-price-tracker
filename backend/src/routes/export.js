import { Router } from 'express';
import { stringify } from 'csv-stringify';
import { query } from '../db.js';

const router = Router();

// GET /api/export.csv — one row per scrape attempt (run), including failures.
router.get('/export.csv', async (_req, res) => {
  const { rows } = await query(`
    select
      tp.store_product_id as product_id,
      tp.product_name,
      tp.option_label as selected_option,
      ph.scraped_at,
      ph.price,
      ph.stock,
      ph.outcome
    from price_history ph
    join tracked_products tp on tp.id = ph.tracked_product_id
    order by ph.scraped_at asc
  `);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="price_history_export.csv"');

  const stringifier = stringify({
    header: true,
    columns: ['product_id', 'product_name', 'selected_option', 'timestamp_utc', 'price', 'stock', 'outcome'],
  });
  stringifier.pipe(res);

  for (const r of rows) {
    stringifier.write({
      product_id: r.product_id,
      product_name: r.product_name,
      selected_option: r.selected_option,
      timestamp_utc: new Date(r.scraped_at).toISOString(),
      price: r.price ?? '',       // empty on failure, per spec
      stock: r.stock ?? '',       // empty on failure, per spec
      outcome: r.outcome,
    });
  }
  stringifier.end();
});

export default router;
