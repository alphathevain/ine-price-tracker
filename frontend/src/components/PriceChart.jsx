import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function PriceChart({ history }) {
  const points = history
    .filter((h) => h.outcome !== 'failed')
    .map((h) => ({
      time: new Date(h.scraped_at).toLocaleString(),
      price: h.price != null ? Number(h.price) : null,
    }));

  if (!points.length) return <p className="muted">No successful scrapes yet — chart will populate after the first run.</p>;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={30} />
        <YAxis domain={['auto', 'auto']} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="price" stroke="#2563eb" dot={false} name="Price" />
      </LineChart>
    </ResponsiveContainer>
  );
}
