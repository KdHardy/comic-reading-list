import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, readThemePreference } from './lib/theme';
import './index.css';

applyTheme(readThemePreference());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Cache the app shell after a warm visit so a reload can still boot offline.
// List data itself is persisted separately in localStorage.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration can fail on unsupported hosts; online use still works.
    });
  });
}
