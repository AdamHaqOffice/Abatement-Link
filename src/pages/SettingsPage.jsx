import { useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import { resetDb, saveDb } from '../utils/storage.js';

export default function SettingsPage({ db, user, actions }) {
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState('');

  function exportDb() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'abatement-link-demo-data.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importDb() {
    try {
      const parsed = JSON.parse(importText);
      saveDb(parsed);
      setMessage('Demo data imported.');
    } catch (err) {
      setMessage(`Import failed: ${err.message}`);
    }
  }

  function reset() {
    if (!window.confirm('Reset all local demo data?')) return;
    resetDb();
    window.location.href = '/login';
  }

  return (
    <AppShell user={user} actions={actions} title="More">
      <section className="panel">
        <p className="eyebrow">Prototype status</p>
        <h1>Abatement Link v1</h1>
        <p>This first version is a mobile-first PWA prototype using local browser storage. It proves the user flow, device states, data parsing, datalog, alarms, notification preferences, companies, and delete behavior before connecting Supabase and real device ingestion.</p>
      </section>

      <section className="two-col">
        <div className="panel"><h2>Data tools</h2><p>Export or reset the local prototype database.</p><div className="inline-actions"><button className="secondary-button" onClick={exportDb}>Export demo data</button><button className="danger-button" onClick={reset}>Reset local data</button></div>{message && <div className="alert info">{message}</div>}</div>
        <div className="panel"><h2>Import demo data</h2><label>Paste exported JSON<textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows="8" /></label><button className="secondary-button" onClick={importDb}>Import</button></div>
      </section>

      <section className="panel">
        <h2>Next backend step</h2>
        <ol className="roadmap">
          <li>Replace localStorage with Supabase tables.</li>
          <li>Add Supabase email/password auth with email verification.</li>
          <li>Create a real /api/ingest endpoint for device JSON.</li>
          <li>Send email notifications from backend rules.</li>
          <li>Add Plivo SMS later using the existing rule structure.</li>
        </ol>
      </section>
    </AppShell>
  );
}
