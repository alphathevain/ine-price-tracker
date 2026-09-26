import { useEffect, useState } from 'react';
import SearchBar from './components/SearchBar.jsx';
import TrackedProductCard from './components/TrackedProductCard.jsx';
import { listTracked, exportCsvUrl } from './api.js';

export default function App() {
  const [tracked, setTracked] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listTracked();
      setTracked(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>INE Price Tracker</h1>
        <a href={exportCsvUrl()} className="export-btn">Export CSV</a>
      </header>

      <SearchBar onTracked={refresh} />

      <section className="panel">
        <h2>Tracked products ({tracked.length})</h2>
        {loading && <p className="muted">Loading…</p>}
        {!loading && !tracked.length && <p className="muted">Nothing tracked yet — search above to add a product.</p>}
        <div className="card-list">
          {tracked.map((p) => (
            <TrackedProductCard key={p.id} product={p} onChanged={refresh} />
          ))}
        </div>
      </section>
    </div>
  );
}
