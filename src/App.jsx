import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient.js';
import { connectionStatus, metricIcon, metricLabel } from './utils/parseDevicePayload.js';

const metrics = ['pressure', 'pressure2', 'temperature', 'temperature2', 'humidity', 'humidity2', 'particles', 'particles2', 'ach', 'ach2', 'velocity', 'velocity2'];
const samplePayload = {
  unique_id: '14374082',
  JobNo: 'JOB-33300',
  TS: '03/16/24 1: 41: 00',
  Count: '2',
  RoomNo1: '1',
  Event1: 'PRESSURE R1 S1 INTERVAL - 0.0001inWC',
  UpLim1: '0.0050 inWC',
  LowLim1: '-0.0050 inWC',
  RoomNo2: '2',
  Event2: 'PRESSURE R2 S2 INTERVAL - 0.0001inWC',
  UpLim2: '0.0050 inWC',
  LowLim2: '-0.0050 inWC',
};

const SUPPORT_PORTAL_URL = import.meta.env.VITE_SUPPORT_PORTAL_URL || 'https://abatementpartnersupport.freshdesk.com/support/home';
const MONSUITE_URL = import.meta.env.VITE_MONSUITE_URL || 'https://monsuite.netlify.app';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';


function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function phonePushAvailable() {
  return Boolean('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
}

async function getPushRegistration() {
  const registration = await navigator.serviceWorker.register('/push-sw.js');
  await navigator.serviceWorker.ready;
  return registration;
}

async function getBrowserPushSubscription() {
  if (!phonePushAvailable()) return null;
  const registration = await getPushRegistration();
  return registration.pushManager.getSubscription();
}

async function enablePhonePushForUser(userId) {
  if (!phonePushAvailable()) throw new Error('This browser does not support web push notifications.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY in Netlify. Add the public push key and redeploy.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted on this device.');
  const registration = await getPushRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    enabled: true,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return subscription;
}

async function disablePhonePushForCurrentBrowser(userId) {
  const subscription = await getBrowserPushSubscription();
  if (subscription) {
    await supabase.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('endpoint', subscription.endpoint).eq('user_id', userId);
    await subscription.unsubscribe();
  } else {
    await supabase.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('user_id', userId);
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function deviceTimestamp(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  // Match the real PPM/RPM cloud timestamp style from firmware examples.
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${yy} ${date.getHours()}: ${pad2(date.getMinutes())}: ${pad2(date.getSeconds())}`;
}

function randomBetween(min, max, decimals = 3) {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(decimals));
}

function eventTypeFromText(eventText) {
  const upper = String(eventText || '').toUpperCase();
  if (upper.includes('OK ALARM') || upper.includes('RETURN TO OK')) return 'OK alarm';
  if (upper.includes('HIGH ALARM')) return 'High alarm';
  if (upper.includes('LOW ALARM')) return 'Low alarm';
  if (upper.includes('INTERVAL')) return 'Interval';
  if (upper.includes('HIGH')) return 'High alarm';
  if (upper.includes('LOW')) return 'Low alarm';
  if (upper.includes('OK') || upper.includes('NORMAL')) return 'Return to OK';
  return 'Event';
}

const groupedDatalogMetrics = ['pressure', 'temperature', 'humidity', 'particles', 'ach', 'velocity'];

function rowMetricKey(reading) {
  const metric = reading.metric || 'unknown';
  return Number(reading.sensor_no) === 2 ? `${metric}2` : metric;
}

function metricColumnLabel(metricKey) {
  const isSecondSensor = metricKey.endsWith('2');
  const baseMetric = isSecondSensor ? metricKey.slice(0, -1) : metricKey;
  return `${metricLabel(baseMetric)}${isSecondSensor ? '2' : ''}`;
}

function formatReadingCell(reading) {
  if (!reading) return '—';
  const value = reading.value ?? '—';
  const limitText = reading.lower_limit !== null && reading.upper_limit !== null
    ? ` (${reading.lower_limit} / ${reading.upper_limit})`
    : '';
  return `${value}${limitText}`;
}

function groupReadingsByRoom(readings) {
  const groups = new Map();
  for (const reading of readings) {
    const timeKey = reading.device_ts || reading.received_at || '';
    const receivedKey = reading.received_at || '';
    const room = Math.min(2, Math.max(1, Number(reading.room_no || 1)));
    const key = `${timeKey}|${receivedKey}|${room}|${reading.job_no || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        device_ts: reading.device_ts,
        received_at: reading.received_at,
        job_no: reading.job_no,
        room,
        values: {},
        eventTypes: new Set(),
        alarmStates: new Set(),
        rawEvents: [],
      });
    }
    const group = groups.get(key);
    group.values[rowMetricKey(reading)] = reading;
    group.eventTypes.add(eventTypeFromText(reading.event_text));
    group.alarmStates.add(reading.alarm_state || 'ok');
    if (reading.event_text) group.rawEvents.push(reading.event_text);
  }
  return [...groups.values()].sort((a, b) => new Date(b.device_ts || b.received_at) - new Date(a.device_ts || a.received_at));
}

function groupAlarmStatus(group) {
  if (group.alarmStates.has('high')) return 'high';
  if (group.alarmStates.has('low')) return 'low';
  return 'ok';
}


function isoForInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function fromDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function displayDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function projectStatusLabel(status) {
  return String(status || 'draft').replace('_', ' ').toUpperCase();
}

function latestRequirement(requirements, type) {
  return [...(requirements || [])]
    .filter((r) => r.requirement_type === type)
    .sort((a, b) => new Date(b.effective_at || b.created_at) - new Date(a.effective_at || a.created_at))[0] || null;
}

function projectActiveAssignments(data, projectId) {
  return (data.projectAssets || []).filter((a) => a.project_id === projectId && !a.removed_at);
}

function assignmentCoversReading(assignment, reading) {
  if (!assignment || !reading) return false;
  const t = new Date(reading.device_ts || reading.received_at).getTime();
  const start = assignment.assigned_at ? new Date(assignment.assigned_at).getTime() : -Infinity;
  const end = assignment.removed_at ? new Date(assignment.removed_at).getTime() : Infinity;
  return t >= start && t <= end;
}

function projectReadingsFromLoadedData(project, assignments, readings) {
  if (!project) return [];
  const projectStart = project.started_at ? new Date(project.started_at).getTime() : -Infinity;
  const projectEnd = project.actual_end_at ? new Date(project.actual_end_at).getTime() : Infinity;
  return (readings || []).filter((reading) => {
    const t = new Date(reading.device_ts || reading.received_at).getTime();
    if (t < projectStart || t > projectEnd) return false;
    return assignments.some((assignment) => assignment.device_id === reading.device_id && assignmentCoversReading(assignment, reading));
  });
}

