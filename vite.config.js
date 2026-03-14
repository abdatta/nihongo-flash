import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const githubPagesBase =
  process.env.GITHUB_ACTIONS === 'true' && repositoryName
    ? `/${repositoryName}/`
    : '/';
const appVersion = process.env.GITHUB_SHA || new Date().toISOString();

export default defineConfig({
  base: githubPagesBase,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
});
