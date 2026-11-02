/** @jsxImportSource hono/jsx */
// Document rendering. Every render reads one DocumentSnapshot plus the live state, so a
// sent revision always looks the same (see the plan's "sent documents are frozen").
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { DocumentSnapshot } from "../../shared/schemas/document";
import { LOGO_TYPES } from "../../shared/schemas/settings";
import { normalizeTemplateConfig } from "../../shared/schemas/template";
import { documentFont, fontFaceCss } from "./fonts";
import { accentInk, onAccent, safeAccent } from "./format";
import { DocumentPage } from "./layouts";
import { type Banner, buildView, type RenderMode, type RenderState } from "./model";
import { DOCUMENT_CSS, DOCUMENT_CSS_PATH } from "./styles";

export type { Banner, RenderMode, RenderState } from "./model";
export { documentBanners } from "./model";
export { previewState, renderStateOf } from "./state";

export interface RenderOptions {
  /** "page": assets load from /p/assets/*. "pdf": fonts and the logo are inlined. */
  mode: RenderMode;
  state: RenderState;
  /**
   * The logo image source. Defaults to the snapshot logo's /p/assets URL. In "pdf" mode,
   * pass the data URI from `inlineLogo` (`renderDocument` does this).
   */
  logoSrc?: string | null;
  /** The signature image source. It works like `logoSrc`. */
  signatureSrc?: string | null;
  /** Page mode: shows a "Download PDF" link. */
  pdfUrl?: string | null;
  /** The CSP nonce for the inline theme style. */
  nonce?: string;
  /** Page mode: a message above the document, for example a decision confirmation. */
  notice?: Child;
  /** Page mode: content after the document, for example the quote decision form. */
  after?: Child;
}

/** The accent color and font: the template's, or the brand kit's when the template has none. */
export function documentTheme(snapshot: DocumentSnapshot): { accentColor: string; font: string } {
  const { style } = normalizeTemplateConfig(snapshot.template.config);
  return {
    accentColor: style.accentColor ?? snapshot.brandKit.accentColor,
    font: style.font ?? snapshot.brandKit.font,
  };
}

function themeCss(snapshot: DocumentSnapshot): string {
  const theme = documentTheme(snapshot);
  const accent = safeAccent(theme.accentColor);
  const font = documentFont(theme.font);
  return `:root{--accent:${accent};--on-accent:${onAccent(accent)};--accent-ink:${accentInk(accent)};--accent-soft:${accent}14;--font:${font.stack};--mono:"IBM Plex Mono",ui-monospace,monospace}`;
}

function BannerList({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div class="banners" role="status">
      {banners.map((banner) => (
        <div key={banner.title} class={`banner ${banner.tone}`}>
          <strong>{banner.title}</strong>
          {banner.body ? <span>{banner.body}</span> : null}
          {banner.comment ? <span class="comment">{`"${banner.comment}"`}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** The document title for the browser tab: "Invoice INV-0042 from Studio One". */
export function documentTitle(snapshot: DocumentSnapshot): string {
  const kind = snapshot.document.kind === "invoice" ? "Invoice" : "Quote";
  const number = snapshot.document.number ?? "draft";
  const from = snapshot.brandKit.businessName;
  return from ? `${kind} ${number} from ${from}` : `${kind} ${number}`;
}

/**
 * Renders the full HTML page of a document. Synchronous and free of I/O. Every value from
 * the snapshot goes through JSX escaping. The only raw text is the CSS, which is static
 * apart from the validated accent color, a known font stack, and bundled font data.
 */
export function renderDocumentHtml(snapshot: DocumentSnapshot, options: RenderOptions): string {
  const config = normalizeTemplateConfig(snapshot.template.config);
  const view = buildView(
    snapshot,
    options.state,
    options.mode,
    options.logoSrc,
    options.signatureSrc,
  );
  const isPage = options.mode === "page";
  const { font } = documentTheme(snapshot);
  const inlineCss = isPage
    ? `${fontFaceCss(font, "page")}${themeCss(snapshot)}`
    : `${fontFaceCss(font, "pdf")}${themeCss(snapshot)}${DOCUMENT_CSS}`;
  const business = snapshot.brandKit.businessName;

  const page = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{documentTitle(snapshot)}</title>
        {isPage ? <link rel="stylesheet" href={DOCUMENT_CSS_PATH} /> : null}
        {/* Static CSS plus validated theme values. No snapshot text reaches it. */}
        <style nonce={options.nonce}>{raw(inlineCss)}</style>
      </head>
      <body>
        <div class="shell">
          {isPage ? (
            <div class="toolbar">
              <span class="who">
                {business ? `${view.kindLabel} from ${business}` : view.kindLabel}
              </span>
              {options.pdfUrl ? (
                <a class="button" href={options.pdfUrl}>
                  Download PDF
                </a>
              ) : null}
            </div>
          ) : null}
          {isPage && options.notice ? options.notice : null}
          <BannerList banners={view.banners} />
          <DocumentPage view={view} layout={config.layout} />
          {isPage && options.after ? options.after : null}
        </div>
      </body>
    </html>
  );
  return `<!doctype html>${page.toString()}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Reads a logo from R2 and returns it as a data URI, or null when it is missing. */
export async function inlineLogo(
  bucket: R2Bucket,
  logoKey: string | null | undefined,
): Promise<string | null> {
  if (!logoKey) return null;
  const ext = logoKey.slice(logoKey.lastIndexOf(".") + 1);
  const type = Object.entries(LOGO_TYPES).find(([, e]) => e === ext)?.[0];
  if (!type) return null;
  const object = await bucket.get(logoKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

/**
 * Renders a document. In "pdf" mode it reads the snapshot's logo and signature from
 * `env.BUCKET` and inlines them, so the HTML needs no network access.
 */
export async function renderDocument(
  env: { BUCKET: R2Bucket },
  snapshot: DocumentSnapshot,
  options: Omit<RenderOptions, "logoSrc" | "signatureSrc">,
): Promise<string> {
  if (options.mode !== "pdf") return renderDocumentHtml(snapshot, options);
  const [logoSrc, signatureSrc] = await Promise.all([
    inlineLogo(env.BUCKET, snapshot.brandKit.logoKey),
    inlineLogo(env.BUCKET, snapshot.brandKit.signatureKey),
  ]);
  return renderDocumentHtml(snapshot, { ...options, logoSrc, signatureSrc });
}
