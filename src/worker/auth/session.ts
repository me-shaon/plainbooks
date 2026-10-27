import type { Context } from "hono";
import { setSignedCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { createAuth, SESSION_EXPIRES_IN_SECONDS } from "./auth";
import { clientIp } from "./rate-limit";

/**
 * Creates a better-auth session for the user and sets the signed session cookie. Setup
 * and invite accept call it after they mark the user active.
 */
export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const ctx = await createAuth(c.env, c.req.raw).$context;
  const session = await ctx.internalAdapter.createSession(userId, false, {
    ipAddress: clientIp(c.req.raw),
    userAgent: c.req.header("user-agent") ?? "",
  });
  const cookie = ctx.authCookies.sessionToken;
  await setSignedCookie(c, cookie.name, session.token, c.env.AUTH_SECRET?.trim() ?? "", {
    path: cookie.attributes.path ?? "/",
    httpOnly: cookie.attributes.httpOnly ?? true,
    secure: cookie.attributes.secure ?? false,
    sameSite: cookie.attributes.sameSite ?? "lax",
    maxAge: SESSION_EXPIRES_IN_SECONDS,
  });
}
