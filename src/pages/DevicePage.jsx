import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { metricIcon, metricLabel, statusForDevice } from '../utils/parseDevicePayload.js';
import { nowIso } from '../utils/storage.js';

export default function DevicePage({ db, user, update, actions }) {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const device = db.devices.find((d) => d.id === deviceId);
  if (!device) return <AppShell user={user} actions={actions}><div className="empty-state">Device not found.</div></AppShell>;

  const readings = db.readings.filter((r) => r.deviceId === device.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const alarms = db.alarms.filter((a) => a.deviceId === device.id).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const activeAlarm = alarms.find((a) => !a.resolvedAt);
  const status = activeAlarm ? activeAlarm.state : statusForDevice(device, db.readings);
  const latestByMetric = ['pressure', 'temperature', 'humidity', 'particles', 'ach', 'velocity'].map((metric) => readings.find((r) => r.metric === metric)).filter(Boolean);

  function validateDevice() {
    update((next) => {
      const found = next.devices.find((d) => d.id === device.id);
      found.verifiedAt = nowIso();
    });
  }

  function deleteDevice() {
    const confirmed = window.confirm('Delete this device and all of its data, alarms, notifications, and company links?');
    if (!confirmed) return;
    update((next) => {
      next.devices = next.devices.filter((d) => d.id !== device.id);
      next.readings = next.readings.filter((r) => r.deviceId !== device.id);
      next.alarms = next.alarms.filter((a) => a.deviceId !== device.id);
      next.notificationRules = next.notificationRules.filter((r) => r.deviceId !== device.id);
      next.notificationLog = next.notificationLog.filter((n) => n.deviceId !== device.id);
      next.companyDevices = next.companyDevices.filter((cd) => cd.deviceId !== device.id);
    });
    navigate('/devices');
  }

  return (
    <AppShell user={user} actions={actions} title={device.name}>
      <section className="device-hero">
        <div>
          <p className="eyebrow">{device.model} · Serial {device.serial}</p>
          <h1>{device.name}</h1>
          <div className="inline-actions"><StatusPill status={status} /><span>Validation code: {device.validationCode}</span></div>
        </div>
        <Link className="secondary-button" to={`/devices/${device.id}/notifications`}>Notifications</Link>
      </section>

      {!device.verifiedAt && (
        <section className="panel warning-panel">
          <h2>Device is Not Verified</h2>
          <p>Tell the customer to validate this serial number on the physical device. For this first version, use the demo button below to simulate the device sending the validation confirmation.</p>
          <button className="primary-button" onClick={validateDevice}>Simulate device validation</button>
        </section>
      )}

      <section className="metric-grid large">
        {['pressure', 'temperature', 'humidity', 'particles', 'ach', 'velocity'].map((metric) => {
          const r = readings.find((item) => item.metric === metric);
          return <div className="metric-tile" key={metric}><span>{metricIcon(metric)}</span><strong>{r?.value ?? '—'}</strong><small>{metricLabel(metric)}</small>{r && <em>{new Date(r.timestamp).toLocaleString()}</em>}</div>;
        })}
      </section>

      <section className="two-col">
        <div className="panel">
          <div className="section-head"><h2>Datalog</h2><span>{readings.length}</span></div>
          <div className="table-scroll">
            <table><thead><tr><th>Time</th><th>Metric</th><th>Value</th><th>Limits</th><th>Event</th></tr></thead><tbody>
              {readings.slice(0, 80).map((r) => <tr key={r.id}><td>{new Date(r.timestamp).toLocaleString()}</td><td>{metricLabel(r.metric)} R{r.room}S{r.sensor}</td><td>{r.value}</td><td>{r.lowerLimit} / {r.upperLimit}</td><td><StatusPill status={r.alarmState} /> {r.eventText}</td></tr>)}
            </tbody></table>
          </div>
        </div>
        <div className="panel">
          <div className="section-head"><h2>Alarm history</h2><span>{alarms.length}</span></div>
          <div className="alarm-list">
            {alarms.length ? alarms.map((a) => <div className="alarm-item" key={a.id}><StatusPill status={a.state} /><strong>{metricLabel(a.metric)} {a.value}</strong><small>{new Date(a.startedAt).toLocaleString()} {a.resolvedAt ? `→ resolved ${new Date(a.resolvedAt).toLocaleString()}` : 'active'}</small></div>) : <p className="muted">No alarms yet.</p>}
          </div>
        </div>
      </section>

      <section className="panel danger-panel soft">
        <h2>Delete device</h2>
        <p>Deleting removes device registration, datalog, alarm history, notification settings, and company links.</p>
        <button className="danger-button" onClick={deleteDevice}>Delete device and data</button>
      </section>
    </AppShell>
  );
}
