// Response headers for rendered documents.

/** A random nonce for the inline theme style. */
export function cspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
}

/**
 * Headers for document HTML. Styles come only from /p/assets/* and the nonce'd inline
 * theme. No scripts at all. `frameAncestors` is 'self' for the in-app preview iframe.
 */
export function documentHeaders(
  nonce: string,
  frameAncestors: "'none'" | "'self'" = "'none'",
): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'none'",
      `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data:",
      "font-src 'self' data:",
      "form-action 'self'",
      "base-uri 'none'",
      `frame-ancestors ${frameAncestors}`,
    ].join("; "),
  };
}
