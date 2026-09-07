import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            EMONCMS_KEY: "test-key",
            ALLOWED_ORIGIN: "http://localhost:5173",
          },
        },
      },
    },
  },
});
