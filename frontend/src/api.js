import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const api = axios.create({ baseURL: BASE_URL });

export const searchStore = (q) => api.get('/api/search', { params: { q } }).then((r) => r.data);

export const getProductOptions = (storeProductId) =>
  api.get(`/api/products/${storeProductId}/options`).then((r) => r.data);

export const trackProduct = (payload) => api.post('/api/tracked-products', payload).then((r) => r.data);

export const listTracked = () => api.get('/api/tracked-products').then((r) => r.data);

export const untrackProduct = (id) => api.delete(`/api/tracked-products/${id}`);

export const updateFrequency = (id, scrapeFrequencyMinutes) =>
  api.patch(`/api/tracked-products/${id}`, { scrapeFrequencyMinutes }).then((r) => r.data);

export const getHistory = (id) => api.get(`/api/tracked-products/${id}/history`).then((r) => r.data);

export const getLog = (id) => api.get(`/api/tracked-products/${id}/log`).then((r) => r.data);

export const scrapeNow = (id) => api.post(`/internal/scrape-one/${id}`).then((r) => r.data);

export const exportCsvUrl = () => `${BASE_URL}/api/export.csv`;
