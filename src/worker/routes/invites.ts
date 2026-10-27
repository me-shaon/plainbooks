import { Hono } from "hono";
import {
  acceptInviteInput,
  type InviteLinkInfo,
  inviteLookupInput,
} from "../../shared/schemas/settings";
import { assertRateLimits, clientIp, RATE_RULES, rateKeys } from "../auth/rate-limit";
import { startSession } from "../auth/session";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import { acceptLink, findLink, isOpen, LINK_INVALID } from "../services/invites";

// Invite and Owner-reset links. These routes need no session (SESSION_EXEMPT_PREFIXES),
// and `sessionAuth` has already run the cross-site guard on the POSTs. The token travels
// in the POST body, never in a GET, so a prefetched link uses nothing.

export const inviteRoutes = new Hono<AppEnv>()
  /** POST /api/invites/lookup: what the invite page shows. It does not use the link. */
  .post("/lookup", async (c) => {
    await assertRateLimits(c.env, [
      { key: rateKeys.ip("token-lookup", clientIp(c.req.raw)), rule: RATE_RULES.tokenLookupIp },
    ]);
    const { token } = await parseJson(c, inviteLookupInput);
    const link = await findLink(c.env.DB, token);
    if (!link || !isOpen(link, Date.now())) throw LINK_INVALID();
    c.header("cache-control", "no-store");
    return c.json<InviteLinkInfo>({
      kind: link.kind,
      email: link.email,
      name: link.name,
      expiresAt: link.expiresAt,
    });
  })

  /**
   * POST /api/invites/accept: sets the password with an invite or reset link, ends the
   * user's other sessions, and signs the user in. Five attempts per IP in 15 minutes.
   */
  .post("/accept", async (c) => {
    await assertRateLimits(c.env, [
      { key: rateKeys.ip("token-link", clientIp(c.req.raw)), rule: RATE_RULES.tokenLinkIp },
    ]);
    const input = await parseJson(c, acceptInviteInput);
    const { userId, kind } = await acceptLink(c.env, { ...input, now: Date.now() });
    await startSession(c, userId);
    return c.json({ ok: true, kind });
  });
