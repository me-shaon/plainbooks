import {
  LOGO_TYPES,
  type LogoContentType,
  type LogoExtension,
  MAX_LOGO_BYTES,
} from "../../shared/schemas/settings";
import { AppError } from "../errors";

export const LOGO_PREFIX = "logos/";
/** `<sha256 hex>.<ext>`, the file name part of a logo key and of its public URL. */
export const LOGO_FILE_PATTERN = /^[a-f0-9]{64}\.(png|jpg|svg)$/;

const CONTENT_TYPE_BY_EXT: Record<LogoExtension, LogoContentType> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

export function logoContentType(ext: LogoExtension): LogoContentType {
  return CONTENT_TYPE_BY_EXT[ext];
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function reject(message: string): never {
  throw new AppError(400, "invalid_logo", message);
}

/** Elements that can run code, embed other documents, or load other resources. */
const FORBIDDEN_ELEMENTS =
  /<\s*(script|foreignObject|iframe|embed|object|audio|video|canvas|handler|listener)\b/i;
/** Event handler attributes such as onload= and onclick=, also after a slash or quote. */
const EVENT_HANDLER = /[\s/"']on[a-z0-9_-]*\s*=/i;
const REFERENCE_ATTRIBUTE = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/**
 * Checks an SVG logo and rejects anything that can run script or load an external resource:
 * script and foreignObject elements, event handlers, DTDs and entities, processing
 * instructions, `javascript:`, `@import`, `src` attributes, animation of `href`, and any
 * `href` or CSS `url()` that is not a local `#fragment`. The logo route also serves
 * every logo with a sandbox CSP, so a missed case still cannot run.
 */
export function assertSafeSvg(text: string): void {
  const body = text.replace(/^﻿/, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) reject("SVG logos cannot contain a DOCTYPE or entities");
  if (/<\?(?!xml\s)/i.test(body)) reject("SVG logos cannot contain processing instructions");
  if (FORBIDDEN_ELEMENTS.test(body)) reject("SVG logos cannot contain scripts or embedded content");
  if (EVENT_HANDLER.test(body)) reject("SVG logos cannot contain event handlers");
  if (/javascript\s*:/i.test(body) || /@import/i.test(body)) {
    reject("SVG logos cannot contain scripts or external references");
  }
  if (/\ssrc\s*=/i.test(body)) reject("SVG logos cannot reference external files");
  if (/attributeName\s*=\s*["']?\s*(?:xlink:)?href/i.test(body)) {
    reject("SVG logos cannot animate links");
  }
  for (const pattern of [REFERENCE_ATTRIBUTE, CSS_URL]) {
    for (const match of body.matchAll(pattern)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (!value.startsWith("#")) reject("SVG logos cannot reference external files");
    }
  }
  // The root element must be <svg>, after an optional XML declaration and comments.
  const start = body
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .trimStart();
  if (!/^<svg[\s>]/i.test(start)) reject("The file is not a valid SVG image");
}

/**
 * Validates an uploaded logo: PNG, JPG, or SVG, at most 1 MB, with content that matches
 * its type. Returns the file extension.
 */
export function validateLogo(bytes: Uint8Array, contentType: string): LogoExtension {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(type in LOGO_TYPES)) reject("Upload a PNG, JPG, or SVG image");
  if (bytes.byteLength === 0) reject("The file is empty");
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new AppError(413, "logo_too_large", "The logo must be 1 MB or smaller");
  }
  const ext = LOGO_TYPES[type as LogoContentType];
  if (ext === "png" && !startsWith(bytes, PNG_MAGIC)) reject("The file is not a valid PNG image");
  if (ext === "jpg" && !startsWith(bytes, JPEG_MAGIC)) reject("The file is not a valid JPG image");
  if (ext === "svg") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      reject("The SVG file must be UTF-8 text");
    }
    assertSafeSvg(text);
  }
  return ext;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores a validated logo at its content-addressed key `logos/<sha256>.<ext>` and returns
 * the key. An existing object is never overwritten, and logos are never deleted, because
 * sent revision snapshots keep referencing old keys.
 */
export async function storeLogo(
  bucket: R2Bucket,
  bytes: Uint8Array,
  ext: LogoExtension,
): Promise<string> {
  const key = `${LOGO_PREFIX}${await sha256Hex(bytes)}.${ext}`;
  const existing = await bucket.head(key);
  if (!existing) {
    await bucket.put(key, bytes, { httpMetadata: { contentType: logoContentType(ext) } });
  }
  return key;
}
