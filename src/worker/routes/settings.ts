import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { brandKitInput, workspaceSettingsInput } from "../../shared/schemas/settings";
import { requireOwner } from "../auth/middleware";
import { type Db, schema } from "../db/client";
import type { AppEnv } from "../env";
import { AppError, parseJson } from "../errors";
import { storeLogo, validateLogo } from "../services/logo";
import {
  forgetWorkspace,
  getBrandKit,
  getWorkspaceSettings,
  isHomeCurrencyLocked,
} from "../services/settings";

const { workspace, taxRates, templates } = schema;

async function assertTemplate(db: Db, id: string | null | undefined) {
  if (!id) return;
  const [row] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, id));
  if (!row) throw new AppError(400, "invalid_template", "Choose an existing template");
}

async function assertActiveTaxRate(db: Db, id: string | null | undefined) {
  if (!id) return;
  const [row] = await db
    .select({ archivedAt: taxRates.archivedAt })
    .from(taxRates)
    .where(eq(taxRates.id, id));
  if (!row || row.archivedAt !== null) {
    throw new AppError(400, "invalid_tax_rate", "Choose an active tax rate");
  }
}

/**
 * Workspace settings and the brand kit, mounted at /api/settings. Everyone can read them.
 * Only an Owner can change them (R38).
 */
export const settingsRoutes = new Hono<AppEnv>()
  .get("/workspace", async (c) => c.json(await getWorkspaceSettings(c.var.db)))
  .patch("/workspace", requireOwner, async (c) => {
    const db = c.var.db;
    const data = await parseJson(c, workspaceSettingsInput);
    if (data.homeCurrency !== undefined) {
      const current = await getWorkspaceSettings(db);
      if (data.homeCurrency !== current.homeCurrency && (await isHomeCurrencyLocked(db))) {
        throw new AppError(
          409,
          "home_currency_locked",
          "The home currency cannot change after the first invoice or quote was finalized",
        );
      }
    }
    await assertTemplate(db, data.defaultTemplateId);
    await assertActiveTaxRate(db, data.defaultTaxRateId);
    if (Object.keys(data).length > 0) {
      await db
        .update(workspace)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(workspace.id, 1));
      forgetWorkspace(c.var.db);
    }
    return c.json(await getWorkspaceSettings(db));
  })
  .get("/brand-kit", async (c) => c.json(await getBrandKit(c.var.db)))
  .patch("/brand-kit", requireOwner, async (c) => {
    const data = await parseJson(c, brandKitInput);
    if (Object.keys(data).length > 0) {
      await c.var.db
        .update(workspace)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(workspace.id, 1));
      forgetWorkspace(c.var.db);
    }
    return c.json(await getBrandKit(c.var.db));
  })
  /**
   * Uploads a new logo. The body is the raw file, and Content-Type is its image type.
   * The old logo stays in R2, because sent revisions may still show it.
   */
  .post("/brand-kit/logo", requireOwner, async (c) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > 1024 * 1024) {
      throw new AppError(413, "logo_too_large", "The logo must be 1 MB or smaller");
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const ext = validateLogo(bytes, c.req.header("content-type") ?? "");
    const key = await storeLogo(c.env.BUCKET, bytes, ext);
    await c.var.db
      .update(workspace)
      .set({ logoKey: key, updatedAt: Date.now() })
      .where(eq(workspace.id, 1));
    forgetWorkspace(c.var.db);
    return c.json(await getBrandKit(c.var.db));
  })
  /** Removes the logo from the brand kit. The file stays in R2 for sent revisions. */
  .delete("/brand-kit/logo", requireOwner, async (c) => {
    await c.var.db
      .update(workspace)
      .set({ logoKey: null, updatedAt: Date.now() })
      .where(eq(workspace.id, 1));
    forgetWorkspace(c.var.db);
    return c.json(await getBrandKit(c.var.db));
  });
