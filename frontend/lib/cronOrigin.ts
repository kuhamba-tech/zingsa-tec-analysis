/**
 * Cron invocations arrive on the deployment host, which is behind Vercel
 * sign-in. A follow-up call to that same host is redirected away from the
 * API. The public production address is the one the API actually serves.
 */
export function cronApiOrigin(): string {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) {
    const host = production.replace(/\/$/, "");
    return host.startsWith("http") ? host : `https://${host}`;
  }
  return "https://zingsa-gnss-tec.vercel.app";
}
