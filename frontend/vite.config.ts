import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Every backend route is proxied to the API in development, so the frontend can
// use same-origin paths (no CORS) — including the SSE stream under /events.
const BACKEND_URL = 'http://localhost:3000';
const BACKEND_ROUTES = ['/auth', '/workflows', '/runs', '/hooks', '/events', '/health', '/stats'];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(
      BACKEND_ROUTES.map((route) => [route, { target: BACKEND_URL, changeOrigin: true }]),
    ),
  },
});
