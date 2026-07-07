import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    console.error('Abatement Link render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="login-screen">
        <section className="login-card">
          <img className="login-logo" src="/abatement-tech-tagline.png" alt="Abatement Technologies" />
          <p className="eyebrow">Startup error</p>
          <h1>Abatement Link hit a page error.</h1>
          <p className="muted">This screen replaces the old blank page so we can see what failed.</p>
          <div className="alert danger">
            <strong>{this.state.error.name || 'Error'}</strong><br />
            {this.state.error.message || String(this.state.error)}
          </div>
          <p className="muted small-text">After changing environment variables or redeploying, clear the browser cache or open the site in a private window.</p>
          <button className="secondary-button" type="button" onClick={() => window.clearAbatementLinkBrowserState?.()}>Clear browser data and reload</button>
        </section>
      </main>
    );
  }
}
