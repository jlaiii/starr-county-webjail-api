# Recipes — copy-paste patterns for the Starr County webjail API

Every snippet here is stdlib-only Python 3 and was run against the live box.
Status: **verified 2026-09-11** — `python3 tools/api_probe.py` → 38 passed,
0 failed, 2 informational (~10 s, ~2 MB of traffic).

Read [`05-pitfalls-for-agents.md`](05-pitfalls-for-agents.md) before adapting
these; the three that bite hardest are *filters are ignored*, *`updatedAt` is
useless*, and *the id route is keyed on `ptsSubjectID`*.

## Cost table — pick the cheapest request that answers your question

| Question | Request | Payload |
|---|---|---|
| How many inmates? | `/inmates?$limit=0` | 41 bytes |
| Anything new? (unchanged) | same URL + `If-None-Match: <etag>` | **304, 0 bytes** |
| Anything new? (changed) | `$limit=1&$sort[createdAt]=-1` + gzip | ~200 KB wire |
| One booking's full record | `/inmates/<ptsSubjectID>` | ~200 KB wire (gzip) |
| One booking's charges | `/inmate-detail/<ptsBookingID>` | ~1 KB |
| All charges | `/offences?$limit=50&$skip=…` | ~1 KB/page |
| Whole roster | 2 × `/inmates?$limit=50` (+gzip) | ~22 MB (≈15 MB gzipped) |

Default page size is **10**; the cap is **50** regardless of what you ask.

## Shared helper (handles gzip + conditional GET)

```python
import gzip, json, time, urllib.request, urllib.error

BASE = "http://64.225.20.254:3030"
UA = "my-agent/1.0 (read-only; contact: me@example.com)"

def get_json(path, etag=None, timeout=30):
    """Returns (status, data_or_None, etag). status 304 = unchanged since etag."""
    h = {"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"}
    if etag:
        h["If-None-Match"] = etag
    req = urllib.request.Request(BASE + path, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)          # urllib never does this for you
            return r.status, json.loads(body), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:                             # unchanged: 0 bytes on the wire
            return 304, None, e.headers.get("ETag")
        raise
```

## 1. Cheap count and "what's newest"

```python
status, d, _ = get_json("/inmates?$limit=0")
print(d["total"], "in custody")                       # total is ALWAYS the collection size

status, d, _ = get_json("/inmates?$limit=1&$sort[createdAt]=-1&$sort[BookingID]=-1")
top = d["data"][0]
print(top["BookingID"], top["LastName"], top["createdAt"])   # createdAt = insert time
```

`$limit=0` also works together with `$sort` and returns `{"total":N,"limit":0,"skip":0,"data":[]}`.

## 2. Fetch exactly one booking (the id route)

```python
status, d, _ = get_json("/inmates?$limit=1&$sort[createdAt]=-1")
subj = d["data"][0]["ptsSubjectID"]

status, rec, _ = get_json(f"/inmates/{subj}")         # -> a single record OBJECT
print(status, rec["LastName"], rec["BookingID"])
```

- The route key is **`ptsSubjectID`** (a person/subject id). `GET /inmates/<ptsBookingID>` → `404 No record found for id '…'`; `GET /inmates/<anything non-numeric>` → `400 BadRequest: Cast to number failed … at path "ptsSubjectID"`.
- One record ≈ 240 ms / ~276 KB raw (~200 KB gzipped) — far cheaper than paging a 13 MB page.
- There is still **no** way to fetch by booking number; search client-side (recipe 5).

## 3. Cheap change detection with `If-None-Match`

```python
etag = None
while True:
    status, d, etag = get_json("/inmates?$limit=50&$skip=0&$sort[createdAt]=-1", etag=etag)
    if status == 304:
        print("roster page unchanged — 0 bytes")
    else:
        print("page changed:", d["data"][0]["BookingID"])
    time.sleep(60)
```

The box returns a weak `ETag` on every response and honors `If-None-Match`
(verified: repeat request → `304`, empty body, ~280 ms). The server still runs
the query, so this saves bandwidth, not county CPU — keep the cadence polite.

## 4. Walk the whole roster (stop on a short page)

```python
def fetch_roster():
    out, skip = [], 0
    while True:
        status, d, _ = get_json(f"/inmates?$limit=50&$skip={skip}&$sort[createdAt]=-1")
        batch = d["data"]
        out += batch
        if len(batch) < 50:        # stop on the SHORT page, not on len(out) == total
            return out
        skip += 50
```

Never loop on `total` alone: a transient stale `total` makes you stop early and
silently miss the tail. ~22 MB raw, ~15 MB gzipped for the current ~83 records.

## 5. Find a person by name (there is no server-side search)

```python
def find(needle, roster):
    q = needle.strip().lower()
    hits = []
    for r in roster:                                   # EVERY page, not just the first
        name = " ".join(x for x in (r["FirstName"], r["MiddleName"], r["LastName"]) if x)
        if q in name.lower() or q in r["BookingID"]:
            hits.append(r)
    return hits
```

Same-surname people are common (STARR COUNTY is a border county — many shared
surnames). Two rows with the same name can be two different people: compare
`ptsPersonID` / `ptsSubjectID` before assuming a duplicate.

## 6. Save mugshots (and respect the publication flag)