function buildProjectStats(project, requirements, projectReadings, alarms) {
  const pressureReq = latestRequirement(requirements, 'pressure');
  const pressureReadings = projectReadings.filter((r) => r.metric === 'pressure' || r.metric === 'pressure2');
  const values = pressureReadings.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
  const lower = pressureReq?.lower_limit ?? null;
  const upper = pressureReq?.upper_limit ?? null;
  const excursions = pressureReadings.filter((r) => {
    const value = Number(r.value);
    if (!Number.isFinite(value)) return false;
    if (lower !== null && lower !== undefined && value < Number(lower)) return true;
    if (upper !== null && upper !== undefined && value > Number(upper)) return true;
    return false;
  });
  return {
    readingCount: projectReadings.length,
    pressureCount: pressureReadings.length,
    alarmCount: (alarms || []).length,
    activeAlarmCount: (alarms || []).filter((a) => !a.resolved_at).length,
    excursionCount: excursions.length,
    pressureAvg: values.length ? (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(4) : '—',
    pressureMin: values.length ? Math.min(...values).toFixed(4) : '—',
    pressureMax: values.length ? Math.max(...values).toFixed(4) : '—',
    dataAvailabilityLabel: projectReadings.length ? 'Data available' : 'No recent data in loaded history',
  };
}



function safeFilePart(value, fallback = 'export') {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(' · ') : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function localDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateRange(rangeMode, startDate, endDate) {
  if (rangeMode !== 'range') return { startIso: null, endIso: null };
  return {
    startIso: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : null,
    endIso: endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : null,
  };
}

async function fetchAllDeviceRows(table, deviceId, timeColumn, startIso, endIso) {
  const pageSize = 1000;
  let from = 0;
  let rows = [];
  for (;;) {
    let query = supabase
      .from(table)
      .select('*')
      .eq('device_id', deviceId)
      .order(timeColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (startIso) query = query.gte(timeColumn, startIso);
    if (endIso) query = query.lte(timeColumn, endIso);
    const { data, error } = await query;
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function isGroupedAlarmRow(row) {
  const eventText = [...(row.eventTypes || [])].join(' ').toUpperCase();
  return eventText.includes('ALARM') || groupAlarmStatus(row) !== 'ok';
}

function buildDeviceCsv(device, groupedRows, alarmRows) {
  const metricKeys = [...groupedDatalogMetrics.map((metric) => metric), ...groupedDatalogMetrics.map((metric) => `${metric}2`)];
  const columns = [
    'Type',
    'Time',
    'Serial',
    'Job',
    'Device Name',
    'Model',
    'Room',
    ...metricKeys.map(metricColumnLabel),
    'Event',
    'Alarm State',
    'Alarm Metric',
    'Alarm Value',
    'Alarm Limit',
    'Resolved At',
    'Raw Event Text',
  ];

  const rows = [];
  for (const row of groupedRows) {
    rows.push([
      'Datalog',
      row.device_ts || row.received_at || '',
      device.serial_number,
      row.job_no || '',
      device.nickname || '',
      device.model || '',
      row.room ? `Room ${row.room}` : '',
      ...metricKeys.map((metricKey) => formatReadingCell(row.values[metricKey])),
      [...(row.eventTypes || [])].join(' · '),
      groupAlarmStatus(row),
      '',
      '',
      '',
      '',
      (row.rawEvents || []).join(' · '),
    ]);
  }

  for (const alarm of alarmRows) {
    const metricValues = metricKeys.map(() => '');
    rows.push([
      'Alarm',
      alarm.started_at || alarm.created_at || '',
      device.serial_number,
      '',
      device.nickname || '',
      device.model || '',
      alarm.room_no ? `Room ${alarm.room_no}` : '',
      ...metricValues,
      eventTypeFromText(alarm.event_text),
      alarm.alarm_state || '',
      metricLabel(alarm.metric),
      alarm.value ?? '',
      alarm.limit_value ?? '',
      alarm.resolved_at || '',
      alarm.event_text || '',
    ]);
  }

  rows.sort((a, b) => new Date(a[1] || 0) - new Date(b[1] || 0) || String(a[0]).localeCompare(String(b[0])));
  return [columns, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function triggerCsvDownload(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function deviceClaimRequest(session, payload) {
  if (!session?.access_token) throw new Error('Sign in again before changing device ownership.');
  const res = await fetch('/.netlify/functions/claim-device', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Device claim request failed.');
  return body;
}

function CsvDownloadModal({ device, onClose }) {
  const [rangeMode, setRangeMode] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [interval, setInterval] = useState('1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function downloadCsv() {
    setBusy(true);
    setMessage('');
    try {
      const { startIso, endIso } = parseDateRange(rangeMode, startDate, endDate);
      if (rangeMode === 'range' && startIso && endIso && new Date(startIso) > new Date(endIso)) {
        throw new Error('Start date must be before end date.');
      }
      const every = Number(interval) || 1;
      const [readings, alarms] = await Promise.all([
        fetchAllDeviceRows('device_readings', device.id, 'device_ts', startIso, endIso),
        fetchAllDeviceRows('alarm_events', device.id, 'started_at', startIso, endIso),
      ]);

      const grouped = groupReadingsByRoom(readings).sort((a, b) => new Date(a.device_ts || a.received_at || 0) - new Date(b.device_ts || b.received_at || 0));
      const selectedRows = grouped.filter((row, index) => isGroupedAlarmRow(row) || every <= 1 || index % every === 0);
      const csvText = buildDeviceCsv(device, selectedRows, alarms);
      const jobName = device.last_job_no || readings.find((reading) => reading.job_no)?.job_no || 'job';
      const filename = `${safeFilePart(device.serial_number, 'serial')}-${safeFilePart(jobName, 'job')}-${localDateStamp()}.csv`;
      triggerCsvDownload(filename, csvText);
      setMessage(`CSV ready: ${selectedRows.length} datalog rows plus ${alarms.length} alarm records.`);
      window.setTimeout(onClose, 700);
    } catch (err) {
      setMessage(err.message || 'Could not download CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Download CSV options">
      <section className="modal-card csv-modal">
        <div className="section-head">
          <div>
            <p className="eyebrow">CSV export</p>
            <h2>Download datalog</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="muted">Choose all days or a date range. The interval setting thins normal datalog rows, but all alarm records are always included.</p>
        <div className="form-stack">
          <label>Days
            <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}>
              <option value="all">All days</option>
              <option value="range">Date range</option>
            </select>
          </label>
          {rangeMode === 'range' && (
            <div className="form-grid compact-form-grid">
              <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
              <label>End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
            </div>
          )}
          <label>Interval
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="1">Download every record</option>
              <option value="2">Download every other record</option>
              <option value="5">Download every 5 records</option>
              <option value="10">Download every 10 records</option>
              <option value="50">Download every 50 records</option>
              <option value="100">Download every 100 records</option>
            </select>
          </label>
          {message && <div className={message.toLowerCase().includes('could not') || message.toLowerCase().includes('must be') ? 'alert danger' : 'alert info'}>{message}</div>}
          <div className="inline-actions modal-actions">
            <button className="primary-button" type="button" onClick={downloadCsv} disabled={busy}>{busy ? 'Preparing…' : 'Download CSV'}</button>
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}

const themeOptions = [
  { value: 'system', label: 'System', hint: 'Use this device preference' },
  { value: 'light', label: 'Light', hint: 'Blue and white daytime view' },
  { value: 'dark', label: 'Dark', hint: 'Black and blue low-light view' },
];

function resolveTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function ThemeSelector({ themeMode, setThemeMode }) {
  return (
    <div className="theme-selector" role="group" aria-label="Appearance theme">
      {themeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={themeMode === option.value ? 'theme-card active' : 'theme-card'}
          onClick={() => setThemeMode(option.value)}
        >
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status || 'unknown'}`}>{String(status || 'unknown').replace('_', ' ')}</span>;
}

function BrandWordmark({ className = 'brand-wordmark', variant = 'default' }) {
  const src = variant === 'tagline' ? '/abatement-tech-tagline.png' : '/abatement-tech-wordmark.png';
  return <img className={className} src={src} alt="Abatement Technologies" />;
}

function AlarmBell({ data }) {
  const [open, setOpen] = useState(false);
  const activeAlarms = (data?.alarms || []).filter((alarm) => !alarm.resolved_at);
  const recentLogs = (data?.logs || []).slice(0, 8);
  const count = activeAlarms.length;

  return (
    <div className="top-menu-wrap">
      <button className={`icon-button bell-button ${count ? 'has-alerts' : ''}`} type="button" onClick={() => setOpen((value) => !value)} aria-label="Alarm notifications">
        <span>🔔</span>
        {count > 0 && <em>{count}</em>}
      </button>
      {open && (
        <div className="top-popover alarm-popover">
          <div className="popover-head">
            <strong>Alarm notifications</strong>
            <small>{count ? `${count} active alarm${count === 1 ? '' : 's'}` : 'No active alarms'}</small>
          </div>
          {activeAlarms.length ? (
            <div className="popover-list">
              {activeAlarms.slice(0, 6).map((alarm) => (
                <NavLink className="popover-row" to={`/devices/${alarm.device_id}`} key={alarm.id} onClick={() => setOpen(false)}>
                  <StatusPill status={alarm.alarm_state} />
                  <div>
                    <strong>{metricLabel(alarm.metric)} {alarm.value ?? '—'}</strong>
                    <small>R{alarm.room_no}S{alarm.sensor_no} · {new Date(alarm.started_at).toLocaleString()}</small>
                  </div>
                </NavLink>
              ))}
            </div>
          ) : (
            <p className="muted popover-empty">You are clear right now. New device alarms will appear here.</p>
          )}
          <div className="popover-head soft-head">
            <strong>Recent notification queue</strong>
          </div>
          <div className="popover-list compact">
            {recentLogs.length ? recentLogs.map((log) => (
              <div className="popover-row" key={log.id}>
                <span className="mini-channel">{log.channel}</span>
                <div>
                  <strong>{String(log.alarm_state || '').toUpperCase()}</strong>
                  <small>{new Date(log.created_at).toLocaleString()} · {log.status}</small>
                </div>
              </div>
            )) : <p className="muted popover-empty">No queued notifications yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function SupportMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="top-menu-wrap">
      <button className="support-button" type="button" onClick={() => setOpen((value) => !value)}>Support</button>
      {open && (
        <div className="top-popover support-popover">
          <div className="popover-head">
            <strong>Support links</strong>
            <small>Quick access for customer/help desk workflows</small>
          </div>
          <a className="support-link-card" href={SUPPORT_PORTAL_URL} target="_blank" rel="noreferrer">
            <strong>Open ticketing system</strong>
            <small>Abatement Partner Support / Freshdesk</small>
          </a>
          {MONSUITE_URL ? (
            <a className="support-link-card" href={MONSUITE_URL} target="_blank" rel="noreferrer">
              <strong>Open MonSuite</strong>
              <small>Manuals, firmware, product support, and assistant</small>
            </a>
          ) : (
            <div className="support-link-card disabled-card">
              <strong>MonSuite link not set</strong>
              <small>Add VITE_MONSUITE_URL in Netlify once you want this button live.</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AppShell({ session, title, children, data }) {
  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <img className="brand-mark" src="/abatement-tech-icon.png" alt="Abatement Technologies mark" />
          <div className="brand-stack">
            <BrandWordmark />
            <div className="brand-meta-row">
              <span className="brand-app-pill">{title || 'Abatement Link'}</span>
              <small>{session?.user?.email}</small>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <AlarmBell data={data} />
          <SupportMenu />
          <button className="ghost-button" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="content">{children}</main>
      <nav className="bottom-nav" aria-label="Main navigation">
        <NavLink to="/">Home</NavLink>
        <NavLink to="/devices">Devices</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/companies">Companies</NavLink>
        <NavLink to="/ingest">Ingest</NavLink>
        <NavLink to="/settings">More</NavLink>
      </nav>
    </div>
  );
}

function ConfigMissing() {
  return (
    <main className="login-screen">
      <section className="login-card">
        <BrandWordmark className="login-logo" variant="tagline" />
        <p className="eyebrow">Database setup required</p>
        <h1>Connect Supabase to use live data.</h1>
        <p className="muted">This version is the database-backed Abatement Link build. Add your Supabase URL and anon key in Netlify environment variables, then run the included SQL schema in Supabase.</p>
        <div className="alert info">Required public vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Required ingest vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DEVICE_INGEST_SECRET.</div>
        <button className="secondary-button" type="button" onClick={() => window.clearAbatementLinkBrowserState?.()}>Clear browser data and reload</button>
      </section>
    </main>
  );
}

function AuthPage({ session }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (session) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: { data: { name: form.name.trim() } },
        });
        if (signUpError) throw signUpError;
        setMessage('Account created. Check the email inbox and confirm the account, then sign in.');
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (loginError) throw loginError;
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <BrandWordmark className="login-logo" variant="tagline" />
        <p className="eyebrow">{mode === 'signup' ? 'Create account' : 'Welcome back'}</p>
        <h1>{mode === 'signup' ? 'Sign up with email.' : 'Sign in to live devices.'}</h1>
        <p className="muted">Email and password only. No SSO, no Google login.</p>
        <div className="brand-underline"><img src="/abatement-tech-wordmark.png" alt="Abatement Technologies" /></div>
        <form className="form-stack" onSubmit={submit}>
          {mode === 'signup' && <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Adam" /></label>}
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" required /></label>
          <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></label>
          {message && <div className="alert info">{message}</div>}
          {error && <div className="alert danger">{error}</div>}
          <button className="primary-button">{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
          <button className="link-button" type="button" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}</button>
        </form>
      </section>
    </main>
  );
}

function Protected({ session, children }) {
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function useCloudData(session) {
  const [state, setState] = useState({ devices: [], readings: [], alarms: [], companies: [], members: [], companyInvites: [], companyDevices: [], notifications: [], logs: [], pushSubscriptions: [], projectTypes: [], projects: [], projectRequirements: [], projectAssets: [], projectContacts: [], projectEvents: [], projectCorrectiveActions: [], projectReports: [], loading: true });
  const claimedInvitesRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    if (!claimedInvitesRef.current) {
      claimedInvitesRef.current = true;
      try { await supabase.rpc('claim_my_company_invites'); } catch { /* Older schemas can ignore this. */ }
    }
    const [devices, readings, alarms, companies, members, companyInvites, companyDevices, notifications, logs, pushSubscriptions, projectTypes, projects, projectRequirements, projectAssets, projectContacts, projectEvents, projectCorrectiveActions, projectReports] = await Promise.all([
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      supabase.from('device_readings').select('*').order('device_ts', { ascending: false }).limit(400),
      supabase.from('alarm_events').select('*').order('started_at', { ascending: false }).limit(200),
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('company_members').select('*, profiles(email, name)').order('created_at', { ascending: false }),
      supabase.from('company_invites').select('*').order('created_at', { ascending: false }),
      supabase.from('company_devices').select('*'),
      supabase.from('notification_rules').select('*'),
      supabase.from('notification_logs').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('push_subscriptions').select('*').eq('user_id', session.user.id).order('updated_at', { ascending: false }),
      supabase.from('project_types').select('*').order('name', { ascending: true }),
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('project_requirements').select('*').order('effective_at', { ascending: false }),
      supabase.from('project_asset_assignments').select('*').order('assigned_at', { ascending: false }),
      supabase.from('project_contacts').select('*').order('created_at', { ascending: false }),
      supabase.from('project_events').select('*').order('event_at', { ascending: false }),
      supabase.from('project_corrective_actions').select('*').order('created_at', { ascending: false }),
      supabase.from('project_reports').select('*').order('created_at', { ascending: false }),
    ]);
    setState({
      devices: devices.data || [],
      readings: readings.data || [],
      alarms: alarms.data || [],
      companies: companies.data || [],
      members: members.data || [],
      companyInvites: companyInvites.data || [],
      companyDevices: companyDevices.data || [],
      notifications: notifications.data || [],
      logs: logs.data || [],
      pushSubscriptions: pushSubscriptions.data || [],
      projectTypes: projectTypes.data || [],
      projects: projects.data || [],
      projectRequirements: projectRequirements.data || [],
      projectAssets: projectAssets.data || [],
      projectContacts: projectContacts.data || [],
      projectEvents: projectEvents.data || [],
      projectCorrectiveActions: projectCorrectiveActions.data || [],
      projectReports: projectReports.data || [],
      loading: false,
      errors: [devices.error, readings.error, alarms.error, companies.error, companyInvites.error, pushSubscriptions.error, projects.error, projectRequirements.error, projectAssets.error, projectEvents.error, projectCorrectiveActions.error].filter(Boolean),
    });
  }, [session]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!session) return undefined;
    const channel = supabase
      .channel('abatement-link-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_readings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alarm_events' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_members' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_invites' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_devices' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_logs' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'push_subscriptions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_requirements' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_asset_assignments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_events' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_corrective_actions' }, refresh)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, refresh]);

  return { ...state, refresh };
}

function DashboardPage({ session, data }) {
  const activeAlarms = data.alarms.filter((a) => !a.resolved_at);
  const connected = data.devices.filter((d) => connectionStatus(d) === 'connected');
  return (
    <AppShell session={session} title="Live Dashboard" data={data}>
      <section className="hero-card brand-hero-card">
        <div>
          <p className="eyebrow">Abatement Link Cloud</p>
          <h1>Live device data, alarms, and customer visibility.</h1>
          <p className="muted">Real-time monitoring for Abatement devices, with a cleaner branded experience built around your live device data.</p>
          <div className="hero-actions-row">
            <NavLink className="primary-button" to="/devices">Add device</NavLink>
          </div>
        </div>
        <div className="hero-brand-panel">
          <img className="hero-mark" src="/abatement-tech-icon.png" alt="Abatement Technologies mark" />
          <BrandWordmark className="hero-tagline" variant="tagline" />
        </div>
      </section>
      {data.errors?.length > 0 && <div className="alert danger">Database query issue: {data.errors.map((e) => e.message).join(' | ')}</div>}
      <section className="summary-grid">
        <div className="summary-card"><span>Devices</span><strong>{data.devices.length}</strong></div>
        <div className="summary-card"><span>Connected</span><strong>{connected.length}</strong></div>
        <div className="summary-card"><span>Active alarms</span><strong>{activeAlarms.length}</strong></div>
        <div className="summary-card"><span>Companies</span><strong>{data.companies.length}</strong></div>
      </section>
      <section className="section-head"><h2>All devices</h2><span>{data.loading ? 'Loading…' : `${data.devices.length} total · no page limit`}</span></section>
      <section className="device-grid">
        {data.devices.length ? data.devices.map((device) => <DeviceCard key={device.id} device={device} readings={data.readings} alarms={data.alarms} />) : <div className="empty-state"><h3>No devices yet</h3><p>Add a serial number to begin.</p></div>}
      </section>
    </AppShell>
  );
}

function DeviceCard({ device, readings, alarms }) {
  const activeAlarm = alarms.find((a) => a.device_id === device.id && !a.resolved_at);
  const status = activeAlarm ? activeAlarm.alarm_state : connectionStatus(device);
  const latest = device.latest_metrics || {};
  return (
    <NavLink className="device-card" to={`/devices/${device.id}`}>
      <div className="device-card-head">
        <div className="device-title-block"><strong>{device.nickname || device.serial_number}</strong><small>{device.model || 'Monitor'} · {device.serial_number}</small></div>
        <StatusPill status={status} />
      </div>
      <div className="device-meta"><span>Job {device.last_job_no || '—'}</span><span>Last seen {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</span></div>
      <div className="metric-strip">
        {metrics.slice(0, 4).map((m) => <div className="metric-mini" key={m}><span>{metricIcon(m)}</span><strong>{latest[m]?.value ?? '—'}</strong><small>{metricLabel(m)}</small></div>)}
      </div>
      <small className="muted device-card-foot">{readings.filter((r) => r.device_id === device.id).length} readings · {alarms.filter((a) => a.device_id === device.id).length} alarms</small>
    </NavLink>
  );
}

function DevicesPage({ session, data }) {
  const [form, setForm] = useState({ serial: '', nickname: '', model: 'PPM4' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  async function addDevice(e, confirmDuplicate = false) {
    e?.preventDefault?.();
    setMessage(''); setError('');
    const serial = form.serial.trim();
    if (!serial) return setError('Serial number is required.');
    setAddBusy(true);
    try {
      const result = await deviceClaimRequest(session, {
        action: 'create-device',
        serial,
        nickname: form.nickname.trim(),
        model: form.model,
        confirmDuplicate,
      });
      if (result.requiresConfirmation) {
        setDuplicateWarning(result);
        return;
      }
      setDuplicateWarning(null);
      setForm({ serial: '', nickname: '', model: 'PPM4' });
      setMessage(result.pendingTakeover
        ? 'Device added as Not Verified. Because this serial already existed, verification will ask whether to keep or delete previous data.'
        : 'Device added as Not Verified. Open it to view the validation code and instructions.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not add device.');
    } finally {
      setAddBusy(false);
    }
  }

  const deviceCompanyMap = useMemo(() => {
    const map = new Map();
    for (const link of data.companyDevices || []) {
      const company = data.companies.find((c) => c.id === link.company_id);
      if (!company) continue;
      if (!map.has(link.device_id)) map.set(link.device_id, []);
      map.get(link.device_id).push(company);
    }
    return map;
  }, [data.companyDevices, data.companies]);

  const deviceSuggestions = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return [];
    const suggestions = [];
    const add = (type, label, value, detail, count = 0) => {
      const key = `${type}:${value}`;
      if (!suggestions.some((item) => item.key === key)) suggestions.push({ key, type, label, value, detail, count });
    };

    for (const company of data.companies || []) {
      const companyDevices = (data.companyDevices || []).filter((link) => link.company_id === company.id);
      if (company.name?.toLowerCase().includes(q)) add('company', company.name, company.id, 'Company', companyDevices.length);
    }

    for (const model of [...new Set((data.devices || []).map((device) => device.model || 'Other'))]) {
      if (String(model).toLowerCase().includes(q)) add('model', model, model, 'Device type', data.devices.filter((device) => (device.model || 'Other') === model).length);
    }

    for (const device of data.devices || []) {
      const name = device.nickname || device.serial_number;
      if (name?.toLowerCase().includes(q)) add('name', name, device.id, 'Device name', 1);
      if (device.serial_number?.toLowerCase().includes(q)) add('serial', device.serial_number, device.id, 'Serial number', 1);
    }

    return suggestions.slice(0, 10);
  }, [deviceSearch, data.devices, data.companies, data.companyDevices]);

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    let devices = [...(data.devices || [])];

    if (activeFilter) {
      if (activeFilter.type === 'company') devices = devices.filter((device) => (deviceCompanyMap.get(device.id) || []).some((company) => company.id === activeFilter.value));
      if (activeFilter.type === 'model') devices = devices.filter((device) => (device.model || 'Other') === activeFilter.value);
      if (activeFilter.type === 'name' || activeFilter.type === 'serial') devices = devices.filter((device) => device.id === activeFilter.value);
    } else if (q) {
      devices = devices.filter((device) => {
        const companies = (deviceCompanyMap.get(device.id) || []).map((company) => company.name).join(' ');
        return [device.nickname, device.serial_number, device.model, companies].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    }

    const sortKey = activeFilter?.type || 'name';
    devices.sort((a, b) => {
      if (sortKey === 'company') {
        const ac = (deviceCompanyMap.get(a.id) || [])[0]?.name || '';
        const bc = (deviceCompanyMap.get(b.id) || [])[0]?.name || '';
        return ac.localeCompare(bc) || (a.nickname || '').localeCompare(b.nickname || '') || a.serial_number.localeCompare(b.serial_number);
      }
      if (sortKey === 'model') return String(a.model || '').localeCompare(String(b.model || '')) || (a.nickname || '').localeCompare(b.nickname || '');
      if (sortKey === 'serial') return String(a.serial_number || '').localeCompare(String(b.serial_number || ''), undefined, { numeric: true });
      return String(a.nickname || a.serial_number || '').localeCompare(String(b.nickname || b.serial_number || ''));
    });
    return devices;
  }, [data.devices, deviceSearch, activeFilter, deviceCompanyMap]);

  function chooseSuggestion(suggestion) {
    setActiveFilter(suggestion);
    setDeviceSearch(suggestion.label);
    setSuggestionsOpen(false);
  }

  function clearDeviceFilter() {
    setActiveFilter(null);
    setDeviceSearch('');
    setSuggestionsOpen(false);
  }

  return (
    <AppShell session={session} title="Devices" data={data}>
      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Claim monitor</p><h1>Add a device</h1></div></div>
        <form className="form-grid" onSubmit={addDevice}>
          <label>Serial number<input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} placeholder="14374082" /></label>
          <label>Device name<input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="Room 204 PPM4" /></label>
          <label>Model<select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}><option>PPM4</option><option>RPM</option><option>Other</option></select></label>
          <button className="primary-button" disabled={addBusy}>{addBusy ? 'Checking…' : 'Add as Not Verified'}</button>
        </form>
        {duplicateWarning && <div className="alert danger duplicate-serial-warning"><strong>This device already exists.</strong><p>If you verify it, all previous data may be deleted and ownership will be moved to this account.</p><p className="small-note">You can still add it now as Not Verified. Final verification will ask whether to keep previous data or delete it.</p><div className="inline-actions"><button className="primary-button" type="button" onClick={() => addDevice(null, true)} disabled={addBusy}>Add anyway as Not Verified</button><button className="secondary-button" type="button" onClick={() => setDuplicateWarning(null)}>Cancel</button></div></div>}
        {message && <div className="alert info">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="section-head device-list-head">
        <div><h2>Your devices</h2><span>{filteredDevices.length} shown · {data.devices.length} total · no page limit</span></div>
        <div className="device-search-wrap">
          <label className="device-search-label">
            <span>Search / filter</span>
            <input
              value={deviceSearch}
              onChange={(e) => { setDeviceSearch(e.target.value); setActiveFilter(null); setSuggestionsOpen(true); }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Name, company, type, serial…"
            />
          </label>
          {activeFilter && <button className="filter-chip" type="button" onClick={clearDeviceFilter}>{activeFilter.detail}: {activeFilter.label} ×</button>}
          {suggestionsOpen && deviceSearch.trim() && (
            <div className="device-search-ddl">
              {deviceSuggestions.length ? deviceSuggestions.map((suggestion) => (
                <button type="button" key={suggestion.key} onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(suggestion); }}>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.detail}{suggestion.count ? ` · ${suggestion.count} device${suggestion.count === 1 ? '' : 's'}` : ''}</small>
                </button>
              )) : <div className="ddl-empty">No exact filter options. Showing text matches.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="device-grid">
        {filteredDevices.length ? filteredDevices.map((device) => <DeviceCard key={device.id} device={device} readings={data.readings} alarms={data.alarms} />) : <div className="empty-state"><h3>No devices match</h3><p>Try another name, company, device type, or serial number.</p><button className="secondary-button" type="button" onClick={clearDeviceFilter}>Clear search</button></div>}
      </section>
    </AppShell>
  );
}

function DevicePage({ session, data }) {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const device = data.devices.find((d) => d.id === deviceId);
  const [error, setError] = useState('');
  const [claimMessage, setClaimMessage] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  if (!device) return <AppShell session={session} data={data}><div className="empty-state">Device not found or not shared with you.</div></AppShell>;
  const readings = data.readings.filter((r) => r.device_id === device.id).sort((a, b) => new Date(b.device_ts) - new Date(a.device_ts));
  const groupedReadings = groupReadingsByRoom(readings);
  const alarms = data.alarms.filter((a) => a.device_id === device.id).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const latest = device.latest_metrics || {};
  const activeAlarm = alarms.find((a) => !a.resolved_at);
  const status = activeAlarm ? activeAlarm.alarm_state : connectionStatus(device);
  const intervalReadings = readings.filter((reading) => String(reading.event_text || '').toUpperCase().includes('INTERVAL'));
  const latestIntervalTime = intervalReadings[0]?.device_ts || intervalReadings[0]?.received_at;
  const hasCurrentIntervalData = latestIntervalTime ? (Date.now() - new Date(latestIntervalTime).getTime()) < (3 * 60 * 60 * 1000) : false;
  const hasAlarmPointData = alarms.length > 0 || readings.some((reading) => String(reading.event_text || '').toUpperCase().includes('ALARM'));

  async function finalizeTakeover(deletePreviousData) {
    setError('');
    setClaimMessage('');
    setClaimBusy(true);
    try {
      const result = await deviceClaimRequest(session, {
        action: 'finalize-takeover',
        deviceId: device.id,
        deletePreviousData,
      });
      setClaimMessage(result.message || 'Device ownership has been moved to this account.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not finish device verification.');
    } finally {
      setClaimBusy(false);
    }
  }

  async function deleteDevice() {
    if (!window.confirm('Delete this device and permanently remove its datalog, alarm history, notification settings, and company links?')) return;
    const { error: deleteError } = await supabase.from('devices').delete().eq('id', device.id);
    if (deleteError) return setError(deleteError.message);
    navigate('/devices');
  }

  return (
    <AppShell session={session} title={device.nickname || device.serial_number} data={data}>
      <section className="device-hero">
        <div><p className="eyebrow">{device.model} · Serial {device.serial_number}</p><h1>{device.nickname || device.serial_number}</h1><div className="inline-actions"><StatusPill status={status} /><span>Validation code: {device.validation_code}</span></div></div>
        <div className="inline-actions hero-device-actions"><button className="secondary-button" type="button" onClick={() => setCsvOpen(true)}>Download CSV</button><NavLink className="secondary-button" to={`/devices/${device.id}/notifications`}>Notifications</NavLink></div>
      </section>
      {csvOpen && <CsvDownloadModal device={device} onClose={() => setCsvOpen(false)} />}
      {error && <div className="alert danger">{error}</div>}
      {!device.verified_at && <section className="panel warning-panel"><h2>Device is Not Verified</h2><p>Tell the customer to enter validation code <strong>{device.validation_code}</strong> on the physical device. The Netlify ingest endpoint will mark it verified when it receives a matching validation_code field. For internal testing, use the Verify Device button on the Ingest page.</p>{device.pending_takeover && <p className="small-note"><strong>Serial ownership warning:</strong> this serial was already registered. After verification, Abatement Link will ask whether previous data should be kept or deleted.</p>}</section>}
      {device.verified_at && device.pending_takeover && !device.takeover_finalized_at && <section className="panel warning-panel takeover-panel"><p className="eyebrow">Device ownership</p><h2>This serial was already registered.</h2><p>Would you like to delete all previous data? Either way, ownership will be moved to this account and the old registration will be removed.</p><div className="inline-actions"><button className="primary-button" type="button" onClick={() => finalizeTakeover(false)} disabled={claimBusy}>{claimBusy ? 'Working…' : 'Keep previous data'}</button><button className="danger-button" type="button" onClick={() => finalizeTakeover(true)} disabled={claimBusy}>Delete previous data</button></div><p className="muted small-note">Keeping previous data moves existing datalog and alarm history onto this account. Deleting previous data starts this device fresh.</p></section>}
      {claimMessage && <div className="alert info">{claimMessage}</div>}
      {!hasAlarmPointData && <section className="panel setup-panel"><p className="eyebrow">Alarm setup</p><h2>Set off one test alarm from the device.</h2><p>Please set off an alarm with your desired alarm points on your physical device. Abatement Link will not know this device’s alarm points until the unit sends a <strong>HIGH ALARM</strong>, <strong>LOW ALARM</strong>, or <strong>OK ALARM</strong> event.</p><p className="muted small-note">After the alarm returns to a good value and the device sends OK ALARM, the alarm history and notifications will reflect the real alarm behavior.</p></section>}
      {!hasCurrentIntervalData && <section className="panel setup-panel"><p className="eyebrow">Live data setup</p><h2>No current interval data yet.</h2><p>To set live data, go on your device to <strong>Communications &gt; Cloud Setup &gt; Cloud Intervals</strong> and turn on/send interval data for this device.</p><p className="muted small-note">Once Abatement Link receives current INTERVAL data, this setup reminder will go away.</p></section>}
      <section className="metric-grid large">
        {metrics.map((metric) => <div className="metric-tile" key={metric}><span>{metricIcon(metric)}</span><strong>{latest[metric]?.value ?? '—'}</strong><small>{metricLabel(metric)}</small>{latest[metric]?.timestamp && <em>{new Date(latest[metric].timestamp).toLocaleString()}</em>}</div>)}
      </section>
      <section className="device-data-layout">
        <div className="panel datalog-panel"><div className="section-head datalog-head"><div><h2>Datalog</h2><span>{groupedReadings.length} room rows · {readings.length} values</span></div><button className="secondary-button slim" type="button" onClick={() => setCsvOpen(true)}>Download CSV</button></div><div className="table-scroll datalog-scroll"><table className="datalog-room-table"><thead><tr><th>Time</th><th>Job</th><th>Room</th>{[...groupedDatalogMetrics.map((metric) => metric), ...groupedDatalogMetrics.map((metric) => `${metric}2`)].map((metricKey) => <th key={metricKey}>{metricColumnLabel(metricKey)}</th>)}<th>Event</th></tr></thead><tbody>{groupedReadings.slice(0, 100).map((row) => <tr key={row.key}><td>{new Date(row.device_ts || row.received_at).toLocaleString()}</td><td>{row.job_no || '—'}</td><td><strong>Room {row.room}</strong></td>{[...groupedDatalogMetrics.map((metric) => metric), ...groupedDatalogMetrics.map((metric) => `${metric}2`)].map((metricKey) => <td key={metricKey}>{formatReadingCell(row.values[metricKey])}</td>)}<td><span className="event-type-chip">{[...row.eventTypes].join(', ')}</span> <StatusPill status={groupAlarmStatus(row)} /><small className="event-raw muted">{row.rawEvents.slice(0, 3).join(' · ')}{row.rawEvents.length > 3 ? ' · …' : ''}</small></td></tr>)}</tbody></table></div></div>
        <div className="panel"><div className="section-head"><h2>Alarm history</h2><span>{alarms.length}</span></div><div className="alarm-list">{alarms.length ? alarms.map((a) => <div className="alarm-item" key={a.id}><StatusPill status={a.alarm_state} /><strong>{metricLabel(a.metric)} {a.value}</strong><small>{new Date(a.started_at).toLocaleString()} {a.resolved_at ? `→ resolved ${new Date(a.resolved_at).toLocaleString()}` : 'active'}</small></div>) : <p className="muted">No alarms yet.</p>}</div></div>
      </section>
      <section className="panel danger-panel soft"><h2>Delete device</h2><p>Deleting removes device registration, datalog, alarm history, notification settings, and company links.</p><button className="danger-button" onClick={deleteDevice}>Delete device and data</button></section>
    </AppShell>
  );
}

function NotificationsPage({ session, data }) {
  const { deviceId } = useParams();
  const device = data.devices.find((d) => d.id === deviceId);
  const existing = data.notifications.find((r) => r.device_id === deviceId && r.user_id === session.user.id);
  const [rule, setRule] = useState(existing || { push_high: true, push_low: true, push_ok: true, email_high: false, email_low: false, email_ok: false, sms_high: false, sms_low: false, sms_ok: false, extra_emails: [] });
  const [newEmail, setNewEmail] = useState('');
  const [message, setMessage] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [browserPushEndpoint, setBrowserPushEndpoint] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function checkCurrentPush() {
      try {
        const subscription = await getBrowserPushSubscription();
        if (!cancelled) setBrowserPushEndpoint(subscription?.endpoint || '');
      } catch {
        if (!cancelled) setBrowserPushEndpoint('');
      }
    }
    checkCurrentPush();
    return () => { cancelled = true; };
  }, [data.pushSubscriptions?.length]);

  if (!device) return <AppShell session={session} data={data}><div className="empty-state">Device not found.</div></AppShell>;

  const savedBrowserSubscription = data.pushSubscriptions.find((sub) => sub.endpoint === browserPushEndpoint && sub.enabled);
  const enabledPhoneCount = data.pushSubscriptions.filter((sub) => sub.enabled).length;
  const phonePushStatus = !phonePushAvailable()
    ? 'Not supported in this browser'
    : !VAPID_PUBLIC_KEY
      ? 'Needs VAPID public key in Netlify'
      : savedBrowserSubscription
        ? 'Enabled on this browser/device'
        : enabledPhoneCount
          ? `Enabled on ${enabledPhoneCount} saved device${enabledPhoneCount === 1 ? '' : 's'}`
          : 'Not enabled on this browser yet';

  function toggle(key) { setRule((r) => ({ ...r, [key]: !r[key] })); }
  function addEmail() { if (newEmail.trim()) { setRule((r) => ({ ...r, extra_emails: [...(r.extra_emails || []), newEmail.trim()] })); setNewEmail(''); } }

  async function save() {
    const payload = { ...rule, device_id: deviceId, user_id: session.user.id, sms_high: false, sms_low: false, sms_ok: false };
    const { error } = await supabase.from('notification_rules').upsert(payload, { onConflict: 'device_id,user_id' });
    setMessage(error ? error.message : 'Notification settings saved. SMS stays disabled until Plivo is added.');
    data.refresh();
  }

  async function enablePhonePush() {
    setPushBusy(true);
    setMessage('');
    try {
      const subscription = await enablePhonePushForUser(session.user.id);
      setBrowserPushEndpoint(subscription.endpoint);
      setMessage('Phone/browser push enabled for this device. Alarm settings below control High, Low, and OK alerts.');
      data.refresh();
    } catch (err) {
      setMessage(err.message || 'Could not enable phone push.');
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePhonePush() {
    setPushBusy(true);
    setMessage('');
    try {
      await disablePhonePushForCurrentBrowser(session.user.id);
      setBrowserPushEndpoint('');
      setMessage('Phone/browser push disabled for this browser. The in-app alarm bell still follows your push toggles.');
      data.refresh();
    } catch (err) {
      setMessage(err.message || 'Could not disable phone push.');
    } finally {
      setPushBusy(false);
    }
  }

  const channel = (name, keys, disabled = false) => <div className={`panel channel-card ${name.toLowerCase()}`}><h2>{name}{disabled && ' - coming soon'}</h2><div className="toggle-grid">{keys.map(([label, key]) => <button key={key} disabled={disabled} className={`toggle-card ${rule[key] ? 'on' : ''}`} onClick={() => !disabled && toggle(key)}><strong>{label}</strong><small>{rule[key] ? 'On' : 'Off'}</small></button>)}</div></div>;

  return <AppShell session={session} title="Notifications" data={data}>
    <section className="hero-card compact-hero">
      <div>
        <p className="eyebrow">{device.nickname}</p>
        <h1>Alarm notification settings.</h1>
        <p className="muted">The alarm bell and phone push channel are on by default for the device owner and accepted company users. Use this page to choose which High, Low, and OK alarms you want.</p>
      </div>
      <div className="push-status-card">
        <strong>Phone push</strong>
        <small>{phonePushStatus}</small>
        <div className="quick-buttons push-buttons">
          <button className="secondary-button slim" type="button" disabled={pushBusy || !phonePushAvailable()} onClick={enablePhonePush}>{pushBusy ? 'Working…' : 'Enable phone alerts'}</button>
          <button className="ghost-button slim" type="button" disabled={pushBusy || !browserPushEndpoint} onClick={disablePhonePush}>Disable here</button>
        </div>
      </div>
    </section>
    <section className="panel notification-explainer">
      <h2>Who gets alarm notifications?</h2>
      <p>By default, the device owner and every accepted user in a company that contains this device get alarm-bell and phone-push notifications. Each user can turn their own push, email, or future SMS settings on or off here.</p>
      <p className="muted small-note">Phone push only works on browsers/devices where the user has clicked Enable phone alerts and allowed notifications. On iPhone, users should install the app to the Home Screen for reliable web push.</p>
    </section>
    {channel('Alarm bell / Phone push - recommended', [['High alarm', 'push_high'], ['Low alarm', 'push_low'], ['Return to OK', 'push_ok']])}
    {channel('Email', [['High alarm', 'email_high'], ['Low alarm', 'email_low'], ['Return to OK', 'email_ok']])}
    <section className="panel"><h2>Extra email recipients</h2><p className="muted">Add additional email addresses that should receive this device’s email notifications when your Email toggles are on.</p><div className="recipient-box"><input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="tech@example.com" /><button className="secondary-button" onClick={addEmail}>Add</button><div className="recipient-list">{(rule.extra_emails || []).map((email) => <span key={email}>{email}</span>)}</div></div></section>
    {channel('SMS', [['High alarm', 'sms_high'], ['Low alarm', 'sms_low'], ['Return to OK', 'sms_ok']], true)}
    {message && <div className="alert info">{message}</div>}
    <button className="primary-button sticky-save" onClick={save}>Save notification settings</button>
  </AppShell>;
}


function ProjectsPage({ session, data }) {
  const defaultType = data.projectTypes.find((type) => type.slug === 'icra_healthcare_construction') || data.projectTypes[0];
  const [form, setForm] = useState({
    project_name: '',
    project_number: '',
    project_type_id: defaultType?.id || '',
    company_id: '',
    facility: '',
    building: '',
    floor: '',
    department: '',
    room_area: '',
    contractor: '',
    infection_prevention_contact: '',
    facility_contact: '',
    project_manager: '',
    planned_start_at: '',
    planned_end_at: '',
    containment_type: 'Negative pressure',
    notes: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.project_type_id && defaultType?.id) setForm((current) => ({ ...current, project_type_id: defaultType.id }));
  }, [defaultType?.id]);

  async function createProject(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!form.project_name.trim()) return setError('Project name is required.');
    setBusy(true);
    try {
      const { data: created, error: createError } = await supabase.from('projects').insert({
        owner_id: session.user.id,
        company_id: form.company_id || null,
        project_type_id: form.project_type_id || defaultType?.id || null,
        project_name: form.project_name.trim(),
        project_number: form.project_number.trim() || null,
        facility: form.facility.trim() || null,
        building: form.building.trim() || null,
        floor: form.floor.trim() || null,
        department: form.department.trim() || null,
        room_area: form.room_area.trim() || null,
        contractor: form.contractor.trim() || null,
        infection_prevention_contact: form.infection_prevention_contact.trim() || null,
        facility_contact: form.facility_contact.trim() || null,
        project_manager: form.project_manager.trim() || null,
        planned_start_at: fromDateTimeLocal(form.planned_start_at),
        planned_end_at: fromDateTimeLocal(form.planned_end_at),
        containment_type: form.containment_type.trim() || null,
        notes: form.notes.trim() || null,
        status: 'draft',
      }).select().single();
      if (createError) throw createError;
      setMessage('Project created. Open it to assign devices and requirements.');
      setForm({ ...form, project_name: '', project_number: '', facility: '', building: '', floor: '', department: '', room_area: '', notes: '' });
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not create project.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell session={session} title="Projects" data={data}>
      <section className="hero-card compact-hero">
        <div>
          <p className="eyebrow">Project records</p>
          <h1>Projects organize monitoring jobs.</h1>
          <p className="muted">Devices still record the measurements. Projects link existing device history to a time-bounded job record for ICRA and future monitoring workflows.</p>
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">New project</p><h2>Create ICRA / healthcare construction project</h2></div></div>
        <form className="form-grid project-form-grid" onSubmit={createProject}>
          <label>Project name<input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} placeholder="OR Wing Renovation" required /></label>
          <label>Project number<input value={form.project_number} onChange={(e) => setForm({ ...form, project_number: e.target.value })} placeholder="ICRA-2026-001" /></label>
          <label>Project type<select value={form.project_type_id} onChange={(e) => setForm({ ...form, project_type_id: e.target.value })}>{data.projectTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>Company<select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}><option value="">No company / personal</option>{data.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label>Facility / hospital<input value={form.facility} onChange={(e) => setForm({ ...form, facility: e.target.value })} placeholder="St. Example Hospital" /></label>
          <label>Building<input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></label>
          <label>Floor<input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></label>
          <label>Department<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
          <label>Room / area<input value={form.room_area} onChange={(e) => setForm({ ...form, room_area: e.target.value })} /></label>
          <label>Contractor<input value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} /></label>
          <label>Infection prevention contact<input value={form.infection_prevention_contact} onChange={(e) => setForm({ ...form, infection_prevention_contact: e.target.value })} /></label>
          <label>Facility contact<input value={form.facility_contact} onChange={(e) => setForm({ ...form, facility_contact: e.target.value })} /></label>
          <label>Project manager<input value={form.project_manager} onChange={(e) => setForm({ ...form, project_manager: e.target.value })} /></label>
          <label>Planned start<input type="datetime-local" value={form.planned_start_at} onChange={(e) => setForm({ ...form, planned_start_at: e.target.value })} /></label>
          <label>Planned end<input type="datetime-local" value={form.planned_end_at} onChange={(e) => setForm({ ...form, planned_end_at: e.target.value })} /></label>
          <label>Containment type<select value={form.containment_type} onChange={(e) => setForm({ ...form, containment_type: e.target.value })}><option>Negative pressure</option><option>Positive pressure</option><option>Neutral / observation</option><option>Other</option></select></label>
          <label className="full-span">Notes<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Scope, special monitoring notes, infection prevention requirements…" /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </form>
        {message && <div className="alert info">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="section-head"><h2>Your projects</h2><span>{data.projects.length} total</span></section>
      <section className="project-grid">
        {data.projects.length ? data.projects.map((project) => {
          const type = data.projectTypes.find((item) => item.id === project.project_type_id);
          const assignments = projectActiveAssignments(data, project.id);
          return (
            <NavLink className="project-card" key={project.id} to={`/projects/${project.id}`}>
              <div className="project-card-head"><div><strong>{project.project_name}</strong><small>{project.project_number || 'No project number'} · {type?.name || 'Project'}</small></div><span className={`status-pill ${project.status}`}>{projectStatusLabel(project.status)}</span></div>
              <div className="device-meta"><span>{project.facility || 'No facility'}</span><span>{project.room_area || project.department || 'No area'}</span></div>
              <div className="summary-grid mini-summary">
                <div className="summary-card"><span>Devices</span><strong>{assignments.length}</strong></div>
                <div className="summary-card"><span>Started</span><strong>{project.started_at ? 'Yes' : 'No'}</strong></div>
              </div>
            </NavLink>
          );
        }) : <div className="empty-state"><h3>No projects yet</h3><p>Create a project, assign existing devices, then start monitoring.</p></div>}
      </section>
    </AppShell>
  );
}

function ProjectPage({ session, data }) {
  const { projectId } = useParams();
  const project = data.projects.find((item) => item.id === projectId);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [requirementForm, setRequirementForm] = useState({
    requirement_type: 'pressure',
    pressure_relationship: 'negative',
    target_value: '',
    lower_limit: '-0.0050',
    upper_limit: '',
    units: 'inWC',
    notes: '',
  });
  const [eventForm, setEventForm] = useState({ event_type: 'note', title: '', description: '', severity: 'info' });
  const [actionForm, setActionForm] = useState({ cause: 'Door open', action_taken: '', responded_by: '', notes: '' });

  if (!project) return <AppShell session={session} title="Project" data={data}><div className="empty-state"><h3>Project not found</h3><p>It may have been deleted or you may not have access.</p></div></AppShell>;

  const projectType = data.projectTypes.find((item) => item.id === project.project_type_id);
  const assignments = (data.projectAssets || []).filter((a) => a.project_id === project.id);
  const activeAssignments = assignments.filter((a) => !a.removed_at);
  const assignedDeviceIds = activeAssignments.map((a) => a.device_id);
  const assignedDevices = data.devices.filter((d) => assignedDeviceIds.includes(d.id));
  const availableDevices = data.devices.filter((d) => !assignedDeviceIds.includes(d.id));
  const requirements = (data.projectRequirements || []).filter((r) => r.project_id === project.id);
  const projectAlarms = (data.alarms || []).filter((alarm) => assignedDeviceIds.includes(alarm.device_id));
  const projectReadings = projectReadingsFromLoadedData(project, assignments, data.readings);
  const stats = buildProjectStats(project, requirements, projectReadings, projectAlarms);
  const currentPressureReq = latestRequirement(requirements, 'pressure');
  const events = (data.projectEvents || []).filter((event) => event.project_id === project.id);
  const actions = (data.projectCorrectiveActions || []).filter((action) => action.project_id === project.id);

  async function updateStatus(status) {
    setMessage(''); setError('');
    try {
      const patch = { status };
      if (status === 'active' && !project.started_at) patch.started_at = new Date().toISOString();
      if (status === 'completed') patch.actual_end_at = new Date().toISOString();
      const { error: updateError } = await supabase.from('projects').update(patch).eq('id', project.id);
      if (updateError) throw updateError;
      await supabase.from('project_events').insert({ project_id: project.id, event_type: 'status', title: `Project ${projectStatusLabel(status)}`, description: `Status changed to ${projectStatusLabel(status)}.`, created_by: session.user.id, event_at: new Date().toISOString() });
      setMessage('Project status updated.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not update project.');
    }
  }

  async function assignDevice(e) {
    e.preventDefault();
    setMessage(''); setError('');
    if (!selectedDeviceId) return setError('Choose a device to assign.');
    try {
      const { error: assignError } = await supabase.from('project_asset_assignments').insert({
        project_id: project.id,
        device_id: selectedDeviceId,
        assigned_at: new Date().toISOString(),
        assigned_by: session.user.id,
      });
      if (assignError) throw assignError;
      const device = data.devices.find((d) => d.id === selectedDeviceId);
      await supabase.from('project_events').insert({ project_id: project.id, device_id: selectedDeviceId, event_type: 'equipment', title: 'Equipment assigned', description: `${device?.nickname || device?.serial_number || 'Device'} assigned to project.`, created_by: session.user.id, event_at: new Date().toISOString() });
      setSelectedDeviceId('');
      setMessage('Device assigned to project.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not assign device.');
    }
  }

  async function removeDevice(assignment) {
    setMessage(''); setError('');
    try {
      const { error: removeError } = await supabase.from('project_asset_assignments').update({ removed_at: new Date().toISOString(), removed_by: session.user.id }).eq('id', assignment.id);
      if (removeError) throw removeError;
      const device = data.devices.find((d) => d.id === assignment.device_id);
      await supabase.from('project_events').insert({ project_id: project.id, device_id: assignment.device_id, event_type: 'equipment', title: 'Equipment removed', description: `${device?.nickname || device?.serial_number || 'Device'} removed from active assignment. Historical data remains linked by assignment time.`, created_by: session.user.id, event_at: new Date().toISOString() });
      setMessage('Device removed from active project assignment. Historical readings remain associated by date range.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not remove device.');
    }
  }

  async function saveRequirement(e) {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      const { error: reqError } = await supabase.from('project_requirements').insert({
        project_id: project.id,
        requirement_type: requirementForm.requirement_type,
        pressure_relationship: requirementForm.requirement_type === 'pressure' ? requirementForm.pressure_relationship : null,
        target_value: requirementForm.target_value === '' ? null : Number(requirementForm.target_value),
        lower_limit: requirementForm.lower_limit === '' ? null : Number(requirementForm.lower_limit),
        upper_limit: requirementForm.upper_limit === '' ? null : Number(requirementForm.upper_limit),
        units: requirementForm.units || null,
        notes: requirementForm.notes || null,
        effective_at: new Date().toISOString(),
        created_by: session.user.id,
      });
      if (reqError) throw reqError;
      await supabase.from('project_events').insert({ project_id: project.id, event_type: 'requirement', title: 'Requirement changed', description: `${metricLabel(requirementForm.requirement_type)} requirement updated.`, created_by: session.user.id, event_at: new Date().toISOString() });
      setMessage('Requirement saved. Older requirements remain in history.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not save requirement.');
    }
  }

  async function addProjectEvent(e) {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      const { error: eventError } = await supabase.from('project_events').insert({
        project_id: project.id,
        event_type: eventForm.event_type,
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || null,
        severity: eventForm.severity,
        event_at: new Date().toISOString(),
        created_by: session.user.id,
      });
      if (eventError) throw eventError;
      setEventForm({ event_type: 'note', title: '', description: '', severity: 'info' });
      setMessage('Project event added.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not add event.');
    }
  }

  async function addCorrectiveAction(e) {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      const { error: actionError } = await supabase.from('project_corrective_actions').insert({
        project_id: project.id,
        cause: actionForm.cause,
        action_taken: actionForm.action_taken.trim(),
        responded_by: actionForm.responded_by.trim() || null,
        notes: actionForm.notes.trim() || null,
        created_by: session.user.id,
      });
      if (actionError) throw actionError;
      await supabase.from('project_events').insert({ project_id: project.id, event_type: 'corrective_action', title: 'Corrective action documented', description: `${actionForm.cause}: ${actionForm.action_taken}`, created_by: session.user.id, event_at: new Date().toISOString() });
      setActionForm({ cause: 'Door open', action_taken: '', responded_by: '', notes: '' });
      setMessage('Corrective action documented.');
      data.refresh();
    } catch (err) {
      setError(err.message || 'Could not save corrective action.');
    }
  }

  const timeline = [
    ...events.map((event) => ({ time: event.event_at || event.created_at, title: event.title, detail: event.description, type: event.event_type })),
    ...projectAlarms.map((alarm) => ({ time: alarm.started_at, title: `${String(alarm.metric || 'Alarm').toUpperCase()} ${String(alarm.alarm_state || '').toUpperCase()}`, detail: alarm.event_text, type: 'alarm' })),
    ...actions.map((action) => ({ time: action.created_at, title: 'Corrective action', detail: `${action.cause}: ${action.action_taken}`, type: 'corrective_action' })),
  ].filter((item) => item.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 60);

  return (
    <AppShell session={session} title="Project Dashboard" data={data}>
      <section className="device-hero project-hero">
        <div>
          <p className="eyebrow">{projectType?.name || 'Project'}</p>
          <h1>{project.project_name}</h1>
          <p className="muted">{project.project_number || 'No project number'} · {project.facility || 'No facility'} · {project.room_area || project.department || 'No room/area'}</p>
          <div className="chip-row"><span>{projectStatusLabel(project.status)}</span><span>{project.containment_type || 'Containment not set'}</span><span>Started: {displayDateTime(project.started_at)}</span></div>
        </div>
        <div className="quick-buttons">
          {project.status !== 'active' && <button className="primary-button" type="button" onClick={() => updateStatus('active')}>Start / resume</button>}
          {project.status === 'active' && <button className="secondary-button" type="button" onClick={() => updateStatus('paused')}>Pause</button>}
          {project.status !== 'completed' && <button className="secondary-button" type="button" onClick={() => updateStatus('completed')}>Complete</button>}
        </div>
      </section>

      {message && <div className="alert info">{message}</div>}
      {error && <div className="alert danger">{error}</div>}

      <section className="summary-grid project-summary-grid">
        <div className="summary-card"><span>Assigned devices</span><strong>{assignedDevices.length}</strong></div>
        <div className="summary-card"><span>Active alarms</span><strong>{stats.activeAlarmCount}</strong></div>
        <div className="summary-card"><span>Recent readings</span><strong>{stats.readingCount}</strong></div>
        <div className="summary-card"><span>Excursions</span><strong>{stats.excursionCount}</strong></div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2>Containment status</h2>
          <div className="project-status-callout">
            <StatusPill status={stats.activeAlarmCount ? 'alarm' : stats.readingCount ? 'connected' : 'disconnected'} />
            <p className="muted">{stats.activeAlarmCount ? 'Active alarm on assigned equipment.' : stats.readingCount ? 'Recent assigned readings found in existing history.' : 'No recent loaded readings for assigned equipment. Offline/no-data should not be treated as normal.'}</p>
          </div>
          <div className="metric-grid">
            <div className="metric-tile"><small>Pressure target</small><strong>{currentPressureReq?.target_value ?? '—'}</strong><em>{currentPressureReq?.units || 'inWC'}</em></div>
            <div className="metric-tile"><small>Lower limit</small><strong>{currentPressureReq?.lower_limit ?? '—'}</strong><em>{currentPressureReq?.units || 'inWC'}</em></div>
            <div className="metric-tile"><small>Average</small><strong>{stats.pressureAvg}</strong><em>loaded pressure readings</em></div>
            <div className="metric-tile"><small>Min / Max</small><strong>{stats.pressureMin}</strong><em>{stats.pressureMax}</em></div>
          </div>
        </div>

        <div className="panel">
          <h2>Assigned equipment</h2>
          <form className="inline-actions" onSubmit={assignDevice}>
            <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
              <option value="">Choose available device…</option>
              {availableDevices.map((device) => <option key={device.id} value={device.id}>{device.nickname || device.serial_number} · {device.model} · {device.serial_number}</option>)}
            </select>
            <button className="primary-button">Assign</button>
          </form>
          <div className="assignment-list">
            {assignments.length ? assignments.map((assignment) => {
              const device = data.devices.find((d) => d.id === assignment.device_id);
              return (
                <div className="assignment-row" key={assignment.id}>
                  <div><strong>{device?.nickname || device?.serial_number || 'Device'}</strong><small>{device?.model || 'Device'} · assigned {displayDateTime(assignment.assigned_at)}{assignment.removed_at ? ` · removed ${displayDateTime(assignment.removed_at)}` : ''}</small></div>
                  {!assignment.removed_at && <button className="secondary-button slim" type="button" onClick={() => removeDevice(assignment)}>Remove</button>}
                </div>
              );
            }) : <p className="muted">No devices assigned yet.</p>}
          </div>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2>Monitoring requirements</h2>
          <form className="form-grid" onSubmit={saveRequirement}>
            <label>Measurement<select value={requirementForm.requirement_type} onChange={(e) => setRequirementForm({ ...requirementForm, requirement_type: e.target.value })}><option value="pressure">Pressure</option><option value="temperature">Temperature</option><option value="humidity">Humidity</option><option value="particles">Particles</option><option value="velocity">Velocity</option><option value="ach">ACH</option></select></label>
            <label>Pressure relationship<select value={requirementForm.pressure_relationship} onChange={(e) => setRequirementForm({ ...requirementForm, pressure_relationship: e.target.value })}><option value="negative">Negative</option><option value="positive">Positive</option><option value="neutral">Neutral / observe</option></select></label>
            <label>Target<input type="number" step="0.0001" value={requirementForm.target_value} onChange={(e) => setRequirementForm({ ...requirementForm, target_value: e.target.value })} /></label>
            <label>Lower limit<input type="number" step="0.0001" value={requirementForm.lower_limit} onChange={(e) => setRequirementForm({ ...requirementForm, lower_limit: e.target.value })} /></label>
            <label>Upper limit<input type="number" step="0.0001" value={requirementForm.upper_limit} onChange={(e) => setRequirementForm({ ...requirementForm, upper_limit: e.target.value })} /></label>
            <label>Units<input value={requirementForm.units} onChange={(e) => setRequirementForm({ ...requirementForm, units: e.target.value })} /></label>
            <label className="full-span">Notes<textarea rows="2" value={requirementForm.notes} onChange={(e) => setRequirementForm({ ...requirementForm, notes: e.target.value })} /></label>
            <button className="primary-button">Save requirement</button>
          </form>
          <div className="table-scroll compact-table">
            <table><thead><tr><th>Type</th><th>Target</th><th>Limits</th><th>Effective</th></tr></thead><tbody>{requirements.slice(0, 12).map((r) => <tr key={r.id}><td>{metricLabel(r.requirement_type)}</td><td>{r.target_value ?? '—'} {r.units}</td><td>{r.lower_limit ?? '—'} / {r.upper_limit ?? '—'}</td><td>{displayDateTime(r.effective_at)}</td></tr>)}</tbody></table>
          </div>
        </div>

        <div className="panel">
          <h2>Corrective actions</h2>
          <form className="form-stack" onSubmit={addCorrectiveAction}>
            <label>Cause<select value={actionForm.cause} onChange={(e) => setActionForm({ ...actionForm, cause: e.target.value })}>{['Door open', 'HEPA stopped', 'Filter issue', 'HVAC issue', 'Containment breach', 'Sensor issue', 'Maintenance', 'Power interruption', 'Unknown', 'Other'].map((cause) => <option key={cause}>{cause}</option>)}</select></label>
            <label>Corrective action<textarea rows="3" value={actionForm.action_taken} onChange={(e) => setActionForm({ ...actionForm, action_taken: e.target.value })} required /></label>
            <label>Responded by<input value={actionForm.responded_by} onChange={(e) => setActionForm({ ...actionForm, responded_by: e.target.value })} /></label>
            <label>Notes<textarea rows="2" value={actionForm.notes} onChange={(e) => setActionForm({ ...actionForm, notes: e.target.value })} /></label>
            <button className="primary-button">Document action</button>
          </form>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2>Add project event</h2>
          <form className="form-stack" onSubmit={addProjectEvent}>
            <label>Event type<select value={eventForm.event_type} onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}><option value="note">Note</option><option value="excursion">Excursion</option><option value="offline">Device offline</option><option value="requirement">Requirement change</option><option value="equipment">Equipment change</option></select></label>
            <label>Title<input value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} required /></label>
            <label>Description<textarea rows="3" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></label>
            <button className="primary-button">Add event</button>
          </form>
        </div>

        <div className="panel">
          <h2>Project timeline</h2>
          <div className="timeline">
            {timeline.length ? timeline.map((item, index) => (
              <div className="timeline-item" key={`${item.time}-${index}`}>
                <span>{displayDateTime(item.time)}</span>
                <strong>{item.title}</strong>
                {item.detail && <p>{item.detail}</p>}
              </div>
            )) : <p className="muted">No project events yet.</p>}
          </div>
        </div>
      </section>
    </AppShell>
  );
}


function CompaniesPage({ session, data }) {
  const [companyName, setCompanyName] = useState('');
  const [invite, setInvite] = useState({ companyId: '', email: '', role: 'viewer' });
  const [deviceLink, setDeviceLink] = useState({ companyId: '', deviceId: '' });
  const [message, setMessage] = useState('');

  function roleFor(companyId) {
    const member = data.members.find((m) => m.company_id === companyId && m.user_id === session.user.id && m.accepted_at);
    return member?.role || null;
  }

  function canManage(company) {
    const role = roleFor(company.id);
    return company.created_by === session.user.id || role === 'owner' || role === 'admin';
  }

  const ownedCompanies = data.companies.filter((c) => c.created_by === session.user.id || roleFor(c.id) === 'owner');
  const adminCompanies = data.companies.filter((c) => canManage(c));
  const sharedCompanies = data.companies.filter((c) => !canManage(c));
  const ownedDevices = data.devices.filter((d) => d.owner_id === session.user.id);

  async function createCompany(e) {
    e.preventDefault();
    const name = companyName.trim();
    if (!name) return setMessage('Enter a company name.');
    const { data: company, error } = await supabase.from('companies').insert({ name, created_by: session.user.id }).select().single();
    if (error) return setMessage(error.message);
    await supabase.from('company_members').insert({ company_id: company.id, user_id: session.user.id, role: 'owner', accepted_at: new Date().toISOString() });
    setCompanyName('');
    setMessage('Company created. You are the company admin/owner.');
    data.refresh();
  }

  async function inviteUser(e) {
    e.preventDefault();
    if (!invite.companyId || !invite.email.trim()) return setMessage('Choose a company and enter an email.');
    const email = invite.email.trim().toLowerCase();
    const role = invite.role === 'admin' ? 'admin' : 'viewer';
    const { data: profile } = await supabase.from('profiles').select('id,email').eq('email', email).maybeSingle();
    if (profile) {
      const { error } = await supabase.from('company_members').upsert({
        company_id: invite.companyId,
        user_id: profile.id,
        role,
        invited_by: session.user.id,
        accepted_at: new Date().toISOString(),
      }, { onConflict: 'company_id,user_id' });
      if (!error) await supabase.from('company_invites').update({ accepted_at: new Date().toISOString() }).eq('company_id', invite.companyId).eq('email', email);
      setMessage(error ? error.message : `${email} added as ${role}.`);
    } else {
      const existingInvite = (data.companyInvites || []).find((row) => row.company_id === invite.companyId && row.email === email && !row.accepted_at);
      const { error } = existingInvite
        ? await supabase.from('company_invites').update({ role, invited_by: session.user.id }).eq('id', existingInvite.id)
        : await supabase.from('company_invites').insert({ company_id: invite.companyId, email, role, invited_by: session.user.id });
      setMessage(error ? error.message : `${email} saved as a pending ${role}. When that email signs up, they will automatically see this company and its devices.`);
    }
    setInvite((current) => ({ ...current, email: '' }));
    data.refresh();
  }

  async function updateMemberRole(member, role) {
    const { error } = await supabase.from('company_members').update({ role }).eq('id', member.id);
    setMessage(error ? error.message : 'Member role updated.');
    data.refresh();
  }

  async function removeMember(member) {
    if (member.user_id === session.user.id) return setMessage('You cannot remove yourself from a company here.');
    if (!window.confirm('Remove this user from the company?')) return;
    const { error } = await supabase.from('company_members').delete().eq('id', member.id);
    setMessage(error ? error.message : 'Member removed from company.');
    data.refresh();
  }

  async function updateInviteRole(inviteRow, role) {
    const safeRole = role === 'admin' ? 'admin' : 'viewer';
    const { error } = await supabase.from('company_invites').update({ role: safeRole }).eq('id', inviteRow.id);
    setMessage(error ? error.message : 'Pending email role updated.');
    data.refresh();
  }

  async function removeInvite(inviteRow) {
    if (!window.confirm(`Remove pending company access for ${inviteRow.email}?`)) return;
    const { error } = await supabase.from('company_invites').delete().eq('id', inviteRow.id);
    setMessage(error ? error.message : 'Pending email removed from company.');
    data.refresh();
  }

  async function attachDevice(e) {
    e.preventDefault();
    if (!deviceLink.companyId || !deviceLink.deviceId) return setMessage('Choose a company and a device.');
    const { error } = await supabase.from('company_devices').insert({ company_id: deviceLink.companyId, device_id: deviceLink.deviceId, added_by: session.user.id });
    setMessage(error ? error.message : 'Device added to company. Company members can now view it.');
    data.refresh();
  }

  async function removeCompanyDevice(companyDeviceId) {
    if (!window.confirm('Remove this device from this company? This does not delete the device or its data.')) return;
    const { error } = await supabase.from('company_devices').delete().eq('id', companyDeviceId);
    setMessage(error ? error.message : 'Device removed from company.');
    data.refresh();
  }

  function companyMembers(companyId) {
    return data.members.filter((m) => m.company_id === companyId);
  }

  function pendingCompanyInvites(companyId) {
    return (data.companyInvites || []).filter((inviteRow) => inviteRow.company_id === companyId && !inviteRow.accepted_at);
  }

  function companyDevices(companyId) {
    return data.companyDevices.filter((cd) => cd.company_id === companyId).map((cd) => ({
      ...cd,
      device: data.devices.find((d) => d.id === cd.device_id),
    }));
  }

  return (
    <AppShell session={session} title="Companies" data={data}>
      <section className="panel">
        <p className="eyebrow">Organizations</p>
        <h1>Companies and shared devices.</h1>
        <p className="muted">Companies you create show under Managed companies. Admins can add and delete users/devices and assign roles. Viewers can see company devices and data but cannot manage users or devices.</p>
        <form className="form-grid" onSubmit={createCompany}>
          <label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Customer company" /></label>
          <button className="primary-button">Create company</button>
        </form>
        {message && <div className="alert info">{message}</div>}
      </section>

      <section className="summary-grid company-summary-grid">
        <div className="summary-card"><span>Managed companies</span><strong>{adminCompanies.length}</strong></div>
        <div className="summary-card"><span>Created by you</span><strong>{ownedCompanies.length}</strong></div>
        <div className="summary-card"><span>Shared with you</span><strong>{sharedCompanies.length}</strong></div>
        <div className="summary-card"><span>Your own devices</span><strong>{ownedDevices.length}</strong></div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2>Add user/email to managed company</h2>
          <form className="form-stack" onSubmit={inviteUser}>
            <label>Company<select value={invite.companyId} onChange={(e) => setInvite({ ...invite, companyId: e.target.value })}>
              <option value="">Choose company</option>
              {adminCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
            <label>Email<input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="user@example.com" /></label><p className="muted small-note">You can add an email even before the person creates an account. It will stay pending in the company; once they sign up with that email, they automatically become a company user and can see shared devices.</p>
            <label>Role<select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="viewer">Viewer - can see devices/data</option>
              <option value="admin">Admin - can add users/devices</option>
            </select></label>
            <button className="secondary-button">Invite/add user</button>
          </form>
        </div>
        <div className="panel">
          <h2>Add your device to company</h2>
          <form className="form-stack" onSubmit={attachDevice}>
            <label>Company<select value={deviceLink.companyId} onChange={(e) => setDeviceLink({ ...deviceLink, companyId: e.target.value })}>
              <option value="">Choose company</option>
              {adminCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
            <label>Your devices<select value={deviceLink.deviceId} onChange={(e) => setDeviceLink({ ...deviceLink, deviceId: e.target.value })}>
              <option value="">Choose device</option>
              {ownedDevices.map((d) => <option key={d.id} value={d.id}>{d.nickname} · {d.serial_number}</option>)}
            </select></label>
            <button className="secondary-button">Add device</button>
          </form>
          <p className="muted small-note">Admins can add devices they personally own. Company members then see the shared device, readings, datalog, and alarm history.</p>
        </div>
      </section>

      <section className="section-head"><h2>Managed companies</h2><span>{adminCompanies.length}</span></section>
      <section className="company-list">
        {adminCompanies.length ? adminCompanies.map((c) => (
          <div className="panel company-card" key={c.id}>
            <div className="company-card-head"><div><h2>{c.name}</h2><p className="muted">Your role: {roleFor(c.id) || (c.created_by === session.user.id ? 'owner' : 'admin')}</p></div><span className="status-pill connected">Admin</span></div>
            <div className="company-section"><strong>Members</strong>{companyMembers(c.id).length ? companyMembers(c.id).map((m) => (
              <div className="member-row" key={m.id}>
                <div><span>{m.profiles?.email || m.user_id}</span><small>{m.role === 'admin' ? 'Admin: can add/delete users and devices' : m.role === 'owner' ? 'Owner: full company control' : 'Viewer: can view devices and data only'}</small></div>
                <select value={m.role} onChange={(e) => updateMemberRole(m, e.target.value)} disabled={m.user_id === session.user.id && m.role === 'owner'}>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
                <button className="danger-button slim" onClick={() => removeMember(m)} disabled={m.user_id === session.user.id}>Remove</button>
              </div>
            )) : <p className="muted">No members yet.</p>}</div>
            <div className="company-section"><strong>Pending email access</strong>{pendingCompanyInvites(c.id).length ? pendingCompanyInvites(c.id).map((pending) => (
              <div className="member-row pending-row" key={pending.id}>
                <div><span>{pending.email}</span><small>Pending account creation. This email will join automatically after signup.</small></div>
                <select value={pending.role} onChange={(e) => updateInviteRole(pending, e.target.value)}>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="danger-button slim" onClick={() => removeInvite(pending)}>Remove</button>
              </div>
            )) : <p className="muted">No pending email invites.</p>}</div>
            <div className="company-section"><strong>Devices</strong>{companyDevices(c.id).length ? companyDevices(c.id).map((cd) => (
              <div className="member-row" key={cd.id}>
                <div><span>{cd.device?.nickname || 'Unknown device'}</span><small>{cd.device?.serial_number || cd.device_id}</small></div>
                <button className="danger-button slim" onClick={() => removeCompanyDevice(cd.id)}>Remove from company</button>
              </div>
            )) : <p className="muted">No devices added yet.</p>}</div>
          </div>
        )) : <div className="empty-state"><h3>No managed companies yet</h3><p>Create a company or ask an admin to make you an admin.</p></div>}
      </section>

      <section className="section-head"><h2>Shared with me</h2><span>{sharedCompanies.length}</span></section>
      <section className="company-list">
        {sharedCompanies.length ? sharedCompanies.map((c) => (
          <div className="panel company-card" key={c.id}>
            <div className="company-card-head"><div><h2>{c.name}</h2><p className="muted">Your role: {roleFor(c.id) || 'viewer'}</p></div><span className="status-pill disconnected">Viewer</span></div>
            <p className="muted">Devices visible to you: {companyDevices(c.id).length}</p>
            <div className="chip-row">{companyDevices(c.id).map((cd) => cd.device ? <NavLink key={cd.id} to={`/devices/${cd.device.id}`}>{cd.device.nickname} · {cd.device.serial_number}</NavLink> : <span key={cd.id}>Unknown device</span>)}</div>
          </div>
        )) : <div className="empty-state"><h3>No shared companies</h3><p>Companies where you are only a viewer will appear here.</p></div>}
      </section>
    </AppShell>
  );
}

function IngestPage({ session, data }) {
  const [jsonText, setJsonText] = useState(JSON.stringify(samplePayload, null, 2));
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [liveNote, setLiveNote] = useState('');
  const latestJsonRef = useRef(jsonText);
  const liveTickRef = useRef(0);
  const liveAlarmRef = useRef({ mode: 'ok', age: 0 });

  useEffect(() => { latestJsonRef.current = jsonText; }, [jsonText]);

  function buildAlarmSample(type) {
    const base = (() => {
      try { return JSON.parse(latestJsonRef.current || '{}'); } catch { return samplePayload; }
    })();
    const alarmText = {
      high: 'PRESSURE R1 S1 HIGH ALARM 0.0068 inWC',
      low: 'PRESSURE R1 S1 LOW ALARM -0.0074 inWC',
      ok: 'PRESSURE R1 S1 OK ALARM -0.0002 inWC',
    }[type] || 'PRESSURE R1 S1 OK ALARM -0.0002 inWC';
    return {
      unique_id: String(base.unique_id || base.serial || base.serial_number || samplePayload.unique_id),
      ...(base.validation_code ? { validation_code: base.validation_code } : {}),
      JobNo: String(base.JobNo || samplePayload.JobNo || 'JOB-33300'),
      RoomNo: '1',
      TS: deviceTimestamp(),
      Event: alarmText,
      UpLim: '0.0050 inWC',
      LowLim: '-0.0050 inWC',
    };
  }

  function loadSample(type) {
    if (type === 'high' || type === 'low' || type === 'ok') {
      setJsonText(JSON.stringify(buildAlarmSample(type), null, 2));
      return;
    }
    const base = { ...samplePayload, TS: deviceTimestamp() };
    setJsonText(JSON.stringify(base, null, 2));
  }

  function pressureScenario(tick) {
    const state = liveAlarmRef.current;
    const normalValue = () => randomBetween(-0.0015, 0.0015, 4).toFixed(4);

    if (state.mode === 'high' || state.mode === 'low') {
      state.age += 1;
      if (state.age >= 2) {
        const room = state.room || 1;
        const value = normalValue();
        liveAlarmRef.current = { mode: 'ok', age: 0, room };
        return {
          label: `Room ${room} OK alarm`,
          room,
          state: 'ok',
          value,
          eventText: `PRESSURE R${room} S1 OK ALARM ${value} inWC`,
        };
      }

      const room = state.room || 1;
      if (state.mode === 'high') {
        const value = randomBetween(0.0061, 0.0095, 4).toFixed(4);
        return {
          label: `Room ${room} High alarm`,
          room,
          state: 'high',
          value,
          eventText: `PRESSURE R${room} S1 HIGH ALARM ${value} inWC`,
        };
      }

      const value = randomBetween(-0.0095, -0.0061, 4).toFixed(4);
      return {
        label: `Room ${room} Low alarm`,
        room,
        state: 'low',
        value,
        eventText: `PRESSURE R${room} S1 LOW ALARM ${value} inWC`,
      };
    }

    const shouldAlarm = tick > 1 && (tick % 7 === 0 || Math.random() < 0.1);
    if (shouldAlarm) {
      const mode = Math.random() < 0.5 ? 'high' : 'low';
      const room = Math.random() < 0.55 ? 1 : 2;
      liveAlarmRef.current = { mode, age: 0, room };
      if (mode === 'high') {
        const value = randomBetween(0.0061, 0.0095, 4).toFixed(4);
        return {
          label: `Room ${room} High alarm`,
          room,
          state: 'high',
          value,
          eventText: `PRESSURE R${room} S1 HIGH ALARM ${value} inWC`,
        };
      }
      const value = randomBetween(-0.0095, -0.0061, 4).toFixed(4);
      return {
        label: `Room ${room} Low alarm`,
        room,
        state: 'low',
        value,
        eventText: `PRESSURE R${room} S1 LOW ALARM ${value} inWC`,
      };
    }

    return {
      label: 'Interval / OK',
      room: null,
      state: 'ok',
      eventText: null,
    };
  }

  function buildLivePayload() {
    let base = samplePayload;
    try { base = JSON.parse(latestJsonRef.current || '{}'); } catch { base = samplePayload; }
    liveTickRef.current += 1;
    const tick = liveTickRef.current;
    const pressure = pressureScenario(tick);
    const serial = String(base.unique_id || base.serial || base.serial_number || samplePayload.unique_id);
    const jobNo = String(base.JobNo || samplePayload.JobNo || 'JOB-33300');
    const common = {
      unique_id: serial,
      ...(base.validation_code ? { validation_code: base.validation_code } : {}),
      JobNo: jobNo,
      TS: deviceTimestamp(),
    };

    // Real firmware alarm messages are single-sensor JSON messages with RoomNo/Event/UpLim/LowLim.
    if (pressure.eventText) {
      return {
        ...common,
        RoomNo: String(pressure.room || 1),
        Event: pressure.eventText,
        UpLim: '0.0050 inWC',
        LowLim: '-0.0050 inWC',
        _simulated_alarm_note: pressure.label,
      };
    }

    const p1Normal = randomBetween(-0.0024, 0.0022, 4).toFixed(4);
    const p2Normal = randomBetween(-0.0022, 0.0025, 4).toFixed(4);
    const temp1 = randomBetween(20.4, 22.6, 1).toFixed(1);
    const temp2 = randomBetween(20.9, 23.1, 1).toFixed(1);
    const humidity1 = randomBetween(39, 49, 1).toFixed(1);
    const humidity2 = randomBetween(40, 51, 1).toFixed(1);
    const particles1 = Math.round(randomBetween(28, 115, 0));
    const particles2 = Math.round(randomBetween(32, 130, 0));
    const ach1 = randomBetween(5.5, 7.4, 1).toFixed(1);
    const ach2 = randomBetween(4.8, 7.0, 1).toFixed(1);

    return {
      ...common,
      Count: '10',
      RoomNo1: '1',
      Event1: `PRESSURE R1 S1 INTERVAL ${p1Normal} inWC`,
      UpLim1: '0.0050 inWC',
      LowLim1: '-0.0050 inWC',
      RoomNo2: '1',
      Event2: `TEMPERATURE R1 S1 INTERVAL ${temp1} °C`,
      UpLim2: '26.0 °C',
      LowLim2: '18.0 °C',
      RoomNo3: '1',
      Event3: `HUMIDITY R1 S1 INTERVAL ${humidity1}%`,
      UpLim3: '60 %',
      LowLim3: '30 %',
      RoomNo4: '1',
      Event4: `PARTICLE R1 S1 INTERVAL ${particles1} ug/m3`,
      UpLim4: '250 ug/m3',
      LowLim4: '0 ug/m3',
      RoomNo5: '1',
      Event5: `ACH R1 S2 INTERVAL ${ach1}`,
      UpLim5: '12.0',
      LowLim5: '3.0',
      RoomNo6: '2',
      Event6: `PRESSURE R2 S2 INTERVAL ${p2Normal} inWC`,
      UpLim6: '0.0050 inWC',
      LowLim6: '-0.0050 inWC',
      RoomNo7: '2',
      Event7: `TEMPERATURE R2 S1 INTERVAL ${temp2} °C`,
      UpLim7: '26.0 °C',
      LowLim7: '18.0 °C',
      RoomNo8: '2',
      Event8: `HUMIDITY R2 S1 INTERVAL ${humidity2}%`,
      UpLim8: '60 %',
      LowLim8: '30 %',
      RoomNo9: '2',
      Event9: `PARTICLE R2 S2 INTERVAL ${particles2} ug/m3`,
      UpLim9: '250 ug/m3',
      LowLim9: '0 ug/m3',
      RoomNo10: '2',
      Event10: `ACH R2 S1 INTERVAL ${ach2}`,
      UpLim10: '12.0',
      LowLim10: '3.0',
      _simulated_alarm_note: pressure.label,
    };
  }

  async function postPayload(payload) {
    const bodyText = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const res = await fetch('/.netlify/functions/ingest-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: bodyText,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ingest failed');
    setResult(body);
    data.refresh();
    return body;
  }


  function currentPayloadSerial() {
    try {
      const payload = JSON.parse(jsonText || '{}');
      return String(payload.unique_id || payload.serial || payload.serial_number || '').trim();
    } catch {
      return '';
    }
  }

  async function verifyDeviceForTesting() {
    setError('');
    setResult(null);
    const serial = currentPayloadSerial();
    if (!serial) return setError('Enter a JSON payload with unique_id first.');
    const device = data.devices.find((item) => item.serial_number === serial);
    if (!device) return setError(`Serial ${serial} is not in your visible devices. Add it on the Devices page first.`);
    const { error: updateError } = await supabase.from('devices').update({ verified_at: new Date().toISOString() }).eq('id', device.id);
    if (updateError) return setError(updateError.message);
    setResult({ ok: true, serial, deviceStatus: 'verified', readingCount: 0, testVerified: true });
    data.refresh();
  }

  async function ingest(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    try {
      await postPayload(jsonText);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!liveRunning) return undefined;
    let stopped = false;

    async function sendLive() {
      if (stopped) return;
      setError('');
      const payload = buildLivePayload();
      setJsonText(JSON.stringify(payload, null, 2));
      try {
        const body = await postPayload(payload);
        setLiveCount((count) => count + 1);
        setLiveNote(`Last live sample sent at ${new Date().toLocaleTimeString()} for serial ${body.serial}. Scenario: ${payload._simulated_alarm_note || 'Interval / OK'}.`);
      } catch (err) {
        setError(err.message);
        setLiveRunning(false);
      }
    }

    sendLive();
    const timer = window.setInterval(sendLive, 60000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [liveRunning, secret]);

  return (
    <AppShell session={session} title="Live Ingest" data={data}>
      <section className="hero-card compact-hero">
        <div>
          <p className="eyebrow">Real endpoint tester</p>
          <h1>Send device JSON to Supabase.</h1>
          <p className="muted">This posts to the Netlify Function at <strong>/.netlify/functions/ingest-device</strong>. Real devices can post to the same URL.</p>
        </div>
      </section>

      <section className="panel live-simulator-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Simulator</p>
            <h2>Believable live data</h2>
          </div>
          <StatusPill status={liveRunning ? 'connected' : 'ok'} />
        </div>
        <p className="muted">Start this while the page is open to send believable pressure, temperature, humidity, particle, and ACH readings once every minute. Most samples are normal INTERVAL data, but the simulator will occasionally send <strong>HIGH ALARM</strong> or <strong>LOW ALARM</strong>, then send <strong>OK ALARM</strong> after the pressure returns to range.</p>
        <div className="quick-buttons">
          <button className={liveRunning ? 'danger-button' : 'primary-button'} type="button" onClick={() => setLiveRunning((running) => !running)}>
            {liveRunning ? 'Stop live data' : 'Start live data'}
          </button>
          <span className="live-count">Sent {liveCount} live sample{liveCount === 1 ? '' : 's'}</span>
        </div>
        {liveNote && <div className="alert info">{liveNote}</div>}
      </section>

      <section className="panel">
        <div className="quick-buttons">
          <button className="secondary-button" type="button" onClick={() => loadSample('interval')}>Interval sample</button>
          <button className="secondary-button" type="button" onClick={() => loadSample('high')}>High alarm sample</button>
          <button className="secondary-button" type="button" onClick={() => loadSample('low')}>Low alarm sample</button>
          <button className="secondary-button" type="button" onClick={() => loadSample('ok')}>OK alarm sample</button>
          <button className="primary-button" type="button" onClick={verifyDeviceForTesting}>Verify device for testing</button>
        </div>
        <p className="muted small-note">Verify Device only lives on this Ingest page for internal testing. Later this page can be hidden from normal users.</p>
        <form onSubmit={ingest} className="form-stack">
          <label>Ingest secret<input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="DEVICE_INGEST_SECRET" /></label>
          <label>Device JSON<textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows="16" /></label>
          <button className="primary-button">Post to live ingest endpoint</button>
        </form>
        {error && <div className="alert danger">{error}</div>}
        {result && <div className="alert info">{result.testVerified ? `Verified test device ${result.serial}.` : `Ingested ${result.readingCount} reading(s) for serial ${result.serial}. Device status: ${result.deviceStatus}`}</div>}
      </section>

      <section className="panel">
        <div className="section-head"><h2>Notification log</h2><span>{data.logs.length}</span></div>
        <div className="table-scroll"><table><thead><tr><th>Time</th><th>Channel</th><th>State</th><th>Status</th><th>Recipients</th></tr></thead><tbody>{data.logs.map((n) => <tr key={n.id}><td>{new Date(n.created_at).toLocaleString()}</td><td>{n.channel}</td><td>{n.alarm_state}</td><td>{n.status}</td><td>{(n.recipients || []).join(', ') || '—'}</td></tr>)}</tbody></table></div>
      </section>
    </AppShell>
  );
}

function SettingsPage({ session, data, themeMode, setThemeMode, resolvedTheme }) {
  return (
    <AppShell session={session} title="Settings" data={data}>
      <section className="panel">
        <p className="eyebrow">Appearance</p>
        <h1>Choose your display mode.</h1>
        <p className="muted">Dark mode uses Abatement black with blue accents. System follows this device automatically.</p>
        <ThemeSelector themeMode={themeMode} setThemeMode={setThemeMode} />
        <div className="alert info">Current active theme: <strong>{resolvedTheme === 'dark' ? 'Dark' : 'Light'}</strong>.</div>
      </section>
      <section className="panel">
        <p className="eyebrow">Cloud setup</p>
        <h1>Abatement Link v2.10</h1>
        <p>This build uses Supabase Auth, Supabase Postgres, Supabase Realtime, and a Netlify Function for device JSON ingest.</p>
        <div className="alert info">SMS is intentionally not functional yet. The database/UI is ready for the future Plivo integration. Support uses the Freshdesk link and MonSuite opens at monsuite.netlify.app by default.</div>
      </section>
      <section className="panel">
        <h2>Required setup</h2>
        <ol className="roadmap">
          <li>Run <code>database/abatement-link-supabase-schema.sql</code> in Supabase SQL Editor.</li>
          <li>Add Netlify env vars from <code>.env.example</code>.</li>
          <li>Enable email/password auth in Supabase.</li>
          <li>Deploy and test with the Ingest page.</li>
        </ol>
      </section>
      <section className="panel">
        <h2>Browser reset</h2>
        <p className="muted">Use this if a previous PWA/service-worker version or stuck Supabase session keeps sending this browser to a blank or bad page.</p>
        <button className="secondary-button" type="button" onClick={() => window.clearAbatementLinkBrowserState?.()}>Clear browser data and reload</button>
      </section>
    </AppShell>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeModeState] = useState(() => localStorage.getItem('abatement-link-theme') || 'system');
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(themeMode));

  const setThemeMode = useCallback((mode) => {
    const next = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
    localStorage.setItem('abatement-link-theme', next);
    setThemeModeState(next);
  }, []);

  useEffect(() => {
    const apply = () => {
      const nextTheme = resolveTheme(themeMode);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.dataset.themeMode = themeMode;
      setResolvedTheme(nextTheme);
    };
    apply();
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [themeMode]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => { setSession(currentSession); setLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const data = useCloudData(session);

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (loading) return <main className="login-screen"><section className="login-card"><BrandWordmark className="login-logo" variant="tagline" /><h1>Loading…</h1></section></main>;

  return <Routes><Route path="/login" element={<AuthPage session={session} />} /><Route path="/" element={<Protected session={session}><DashboardPage session={session} data={data} /></Protected>} /><Route path="/devices" element={<Protected session={session}><DevicesPage session={session} data={data} /></Protected>} /><Route path="/devices/:deviceId" element={<Protected session={session}><DevicePage session={session} data={data} /></Protected>} /><Route path="/devices/:deviceId/notifications" element={<Protected session={session}><NotificationsPage session={session} data={data} /></Protected>} /><Route path="/projects" element={<Protected session={session}><ProjectsPage session={session} data={data} /></Protected>} /><Route path="/projects/:projectId" element={<Protected session={session}><ProjectPage session={session} data={data} /></Protected>} /><Route path="/companies" element={<Protected session={session}><CompaniesPage session={session} data={data} /></Protected>} /><Route path="/ingest" element={<Protected session={session}><IngestPage session={session} data={data} /></Protected>} /><Route path="/settings" element={<Protected session={session}><SettingsPage session={session} data={data} themeMode={themeMode} setThemeMode={setThemeMode} resolvedTheme={resolvedTheme} /></Protected>} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
