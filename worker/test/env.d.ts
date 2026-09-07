// Types the `env` that `cloudflare:test` hands the tests as the Worker's own
// Env, so `worker.fetch(req, env, ctx)` typechecks. The values come from the
// miniflare bindings in vitest.config.ts.
import type { Env } from "../src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
