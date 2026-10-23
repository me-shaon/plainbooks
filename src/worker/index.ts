import { app } from "./app";
import "./services/email";
import "./services/recurring";
import { runTick } from "./services/scheduler";

// Feature services register job handlers and enqueue hooks at module scope.
// Import each one here (U13 email, U15 recurring, U16 reminders).

export default {
  fetch: app.fetch,
  async scheduled(controller, env, _ctx) {
    const summary = await runTick(env, controller.scheduledTime);
    console.log("scheduler tick", JSON.stringify(summary));
  },
} satisfies ExportedHandler<Env>;
