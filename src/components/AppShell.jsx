import { NavLink } from 'react-router-dom';

export default function AppShell({ user, actions, children, title }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <img src="/abatement-link-mark.svg" alt="Abatement Link" />
          <div>
            <strong>{title || 'Abatement Link'}</strong>
            <small>{user?.email}</small>
          </div>
        </div>
        <button className="ghost-button" onClick={actions?.logout}>Sign out</button>
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
