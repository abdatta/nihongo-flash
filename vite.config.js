import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = process.env.GITHUB_SHA || new Date().toISOString();

export default defineConfig({
  // Relative asset URLs let the same build work from a custom-domain root
  // and from a GitHub Pages project path without per-domain config changes.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
});
