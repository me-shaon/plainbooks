import { app } from "./app";
import "./services/email";
import "./services/recurring";
import "./services/reminders";
import "./services/updates";
import { withGeneratedSecrets } from "./secrets";
import { runTick } from "./services/scheduler";

// Durable Object classes must be exports of the main module.
export { AuthRateLimiter } from "./auth/rate-limit";

// Feature services register job handlers and enqueue hooks at module scope.
// Import each one here (U13 email, U15 recurring, U16 reminders, update check).

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, await withGeneratedSecrets(env), ctx);
  },
  async scheduled(controller, env, _ctx) {
    const summary = await runTick(await withGeneratedSecrets(env), controller.scheduledTime);
    console.log("scheduler tick", JSON.stringify(summary));
  },
} satisfies ExportedHandler<Env>;
