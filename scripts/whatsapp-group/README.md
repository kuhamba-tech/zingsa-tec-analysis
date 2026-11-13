# Existing WhatsApp group alert sender

This is a persistent local sender for the existing ZINGSA alert API, using `whatsapp-web.js` and the installed browser. It sends directly to the configured WhatsApp **group chat**, never substitutes individual messages to group members, and does not use the old individual-recipient Cloud API adapter.

This library automates WhatsApp Web; it is not Meta's official Business API. A phone-approved linked session and an always-running computer or persistent host are required. It does not run inside a Vercel serverless function. The deployed alert evaluation schedule remains independent of this local delivery worker.

## Private setup

The actual supplied phone number and invitation are saved in `.whatsapp-alerts/config.private.json`, which is ignored by Git. The structure is:

```json
{
  "sender_phone": "INTERNATIONAL_DIGITS_WITHOUT_PLUS",
  "group_invite_url": "https://chat.whatsapp.com/YOUR_GROUP_INVITATION",
  "api_base": "https://YOUR_PROJECT.vercel.app",
  "poll_seconds": 60,
  "enabled": true
}
```

Install in this directory with `PUPPETEER_SKIP_DOWNLOAD=true npm ci` when using an existing Chrome/Edge installation. `WHATSAPP_BROWSER_PATH` can identify the installed browser explicitly. The package includes a lockfile; no browser binary download is needed for the configured Windows environment.

Start with `powershell -File scripts/whatsapp-group/start.ps1` from the project root, or `npm start` in this directory. Keep that process and computer running. Visit **http://127.0.0.1:8788** on the sender computer. The page shows the live linking code; approve it on the sending phone through WhatsApp's Linked devices flow. The code refreshes automatically. Never paste phone OTPs, pairing codes, invitation tokens or session files into source control or a public page.

The sender verifies that the linked account matches the configured number, resolves the supplied invitation, verifies a group chat, and uses existing group membership or the supplied invitation. If administrator membership approval is needed, delivery stays paused. A wrong account or unresolved group never falls back to another destination.

Session/cache files, private configuration, pairing state and delivery records all remain under ignored `.whatsapp-alerts/`. The linking/status server binds only to loopback, sends no CORS permission, rejects non-loopback Host names and supports only reads. Its page does not expose a general-purpose send endpoint. Linked account history may be persisted locally by the WhatsApp Web session; protect this directory as account credentials.

If the alert API requires an API key, set `API_KEY` privately in the worker process environment. The invitation, credentials and sender number are not stored in the tracked package files. The sender uses the application's actual Vercel group-router URLs, rather than assuming a `/gic/ingest`-style public route.

## Delivery behaviour

- Poll existing active/watch early-warning records every 60 seconds; no simulated alerts.
- Require an actual recent observation timestamp; ignore resolved/stale records and unknown timestamps.
- Preserve experimental driver-watch labels and source/observation time. Do not describe driver risk as confirmed local impact.
- GIC messages require genuine fresh current flags, non-provisional recorded site approval and the existing engineering-action eligibility flag. No missing-field-data or EKF prediction warnings are generated.
- Deduplicate accepted messages by destination group and alert identity/severity/status. Persist only after WhatsApp returns an accepted message ID. Failed sends remain eligible; a definite negative message acknowledgement permits retry.
- Show acceptance separately from delivery acknowledgement. An accepted API call does not prove every participant read a message.
- Pause on disconnected sessions or unverified groups. Report source failures rather than inventing alerts or silently using another destination.

No messages are sent merely to test account setup. The first real sends occur only after phone approval, sender verification, group verification and selection of genuine eligible alert records. A crash between remote message acceptance and local checkpoint persistence can produce a duplicate on restart; the worker does not claim exactly-once network delivery.

## Checks

Run `npm test` in this directory. The six tests cover actual group-only destination validation, Vercel routing, freshness/scientific labels, GIC restrictions, successful-message deduplication and retry after failure. They use fixtures and do not contact WhatsApp or send messages.

The actual account session and group delivery must be verified after the phone approves linking. Until then, status is **pending phone approval**, not connected or delivered.
