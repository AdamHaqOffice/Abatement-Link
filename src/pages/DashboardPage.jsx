import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import DeviceCard from '../components/DeviceCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { statusForDevice } from '../utils/parseDevicePayload.js';

export default function DashboardPage({ db, user, actions }) {
  const myDevices = db.devices.filter((d) => d.ownerId === user.id || db.companyDevices.some((cd) => cd.deviceId === d.id && db.companyMembers.some((m) => m.companyId === cd.companyId && m.userId === user.id && m.acceptedAt)));
  const connected = myDevices.filter((d) => statusForDevice(d, db.readings) === 'connected').length;
  const activeAlarms = db.alarms.filter((a) => myDevices.some((d) => d.id === a.deviceId) && !a.resolvedAt);
  const pendingInvites = db.invites.filter((i) => i.email === user.email && !i.acceptedAt);

  return (
    <AppShell user={user} actions={actions} title="Dashboard">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Abatement Link</p>
          <h1>Live device status, alarms, and datalogs.</h1>
          <p>Mobile-first dashboard for PPM4, RPM, and sensor data coming from device JSON messages.</p>
        </div>
        <Link className="primary-button" to="/devices">Add device</Link>
      </section>

      {pendingInvites.length > 0 && (
        <Link to="/companies" className="alert info clickable">You have {pendingInvites.length} company invite{pendingInvites.length > 1 ? 's' : ''} waiting.</Link>
      )}

      <section className="summary-grid">
        <div className="summary-card"><span>Devices</span><strong>{myDevices.length}</strong></div>
        <div className="summary-card"><span>Connected</span><strong>{connected}</strong></div>
        <div className="summary-card"><span>Active alarms</span><strong>{activeAlarms.length}</strong></div>
        <div className="summary-card"><span>Data records</span><strong>{db.readings.filter((r) => myDevices.some((d) => d.id === r.deviceId)).length}</strong></div>
      </section>

      {activeAlarms.length > 0 && (
        <section className="panel danger-panel">
          <div className="section-head"><h2>Active alarms</h2><StatusPill status="alarm" /></div>
          {activeAlarms.slice(0, 4).map((alarm) => {
            const device = db.devices.find((d) => d.id === alarm.deviceId);
            return <Link className="alarm-row" key={alarm.id} to={`/devices/${alarm.deviceId}`}><strong>{device?.name}</strong><span>{alarm.metric} {alarm.value} · {alarm.state}</span></Link>;
          })}
        </section>
      )}

      <section className="section-head"><h2>Your devices</h2><Link to="/devices">Manage</Link></section>
      <section className="device-grid">
        {myDevices.length ? myDevices.map((device) => <DeviceCard key={device.id} device={device} readings={db.readings} alarms={db.alarms} />) : (
          <div className="empty-state"><h3>No devices yet</h3><p>Add a serial number to start validating a monitor.</p><Link className="primary-button" to="/devices">Add your first device</Link></div>
        )}
      </section>
    </AppShell>
  );
}
