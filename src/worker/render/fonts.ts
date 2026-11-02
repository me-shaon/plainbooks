// Bundled woff2 fonts for documents. Vite inlines each `?inline` import as a base64 data
// URI at build time, so the Worker needs no asset binding. Public pages load the same bytes
// from /p/assets/fonts/<file>. PDF HTML embeds the data URIs, so the renderer makes no
// network calls.
import dmSans400 from "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2?inline";
import dmSans500 from "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff2?inline";
import dmSans600 from "@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2?inline";
import ebGaramond400 from "@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2?inline";
import ebGaramond500 from "@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2?inline";
import ebGaramond600 from "@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2?inline";
import ibmPlexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline";
import ibmPlexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?inline";
import ibmPlexSans400 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?inline";
import ibmPlexSans500 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?inline";
import ibmPlexSans600 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?inline";
import instrumentSans400 from "@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2?inline";
import instrumentSans500 from "@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2?inline";
import instrumentSans600 from "@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2?inline";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?inline";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2?inline";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2?inline";
import lora400 from "@fontsource/lora/files/lora-latin-400-normal.woff2?inline";
import lora500 from "@fontsource/lora/files/lora-latin-500-normal.woff2?inline";
import lora600 from "@fontsource/lora/files/lora-latin-600-normal.woff2?inline";
import manrope400 from "@fontsource/manrope/files/manrope-latin-400-normal.woff2?inline";
import manrope500 from "@fontsource/manrope/files/manrope-latin-500-normal.woff2?inline";
import manrope600 from "@fontsource/manrope/files/manrope-latin-600-normal.woff2?inline";
import sourceSerif400 from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?inline";
import sourceSerif500 from "@fontsource/source-serif-4/files/source-serif-4-latin-500-normal.woff2?inline";
import sourceSerif600 from "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?inline";
import workSans400 from "@fontsource/work-sans/files/work-sans-latin-400-normal.woff2?inline";
import workSans500 from "@fontsource/work-sans/files/work-sans-latin-500-normal.woff2?inline";
import workSans600 from "@fontsource/work-sans/files/work-sans-latin-600-normal.woff2?inline";
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
  "inter-400.woff2": {
    family: "Inter",
    fontId: "inter",
    weight: 400,
    dataUri: inter400,
  },
  "inter-500.woff2": {
    family: "Inter",
    fontId: "inter",
    weight: 500,
    dataUri: inter500,
  },
  "inter-600.woff2": {
    family: "Inter",
    fontId: "inter",
    weight: 600,
    dataUri: inter600,
  },
  "dm-sans-400.woff2": {
    family: "DM Sans",
    fontId: "dm-sans",
    weight: 400,
    dataUri: dmSans400,
  },
  "dm-sans-500.woff2": {
    family: "DM Sans",
    fontId: "dm-sans",
    weight: 500,
    dataUri: dmSans500,
  },
  "dm-sans-600.woff2": {
    family: "DM Sans",
    fontId: "dm-sans",
    weight: 600,
    dataUri: dmSans600,
  },
  "manrope-400.woff2": {
    family: "Manrope",
    fontId: "manrope",
    weight: 400,
    dataUri: manrope400,
  },
  "manrope-500.woff2": {
    family: "Manrope",
    fontId: "manrope",
    weight: 500,
    dataUri: manrope500,
  },
  "manrope-600.woff2": {
    family: "Manrope",
    fontId: "manrope",
    weight: 600,
    dataUri: manrope600,
  },
  "work-sans-400.woff2": {
    family: "Work Sans",
    fontId: "work-sans",
    weight: 400,
    dataUri: workSans400,
  },
  "work-sans-500.woff2": {
    family: "Work Sans",
    fontId: "work-sans",
    weight: 500,
    dataUri: workSans500,
  },
  "work-sans-600.woff2": {
    family: "Work Sans",
    fontId: "work-sans",
    weight: 600,
    dataUri: workSans600,
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
  "lora-400.woff2": {
    family: "Lora",
    fontId: "lora",
    weight: 400,
    dataUri: lora400,
  },
  "lora-500.woff2": {
    family: "Lora",
    fontId: "lora",
    weight: 500,
    dataUri: lora500,
  },
  "lora-600.woff2": {
    family: "Lora",
    fontId: "lora",
    weight: 600,
    dataUri: lora600,
  },
  "eb-garamond-400.woff2": {
    family: "EB Garamond",
    fontId: "eb-garamond",
    weight: 400,
    dataUri: ebGaramond400,
  },
  "eb-garamond-500.woff2": {
    family: "EB Garamond",
    fontId: "eb-garamond",
    weight: 500,
    dataUri: ebGaramond500,
  },
  "eb-garamond-600.woff2": {
    family: "EB Garamond",
    fontId: "eb-garamond",
    weight: 600,
    dataUri: ebGaramond600,
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
