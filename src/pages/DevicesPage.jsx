import { useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import DeviceCard from '../components/DeviceCard.jsx';
import { uid, nowIso } from '../utils/storage.js';

export default function DevicesPage({ db, user, update, actions }) {
  const [form, setForm] = useState({ serial: '', name: '', model: 'PPM4' });
  const [message, setMessage] = useState('');
  const myDevices = db.devices.filter((d) => d.ownerId === user.id || db.companyDevices.some((cd) => cd.deviceId === d.id && db.companyMembers.some((m) => m.companyId === cd.companyId && m.userId === user.id && m.acceptedAt)));

  function addDevice(e) {
    e.preventDefault();
    const serial = form.serial.trim();
    if (!serial) return setMessage('Serial number is required.');
    if (db.devices.some((d) => d.serial === serial && d.ownerId === user.id)) return setMessage('You already added this serial number.');
    update((next) => {
      next.devices.push({
        id: uid('dev'),
        ownerId: user.id,
        serial,
        name: form.name.trim() || `${form.model} ${serial}`,
        model: form.model,
        verifiedAt: null,
        validationCode: Math.floor(100000 + Math.random() * 900000).toString(),
        createdAt: nowIso(),
      });
    });
    setForm({ serial: '', name: '', model: 'PPM4' });
    setMessage('Device added as Not Verified. Open it to view validation steps.');
  }

  return (
    <AppShell user={user} actions={actions} title="Devices">
      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Claim monitor</p><h1>Add a device</h1></div></div>
        <form className="form-grid" onSubmit={addDevice}>
          <label>Serial number<input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} placeholder="14374082" /></label>
          <label>Device name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Room 204 PPM4" /></label>
          <label>Model<select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}><option>PPM4</option><option>RPM</option><option>Other</option></select></label>
          <button className="primary-button">Add as Not Verified</button>
        </form>
        {message && <div className="alert info">{message}</div>}
      </section>

      <section className="section-head"><h2>Devices</h2><span>{myDevices.length} total</span></section>
      <section className="device-grid">
        {myDevices.length ? myDevices.map((device) => <DeviceCard key={device.id} device={device} readings={db.readings} alarms={db.alarms} />) : <div className="empty-state"><h3>No devices yet</h3><p>Add a serial number above.</p></div>}
      </section>
    </AppShell>
  );
}
