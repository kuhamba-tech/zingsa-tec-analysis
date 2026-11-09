# ZINGSA Scientific RAG — Architecture Assessment & Plan

## Phase 1 — Existing architecture (brief)

| Layer | What exists today |
| --- | --- |
| Frontend | Next.js App Router under `frontend/` (Vercel) |
| Backend | FastAPI under `backend/` + `zgiis/` science packages |
| Database | Supabase Postgres only (`SUPABASE_DATABASE_URL` / pooler) |
| Reports | Deterministic narrative in `zgiis/space_weather/report_narrative.py` + `report_builder.py`; UI `SpaceWeatherReportsPanel` |
| AI today | OpenAI Responses API via `zgiis/ai/assistant.py` + `/chat` — live context injected, no literature retrieval |
| Auth | Optional `API_KEY`; admin keys for broadcast/GIC — no end-user OAuth roles yet |
| Background jobs | Render workers / local schedulers; Vercel crons for navigation news & early warning (`maxDuration` 60s) |
| Vector DB | **None** — no pgvector / embeddings tables before this work |

Observation sources (unchanged): ZINGSA CORS/NTRIP → `vtec_obs`; NOAA SWPC; NASA DONKI; Kyoto Dst/ASYSYM; Spider status.

**Integrity rule (binding):** RAG may cite literature; numerical report values must remain archive/live measurements. When Drive/RAG is unavailable, reports stay measurement-only.

## Implementation decisions

1. **Start with Drive sync + indexing + citation verification**, then wire literature into Daily Reports.
2. **Google credentials stay in `backend/.env`** — folder ID / OAuth / service account never shipped to the browser.
3. **Postgres tables** for documents/chunks; embeddings as `REAL[]` with in-process cosine (enable `pgvector` later if desired).
4. **Incremental sync batches** so Vercel/serverless can run short sync ticks; long backfills belong on Render/local worker.
5. **Reuse OpenAI** for embeddings + grounded answers when `OPENAI_API_KEY` is set; otherwise retrieval returns passages only.
6. **Admin gate** uses `X-Scientific-Rag-Admin-Key` (falls back to `API_KEY` / `BROADCAST_ADMIN_KEY`).

## Env variables (server-only)

```
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_OAUTH_CLIENT_ID=
GOOGLE_DRIVE_OAUTH_CLIENT_SECRET=
GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=
# optional alternative to OAuth refresh flow:
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE=
SCIENTIFIC_RAG_ADMIN_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
SCIENTIFIC_RAG_ENABLED=true
```

Put the Drive folder link/ID only in backend env — never in chat or frontend `NEXT_PUBLIC_*`.

## Remaining limitations (v1)

- Full OAuth browser consent UI is stubbed; production connect path uses refresh token / service account in env.
- Equation/table structure extraction is best-effort plain text.
- Human review workflow for auto-drafted reports is not yet a full approval queue.
- Hybrid search is keyword + embedding cosine; dedicated reranker model can follow.
