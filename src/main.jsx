import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './AppSuite.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Auto-updating service worker. When a new version is available it is
// activated silently on the next load; we surface a toast so the user can
// refresh immediately if they want the update now.
export const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('filevault:sw-update-available'));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('filevault:sw-offline-ready'));
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
