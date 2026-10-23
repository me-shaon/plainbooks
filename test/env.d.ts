declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    /** Test bindings from vitest.config.ts. Production sets these as secrets. */
    RESEND_API_KEY: string;
    RESEND_WEBHOOK_SECRET: string;
  }
}
