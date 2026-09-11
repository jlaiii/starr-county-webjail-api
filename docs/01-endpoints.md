# Endpoints

Base URL: `http://64.225.20.254:3030` — plain HTTP, no key, no auth headers
needed for reads. All responses are JSON. Verified Sep 2026.

## Service list

| Service | Method | Description | Notes |
|---|---|---|---|
| `/inmates` | GET | Current-custody roster | The main collection. ~80–90 records |
| `/inmates/:ptsSubjectID` | GET | **One full record object** (no envelope) | The id route is keyed on `ptsSubjectID`, *not* `ptsBookingID`. Unknown → `404 No record found for id '…'`; non-numeric → `400 BadRequest … at path "ptsSubjectID"`. ~276 KB, ~250 ms — the cheapest way to re-check a single booking |
| `/offences` | GET | All charges for current bookings | Join to inmates via `ptsBookingID` |
| `/attachments` | GET | — | **Always `{total: 0, data: []}`** — dead collection |
| `/inmate-detail/:ptsBookingID` | GET | `{offences: [...], attachments: []}` | Custom route (not Feathers-standard) |
| `/inmates/get/genders-races` | GET | `{races: [...], genders: [...]}` | Custom method; narrower than real data |
| `/` | GET | Feathers welcome HTML | No API listing |
| `/socket.io/` | GET | Engine.IO v3 handshake (socket.io v2) | Realtime transport exists but emits no service events — see [07-realtime.md](07-realtime.md) |

Anything else (`/api`, `/docs`, `/swagger.json`, `/openapi.json`,
`/search`, `/history`, `/released-inmates`, `/ws`, ...) → `404`.

## Response envelope (list endpoints)

```json
{ "total": 82, "limit": 50, "skip": 0, "data": [ ...records... ] }
```

- `total` = size of the **entire collection** (not the page).
- `data` = the requested page. Empty array past the end of the collection.
- **Default page size is 10** when no `$limit` is given.
- `limit: 0` with `$limit=0` → cheap count: `{ "total": 82, "limit": 0, "skip": 0, "data": [] }`.

## HTTP verbs

| Verb | Behavior |
|---|---|
| `GET` | Read. The only thing that works anonymously |
| `HEAD` | `200`, no body, same headers as GET (`Content-Length` preserved) |
| `OPTIONS` | `204`, CORS headers, empty body |
| `POST` / `PUT` / `PATCH` / `DELETE` | `500 {"name":"GeneralError","message":"Unauthenticated",...}` — writes exist but are auth-protected. **Do not attempt writes.** |

The `Allow: GET,POST,PUT,PATCH,DELETE` header on collections is Feathers'
default and does **not** mean anonymous writes are possible.

## Status codes

- `200` — normal (including unknown `/inmate-detail/<n>` → `{"offences":[],"attachments":[]}`, **not** 404)
- `304` — `If-None-Match` matched the current weak `ETag`; empty body, resource unchanged
- `400` — malformed params or a non-numeric id on `/inmates/<id>` (the route casts to `ptsSubjectID`)
- `404` — unknown routes, unknown ids on `/inmates/<ptsSubjectID>`, unknown custom methods
- `500` — auth-required write attempts, or server-side errors

## Headers

- `Access-Control-Allow-Origin: *` — every response. CORS-friendly.
- No `Server`/`X-Powered-By` header — Feathers/Node behind a thin proxy.
- `Content-Type: application/json; charset=utf-8` on JSON routes.
- `ETag: W/"…"` (weak) on every JSON response — send it back as `If-None-Match`
  and an unchanged resource answers `304` with an empty body (verified: a 13 MB
  roster page costs *zero* bytes when nothing changed).
- `Content-Encoding: gzip` when you send `Accept-Encoding: gzip` (~25–35% smaller;
  stdlib `urllib` and `curl` do **not** ask for it by default, `requests` does).
- `Connection: close` — no keep-alive: every request pays a fresh TCP handshake.
- Hardening headers present: `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `X-DNS-Prefetch-Control: off`,
  `X-Download-Options: noopen`, `Vary: Accept, Accept-Encoding`.

## Sorting quick reference

```text
# Most useful sort keys (all verified working):
$sort[createdAt]=-1        newest-inserted booking first   (new-booking watchers)
$sort[BookingID]=-1        newest booking number first      (true booking order)
$sort[BookingDate]=-1      newest booked-date first         (ties in arbitrary order)
$sort[LastName]=1          alphabetical
$sort[updatedAt]=-1        NOT useful: re-stamped hourly on every record
```

See [03-query-behavior.md](03-query-behavior.md) for the full semantics.
