import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';

// Every backend route is proxied to the API in development, so the frontend can
// use same-origin paths (no CORS) — including the SSE stream under /events.
const BACKEND_URL = 'http://localhost:3000';
const BACKEND_ROUTES = ['/auth', '/workflows', '/runs', '/hooks', '/events', '/health', '/stats'];

// A browser navigation (hard load or refresh of e.g. /runs/:id) sends
// `Accept: text/html` and must fall through to the SPA (index.html) instead of
// the API — the route only exists client-side, in react-router. Fetch/XHR/
// EventSource calls never send that Accept value, so this only affects full
// page loads, not the app's own API calls.
const proxyConfig: ProxyOptions = {
  target: BACKEND_URL,
  changeOrigin: true,
  bypass(req) {
    if (req.headers.accept?.includes('text/html')) {
      return req.url; // skip the proxy; let Vite's SPA fallback serve index.html
    }
    return undefined;
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(BACKEND_ROUTES.map((route) => [route, proxyConfig])),
  },
});
