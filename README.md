# Starr County (TX) Jail — Inmate Roster & Public Webjail Booking API

[![Live demo](https://img.shields.io/badge/LIVE%20demo-GitHub%20Pages-1d4ed8)](https://jlaiii.github.io/starr-county-webjail-api/)
[![Docs: live-asserted](https://img.shields.io/badge/docs-live--asserted-0f7a4a)](#verify-the-docs-against-the-live-api)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Live inmate roster & lookup for Starr County Jail, Rio Grande City, Texas**
— search current inmates by name or booking number, view mugshots, charges,
bonds and booking dates, with data pulled **directly from the county's public
Webjail feed** (updated hourly).

- **Use it live**: <https://jlaiii.github.io/starr-county-webjail-api/>
- **API field guide** (for developers *and* AI agents): [`docs/`](docs/) —
  endpoints, data model, query behavior, lifecycle, pitfalls, recipes, and a
  realtime study
- **Live test suite**: [`tools/api_probe.py`](tools/api_probe.py) — ~40
  read-only checks that assert every documented behavior against the county box
- **CLI + working code**: [`tools/jail.py`](tools/jail.py)
  (count / newest / find / show / photo / csv) and [`examples/`](examples/)
- **Machine-readable**: [`schema/`](schema/) JSON Schemas,
  [`llms.txt`](llms.txt) (one-page LLM index, also served at the site root),
  [`AGENTS.md`](AGENTS.md) (rules for agents editing this repo)

The county publishes no roster page on its own website — its booking system
feeds this public Webjail API, which is what this project documents, mirrors,
and turns into a friendly lookup UI.

A reverse-engineered field guide, reference documentation, and working code
for the **read-only public API** behind Starr County, Texas's jail roster
(the data source for the county's Webjail-style inmate lookup site).

Built and verified against the live endpoint in **September 2026**. The API is
**undocumented** by the county — everything here was learned by direct
observation. Treat field names/behaviors as stable-but-unconfirmed.

> Written primarily for **AI agents** that need to integrate with this API
> fast and correctly. Start with [`docs/05-pitfalls-for-agents.md`](docs/05-pitfalls-for-agents.md),
> then read the other docs in order. Copy-paste code lives in [`examples/`](examples/).

## Live demo (GitHub Pages)

<https://jlaiii.github.io/starr-county-webjail-api/> — a self-contained,
mobile-friendly web app. **A GitHub Actions workflow (`.github/workflows/
deploy.yml`) mirrors the county API hourly** (roster + charges + mugshots)
into the Pages site (`tools/mirror.py`), so the app is fast and needs no
CORS relay or runtime calls to the county — data.json and lazy-loaded
mugshot files come from the same origin over HTTPS.

- Mugshot roster grid (5-up on desktop, 2-up on phones) showing name, booking
  number, "booked today/yesterday/N days ago", charge count, bond and age at a
  glance, with a designed placeholder for county-withheld photos
- Photo wall view for browsing faces, and a full inmate file per person: photo,
  age / DOB / height / weight / eyes / hair, plus every charge with its level,
  bond, arresting agency and arrest date and the booking's total bond
- Search matches name, booking number and charge text; gender filter; nine sorts
  (newest booking, name, booked date, oldest/youngest, heaviest/lightest,
  tallest/shortest)
- Stat band (in custody / men / women / with photo), live status line,
  English/Spanish toggle, light/dark toggle, mobile-first — no third-party
  scripts, no trackers, no cookies

Run it locally against a fresh mirror:
`python3 tools/mirror.py && cd _site && python3 -m http.server 8000`,
then open <http://localhost:8000>

## Quick facts

| Fact | Value |
|---|---|
| Base URL | `http://64.225.20.254:3030` (HTTP, **not** HTTPS) |
| Auth | None for reads. Writes require county-side auth and return `500 Unauthenticated` anonymously |
| Format | JSON, FeathersJS-style envelopes: `{ "total": N, "limit": N, "skip": N, "data": [...] }` |
| CORS | `Access-Control-Allow-Origin: *` on every response (browser-friendly) |
| Services | `inmates`, `offences`, `attachments` (always empty), `inmate-detail/:pid` (custom), `inmates/get/genders-races` (custom), `inmates/:ptsSubjectID` (single record) |
| Roster size | ~80–90 records (current custody only) |
| Record size | **~150–300 KB each** — every record embeds a base64 mugshot |
| Page size | default 10, **hard cap 50**; `$limit=0` = cheap count (41 bytes) |
| Full-roster fetch | ~22 MB (2 pages × 50) — budget your polling |
| Cheapest change check | `If-None-Match: <ETag>` → `304` with an empty body; gzip supported |
| Data freshness | County batch-inserts new bookings hourly at ~`:00:01` UTC |
| Released inmates | **Records are deleted — no archive exists** |
| Realtime | `/socket.io/` answers a handshake but emits no events — poll instead ([07](docs/07-realtime.md)) |
| Docs accuracy | Asserted by [`tools/api_probe.py`](tools/api_probe.py) against the live box: 44 checks, last run 2026-09-11 ([how to re-run](#verify-the-docs-against-the-live-api)) |

## Quickstart

```bash
# Count current inmates (total is the full-collection count)
curl "http://64.225.20.254:3030/inmates?\$limit=0"

# Newest 5 bookings (createdAt = API insert time, see docs/04)
curl "http://64.225.20.254:3030/inmates?\$limit=5&\$sort[createdAt]=-1"

# Charges for one booking (ptsBookingID from a roster record)
curl "http://64.225.20.254:3030/inmate-detail/10501"

# One full record, no paging (the id route is keyed on ptsSubjectID)
curl "http://64.225.20.254:3030/inmates/10260"
```

```python
# stdlib only — no dependencies
import json, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "my-agent/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())

roster = get("http://64.225.20.254:3030/inmates?$limit=50&$skip=0&$sort[createdAt]=-1")
print(roster["total"], "in custody; newest:", roster["data"][0]["FirstName"], roster["data"][0]["LastName"])
```

Or skip the plumbing and use the included CLI:

```bash
python3 tools/jail.py count                     # e.g. "83 in custody · 214 charge rows"
python3 tools/jail.py newest 5                  # latest bookings with charges/bond
python3 tools/jail.py find "PENA"               # name search (walks the roster client-side)
python3 tools/jail.py show 10260                # one record + charges (ptsSubjectID or BookingID)
python3 tools/jail.py photo 10493 --out mugshots
python3 tools/jail.py csv --out roster.csv
```

Add `--json` to any command for machine-readable output — handy inside agent
loops.

## Verify the docs against the live API

The docs are asserted, not just written down. One command re-checks every claim:

```bash
python3 tools/api_probe.py            # ~40 read-only checks, ~10 s, ~2 MB
python3 tools/api_probe.py --full     # + full-roster data-model checks (~22 MB)
python3 tools/api_probe.py --json /tmp/probe.json --quiet   # machine-readable
```

Last run: **2026-09-11 — quick suite 38 passed / 0 failed / 2 informational
(10 s, ~2 MB); `--full` 44 passed / 0 failed / 5 informational (15 s, ~22 MB).**
A check flipping to FAIL means the county changed the box: fix the doc and your
integration, then re-run.

## Repo map

```
web/
  index.html / styles.css / app.js    self-contained lookup app (GitHub Pages)
tools/
  api_probe.py                        live conformance suite — asserts docs/01-05
  jail.py                             stdlib CLI: count / newest / find / show / photo / csv
  mirror.py                           hourly county-API -> Pages mirror
.github/workflows/
  deploy.yml                          cron: mirror + deploy Pages
docs/
  01-endpoints.md              every endpoint, verbs, statuses, envelopes, headers
  02-data-model.md             field dictionaries, types, enums (as observed)
  03-query-behavior.md         what the API honors vs silently ignores
  04-lifecycle.md              how records appear, update, and vanish
  05-pitfalls-for-agents.md    agent cheat-sheet — read this FIRST
  06-recipes.md                copy-paste patterns (cheap counts, single record, watchers, exports)
  07-realtime.md               the socket.io surface: handshake yes, events no
schema/
  inmates.schema.json          JSON Schema for a roster record
  offences.schema.json         JSON Schema for a charge row
examples/
  python/
    fetch_roster.py            paginated roster fetch (+ optional mugshot save)
    watch_bookings.py          new-booking watcher (createdAt watermark)
    watch_releases.py          release watcher (removal detection, 2-phase confirm)
    inmate_card.py             booking + charges + mugshot, formatted output
  curl.md                      copy-paste curl one-liners
AGENTS.md                      rules + conventions for AI agents editing this repo
llms.txt                       one-page index for LLMs (also served at the site root)
```

## Golden rules (the 30-second version)

1. **`$limit`/`$skip`/`$sort[field]` are honored. Everything else is silently ignored** — field filters, `$select`, `$or`, `$like`, `status=` all return the unfiltered collection. Never trust `total` from a filtered query.
2. **Page size caps at 50** no matter what you request (default is 10); `$limit=0` is a 41-byte count.
3. **`createdAt` ≠ booking time.** It is when the county's hourly batch inserted the record (clustered at `:00:01` UTC; median ~21 h after `BookingDate`). `BookingID` (`YYYY######`) is the true chronological order.
4. **`updatedAt` is re-stamped on every record at the top of every hour** — useless for change detection; use `createdAt` watermarks instead.
5. **Every record is ~300 KB** (inline base64 mugshot). Full-roster scans are ~22 MB. Poll smart: `$limit=0` to count, `If-None-Match` to detect change (**304 = zero bytes**), `Accept-Encoding: gzip` to shrink everything by 25–35%, and `GET /inmates/<ptsSubjectID>` to re-check one booking.
6. **Released = deleted.** No tombstone, no archive. Detect releases by diffing roster ID sets across polls, and confirm across 2+ polls (the box occasionally drops the whole roster for a sync).
7. **Be polite.** It's a public safety system, unthrottled as far as we can tell. Keep request rates low (a poll per minute is already aggressive), cache responses, and never attempt writes.

## Data notes

- Public safety data published by Starr County, TX. All data shown is already
  public on the county's roster site. Do not use for life-safety decisions —
  no warranty, records can lag or contain county entry errors.
- Observed quirks (recorded Sep 2026): `StatuteLevel` contains typos
  (`"MISDEMEANO"`); `Race` on current roster is almost all `WHITE`; the
  `genders-races` endpoint lists a narrower enum than the data.

## License

MIT — see [LICENSE](LICENSE).
