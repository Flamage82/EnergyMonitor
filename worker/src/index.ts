export interface Env {
  EMONCMS_KEY: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
