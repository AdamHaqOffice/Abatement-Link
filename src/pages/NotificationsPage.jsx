import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import { uid, cleanEmail } from '../utils/storage.js';

const events = ['high', 'low', 'ok'];
const channels = [
  { id: 'push', label: 'Push', helper: 'Recommended first. Works in supported browsers/PWAs.' },
  { id: 'email', label: 'Email', helper: 'Functional settings now; backend email sending is next.' },
  { id: 'sms', label: 'SMS', helper: 'Future Plivo integration. Kept off by default to control cost.' },
];

export default function NotificationsPage({ db, user, update, actions }) {
  const { deviceId } = useParams();
  const device = db.devices.find((d) => d.id === deviceId);
  const [newEmail, setNewEmail] = useState('');
  const existing = db.notificationRules.find((r) => r.deviceId === deviceId && r.userId === user.id);
  const [saved, setSaved] = useState(false);

  const rule = useMemo(() => existing || {
    deviceId,
    userId: user.id,
    channels: {
      push: { high: true, low: true, ok: true, recipients: [user.email] },
      email: { high: false, low: false, ok: false, recipients: [user.email] },
      sms: { high: false, low: false, ok: false, recipients: [] },
    },
  }, [existing, deviceId, user.id, user.email]);

  const [draft, setDraft] = useState(rule);
  if (!device) return <AppShell user={user} actions={actions}><div className="empty-state">Device not found.</div></AppShell>;

  async function requestPush() {
    if (!('Notification' in window)) return alert('This browser does not support web notifications.');
    const permission = await Notification.requestPermission();
    alert(`Push notification permission: ${permission}`);
  }

  function toggle(channel, event) {
    setDraft((current) => ({
      ...current,
      channels: {
        ...current.channels,
        [channel]: {
          ...current.channels[channel],
          [event]: !current.channels[channel][event],
        },
      },
    }));
  }

  function addEmail() {
    const email = cleanEmail(newEmail);
    if (!email) return;
    setDraft((current) => ({
      ...current,
      channels: {
        ...current.channels,
        email: {
          ...current.channels.email,
          recipients: Array.from(new Set([...current.channels.email.recipients, email])),
        },
      },
    }));
    setNewEmail('');
  }

  function save() {
    update((next) => {
      const idx = next.notificationRules.findIndex((r) => r.deviceId === deviceId && r.userId === user.id);
      const entry = { ...draft, id: existing?.id || uid('rule') };
      if (idx >= 0) next.notificationRules[idx] = entry;
      else next.notificationRules.push(entry);
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <AppShell user={user} actions={actions} title="Notifications">
      <section className="hero-card compact-hero">
        <div><p className="eyebrow">{device.name}</p><h1>Notification preferences</h1><p>Push customers toward push first, email second, and SMS later because SMS costs money.</p></div>
        <Link className="secondary-button" to={`/devices/${device.id}`}>Back to device</Link>
      </section>

      <section className="notification-stack">
        {channels.map((channel) => (
          <div className={`panel channel-card ${channel.id}`} key={channel.id}>
            <div className="section-head"><div><h2>{channel.label}</h2><p>{channel.helper}</p></div>{channel.id === 'push' && <button className="secondary-button" onClick={requestPush}>Enable push</button>}</div>
            <div className="toggle-grid">
              {events.map((event) => <button key={event} onClick={() => toggle(channel.id, event)} className={`toggle-card ${draft.channels[channel.id][event] ? 'on' : ''}`}><strong>{event.toUpperCase()}</strong><span>{draft.channels[channel.id][event] ? 'On' : 'Off'}</span></button>)}
            </div>
            {channel.id === 'email' && (
              <div className="recipient-box">
                <label>Add email recipient<input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="recipient@example.com" /></label>
                <button className="secondary-button" onClick={addEmail}>Add email</button>
                <div className="recipient-list">{draft.channels.email.recipients.map((email) => <span key={email}>{email}</span>)}</div>
              </div>
            )}
            {channel.id === 'sms' && <div className="alert info">SMS is intentionally UI-only in v1. Plivo can be wired into this rule later.</div>}
          </div>
        ))}
      </section>

      <button className="primary-button sticky-save" onClick={save}>{saved ? 'Saved' : 'Save notification settings'}</button>
    </AppShell>
  );
}
