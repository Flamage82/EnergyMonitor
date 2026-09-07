/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Minimal shim so we can read the injected env var without pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };

// A production build with no VITE_WORKER_URL used to publish green but dead (the
// old config fallback was a placeholder domain). Fail the build instead so a
// misconfigured deploy is a red CI run. CI's plain compile-check build passes a
// throwaway value; the Pages deploy passes the real WORKER_URL repo variable.
export default defineConfig(({ command }) => {
  if (command === "build" && !process.env.VITE_WORKER_URL) {
    throw new Error(
      "VITE_WORKER_URL is unset — set the WORKER_URL Actions repository variable (see README > Deploy).",
    );
  }

  return {
    base: "/EnergyMonitor/",
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // Recharts + d3 is ~75% of the bundle and changes far less often than
          // app code — split it out so a normal app edit doesn't bust its cache.
          manualChunks: { recharts: ["recharts"] },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
