/** Ensure pathname has a trailing slash (keeps ?query and #hash). */
export function withTrailingSlash(href: string): string {
  if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:")) {
    return href;
  }
  const hashIdx = href.indexOf("#");
  const queryIdx = href.indexOf("?");
  let cut = href.length;
  if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
  if (queryIdx >= 0) cut = Math.min(cut, queryIdx);
  const path = href.slice(0, cut);
  const rest = href.slice(cut);
  if (path === "/" || path.endsWith("/")) return href;
  // Leave file-like paths alone (e.g. /downloads/foo.zip)
  const last = path.split("/").pop() ?? "";
  if (last.includes(".")) return href;
  return `${path}/${rest}`;
}
