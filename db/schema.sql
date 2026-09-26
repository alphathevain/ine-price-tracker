-- INE Price Tracker — Supabase / Postgres schema
-- Run this in the Supabase SQL editor (or via psql) before starting the backend.

create extension if not exists "pgcrypto";

create table if not exists tracked_products (
  id uuid primary key default gen_random_uuid(),
  store_product_id text not null,        -- product ID as shown in the store's product page URL
  product_name text not null,
  option_label text not null,            -- e.g. "128GB", "Pack of 3"
  option_id text,                        -- the store's short `opt` code for this option (e.g. "o2"), required for the quote API call
  product_url text,                      -- full URL of the product page, for reference
  scrape_frequency_minutes int not null default 120,  -- configurable per product (bonus feature)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_product_id, option_label)
);

-- One row per scrape ATTEMPT (includes intra-run retries). This is the audit trail.
create table if not exists scrape_log (
  id uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id) on delete cascade,
  attempt_number int not null,           -- 1, 2, 3... within one scrape run
  run_id uuid not null,                  -- groups the attempts belonging to one scrape run
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms int,
  outcome text not null check (outcome in ('success', 'retried', 'failed', 'attempt_failed')),
  http_status int,
  error_message text,
  strategy text                          -- 'http' or 'playwright', for debugging which path ran
);

-- One row per completed scrape RUN (the final outcome after retries are exhausted or a success lands).
-- This is what price history charts and the CSV export read from.
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id) on delete cascade,
  run_id uuid not null,
  scraped_at timestamptz not null,       -- ISO 8601 UTC
  price numeric,                          -- NULL if the run ultimately failed
  stock text,                             -- NULL if the run ultimately failed
  outcome text not null check (outcome in ('success', 'retried', 'failed')),
  attempt_count int not null default 1,
  error_message text
);

-- Optional: alert records for the price-drop / back-in-stock bonus feature
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id) on delete cascade,
  alert_type text not null check (alert_type in ('price_drop', 'back_in_stock')),
  triggered_at timestamptz not null default now(),
  old_value text,
  new_value text,
  notified boolean not null default false
);

create index if not exists idx_price_history_product on price_history (tracked_product_id, scraped_at desc);
create index if not exists idx_scrape_log_product on scrape_log (tracked_product_id, started_at desc);
