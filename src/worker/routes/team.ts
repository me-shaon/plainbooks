import { type Context, Hono } from "hono";
import type { TeamMember } from "../../shared/schemas/settings";
import { teamMemberInput, teamRoleInput } from "../../shared/schemas/settings";
import { requireOwner } from "../auth/middleware";
import type { AppEnv } from "../env";
import { AppError, parseJson } from "../errors";
import { appOrigin } from "../services/email";
import {
  addMember,
  type LinkContext,
  listTeam,
  removeUser,
  resendInvite,
  resetSignIn,
  setUserRole,
} from "../services/team";

/** The context for a new invite or reset link. */
function linkContext(c: Context<AppEnv>): LinkContext {
  return {
    env: c.env,
    db: c.var.db,
    actor: c.var.user,
    origin: appOrigin(c.env) || new URL(c.req.url).origin,
    now: Date.now(),
  };
}

/**
 * The team list, mounted at /api/team. Owner only. Adding a member creates an invite
 * link. Removing a member ends their sessions.
 */
export const teamRoutes = new Hono<AppEnv>()
  .use(requireOwner)
  .get("/", async (c) => {
    const items: TeamMember[] = await listTeam(c.env.DB, Date.now());
    return c.json({ items });
  })
  .post("/", async (c) => {
    const data = await parseJson(c, teamMemberInput);
    return c.json(await addMember(linkContext(c), data), 201);
  })
  .post("/:id/invite", async (c) => {
    return c.json(await resendInvite(linkContext(c), c.req.param("id")));
  })
  .post("/:id/reset", async (c) => {
    const id = c.req.param("id");
    if (id === c.var.user.id) {
      throw new AppError(
        409,
        "cannot_reset_self",
        "You cannot reset your own sign-in. Change your password from the sign-in page.",
      );
    }
    return c.json(await resetSignIn(linkContext(c), id));
  })
  .patch("/:id", async (c) => {
    const { role } = await parseJson(c, teamRoleInput);
    await setUserRole(c.var.db, c.req.param("id"), role);
    const member = (await listTeam(c.env.DB, Date.now())).find((m) => m.id === c.req.param("id"));
    return c.json(member);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (id === c.var.user.id) {
      throw new AppError(409, "cannot_remove_self", "You cannot remove yourself from the team");
    }
    await removeUser(c.var.db, id);
    return c.body(null, 204);
  });
