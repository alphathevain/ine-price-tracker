import { useEffect, useState } from 'react';
import { getHistory, getLog, scrapeNow, untrackProduct, updateFrequency } from '../api.js';
import PriceChart from './PriceChart.jsx';
import ScrapeLog from './ScrapeLog.jsx';

export default function TrackedProductCard({ product, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState([]);
  const [log, setLog] = useState([]);
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    if (expanded) refresh();
  }, [expanded]);

  async function refresh() {
    const [h, l] = await Promise.all([getHistory(product.id), getLog(product.id)]);
    setHistory(h);
    setLog(l);
  }

  async function handleScrapeNow() {
    setScraping(true);
    try {
      await scrapeNow(product.id);
      await refresh();
      onChanged?.();
    } finally {
      setScraping(false);
    }
  }

  async function handleUntrack() {
    await untrackProduct(product.id);
    onChanged?.();
  }

  async function handleFrequencyChange(e) {
    await updateFrequency(product.id, Number(e.target.value));
    onChanged?.();
  }

  const latestOutcome = product.latest_outcome;

  return (
    <div className="card">
      <div className="card-header" onClick={() => setExpanded((v) => !v)}>
        <div>
          <strong>{product.product_name}</strong>
          <span className="option-label"> · {product.option_label}</span>
        </div>
        <div className="card-header-right">
          {product.latest_price != null ? (
            <span className="price">${Number(product.latest_price).toFixed(2)}</span>
          ) : (
            <span className="muted">no data</span>
          )}
          {latestOutcome && <span className={`badge badge-${latestOutcome}`}>{latestOutcome}</span>}
          <span className="stock">{product.latest_stock ?? '—'}</span>
        </div>
      </div>

      {expanded && (
        <div className="card-body">
          <div className="card-controls">
            <label>
              Scrape every
              <select defaultValue={product.scrape_frequency_minutes} onChange={handleFrequencyChange}>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={240}>4 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </label>
            <button onClick={handleScrapeNow} disabled={scraping}>
              {scraping ? 'Scraping…' : 'Scrape now'}
            </button>
            <button className="danger" onClick={handleUntrack}>Untrack</button>
          </div>

          <h4>Price history</h4>
          <PriceChart history={history} />

          <h4>Scrape log</h4>
          <ScrapeLog log={log} />
        </div>
      )}
    </div>
  );
}
