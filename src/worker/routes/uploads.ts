import { Hono } from "hono";
import type { LogoExtension } from "../../shared/schemas/settings";
import type { AppEnv } from "../env";
import { LOGO_FILE_PATTERN, LOGO_PREFIX, logoContentType } from "../services/logo";

/** Headers for every served logo. The sandbox CSP stops any script in an SVG. */
export const LOGO_HEADERS = {
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  // Keys are content addressed, so a URL never changes content.
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

/**
 * Public files, mounted at /p/assets. No sign-in: public invoice pages and emails load
 * these. Access bypasses /p/* (see the plan's Key Technical Decisions).
 */
export const publicAssetRoutes = new Hono<AppEnv>().get("/logo/:file", async (c) => {
  const file = c.req.param("file");
  if (!LOGO_FILE_PATTERN.test(file)) return c.text("Not found", 404);
  const object = await c.env.BUCKET.get(`${LOGO_PREFIX}${file}`);
  if (!object) return c.text("Not found", 404);
  const ext = file.slice(file.lastIndexOf(".") + 1) as LogoExtension;
  return new Response(object.body, {
    headers: {
      ...LOGO_HEADERS,
      "Content-Type": logoContentType(ext),
      ETag: object.httpEtag,
    },
  });
});
