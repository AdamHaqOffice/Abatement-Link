export default function StatusPill({ status }) {
  const label = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    not_verified: 'Not Verified',
    alarm: 'Alarm',
    ok: 'OK',
    high: 'High Alarm',
    low: 'Low Alarm',
  }[status] || status;
  return <span className={`status-pill ${status}`}>{label}</span>;
}
