import "@testing-library/jest-dom/vitest";

// config.ts reads VITE_WORKER_URL at import time and no longer has a baked-in
// fallback URL, so give the suite a dummy value — otherwise <App> renders the
// "dashboard not configured" notice instead of the dashboard.
const env = import.meta.env as Record<string, string | undefined>;
env.VITE_WORKER_URL ||= "https://worker.test";

// Node 25+ defines its own `localStorage` global that is `undefined` unless
// --localstorage-file is passed, and vitest won't overwrite an existing global
// with jsdom's. Install an in-memory Storage when the global one is unusable
// (Node 22, which CI runs, already has jsdom's and skips this).
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => { store.delete(key); },
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}
