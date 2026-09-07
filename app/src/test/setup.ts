import "@testing-library/jest-dom/vitest";

// config.ts reads VITE_WORKER_URL at import time and no longer has a baked-in
// fallback URL, so give the suite a dummy value — otherwise <App> renders the
// "dashboard not configured" notice instead of the dashboard.
const env = import.meta.env as Record<string, string | undefined>;
env.VITE_WORKER_URL ||= "https://worker.test";
