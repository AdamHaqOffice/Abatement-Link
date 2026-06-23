import { useState } from 'react';
import { Navigate } from 'react-router-dom';

export default function LoginPage({ user, actions, verifyOnly = false }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', code: '123456' });
  const [error, setError] = useState('');

  if (user?.verifiedAt) return <Navigate to="/" replace />;

  function submit(e) {
    e.preventDefault();
    setError('');
    try {
      if (verifyOnly || user) actions.verifyEmail(form.code);
      else if (mode === 'signup') actions.signup(form);
      else actions.login(form);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <img className="login-logo" src="/abatement-link-mark.svg" alt="Abatement Link" />
        <p className="eyebrow">Mobile-first device cloud</p>
        <h1>{user && !user.verifiedAt ? 'Verify your email' : mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted">
          Abatement Link lets customers add devices, validate serial numbers, view latest readings, review alarms,
          and share devices through companies.
        </p>

        {error && <div className="alert danger">{error}</div>}

        <form onSubmit={submit} className="form-stack">
          {user && !user.verifiedAt ? (
            <>
              <div className="alert info">
                Demo verification code: <strong>123456</strong>. In production this would be sent by email.
              </div>
              <label>Verification code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
              <button className="primary-button">Verify email</button>
            </>
          ) : (
            <>
              {mode === 'signup' && <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></label>}
              <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label>
              <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Password" /></label>
              <button className="primary-button">{mode === 'signup' ? 'Sign up with email' : 'Log in'}</button>
              <button type="button" className="link-button" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
                {mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
              </button>
              <button type="button" className="link-button muted-link" onClick={() => setError('Demo reset: in the production build this sends a reset email.')}>Forgot password?</button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
