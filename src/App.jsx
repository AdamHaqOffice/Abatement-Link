import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DevicesPage from './pages/DevicesPage.jsx';
import DevicePage from './pages/DevicePage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import CompaniesPage from './pages/CompaniesPage.jsx';
import IngestPage from './pages/IngestPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { loadDb, saveDb, cleanEmail, uid, nowIso } from './utils/storage.js';

export const AppContext = null;

function useDatabase() {
  const [db, setDb] = useState(loadDb);

  useEffect(() => {
    const sync = () => setDb(loadDb());
    window.addEventListener('abatement-link-db-change', sync);
    return () => window.removeEventListener('abatement-link-db-change', sync);
  }, []);

  function update(mutator) {
    const next = structuredClone(loadDb());
    mutator(next);
    saveDb(next);
    setDb(next);
  }

  return [db, update, setDb];
}

function Protected({ user, children }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.verifiedAt) return <Navigate to="/verify" replace />;
  return children;
}

export default function App() {
  const [db, update] = useDatabase();
  const user = useMemo(() => db.users.find((u) => u.id === db.currentUserId) || null, [db]);

  const actions = {
    signup({ email, password, name }) {
      const normalized = cleanEmail(email);
      if (!normalized || !password) throw new Error('Email and password are required.');
      if (db.users.some((u) => u.email === normalized)) throw new Error('An account already exists for that email.');
      update((next) => {
        const userId = uid('usr');
        next.users.push({
          id: userId,
          email: normalized,
          password,
          name: name || normalized.split('@')[0],
          verificationCode: '123456',
          verifiedAt: null,
          createdAt: nowIso(),
        });
        next.currentUserId = userId;
      });
    },
    login({ email, password }) {
      const normalized = cleanEmail(email);
      const found = db.users.find((u) => u.email === normalized && u.password === password);
      if (!found) throw new Error('Email or password did not match.');
      update((next) => { next.currentUserId = found.id; });
    },
    logout() {
      update((next) => { next.currentUserId = null; });
    },
    verifyEmail(code) {
      if (!user) return;
      if (String(code).trim() !== String(user.verificationCode)) throw new Error('Verification code did not match. Demo code is 123456.');
      update((next) => {
        const current = next.users.find((u) => u.id === user.id);
        current.verifiedAt = nowIso();
      });
    },
  };

  const sharedProps = { db, user, update, actions };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage user={user} actions={actions} />} />
      <Route path="/verify" element={<LoginPage user={user} actions={actions} verifyOnly />} />
      <Route path="/" element={<Protected user={user}><DashboardPage {...sharedProps} /></Protected>} />
      <Route path="/devices" element={<Protected user={user}><DevicesPage {...sharedProps} /></Protected>} />
      <Route path="/devices/:deviceId" element={<Protected user={user}><DevicePage {...sharedProps} /></Protected>} />
      <Route path="/devices/:deviceId/notifications" element={<Protected user={user}><NotificationsPage {...sharedProps} /></Protected>} />
      <Route path="/companies" element={<Protected user={user}><CompaniesPage {...sharedProps} /></Protected>} />
      <Route path="/ingest" element={<Protected user={user}><IngestPage {...sharedProps} /></Protected>} />
      <Route path="/settings" element={<Protected user={user}><SettingsPage {...sharedProps} /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
