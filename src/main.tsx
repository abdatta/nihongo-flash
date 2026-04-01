import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installMockLocalStorage } from './mockLocalStorage';

const SERVICE_WORKER_VERSION = __APP_VERSION__;
const isMockStorageMode = import.meta.env.MODE === 'mock-storage';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let hasRefreshedForUpdate = false;

    const reloadForUpdate = () => {
      if (hasRefreshedForUpdate) return;
      hasRefreshedForUpdate = true;
      window.location.reload();
    };

    const registerServiceWorker = async () => {
      try {
        const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(SERVICE_WORKER_VERSION)}`;
        const registration = await navigator.serviceWorker.register(serviceWorkerUrl);

        navigator.serviceWorker.addEventListener('controllerchange', reloadForUpdate);

        const activateWorker = (worker: ServiceWorker | null) => {
          if (!worker) return;

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        };

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        if (registration.installing) {
          activateWorker(registration.installing);
        }

        registration.addEventListener('updatefound', () => {
          activateWorker(registration.installing);
        });

        const checkForUpdates = () => {
          registration.update().catch(() => {
            // Ignore update check failures so the app still works offline.
          });
        };

        window.setInterval(checkForUpdates, 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            checkForUpdates();
          }
        });

        checkForUpdates();
      } catch {
        // Service worker registration is optional during local development.
      }
    };

    registerServiceWorker();
  });
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const bootstrap = async () => {
  if (isMockStorageMode) {
    await installMockLocalStorage();
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

void bootstrap();
