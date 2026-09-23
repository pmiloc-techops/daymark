import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[Daymark startup]', error); }
  render() {
    if (this.state.error) return <main style={{ maxWidth: 620, margin: '12vh auto', padding: 28, fontFamily: 'system-ui, sans-serif', color: '#263149', background: '#fff', border: '1px solid #e7eaf0', borderRadius: 14 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Daymark couldn’t start</h1>
      <p style={{ color: '#687487', lineHeight: 1.6 }}>The app hit a startup error. Check the browser console for the error details, then confirm your local environment variables and database setup.</p>
      <details><summary style={{ cursor: 'pointer', color: '#657bd1' }}>Show error details</summary><pre style={{ whiteSpace: 'pre-wrap', color: '#9c4654', fontSize: 12 }}>{String(this.state.error?.message || this.state.error)}</pre></details>
      <button onClick={() => window.location.reload()} style={{ marginTop: 18, border: 0, borderRadius: 7, padding: '10px 14px', background: '#6079d6', color: 'white', cursor: 'pointer' }}>Reload app</button>
    </main>;
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
rootElement.dataset.appReady = 'true';
createRoot(rootElement).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
