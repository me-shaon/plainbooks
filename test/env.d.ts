declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    /** Test bindings from vitest.config.ts. Production sets these as secrets. */
    RESEND_API_KEY: string;
    APP_URL: string;
    ENCRYPTION_KEY: string;
    AUTH_SECRET: string;
    PBKDF2_ITERATIONS: string;
  }
}
