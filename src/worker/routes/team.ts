import { asc } from "drizzle-orm";
import { Hono } from "hono";
import type { TeamMember } from "../../shared/schemas/settings";
import { teamMemberInput, teamRoleInput } from "../../shared/schemas/settings";
import { requireOwner } from "../auth/middleware";
import { schema } from "../db/client";
import type { AppEnv } from "../env";
import { AppError, parseJson } from "../errors";
import { removeUser, setUserRole } from "../services/team";

const { users } = schema;

const memberColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  createdAt: users.createdAt,
};

/** `users.created_at` reads as a `Date`. The API sends epoch ms. */
function toTeamMember(row: Omit<TeamMember, "createdAt"> & { createdAt: Date }): TeamMember {
  return { ...row, createdAt: row.createdAt.getTime() };
}

/**
 * The team list, mounted at /api/team. Owner only. Adding a member only adds the row.
 * The person also needs permission in the Cloudflare Access application.
 */
export const teamRoutes = new Hono<AppEnv>()
  .use(requireOwner)
  .get("/", async (c) => {
    const rows = await c.var.db.select(memberColumns).from(users).orderBy(asc(users.email));
    const items: TeamMember[] = rows.map(toTeamMember);
    return c.json({ items });
  })
  .post("/", async (c) => {
    const data = await parseJson(c, teamMemberInput);
    const [created] = await c.var.db
      .insert(users)
      .values(data)
      .onConflictDoNothing({ target: users.email })
      .returning(memberColumns);
    if (!created) {
      throw new AppError(409, "member_exists", "This email is already on the team");
    }
    return c.json(toTeamMember(created), 201);
  })
  .patch("/:id", async (c) => {
    const { role } = await parseJson(c, teamRoleInput);
    const updated = await setUserRole(c.var.db, c.req.param("id"), role);
    return c.json(updated);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (id === c.var.user.id) {
      throw new AppError(409, "cannot_remove_self", "You cannot remove yourself from the team");
    }
    await removeUser(c.var.db, id);
    return c.body(null, 204);
  });
