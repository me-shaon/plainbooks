import { Hono } from "hono";
import type { LogoExtension } from "../../shared/schemas/settings";
import type { AppEnv } from "../env";
import { fontFileBytes } from "../render/fonts";
import { DOCUMENT_CSS } from "../render/styles";
import { LOGO_FILE_PATTERN, LOGO_PREFIX, logoContentType } from "../services/logo";

/** Headers for every served logo. The sandbox CSP stops any script in an SVG. */
export const LOGO_HEADERS = {
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  // Keys are content addressed, so a URL never changes content.
  "Cache-Control": "public, max-age=31536000, immutable",
} as const;

const PUBLIC_ASSET_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
} as const;

/**
 * Public files, mounted at /p/assets: logos, document fonts, and the document CSS. No sign-in: public invoice pages and emails load
 * these. Access bypasses /p/* (see the plan's Key Technical Decisions).
 */
export const publicAssetRoutes = new Hono<AppEnv>()
  .get(
    "/document.css",
    () =>
      new Response(DOCUMENT_CSS, {
        headers: {
          ...PUBLIC_ASSET_HEADERS,
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      }),
  )
  .get("/fonts/:file", (c) => {
    const bytes = fontFileBytes(c.req.param("file"));
    if (!bytes) return c.text("Not found", 404);
    return new Response(bytes, {
      headers: {
        ...PUBLIC_ASSET_HEADERS,
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  })
  .get("/logo/:file", async (c) => {
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
