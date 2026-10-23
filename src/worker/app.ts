import { Hono } from "hono";
import { accessAuth } from "./auth/middleware";
import type { AppEnv } from "./env";
import { handleError } from "./errors";
import { api } from "./routes";

/** The HTTP app. Every /api/* and /render/* request passes `accessAuth` first. */
export const app = new Hono<AppEnv>();

app.onError(handleError);

app.use("/api/*", accessAuth);
app.use("/render/*", accessAuth);

app.route("/api", api);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("/render/*", (c) => c.text("Not found", 404));
app.all("/p/*", (c) => c.text("Not found", 404));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
