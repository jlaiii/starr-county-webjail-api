# AGENTS.md — working notes for AI agents / automation in this repo

This repo is the **public field guide + mirror + lookup app** for the Starr County
(TX) jail "Webjail" API (`http://64.225.20.254:3030`, read-only, undocumented by
the county). If you are an agent asked to *integrate with that API*, read
[`docs/05-pitfalls-for-agents.md`](docs/05-pitfalls-for-agents.md) first, then
`docs/01`–`04`. If you are an agent asked to *change this repo*, read on.

## Ground rules

1. **Never write to the county API.** `POST/PUT/PATCH/DELETE` are auth-protected
   and return `500 Unauthenticated`; anonymous access is strictly read-only. Do
   not fuzz the write verbs, do not probe for auth bypasses.
2. **Stay polite.** The box has no cache and no rate limit we have observed, but
   every `/inmates` page costs it a fresh Mongo query plus megabytes of base64.
   Poll at ≥1 min cadence, full scans at most hourly, always send a descriptive
   `User-Agent`, and prefer the cheap paths in [`docs/06-recipes.md`](docs/06-recipes.md)
   (`$limit=0` count, single-record fetch, `If-None-Match`, gzip).
3. **Stdlib only.** Everything in `tools/` and `examples/` uses Python 3 stdlib
   (no `requests`, no `pip install`). Keep it that way — the repo is meant to be
   copy-pasteable by any agent with a bare Python.
4. **No API keys, no personal data.** Everything served is already public county
   data. Never commit snapshots of individuals' mugshots or scraped rosters.
5. **UI rules (non-negotiable):** no emojis anywhere in user-facing UI, slim
   header (≈40 px), charges/bond visible at a glance, mobile-first (no
   horizontal overflow at 390 px), bilingual EN/ES with **both** language keys
   for every new string, respect `prefers-reduced-motion`.
6. **Cache-bust every UI deploy:** bump `?v=N` on both `styles.css` and `app.js`
   in `web/index.html`. GitHub Pages caches HTML for ~10 minutes; without the
   bump, users keep the old assets and report features as missing.

## Layout

```
docs/01-endpoints.md            every route, verb, status, header
docs/02-data-model.md           field dictionaries + observed enums
docs/03-query-behavior.md       what the API honors vs silently ignores
docs/04-lifecycle.md            hourly batch rhythm, release = deletion
docs/05-pitfalls-for-agents.md  checklist — read this first
docs/06-recipes.md              copy-paste patterns for common tasks
docs/07-realtime.md             the socket.io surface: what it does / doesn't do
examples/python/*.py            small, runnable, commented
examples/curl.md                curl one-liners
tools/api_probe.py              live conformance suite (asserts the docs)
tools/mirror.py                 county API -> GitHub Pages mirror (runs in Actions)
tools/jail.py                   one-file CLI: count / newest / find / show / photo / csv
web/                            the Pages app (index.html, styles.css, app.js)
schema/*.json                   JSON Schema for the two collections
.github/workflows/deploy.yml    hourly mirror + Pages deploy
```

## Verify before you claim anything

```bash
python3 tools/api_probe.py            # ~40 requests, asserts docs/01-05 against the live box
python3 tools/api_probe.py --full     # + full-roster data-model checks (~22 MB)
python3 tools/api_probe.py --json /tmp/probe.json --quiet   # machine-readable

# app changes: rebuild the mirror locally and serve it
python3 tools/mirror.py && cd _site && python3 -m http.server 8000
```

A check flipping to FAIL means the county changed something: fix the doc AND the
integration, never the check (unless the check itself was wrong — then fix the
check's expectation and say so in the commit message).

## Deploy loop (Pages app)

1. Edit `web/**` or `tools/**` on `main`, commit, push.
2. The workflow only triggers on `web/**`, `tools/**`, the workflow file itself,
   or a `workflow_dispatch` — docs-only commits do **not** rebuild the site.
3. Poll `GET /repos/jlaiii/starr-county-webjail-api/actions/runs?per_page=1` until
   `status=completed` and `conclusion=success`, then wait ~20 s for the artifact.
4. Verify the live URL over HTTP (fetch the HTML and the assets, grep for the
   change) — never trust the workflow status alone, and never claim a UI change
   is live without fetching it.
5. Tell the user to hard-refresh (or open `?v=N`) when they report a change
   missing: their browser may still hold the old HTML for up to ~10 minutes.

## Facts worth not re-deriving

- `$limit` / `$skip` / `$sort[field]` are the only honored query params; the cap
  is 50 records no matter what you ask for. Everything else is silently ignored.
- `createdAt` = API insert time (hourly batch at `:00:01` UTC). `updatedAt` is
  re-stamped on every record every hour — useless for change detection.
  `BookingID` (`YYYY######`) is the true chronological order.
- Releases are *deletions*: diff roster ID sets and confirm over two consecutive
  polls (the box transiently drops the whole roster).
- The id route is keyed on **`ptsSubjectID`**, not `ptsBookingID`:
  `GET /inmates/10260` returns one full record; `GET /inmates/10501` (a booking
  id) is a 404.
- Weak `ETag` + `If-None-Match` works: an unchanged page answers `304` with an
  empty body. gzip works if you ask for it. Connections are never reused
  (`Connection: close`).
