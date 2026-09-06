#!/usr/bin/env python3
"""Watch for NEW bookings on the Starr County Webjail API.

Cheap polling: one ~300 KB request per tick (newest record by createdAt)
vs ~25 MB for a full roster scan. When the top record is newer than the
watermark, page through until records older than the watermark and report
every unseen ptsBookingID. Quiet ticks print nothing.

Usage:  python3 watch_bookings.py          # one check
        watch -n 60 python3 watch_bookings.py   # or any scheduler loop
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

API = "http://64.225.20.254:3030"
UA = "starr-webjail-example/1.0"
STATE = os.path.expanduser("~/.starr_watch_state.json")  # set your own path
PAGE = 50


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def parse_dt(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {"seen": {}, "watermark": None}


def save_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f)
    os.replace(tmp, STATE)


def name_of(rec):
    return " ".join(str(rec.get(k) or "").strip()
                    for k in ("FirstName", "MiddleName", "LastName")).strip()


def scan(st):
    """Return all records above the watermark (seen or not) so the caller
    can alert unseen ones AND advance the watermark past the whole region."""
    watermark = parse_dt(st.get("watermark"))
    top = get(f"{API}/inmates?$limit=1&$sort[createdAt]=-1").get("data", [])
    if not top:
        return []
    top_dt = parse_dt(top[0].get("createdAt"))
    if watermark is not None and top_dt is not None and top_dt <= watermark:
        return []  # nothing new since last check — one request, done

    cands, skip, hit_old = [], 0, False
    for _ in range(10):  # safety cap
        batch = get(f"{API}/inmates?$limit={PAGE}&$skip={skip}&$sort[createdAt]=-1")
        for rec in batch.get("data", []):
            dt = parse_dt(rec.get("createdAt"))
            if watermark is not None and dt is not None and dt <= watermark:
                hit_old = True
                break
            cands.append(rec)
        if hit_old or len(batch.get("data", [])) < PAGE:
            break
        skip += PAGE
    cands.sort(key=lambda r: str(r.get("ptsBookingID")))
    return cands


def main():
    st = load_state()
    if not st.get("seen"):
        # first run / state loss: baseline on the full roster
        recs, skip = [], 0
        while True:
            batch = get(f"{API}/inmates?$limit={PAGE}&$skip={skip}&$sort[createdAt]=-1")
            data = batch.get("data", [])
            recs.extend(data)
            if len(data) < PAGE:
                break
            skip += PAGE
        for r in recs:
            if r.get("ptsBookingID") is not None:
                st["seen"][str(r["ptsBookingID"])] = 1
        mx = max((parse_dt(r.get("createdAt")) for r in recs if r.get("createdAt")),
                 default=None)
        if mx:
            st["watermark"] = mx.isoformat()
        save_state(st)
        print(f"baseline: {len(recs)} in custody — watching for new bookings")
        return

    above = scan(st)
    if not above:
        return  # silent tick

    # advance the watermark past EVERYTHING examined (seen or not), then alert
    mx = max((parse_dt(r.get("createdAt")) for r in above if r.get("createdAt")),
             default=None)
    if mx:
        st["watermark"] = mx.isoformat()
    new = [r for r in above if str(r["ptsBookingID"]) not in st["seen"]]
    for r in new:
        st["seen"][str(r["ptsBookingID"])] = 1
    save_state(st)

    for r in new:
        print(f"NEW pid={r['ptsBookingID']} #{r.get('BookingID')} "
              f"booked={str(r.get('BookingDate'))[:10]} {name_of(r)}")
    # fetch charges per new booking via /inmate-detail/<pid> as needed


if __name__ == "__main__":
    sys.exit(main())
