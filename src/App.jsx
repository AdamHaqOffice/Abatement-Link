import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient.js';
import { connectionStatus, metricIcon, metricLabel } from './utils/parseDevicePayload.js';

const metrics = ['pressure', 'temperature', 'humidity', 'particles', 'ach', 'velocity'];
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

function StatusPill({ status }) {
  return <span className={`status-pill ${status || 'unknown'}`}>{String(status || 'unknown').replace('_', ' ')}</span>;
}

function AppShell({ session, title, children }) {
  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <img src="/abatement-link-mark.svg" alt="Abatement Link" />
          <div>
            <strong>{title || 'Abatement Link'}</strong>
            <small>{session?.user?.email}</small>
          </div>
        </div>
        <button className="ghost-button" onClick={logout}>Sign out</button>
      </header>
      <main className="content">{children}</main>
      <nav className="bottom-nav" aria-label="Main navigation">
        <NavLink to="/">Home</NavLink>
        <NavLink to="/devices">Devices</NavLink>
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
        <img className="login-logo" src="/abatement-link-mark.svg" alt="Abatement Link" />
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
        <img className="login-logo" src="/abatement-link-mark.svg" alt="Abatement Link" />
        <p className="eyebrow">{mode === 'signup' ? 'Create account' : 'Welcome back'}</p>
        <h1>{mode === 'signup' ? 'Sign up with email.' : 'Sign in to live devices.'}</h1>
        <p className="muted">Email and password only. No SSO, no Google login.</p>
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
  const [state, setState] = useState({ devices: [], readings: [], alarms: [], companies: [], members: [], companyDevices: [], notifications: [], logs: [], loading: true });

  const refresh = useCallback(async () => {
    if (!session) return;
    const [devices, readings, alarms, companies, members, companyDevices, notifications, logs] = await Promise.all([
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      supabase.from('device_readings').select('*').order('device_ts', { ascending: false }).limit(400),
      supabase.from('alarm_events').select('*').order('started_at', { ascending: false }).limit(200),
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('company_members').select('*, profiles(email, name)').order('created_at', { ascending: false }),
      supabase.from('company_devices').select('*'),
      supabase.from('notification_rules').select('*'),
      supabase.from('notification_logs').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    setState({
      devices: devices.data || [],
      readings: readings.data || [],
      alarms: alarms.data || [],
      companies: companies.data || [],
      members: members.data || [],
      companyDevices: companyDevices.data || [],
      notifications: notifications.data || [],
      logs: logs.data || [],
      loading: false,
      errors: [devices.error, readings.error, alarms.error, companies.error].filter(Boolean),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_devices' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_logs' }, refresh)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, refresh]);

  return { ...state, refresh };
}

function DashboardPage({ session, data }) {
  const activeAlarms = data.alarms.filter((a) => !a.resolved_at);
  const connected = data.devices.filter((d) => connectionStatus(d) === 'connected');
  return (
    <AppShell session={session} title="Live Dashboard">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Abatement Link Cloud</p>
          <h1>Live device data, alarms, and customers.</h1>
          <p className="muted">Database-backed v2: devices update from Supabase when JSON lands in the ingest endpoint.</p>
        </div>
        <NavLink className="primary-button" to="/devices">Add device</NavLink>
      </section>
      {data.errors?.length > 0 && <div className="alert danger">Database query issue: {data.errors.map((e) => e.message).join(' | ')}</div>}
      <section className="summary-grid">
        <div className="summary-card"><span>Devices</span><strong>{data.devices.length}</strong></div>
        <div className="summary-card"><span>Connected</span><strong>{connected.length}</strong></div>
        <div className="summary-card"><span>Active alarms</span><strong>{activeAlarms.length}</strong></div>
        <div className="summary-card"><span>Companies</span><strong>{data.companies.length}</strong></div>
      </section>
      <section className="section-head"><h2>Recent devices</h2><span>{data.loading ? 'Loading…' : `${data.devices.length} total`}</span></section>
      <section className="device-grid">
        {data.devices.length ? data.devices.slice(0, 8).map((device) => <DeviceCard key={device.id} device={device} readings={data.readings} alarms={data.alarms} />) : <div className="empty-state"><h3>No devices yet</h3><p>Add a serial number to begin.</p></div>}
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
      <div className="device-card-head"><div><strong>{device.nickname || device.serial_number}</strong><small>{device.model || 'Monitor'} · {device.serial_number}</small></div><StatusPill status={status} /></div>
      <div className="device-meta"><span>Job {device.last_job_no || '—'}</span><span>Last seen {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</span></div>
      <div className="metric-strip">
        {metrics.slice(0, 4).map((m) => <div className="metric-mini" key={m}><span>{metricIcon(m)}</span><strong>{latest[m]?.value ?? '—'}</strong><small>{metricLabel(m)}</small></div>)}
      </div>
      <small className="muted">{readings.filter((r) => r.device_id === device.id).length} readings · {alarms.filter((a) => a.device_id === device.id).length} alarms</small>
    </NavLink>
  );
}

function DevicesPage({ session, data }) {
  const [form, setForm] = useState({ serial: '', nickname: '', model: 'PPM4' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function addDevice(e) {
    e.preventDefault();
    setMessage(''); setError('');
    const serial = form.serial.trim();
    if (!serial) return setError('Serial number is required.');
    const validationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const { error: insertError } = await supabase.from('devices').insert({
      owner_id: session.user.id,
      serial_number: serial,
      nickname: form.nickname.trim() || `${form.model} ${serial}`,
      model: form.model,
      validation_code: validationCode,
    });
    if (insertError) return setError(insertError.message);
    setForm({ serial: '', nickname: '', model: 'PPM4' });
    setMessage('Device added as Not Verified. Open it to view the validation code and instructions.');
    data.refresh();
  }

  return (
    <AppShell session={session} title="Devices">
      <section className="panel">
        <div className="section-head"><div><p className="eyebrow">Claim monitor</p><h1>Add a device</h1></div></div>
        <form className="form-grid" onSubmit={addDevice}>
          <label>Serial number<input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} placeholder="14374082" /></label>
          <label>Device name<input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="Room 204 PPM4" /></label>
          <label>Model<select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}><option>PPM4</option><option>RPM</option><option>Other</option></select></label>
          <button className="primary-button">Add as Not Verified</button>
        </form>
        {message && <div className="alert info">{message}</div>}
        {error && <div className="alert danger">{error}</div>}
      </section>
      <section className="section-head"><h2>Your devices</h2><span>{data.devices.length} total</span></section>
      <section className="device-grid">
        {data.devices.length ? data.devices.map((device) => <DeviceCard key={device.id} device={device} readings={data.readings} alarms={data.alarms} />) : <div className="empty-state"><h3>No devices yet</h3><p>Add a serial number above.</p></div>}
      </section>
    </AppShell>
  );
}

function DevicePage({ session, data }) {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const device = data.devices.find((d) => d.id === deviceId);
  const [error, setError] = useState('');
  if (!device) return <AppShell session={session}><div className="empty-state">Device not found or not shared with you.</div></AppShell>;
  const readings = data.readings.filter((r) => r.device_id === device.id).sort((a, b) => new Date(b.device_ts) - new Date(a.device_ts));
  const alarms = data.alarms.filter((a) => a.device_id === device.id).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const latest = device.latest_metrics || {};
  const activeAlarm = alarms.find((a) => !a.resolved_at);
  const status = activeAlarm ? activeAlarm.alarm_state : connectionStatus(device);

  async function markValidated() {
    setError('');
    const { error: updateError } = await supabase.from('devices').update({ verified_at: new Date().toISOString() }).eq('id', device.id);
    if (updateError) setError(updateError.message); else data.refresh();
  }

  async function deleteDevice() {
    if (!window.confirm('Delete this device and permanently remove its datalog, alarm history, notification settings, and company links?')) return;
    const { error: deleteError } = await supabase.from('devices').delete().eq('id', device.id);
    if (deleteError) return setError(deleteError.message);
    navigate('/devices');
  }

  return (
    <AppShell session={session} title={device.nickname || device.serial_number}>
      <section className="device-hero">
        <div><p className="eyebrow">{device.model} · Serial {device.serial_number}</p><h1>{device.nickname || device.serial_number}</h1><div className="inline-actions"><StatusPill status={status} /><span>Validation code: {device.validation_code}</span></div></div>
        <NavLink className="secondary-button" to={`/devices/${device.id}/notifications`}>Notifications</NavLink>
      </section>
      {error && <div className="alert danger">{error}</div>}
      {!device.verified_at && <section className="panel warning-panel"><h2>Device is Not Verified</h2><p>Tell the customer to enter validation code <strong>{device.validation_code}</strong> on the physical device. The Netlify ingest endpoint will mark it verified when it receives a matching validation_code field. For testing, use the button below.</p><button className="primary-button" onClick={markValidated}>Mark validated for testing</button></section>}
      <section className="metric-grid large">
        {metrics.map((metric) => <div className="metric-tile" key={metric}><span>{metricIcon(metric)}</span><strong>{latest[metric]?.value ?? '—'}</strong><small>{metricLabel(metric)}</small>{latest[metric]?.timestamp && <em>{new Date(latest[metric].timestamp).toLocaleString()}</em>}</div>)}
      </section>
      <section className="two-col">
        <div className="panel"><div className="section-head"><h2>Datalog</h2><span>{readings.length}</span></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Metric</th><th>Value</th><th>Limits</th><th>Event</th></tr></thead><tbody>{readings.slice(0, 100).map((r) => <tr key={r.id}><td>{new Date(r.device_ts).toLocaleString()}</td><td>{metricLabel(r.metric)} R{r.room_no}S{r.sensor_no}</td><td>{r.value ?? '—'}</td><td>{r.lower_limit ?? '—'} / {r.upper_limit ?? '—'}</td><td><StatusPill status={r.alarm_state} /> {r.event_text}</td></tr>)}</tbody></table></div></div>
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
  if (!device) return <AppShell session={session}><div className="empty-state">Device not found.</div></AppShell>;

  function toggle(key) { setRule((r) => ({ ...r, [key]: !r[key] })); }
  function addEmail() { if (newEmail.trim()) { setRule((r) => ({ ...r, extra_emails: [...(r.extra_emails || []), newEmail.trim()] })); setNewEmail(''); } }
  async function save() {
    const payload = { ...rule, device_id: deviceId, user_id: session.user.id, sms_high: false, sms_low: false, sms_ok: false };
    const { error } = await supabase.from('notification_rules').upsert(payload, { onConflict: 'device_id,user_id' });
    setMessage(error ? error.message : 'Notification settings saved. SMS stays disabled until Plivo is added.');
    data.refresh();
  }
  async function askPush() { if ('Notification' in window) await Notification.requestPermission(); }

  const channel = (name, keys, disabled = false) => <div className={`panel channel-card ${name.toLowerCase()}`}><h2>{name}{disabled && ' - coming soon'}</h2><div className="toggle-grid">{keys.map(([label, key]) => <button key={key} disabled={disabled} className={`toggle-card ${rule[key] ? 'on' : ''}`} onClick={() => !disabled && toggle(key)}><strong>{label}</strong><small>{rule[key] ? 'On' : 'Off'}</small></button>)}</div></div>;
  return <AppShell session={session} title="Notifications"><section className="hero-card compact-hero"><div><p className="eyebrow">{device.nickname}</p><h1>Sign up for notifications.</h1><p className="muted">The flow pushes users toward push first, then email. SMS is visible but disabled for the future Plivo integration.</p></div><button className="secondary-button" onClick={askPush}>Enable browser push</button></section>{channel('Push - recommended', [['High alarm', 'push_high'], ['Low alarm', 'push_low'], ['Return to OK', 'push_ok']])}{channel('Email', [['High alarm', 'email_high'], ['Low alarm', 'email_low'], ['Return to OK', 'email_ok']])}<section className="panel"><h2>Extra email recipients</h2><div className="recipient-box"><input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="tech@example.com" /><button className="secondary-button" onClick={addEmail}>Add</button><div className="recipient-list">{(rule.extra_emails || []).map((email) => <span key={email}>{email}</span>)}</div></div></section>{channel('SMS', [['High alarm', 'sms_high'], ['Low alarm', 'sms_low'], ['Return to OK', 'sms_ok']], true)}{message && <div className="alert info">{message}</div>}<button className="primary-button sticky-save" onClick={save}>Save notification settings</button></AppShell>;
}

function CompaniesPage({ session, data }) {
  const [companyName, setCompanyName] = useState('');
  const [invite, setInvite] = useState({ companyId: '', email: '' });
  const [deviceLink, setDeviceLink] = useState({ companyId: '', deviceId: '' });
  const [message, setMessage] = useState('');

  async function createCompany(e) {
    e.preventDefault();
    const { data: company, error } = await supabase.from('companies').insert({ name: companyName, created_by: session.user.id }).select().single();
    if (error) return setMessage(error.message);
    await supabase.from('company_members').insert({ company_id: company.id, user_id: session.user.id, role: 'owner', accepted_at: new Date().toISOString() });
    setCompanyName(''); setMessage('Company created.'); data.refresh();
  }
  async function inviteUser(e) {
    e.preventDefault();
    const { data: profile } = await supabase.from('profiles').select('id,email').eq('email', invite.email.trim().toLowerCase()).maybeSingle();
    if (profile) {
      const { error } = await supabase.from('company_members').insert({ company_id: invite.companyId, user_id: profile.id, role: 'viewer', invited_by: session.user.id, accepted_at: new Date().toISOString() });
      setMessage(error ? error.message : 'Existing user added to company.');
    } else {
      const { error } = await supabase.from('company_invites').insert({ company_id: invite.companyId, email: invite.email.trim().toLowerCase(), role: 'viewer', invited_by: session.user.id });
      setMessage(error ? error.message : 'Invite saved. When that user signs up, they can be added/accepted later.');
    }
    data.refresh();
  }
  async function attachDevice(e) {
    e.preventDefault();
    const { error } = await supabase.from('company_devices').insert({ company_id: deviceLink.companyId, device_id: deviceLink.deviceId, added_by: session.user.id });
    setMessage(error ? error.message : 'Device added to company.'); data.refresh();
  }

  return <AppShell session={session} title="Companies"><section className="panel"><p className="eyebrow">Organizations</p><h1>Companies and shared devices.</h1><form className="form-grid" onSubmit={createCompany}><label>Company name<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Customer company" /></label><button className="primary-button">Create company</button></form>{message && <div className="alert info">{message}</div>}</section><section className="two-col"><div className="panel"><h2>Add user to company</h2><form className="form-stack" onSubmit={inviteUser}><label>Company<select value={invite.companyId} onChange={(e) => setInvite({ ...invite, companyId: e.target.value })}><option value="">Choose company</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Email<input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="user@example.com" /></label><button className="secondary-button">Invite/add user</button></form></div><div className="panel"><h2>Add device to company</h2><form className="form-stack" onSubmit={attachDevice}><label>Company<select value={deviceLink.companyId} onChange={(e) => setDeviceLink({ ...deviceLink, companyId: e.target.value })}><option value="">Choose company</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Device<select value={deviceLink.deviceId} onChange={(e) => setDeviceLink({ ...deviceLink, deviceId: e.target.value })}><option value="">Choose device</option>{data.devices.map((d) => <option key={d.id} value={d.id}>{d.nickname} · {d.serial_number}</option>)}</select></label><button className="secondary-button">Add device</button></form></div></section><section className="company-list">{data.companies.map((c) => <div className="panel company-card" key={c.id}><h2>{c.name}</h2><p className="muted">Members: {data.members.filter((m) => m.company_id === c.id).map((m) => m.profiles?.email || m.user_id).join(', ') || '—'}</p><p className="muted">Devices: {data.companyDevices.filter((cd) => cd.company_id === c.id).length}</p></div>)}</section></AppShell>;
}

function IngestPage({ session, data }) {
  const [jsonText, setJsonText] = useState(JSON.stringify(samplePayload, null, 2));
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  function loadSample(type) {
    const base = { ...samplePayload, TS: new Date().toLocaleString('en-US', { year: '2-digit', month: '2-digit', day: '2-digit', hour12: false }).replace(',', '') };
    if (type === 'high') base.Event1 = 'PRESSURE R1S1 HIGH -4.200 ALARM';
    if (type === 'low') base.Event1 = 'PRESSURE R1S1 LOW -28.200 ALARM';
    if (type === 'ok') base.Event1 = 'PRESSURE R1S1 OK -13.860 NORMAL';
    setJsonText(JSON.stringify(base, null, 2));
  }
  async function ingest(e) {
    e.preventDefault(); setError(''); setResult(null);
    try {
      const res = await fetch('/.netlify/functions/ingest-device', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret }, body: jsonText });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Ingest failed');
      setResult(body); data.refresh();
    } catch (err) { setError(err.message); }
  }
  return <AppShell session={session} title="Live Ingest"><section className="hero-card compact-hero"><div><p className="eyebrow">Real endpoint tester</p><h1>Send device JSON to Supabase.</h1><p className="muted">This posts to the Netlify Function at <strong>/.netlify/functions/ingest-device</strong>. Real devices can post to the same URL.</p></div></section><section className="panel"><div className="quick-buttons"><button className="secondary-button" onClick={() => loadSample('ok')}>OK sample</button><button className="secondary-button" onClick={() => loadSample('high')}>High alarm sample</button><button className="secondary-button" onClick={() => loadSample('low')}>Low alarm sample</button></div><form onSubmit={ingest} className="form-stack"><label>Ingest secret<input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="DEVICE_INGEST_SECRET" /></label><label>Device JSON<textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows="14" /></label><button className="primary-button">Post to live ingest endpoint</button></form>{error && <div className="alert danger">{error}</div>}{result && <div className="alert info">Ingested {result.readingCount} reading(s) for serial {result.serial}. Device status: {result.deviceStatus}</div>}</section><section className="panel"><div className="section-head"><h2>Notification log</h2><span>{data.logs.length}</span></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Channel</th><th>State</th><th>Status</th><th>Recipients</th></tr></thead><tbody>{data.logs.map((n) => <tr key={n.id}><td>{new Date(n.created_at).toLocaleString()}</td><td>{n.channel}</td><td>{n.alarm_state}</td><td>{n.status}</td><td>{(n.recipients || []).join(', ') || '—'}</td></tr>)}</tbody></table></div></section></AppShell>;
}

function SettingsPage({ session }) {
  return <AppShell session={session} title="Settings"><section className="panel"><p className="eyebrow">Cloud setup</p><h1>Abatement Link v2.2</h1><p>This build uses Supabase Auth, Supabase Postgres, Supabase Realtime, and a Netlify Function for device JSON ingest.</p><div className="alert info">SMS is intentionally not functional yet. The database/UI is ready for the future Plivo integration.</div></section><section className="panel"><h2>Required setup</h2><ol className="roadmap"><li>Run <code>database/abatement-link-supabase-schema.sql</code> in Supabase SQL Editor.</li><li>Add Netlify env vars from <code>.env.example</code>.</li><li>Enable email/password auth in Supabase.</li><li>Deploy and test with the Ingest page.</li></ol></section><section className="panel"><h2>Browser reset</h2><p className="muted">Use this if a previous PWA/service-worker version or stuck Supabase session keeps sending this browser to a blank or bad page.</p><button className="secondary-button" type="button" onClick={() => window.clearAbatementLinkBrowserState?.()}>Clear browser data and reload</button></section></AppShell>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => { setSession(currentSession); setLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const data = useCloudData(session);

  if (!isSupabaseConfigured) return <ConfigMissing />;
  if (loading) return <main className="login-screen"><section className="login-card"><img className="login-logo" src="/abatement-link-mark.svg" alt="Abatement Link" /><h1>Loading…</h1></section></main>;

  return <Routes><Route path="/login" element={<AuthPage session={session} />} /><Route path="/" element={<Protected session={session}><DashboardPage session={session} data={data} /></Protected>} /><Route path="/devices" element={<Protected session={session}><DevicesPage session={session} data={data} /></Protected>} /><Route path="/devices/:deviceId" element={<Protected session={session}><DevicePage session={session} data={data} /></Protected>} /><Route path="/devices/:deviceId/notifications" element={<Protected session={session}><NotificationsPage session={session} data={data} /></Protected>} /><Route path="/companies" element={<Protected session={session}><CompaniesPage session={session} data={data} /></Protected>} /><Route path="/ingest" element={<Protected session={session}><IngestPage session={session} data={data} /></Protected>} /><Route path="/settings" element={<Protected session={session}><SettingsPage session={session} /></Protected>} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
