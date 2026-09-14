/* Where a redirect is allowed to send someone.
 *
 * A `next` value arrives from the URL bar - /login?next=/recipes/create - which
 * means anybody can put anything in it. Handing it straight to router.push would
 * make every link to the login page a redirect to any site on the internet, which
 * is the open-redirect bug: the address bar says our domain, the page you land on
 * is not. So a value is used only if it is an absolute path on this site, and
 * anything else quietly falls back.
 */

/** The requested path if it is safe to navigate to, otherwise `fallback`. */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;

  // Browsers ignore surrounding whitespace when resolving a URL, so " //evil.com"
  // has to be measured the way the browser will read it, not as it arrives.
  const path = next.trim();

  // Must be rooted here. A bare "recipes/create" is relative to whatever page is
  // open, and "https://..." is somebody else's site.
  if (!path.startsWith("/")) return fallback;

  /* "//host" is a protocol-relative URL - it begins with a slash and still
   * points at another origin. Browsers normalise a backslash to a forward slash
   * in this position, so "/\host" is the same trick spelled differently. */
  if (path.startsWith("//") || path.startsWith("/\\")) return fallback;

  return path;
}
