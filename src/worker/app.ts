import { Hono } from "hono";
import { AUTH_BASE_PATH, createAuth } from "./auth/auth";
import { accessAuth, assertSameOriginWrite } from "./auth/middleware";
import type { AppEnv } from "./env";
import { handleError } from "./errors";
import { api } from "./routes";
import { publicRoutes } from "./routes/public";
import { renderRoutes } from "./routes/render";
import { publicAssetRoutes } from "./routes/uploads";

/**
 * The HTTP app. Every /api/* and /render/* request passes `accessAuth` first, except the
 * exempt prefixes in `AUTH_EXEMPT_PREFIXES`.
 */
export const app = new Hono<AppEnv>();

app.onError(handleError);

app.use("/api/*", accessAuth);
app.use("/render/*", accessAuth);

// better-auth: sign-in, sign-out, password reset, and Google OAuth. It skips Access, so the
// cross-site write guard runs here.
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
  assertSameOriginWrite(c.req.raw, c.env);
  return createAuth(c.env, c.req.raw).handler(c.req.raw);
});

app.route("/api", api);
app.route("/render", renderRoutes);
// Public: no Access check. Assets first, so /p/assets/* never reaches the token routes.
app.route("/p/assets", publicAssetRoutes);
app.route("/p", publicRoutes);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("/render/*", (c) => c.text("Not found", 404));
app.all("/p/*", (c) => c.text("Not found", 404));

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
