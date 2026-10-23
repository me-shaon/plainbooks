import { app } from "./app";

export default {
  fetch: app.fetch,
  async scheduled(_controller, _env, _ctx) {
    // U17 drains the job outbox here.
  },
} satisfies ExportedHandler<Env>;
