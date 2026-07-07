import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import './styles.css';

async function clearBrowserState(reason = 'manual') {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    localStorage.removeItem('sb-' + (import.meta.env.VITE_SUPABASE_URL || 'abatement-link') + '-auth-token');
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') || key.includes('supabase') || key.includes('abatement-link')) localStorage.removeItem(key);
    });
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith('sb-') || key.includes('supabase') || key.includes('abatement-link')) sessionStorage.removeItem(key);
    });
    console.info('Abatement Link browser state cleared:', reason);
  } catch (error) {
    console.warn('Browser state cleanup skipped:', error);
  }
}

window.clearAbatementLinkBrowserState = async function clearAndReload() {
  await clearBrowserState('button');
  window.location.href = '/';
};

if (new URLSearchParams(window.location.search).has('reset')) {
  clearBrowserState('reset-query').finally(() => {
    window.history.replaceState({}, '', '/');
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// v2.11 keeps service workers available because real phone push notifications
// require /push-sw.js. The manual ?reset=1 flow still clears old workers/caches.
