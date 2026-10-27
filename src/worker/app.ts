import { Hono } from "hono";
import { AUTH_BASE_PATH, createAuth } from "./auth/auth";
import { sessionAuth } from "./auth/middleware";
import type { AppEnv } from "./env";
import { handleError } from "./errors";
import { api } from "./routes";
import { publicRoutes } from "./routes/public";
import { renderRoutes } from "./routes/render";
import { publicAssetRoutes } from "./routes/uploads";

/**
 * The HTTP app. Every /api/* and /render/* request passes `sessionAuth` first. It runs the
 * cross-site guard, then requires a session except on `SESSION_EXEMPT_PREFIXES`.
 */
export const app = new Hono<AppEnv>();

app.onError(handleError);

app.use("/api/*", sessionAuth);
app.use("/render/*", sessionAuth);

// better-auth: sign-in, sign-out, password reset, and Google OAuth. It needs no session.
// `sessionAuth` has already run the cross-site guard.
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) =>
  createAuth(c.env, c.req.raw).handler(c.req.raw),
);

app.route("/api", api);
app.route("/render", renderRoutes);
// Public: no session. Assets first, so /p/assets/* never reaches the token routes.
app.route("/p/assets", publicAssetRoutes);
app.route("/p", publicRoutes);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("/render/*", (c) => c.text("Not found", 404));
app.all("/p/*", (c) => c.text("Not found", 404));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
