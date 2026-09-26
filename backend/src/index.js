import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import productsRouter from './routes/products.js';
import scrapeRouter from './routes/scrape.js';
import exportRouter from './routes/export.js';

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.get('/', (_req, res) => res.json({ ok: true, service: 'ine-price-tracker-backend' }));

app.use('/api', productsRouter);
app.use('/api', exportRouter);
app.use('/internal', scrapeRouter);

app.use((err, _req, res, _next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend listening on :${port}`));
