import { Hono } from "hono";
import { EXPORT_TYPES, type ExportType } from "../../shared/schemas/report";
import type { AppEnv } from "../env";
import { AppError } from "../errors";
import {
  agingReport,
  exportCsv,
  exportFilename,
  incomeReport,
  resolveRange,
  taxSummary,
} from "../services/reports";

/**
 * Reports, mounted at /api/reports. Query: period=month|quarter|year, from, to (issue
 * dates). Exports stream CSV: /export/invoices, /export/payments, /export/clients.
 */
export const reportRoutes = new Hono<AppEnv>()
  .get("/tax-summary", async (c) => c.json(await taxSummary(c.var.db, c.req.query(), Date.now())))
  .get("/income", async (c) => c.json(await incomeReport(c.var.db, c.req.query(), Date.now())))
  .get("/aging", async (c) => c.json(await agingReport(c.var.db, Date.now())))
  .get("/export/:type", async (c) => {
    const type = c.req.param("type").replace(/\.csv$/, "") as ExportType;
    if (!EXPORT_TYPES.includes(type)) {
      throw new AppError(404, "export_not_found", "This export does not exist");
    }
    const range = await resolveRange(c.var.db, c.req.query(), Date.now());
    return new Response(exportCsv(c.var.db, type, range), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(type, range)}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