```python
import base64, pathlib

def save_mugshot(rec, outdir="mugshots"):
    if rec.get("PublishImageToWebjail") is False:       # county withheld the photo
        return None
    blob = rec.get("MugShotFileStream")
    if not blob:
        return None
    if blob.startswith("data:"):                        # defensive: older records
        blob = blob.split(",", 1)[1]
    raw = base64.b64decode(blob)
    ext = ".png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    p = pathlib.Path(outdir) / f"{rec['ptsBookingID']}{ext}"   # unique per booking
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw)
    return p
```

Observed: 100% of current mugshots are raw base64 **PNG**, 276 KB base64 median
(range 207–355 KB ⇒ ~155–266 KB decoded), and ~12% of records carry
`PublishImageToWebjail: false` (no public photo).

## 7. Export roster + charges to CSV / NDJSON

```python
import csv, io, json

roster = fetch_roster()
status, charges, _ = get_json("/offences?$limit=50&$skip=0")
by_booking = {}
for c in charges:                                    # page through all /offences pages too
    by_booking.setdefault(c["ptsBookingID"], []).append(c)

with open("roster.csv", "w", newline="") as fh:
    w = csv.writer(fh)                               # csv module handles the quoting
    w.writerow(["bookingID", "ptsBookingID", "name", "booked", "dob", "gender", "race",
                "height", "weight", "charges", "bond_total"])
    for r in roster:
        cs = by_booking.get(r["ptsBookingID"], [])
        bond = sum(c.get("BondAmount") or 0 for c in cs)
        w.writerow([r["BookingID"], r["ptsBookingID"], f'{r["LastName"]}, {r["FirstName"]}',
                    r["BookingDate"][:10], r["DOB"][:10], r["Gender"], r["Race"],
                    r["Height"], r["Weight"],
                    " | ".join(c["StatuteDescription"] for c in cs), bond])

with open("roster.ndjson", "w") as fh:                # one JSON object per line = agent-friendly
    for r in roster:
        r = dict(r, charges=by_booking.get(r["ptsBookingID"], []))
        r.pop("MugShotFileStream", None)             # keep NDJSON small
        fh.write(json.dumps(r) + "\n")
```

Agency names contain apostrophes (`STARR COUNTY SHERIFF'S OFFICE`) and charge
descriptions contain commas — let `csv` quote for you; never hand-roll it.

## 8. Watch for new bookings (watermark on `createdAt`)

```python
seen, watermark = set(), None
while True:
    status, d, _ = get_json("/inmates?$limit=1&$sort[createdAt]=-1")
    newest = d["data"][0]
    if watermark is None:
        watermark = newest["createdAt"]              # baseline on first run
    if newest["createdAt"] > watermark:
        skip, fresh = 0, []
        while True:                                  # page back to the watermark
            _, dp, _ = get_json(f"/inmates?$limit=50&$skip={skip}&$sort[createdAt]=-1")
            page = dp["data"]
            for r in page:
                if r["createdAt"] <= watermark:
                    break
                if r["ptsBookingID"] not in seen:
                    fresh.append(r)
            watermark = max(watermark, *[r["createdAt"] for r in page], newest["createdAt"])
            if len(page) < 50 or all(r["createdAt"] <= watermark for r in page):
                break
            skip += 50
        for r in fresh:                              # advance the watermark past EVERYTHING seen,
            seen.add(r["ptsBookingID"])              # not just the rows you alerted on
            print("new booking", r["BookingID"], r["LastName"])
    time.sleep(60)
```

The county's batch lands hourly at `:00:01` UTC, so a 1-minute cadence is the
practical floor — busy-waiting faster just burns the county's bandwidth.
A complete, commented implementation lives in
[`examples/python/watch_bookings.py`](../examples/python/watch_bookings.py).

## 9. Detect releases (deletions, two-phase)

```python
prev, pending = set(), {}
while True:
    roster = fetch_roster()                          # hourly is plenty for this
    ids = {r["ptsBookingID"] for r in roster}
    gone = prev - ids
    if gone and len(gone) < max(10, 0.30 * len(prev)):   # mass-removal guard
        for pid in gone:                             # first sighting: pending only
            pending.setdefault(pid, time.time())
    for pid in list(pending):
        if pid in ids:                               # came back -> transient gap, drop it
            pending.pop(pid)
        elif time.time() - pending[pid] > 900:       # absent on 2+ passes (~15+ min)
            print("released:", pid)
            pending.pop(pid)
    prev = ids
    time.sleep(900)
```

The box has been seen dropping the whole roster for one sync and re-adding the
same records — never alert on a single missing observation. Nothing is archived
county-side: if you want charges/history to survive a release, store them while
the record is live.

## 10. Charges for one booking

```python
status, d, _ = get_json("/inmate-detail/10438")       # keyed on ptsBookingID here
print(len(d["offences"]), "charges", d["attachments"])   # attachments is always []
```

Unknown ids answer `200 {"offences":[],"attachments":[]}` — **not** a 404, so
treat an empty list as "no charges / not found", never as "endpoint missing".

## Politeness checklist

- Descriptive `User-Agent` on every request; one process, sequential calls.
- `$limit=0` before any page fetch; `If-None-Match` before any repeat fetch; gzip always.
- Full-roster scans at most hourly; never in a tight loop.
- No writes, no fuzzing, no auth probing. Treat lagged data as informational only.

## Re-verify anytime

```bash
python3 tools/api_probe.py           # asserts all of the above against the live box
python3 tools/api_probe.py --full    # + roster-wide data-model checks
```
