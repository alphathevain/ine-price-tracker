export default function ScrapeLog({ log }) {
  if (!log.length) return <p className="muted">No scrape attempts logged yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Attempt</th>
            <th>Strategy</th>
            <th>Outcome</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {log.map((entry) => (
            <tr key={entry.id} className={`outcome-${entry.outcome}`}>
              <td>{new Date(entry.started_at).toLocaleString()}</td>
              <td>{entry.attempt_number}</td>
              <td>{entry.strategy || '—'}</td>
              <td><span className={`badge badge-${entry.outcome}`}>{entry.outcome}</span></td>
              <td>{entry.duration_ms != null ? `${entry.duration_ms}ms` : '—'}</td>
              <td className="error-cell">{entry.error_message || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
