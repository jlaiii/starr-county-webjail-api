# Starr County (TX) Jail — Inmate Roster & Public Webjail Booking API

[![Live demo](https://img.shields.io/badge/LIVE%20demo-GitHub%20Pages-1d4ed8)](https://jlaiii.github.io/starr-county-webjail-api/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Live inmate roster & lookup for Starr County Jail, Rio Grande City, Texas**
— search current inmates by name or booking number, view mugshots, charges,
bonds and booking dates, with data pulled **directly from the county's public
Webjail feed** (updated hourly).

- 🌐 **Use it live**: <https://jlaiii.github.io/starr-county-webjail-api/>
- 📚 **API field guide** (for developers *and* AI agents): see [`docs/`](docs/)
- 💻 **Working code**: see [`examples/`](examples/)

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

- Search by name or booking number
- Sort: newest booking / name / booked date
- Tap any inmate for details + charges
- English 🇺🇸 / Español 🇲🇽 toggle, dark mode, mobile-first

Run it locally against a fresh mirror:
`python3 tools/mirror.py && cd _site && python3 -m http.server 8000`
→ <http://localhost:8000>

## Quick facts

| Fact | Value |
|---|---|
| Base URL | `http://64.225.20.254:3030` (HTTP, **not** HTTPS) |
| Auth | None for reads. Writes require county-side auth and return `500 Unauthenticated` anonymously |
| Format | JSON, FeathersJS-style envelopes: `{ "total": N, "limit": N, "skip": N, "data": [...] }` |
| CORS | `Access-Control-Allow-Origin: *` on every response (browser-friendly) |
| Services | `inmates`, `offences`, `attachments` (always empty), `inmate-detail/:pid` (custom), `inmates/get/genders-races` (custom) |
| Roster size | ~80–90 records (current custody only) |
| Record size | **~150–300 KB each** — every record embeds a base64 mugshot |
| Full-roster fetch | ~25 MB (2 pages × 50) — budget your polling |
| Data freshness | County batch-inserts new bookings hourly at ~`:00:01` UTC |
| Released inmates | **Records are deleted — no archive exists** |

## Quickstart

```bash
# Count current inmates (total is the full-collection count)
curl "http://64.225.20.254:3030/inmates?\$limit=0"

# Newest 5 bookings (createdAt = API insert time, see docs/04)
curl "http://64.225.20.254:3030/inmates?\$limit=5&\$sort[createdAt]=-1"

# All charges for one booking
curl "http://64.225.20.254:3030/inmate-detail/10438"
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

## Repo map

```
web/
  index.html / styles.css / app.js    self-contained lookup app (GitHub Pages)
tools/
  mirror.py                           hourly county-API -> Pages mirror
.github/workflows/
  deploy.yml                          cron: mirror + deploy Pages
docs/
  01-endpoints.md              every endpoint, verbs, statuses, envelopes
  02-data-model.md             field dictionaries, types, enums (as observed)
  03-query-behavior.md         what the API honors vs silently ignores
  04-lifecycle.md              how records appear, update, and vanish
  05-pitfalls-for-agents.md    agent cheat-sheet — read this FIRST
examples/
  python/
    fetch_roster.py            paginated roster fetch (+ optional mugshot save)
    watch_bookings.py          new-booking watcher (createdAt watermark)
    watch_releases.py          release watcher (removal detection, 2-phase confirm)
    inmate_card.py             booking + charges + mugshot, formatted output
  curl.md                      copy-paste curl one-liners
```

## Golden rules (the 30-second version)

1. **`$limit`/`$skip`/`$sort[field]` are honored. Everything else is silently ignored** — field filters, `$select`, `$or`, `$like`, `status=` all return the unfiltered collection. Never trust `total` from a filtered query.
2. **Page size caps at 50** no matter what you request.
3. **`createdAt` ≠ booking time.** It is when the county's hourly batch inserted the record (clustered at `:00:01` UTC; median ~22 h after `BookingDate`). `BookingID` (`YYYY######`) is the true chronological order.
4. **`updatedAt` is re-stamped on every record at the top of every hour** — useless for change detection; use `createdAt` watermarks instead.
5. **Every record is ~300 KB** (inline base64 mugshot). Full-roster scans are ~25 MB. Poll smart, cache hard.
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
