import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; pooled connections don't ship a full chain
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // A dropped idle connection should never crash the process
  console.error('Unexpected Postgres pool error', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
