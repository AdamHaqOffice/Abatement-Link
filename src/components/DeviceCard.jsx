import { Link } from 'react-router-dom';
import StatusPill from './StatusPill.jsx';
import { metricIcon, metricLabel, statusForDevice } from '../utils/parseDevicePayload.js';

export default function DeviceCard({ device, readings, alarms }) {
  const status = statusForDevice(device, readings);
  const deviceReadings = readings.filter((r) => r.deviceId === device.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const latest = deviceReadings[0];
  const activeAlarm = alarms.find((a) => a.deviceId === device.id && !a.resolvedAt);
  const latestByMetric = Object.values(deviceReadings.reduce((acc, r) => {
    if (!acc[r.metric]) acc[r.metric] = r;
    return acc;
  }, {})).slice(0, 4);

  return (
    <Link className="device-card" to={`/devices/${device.id}`}>
      <div className="device-card-head">
        <div>
          <strong>{device.name}</strong>
          <small>Serial {device.serial}</small>
        </div>
        <StatusPill status={activeAlarm ? activeAlarm.state : status} />
      </div>
      <div className="device-meta">
        <span>Job {latest?.jobNo || '—'}</span>
        <span>Last data {latest ? new Date(latest.timestamp).toLocaleString() : 'never'}</span>
      </div>
      <div className="metric-strip">
        {latestByMetric.length ? latestByMetric.map((r) => (
          <div className="metric-mini" key={`${r.metric}-${r.timestamp}`}>
            <span>{metricIcon(r.metric)}</span>
            <strong>{r.value ?? '—'}</strong>
            <small>{metricLabel(r.metric)}</small>
          </div>
        )) : ['pressure', 'temperature', 'humidity', 'particles'].map((m) => (
          <div className="metric-mini empty" key={m}>
            <span>{metricIcon(m)}</span>
            <strong>—</strong>
            <small>{metricLabel(m)}</small>
          </div>
        ))}
      </div>
    </Link>
  );
}
