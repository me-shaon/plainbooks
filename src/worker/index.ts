import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("/p/*", (c) => c.text("Not found", 404));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller, _env, _ctx) {
    // U17 drains the job outbox here.
  },
} satisfies ExportedHandler<Env>;
