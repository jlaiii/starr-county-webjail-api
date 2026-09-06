# Endpoints

Base URL: `http://64.225.20.254:3030` — plain HTTP, no key, no auth headers
needed for reads. All responses are JSON. Verified Sep 2026.

## Service list

| Service | Method | Description | Notes |
|---|---|---|---|
| `/inmates` | GET | Current-custody roster | The main collection. ~80–90 records |
| `/offences` | GET | All charges for current bookings | Join to inmates via `ptsBookingID` |
| `/attachments` | GET | — | **Always `{total: 0, data: []}`** — dead collection |
| `/inmate-detail/:ptsBookingID` | GET | `{offences: [...], attachments: []}` | Custom route (not Feathers-standard) |
| `/inmates/get/genders-races` | GET | `{races: [...], genders: [...]}` | Custom method; narrower than real data |
| `/` | GET | Feathers welcome HTML | No API listing |

Anything else (`/api`, `/docs`, `/swagger.json`, `/openapi.json`,
`/search`, `/history`, `/released-inmates`, ...) → `404`.

## Response envelope (list endpoints)

```json
{ "total": 82, "limit": 50, "skip": 0, "data": [ ...records... ] }
```

- `total` = size of the **entire collection** (not the page).
- `data` = the requested page. Empty array past the end of the collection.
- `limit: 0` with `$limit=0` → cheap count: `{ "total": 82, "limit": 0, "skip": 0, "data": [] }`.

## HTTP verbs

| Verb | Behavior |
|---|---|
| `GET` | Read. The only thing that works anonymously |
| `HEAD` | 200, no body, same headers as GET |
| `OPTIONS` | 204, CORS headers |
| `POST` / `PUT` / `PATCH` / `DELETE` | `500 {"name":"GeneralError","message":"Unauthenticated",...}` — writes exist but are auth-protected. **Do not attempt writes.** |

The `Allow: GET,POST,PUT,PATCH,DELETE` header on collections is Feathers'
default and does **not** mean anonymous writes are possible.

## Status codes

- `200` — normal (including unknown `/inmate-detail/<n>` → `{"offences":[],"attachments":[]}`, **not** 404)
- `400` — malformed Feathers params (e.g. `/inmates/count` treated as an id route)
- `404` — unknown routes / unknown custom methods
- `500` — auth-required write attempts, or server-side errors

## Headers

- `Access-Control-Allow-Origin: *` — every response. CORS-friendly.
- No `Server`/`X-Powered-By` header — Feathers/Node behind a thin proxy.
- `Content-Type: application/json; charset=utf-8` on JSON routes.

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
