// Bundled woff2 fonts for documents. Vite inlines each `?inline` import as a base64 data
// URI at build time, so the Worker needs no asset binding. Public pages load the same bytes
// from /p/assets/fonts/<file>. PDF HTML embeds the data URIs, so the renderer makes no
// network calls.
import ibmPlexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline";
import ibmPlexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?inline";
import ibmPlexSans400 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?inline";
import ibmPlexSans500 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?inline";
import ibmPlexSans600 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?inline";
import instrumentSans400 from "@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2?inline";
import instrumentSans500 from "@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2?inline";
import instrumentSans600 from "@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2?inline";
import sourceSerif400 from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?inline";
import sourceSerif500 from "@fontsource/source-serif-4/files/source-serif-4-latin-500-normal.woff2?inline";
import sourceSerif600 from "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?inline";
import { FONT_CHOICES, type FontChoice } from "../../shared/schemas/settings";

export type DocumentFontId = FontChoice | "ibm-plex-mono";

interface FontFile {
  family: string;
  fontId: DocumentFontId;
  weight: number;
  dataUri: string;
}

/** Every bundled font file, keyed by its public file name. */
export const FONT_FILES: Record<string, FontFile> = {
  "instrument-sans-400.woff2": {
    family: "Instrument Sans",
    fontId: "instrument-sans",
    weight: 400,
    dataUri: instrumentSans400,
  },
  "instrument-sans-500.woff2": {
    family: "Instrument Sans",
    fontId: "instrument-sans",
    weight: 500,
    dataUri: instrumentSans500,
  },
  "instrument-sans-600.woff2": {
    family: "Instrument Sans",
    fontId: "instrument-sans",
    weight: 600,
    dataUri: instrumentSans600,
  },
  "ibm-plex-sans-400.woff2": {
    family: "IBM Plex Sans",
    fontId: "ibm-plex-sans",
    weight: 400,
    dataUri: ibmPlexSans400,
  },
  "ibm-plex-sans-500.woff2": {
    family: "IBM Plex Sans",
    fontId: "ibm-plex-sans",
    weight: 500,
    dataUri: ibmPlexSans500,
  },
  "ibm-plex-sans-600.woff2": {
    family: "IBM Plex Sans",
    fontId: "ibm-plex-sans",
    weight: 600,
    dataUri: ibmPlexSans600,
  },
  "source-serif-4-400.woff2": {
    family: "Source Serif 4",
    fontId: "source-serif-4",
    weight: 400,
    dataUri: sourceSerif400,
  },
  "source-serif-4-500.woff2": {
    family: "Source Serif 4",
    fontId: "source-serif-4",
    weight: 500,
    dataUri: sourceSerif500,
  },
  "source-serif-4-600.woff2": {
    family: "Source Serif 4",
    fontId: "source-serif-4",
    weight: 600,
    dataUri: sourceSerif600,
  },
  "ibm-plex-mono-400.woff2": {
    family: "IBM Plex Mono",
    fontId: "ibm-plex-mono",
    weight: 400,
    dataUri: ibmPlexMono400,
  },
  "ibm-plex-mono-500.woff2": {
    family: "IBM Plex Mono",
    fontId: "ibm-plex-mono",
    weight: 500,
    dataUri: ibmPlexMono500,
  },
};

export const FONT_ASSET_PREFIX = "/p/assets/fonts/";

/** The brand kit font, or Instrument Sans when the stored value is unknown. */
export function documentFont(font: string): (typeof FONT_CHOICES)[number] {
  return FONT_CHOICES.find((f) => f.id === font) ?? FONT_CHOICES[0];
}

/**
 * `@font-face` rules for the brand font and the mono font. "page" mode points at
 * /p/assets/fonts/*. "pdf" mode embeds the files as data URIs.
 */
export function fontFaceCss(font: string, mode: "page" | "pdf"): string {
  const ids: DocumentFontId[] = [documentFont(font).id, "ibm-plex-mono"];
  let css = "";
  for (const [file, entry] of Object.entries(FONT_FILES)) {
    if (!ids.includes(entry.fontId)) continue;
    const src = mode === "pdf" ? entry.dataUri : `${FONT_ASSET_PREFIX}${file}`;
    css += `@font-face{font-family:"${entry.family}";font-style:normal;font-weight:${entry.weight};font-display:swap;src:url(${src}) format("woff2")}\n`;
  }
  return css;
}

/** The bytes of a bundled font file, or null for an unknown name. */
export function fontFileBytes(file: string): Uint8Array | null {
  const entry = Object.hasOwn(FONT_FILES, file) ? FONT_FILES[file] : undefined;
  if (!entry) return null;
  const base64 = entry.dataUri.slice(entry.dataUri.indexOf(",") + 1);
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}
