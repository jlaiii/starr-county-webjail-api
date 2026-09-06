# Query behavior — what works and what is silently ignored

This is the single most important document for writing correct code against
this API. The endpoint **looks** like a FeathersJS/Mongo query API and then
ignores most of the query language.

## Honored (verified)

| Param | Behavior | Example |
|---|---|---|
| `$limit` | Page size. **Hard cap 50.** `$limit=60` returns 50. `$limit=0` returns an empty `data` with the true `total` (cheap count) | `?$limit=50` |
| `$skip` | Offset. Past the end → empty `data`, `total` unchanged | `?$skip=50` |
| `$sort[field]` | Asc/desc by any real field: `-1` desc, `1` asc. Verified: `createdAt`, `updatedAt`, `BookingID`, `BookingDate`, `LastName`, `DOB` | `?$sort[createdAt]=-1` |

Only these three. Everything else in the rest of this doc is ignored.

## Silently ignored (all verified Sep 2026)

```text
?status=released            → same collection as no filter
?LastName=PENA              → full collection
?ptsBookingID=5185          → full collection
?ptsBookingID[$ne]=5185     → full collection
?BookingID[$gt]=2026001900  → full collection
?$or[0][...]&$or[1][...]    → full collection
?LastName[$like]=%PENA%     → full collection
?$select=ptsBookingID,...   → full records (mugshot included)
?$select[]=ptsBookingID     → full records
?released=1 / ?isReleased=true → full collection
```

**The server never errors on unknown params — it just ignores them.**
Consequences:

- **Never trust `total` from a "filtered" request.** `total` is always the
  full collection count. Filter client-side after fetching.
- **There is no server-side name search.** Fetch pages and match in your
  code (names are uppercase; match case-insensitively).
- **There is no released archive or status flag.** "Released" data does not
  exist server-side at all.

## Ordering semantics

- **No `$sort`** → records come back in insertion order (oldest first —
  the first record is the longest-tenured inmate).
- Tie-breaks on `$sort[BookingDate]` etc. are **not deterministic** — two
  records with the same date can come back in any order. When you need
  stable ordering, sort by `BookingID` (unique, zero-padded, chronological).
- Sorts are string sorts on the raw values (safe for `BookingID`, dates;
  be careful with numeric-looking strings that aren't zero-padded).

## Full page walk

```python
# stdlib-only pagination that stops on a short page (roster is ~2 pages)
def fetch_all(path):
    items, skip = [], 0
    while True:
        d = get(f"http://64.225.20.254:3030{path}?$limit=50&$skip={skip}")
        batch = d.get("data", [])
        items.extend(batch)
        if len(batch) < 50:
            break
        skip += 50
    return items
```

Do **not** loop on `total` alone — if a county re-sync momentarily returns a
stale `total`, you can stop early and miss the tail (a bug we hit in
production). Stop on the short page.

## Polite usage notes

- No rate limits were observed, but the box is an unauthenticated public
  system with no caching — every request costs it a fresh Mongo query plus
  ~300 KB of base64 per record. Keep polling modest (≥1 min cadence for
  watchers), cache aggressively, and reuse one connection where possible.
- Always send a descriptive `User-Agent` (`curl`, Python `urllib`, or your
  agent name — the box serves them all).
