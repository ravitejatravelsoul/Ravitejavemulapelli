import "server-only";

/**
 * Rewrites local, relative `href`/`src` references in a served HTML
 * entry file so the browser's own follow-up requests for sibling
 * resources (styles.css, script.js) carry the same preview auth token
 * the entry file itself was requested with — see
 * app/office/preview/[projectId]/[...path]/route.ts's docblock for why:
 * a sandboxed, `allow-scripts`-only iframe never sends cookies for any
 * of its own requests, so the token has to travel in the URL instead.
 *
 * Deliberately narrow: only touches attribute values that are local and
 * relative (no scheme, not root-relative, not a fragment or data URI) —
 * absolute paths and external URLs are left untouched, since those were
 * never going to be authenticated by this route anyway.
 */

const LOCAL_HREF_ATTR = /(href|src)="([^"]+)"/g;

export function isLocalRelativePath(value: string): boolean {
  return !/^([a-z]+:)?\/\//i.test(value) && !value.startsWith("/") && !value.startsWith("#") && !value.startsWith("data:");
}

export function rewriteLocalResourceLinks(html: string, token: string): string {
  return html.replace(LOCAL_HREF_ATTR, (match, attr: string, value: string) => {
    if (!isLocalRelativePath(value)) return match;
    const separator = value.includes("?") ? "&" : "?";
    return `${attr}="${value}${separator}token=${encodeURIComponent(token)}"`;
  });
}
