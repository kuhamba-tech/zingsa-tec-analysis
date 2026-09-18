# Cloudflare security activation

Repository protections are active after deployment. The controls below must also be enabled in the Cloudflare account for the production domain; code alone cannot activate Cloudflare's edge.

## Required deployment secrets

Set these in the production environment, never in `NEXT_PUBLIC_*` variables:

```env
ZGIIS_ENV=production
API_KEY=<long-random-value>
BROADCAST_ADMIN_KEY=<different-long-random-value>
CORS_ORIGINS=https://your-production-domain.example
MAX_REQUEST_BODY_BYTES=67108864
```

`NEXT_PUBLIC_API_KEY` is visible to every browser and must not be treated as a secret. Cloudflare rate limiting and Turnstile should protect public browser actions; private ingestion and administration must use server-side secrets.

## Cloudflare dashboard

1. Add the production domain to Cloudflare and verify every imported DNS record.
2. Proxy the web `A`, `AAAA`, or `CNAME` records (orange cloud). Do not proxy mail records.
3. Set SSL/TLS encryption mode to **Full (strict)**, enable **Always Use HTTPS**, and require TLS 1.2 or newer.
4. Enable the Cloudflare managed WAF ruleset and Bot Fight Mode (or Super Bot Fight Mode when included in the account plan).
5. Create rate-limiting rules, starting in log mode and reviewing legitimate traffic before blocking:
   - All `/api/*`: challenge unusually high request rates per IP.
   - `POST` upload, chat, processing, and broadcast routes: use a substantially lower rate.
   - Exempt authenticated machine-ingest routes only when they use a dedicated secret and known source addresses.
6. Create a WAF custom rule that applies a **Managed Challenge** to suspicious automated traffic targeting `/api/*`; allow verified search-engine bots when public indexing is desired.
7. Restrict the origin so it accepts traffic only through Cloudflare where the hosting architecture permits it. Vercel preview URLs remain separate origins and should use Vercel Deployment Protection.

## Turnstile verification

Create a Cloudflare Turnstile widget for the production hostname. Add it to public write actions such as chat and file uploads. Configure:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public-site-key>
TURNSTILE_SECRET_KEY=<private-server-key>
```

Every submitted Turnstile token must be validated by the backend using Cloudflare's Siteverify endpoint before the write is accepted. A client-side widget without server-side validation is not security.

## Verification after activation

- Confirm the domain resolves to Cloudflare anycast addresses and the DNS record is shown as proxied.
- Confirm HTTPS redirects and the security response headers.
- Test legitimate dashboard reads, uploads, chat, and administrator actions.
- Confirm repeated automated requests trigger a challenge or rate limit.
- Review Cloudflare Security Events and Turnstile token-validation analytics for false positives.
