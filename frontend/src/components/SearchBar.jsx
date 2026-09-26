import { useState } from 'react';
import { searchStore, getProductOptions, trackProduct } from '../api.js';

export default function SearchBar({ onTracked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [optionPicker, setOptionPicker] = useState(null); // { product, options }

  async function handleSearch(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchStore(q.trim());
      setResults(data.results || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function openOptionPicker(product) {
    setError(null);
    try {
      const data = await getProductOptions(product.storeProductId);
      setOptionPicker({ product: { ...product, url: product.url || data.productUrl, title: data.productName || product.title }, options: data.options });
    } catch (err) {
      setError('Could not load options for this product: ' + (err.response?.data?.detail || err.message));
    }
  }

  async function handleTrack(option) {
    const { product } = optionPicker;
    await trackProduct({
      storeProductId: product.storeProductId,
      productName: product.title,
      optionLabel: option.label,
      optionId: option.optCode, // the store's `opt` code, e.g. "o2" — required for scraping
      productUrl: product.url,
    });
    setOptionPicker(null);
    onTracked?.();
  }

  return (
    <section className="panel">
      <h2>Find a product to track</h2>
      <form onSubmit={handleSearch} className="search-row">
        <input
          type="text"
          placeholder="Search by product name (partial or full)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="results-list">
        {results.map((p, i) => (
          <li key={p.storeProductId || i} className="result-item">
            <span>{p.title}</span>
            <button onClick={() => openOptionPicker(p)}>Choose option…</button>
          </li>
        ))}
      </ul>

      {optionPicker && (
        <div className="option-picker">
          <h4>{optionPicker.product.title} — pick the option to track</h4>
          <div className="option-buttons">
            {optionPicker.options.map((opt, i) => (
              <button key={opt.optCode || i} onClick={() => handleTrack(opt)}>
                {opt.label}
              </button>
            ))}
          </div>
          <button className="danger" onClick={() => setOptionPicker(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
