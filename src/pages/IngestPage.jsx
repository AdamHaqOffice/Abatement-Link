import { useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { parsePayload, metricLabel } from '../utils/parseDevicePayload.js';
import { uid, nowIso } from '../utils/storage.js';

const samplePayload = {
  unique_id: '14374082',
  JobNo: '41399',
  TS: '03/24/26,03:10:00',
  Count: '1',
  RoomNo1: '1',
  Event1: 'PRESSURE R1S1 INTERVAL -13.860 SET MENU PASSWORD',
  UpLim1: '-6.494 SET MENU PASSWORD',
  LowLim1: '-23.988 SET MENU PASSWORD',
};

export default function IngestPage({ db, user, update, actions }) {
  const [jsonText, setJsonText] = useState(JSON.stringify(samplePayload, null, 2));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  function sendBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icon-192.png' });
    }
  }

  function ingest(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = JSON.parse(jsonText);
      const parsed = parsePayload(payload);
      if (!parsed.serial) throw new Error('Payload needs unique_id / serial number.');
      let ingestSummary = null;

      update((next) => {
        let device = next.devices.find((d) => d.serial === parsed.serial);
        if (!device) {
          device = {
            id: uid('dev'),
            ownerId: user.id,
            serial: parsed.serial,
            name: `Unclaimed ${parsed.serial}`,
            model: 'Unknown',
            verifiedAt: null,
            validationCode: Math.floor(100000 + Math.random() * 900000).toString(),
            createdAt: nowIso(),
          };
          next.devices.push(device);
        }
        if (!device.verifiedAt && device.ownerId === user.id) device.verifiedAt = nowIso();

        const createdReadings = parsed.readings.map((r) => ({ ...r, id: uid('rdg'), deviceId: device.id, receivedAt: nowIso() }));
        next.readings.push(...createdReadings);

        createdReadings.forEach((reading) => {
          const active = next.alarms.find((a) => a.deviceId === device.id && a.metric === reading.metric && a.room === reading.room && a.sensor === reading.sensor && !a.resolvedAt);
          if (reading.alarmState === 'high' || reading.alarmState === 'low') {
            if (!active || active.state !== reading.alarmState) {
              if (active) active.resolvedAt = reading.timestamp;
              const alarm = {
                id: uid('alm'),
                deviceId: device.id,
                readingId: reading.id,
                state: reading.alarmState,
                metric: reading.metric,
                room: reading.room,
                sensor: reading.sensor,
                value: reading.value,
                limit: reading.alarmState === 'high' ? reading.upperLimit : reading.lowerLimit,
                startedAt: reading.timestamp,
                resolvedAt: null,
                createdAt: nowIso(),
              };
              next.alarms.push(alarm);
              const rules = next.notificationRules.filter((rule) => rule.deviceId === device.id);
              rules.forEach((rule) => {
                ['push', 'email', 'sms'].forEach((channel) => {
                  if (rule.channels?.[channel]?.[reading.alarmState]) {
                    const note = {
                      id: uid('note'),
                      deviceId: device.id,
                      alarmId: alarm.id,
                      channel,
                      state: reading.alarmState,
                      recipients: rule.channels[channel].recipients || [],
                      status: channel === 'sms' ? 'future' : channel === 'email' ? 'queued' : 'sent/local',
                      createdAt: nowIso(),
                    };
                    next.notificationLog.push(note);
                  }
                });
              });
              sendBrowserNotification(`${device.name}: ${reading.alarmState.toUpperCase()} alarm`, `${metricLabel(reading.metric)} ${reading.value}`);
            }
          } else if (reading.alarmState === 'ok' && active) {
            active.resolvedAt = reading.timestamp;
            const rules = next.notificationRules.filter((rule) => rule.deviceId === device.id);
            rules.forEach((rule) => {
              ['push', 'email', 'sms'].forEach((channel) => {
                if (rule.channels?.[channel]?.ok) {
                  next.notificationLog.push({
                    id: uid('note'),
                    deviceId: device.id,
                    alarmId: active.id,
                    channel,
                    state: 'ok',
                    recipients: rule.channels[channel].recipients || [],
                    status: channel === 'sms' ? 'future' : channel === 'email' ? 'queued' : 'sent/local',
                    createdAt: nowIso(),
                  });
                }
              });
            });
            sendBrowserNotification(`${device.name}: alarm returned to OK`, `${metricLabel(reading.metric)} ${reading.value}`);
          }
        });

        ingestSummary = { device, readings: createdReadings };
      });

      setResult(ingestSummary || { readings: [] });
    } catch (err) {
      setError(err.message);
    }
  }

  function loadSample(type) {
    const base = { ...samplePayload, TS: new Date().toLocaleString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit', hour12: false }).replace(',', '') };
    if (type === 'high') {
      base.Event1 = 'PRESSURE R1S1 HIGH -4.200 ALARM';
      base.UpLim1 = '-6.494';
      base.LowLim1 = '-23.988';
    } else if (type === 'low') {
      base.Event1 = 'PRESSURE R1S1 LOW -28.200 ALARM';
      base.UpLim1 = '-6.494';
      base.LowLim1 = '-23.988';
    } else if (type === 'ok') {
      base.Event1 = 'PRESSURE R1S1 OK -13.860 NORMAL';
      base.UpLim1 = '-6.494';
      base.LowLim1 = '-23.988';
    }
    setJsonText(JSON.stringify(base, null, 2));
  }

  return (
    <AppShell user={user} actions={actions} title="Data Ingest">
      <section className="hero-card compact-hero">
        <div><p className="eyebrow">Prototype endpoint tester</p><h1>Paste device JSON and simulate live data.</h1><p>This represents the future /api/ingest endpoint. In v1 it writes to local browser storage so we can test the full app flow.</p></div>
      </section>

      <section className="panel">
        <div className="quick-buttons"><button className="secondary-button" onClick={() => loadSample('ok')}>OK sample</button><button className="secondary-button" onClick={() => loadSample('high')}>High alarm sample</button><button className="secondary-button" onClick={() => loadSample('low')}>Low alarm sample</button></div>
        <form onSubmit={ingest} className="form-stack"><label>Device JSON<textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows="14" /></label><button className="primary-button">Ingest JSON</button></form>
        {error && <div className="alert danger">{error}</div>}
      </section>

      {result && <section className="panel"><h2>Ingested</h2>{result.readings?.map((r) => <div className="reading-row" key={r.id}><StatusPill status={r.alarmState} /><strong>{metricLabel(r.metric)} {r.value}</strong><span>Serial {result.device.serial} · R{r.room}S{r.sensor}</span></div>)}</section>}

      <section className="panel">
        <div className="section-head"><h2>Notification log</h2><span>{db.notificationLog.length}</span></div>
        <div className="table-scroll"><table><thead><tr><th>Time</th><th>Channel</th><th>State</th><th>Status</th><th>Recipients</th></tr></thead><tbody>{db.notificationLog.slice().reverse().slice(0, 50).map((n) => <tr key={n.id}><td>{new Date(n.createdAt).toLocaleString()}</td><td>{n.channel}</td><td>{n.state}</td><td>{n.status}</td><td>{n.recipients?.join(', ') || '—'}</td></tr>)}</tbody></table></div>
      </section>
    </AppShell>
  );
}
