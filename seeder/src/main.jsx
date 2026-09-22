import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Earlier releases shipped a (never-registered) CRA/Workbox service worker. Make
// sure browsers that still hold one drop it, or they keep serving stale bundles.
try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => { });
  }
} catch {
  console.log("Error releasing service worker");
}
