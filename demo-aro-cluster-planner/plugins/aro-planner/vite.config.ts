import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    // Same-origin in dev, so the wizard calls /api/aro-planner exactly as it will
    // once mounted inside Backstage. No CORS, no environment-specific base URL.
    proxy: {
      '/api/aro-planner': {
        target: process.env.ARO_PLANNER_BACKEND ?? 'http://localhost:7008',
        changeOrigin: true,
      },
    },
  },
});
