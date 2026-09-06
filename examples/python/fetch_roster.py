#!/usr/bin/env python3
"""Fetch the full current roster from the Starr County Webjail API.

Stdlib only. Paginates in $limit=50 pages (hard cap), stops on a short
page, optionally saves mugshots to ./mugshots/<ptsBookingID>.<ext>.

Usage:
    python3 fetch_roster.py                 # print names + booking ids
    python3 fetch_roster.py --save-mugshots # also write mugshot files
    python3 fetch_roster.py --json out.json # dump full records (minus streams)
"""
import argparse
import base64
import json
import os
import sys
import urllib.request

API = "http://64.225.20.254:3030"
UA = "starr-webjail-example/1.0"
PAGE = 50


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch_all(path):
    """Paginate; stop on a short page (never trust `total` alone — it can
    lag during the county's full re-syncs)."""
    items, skip = [], 0
    while True:
        data = get(f"{API}{path}?$limit={PAGE}&$skip={skip}")
        batch = data.get("data", [])
        items.extend(batch)
        if len(batch) < PAGE:
            break
        skip += PAGE
    return data.get("total"), items


def name_of(rec):
    return " ".join(str(rec.get(k) or "").strip()
                    for k in ("FirstName", "MiddleName", "LastName")).strip()


def strip_stream(rec):
    return {k: v for k, v in rec.items() if k != "MugShotFileStream"}


def save_mugshot(rec, outdir):
    b64 = rec.get("MugShotFileStream")
    if not b64:
        return None
    if b64.startswith("data:"):  # defensive: strip data URI prefix if present
        b64 = b64.split(",", 1)[1]
    try:
        img = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    except Exception:
        return None
    if len(img) < 500:
        return None
    ext = ".png" if img[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{rec['ptsBookingID']}{ext}")
    with open(path, "wb") as f:
        f.write(img)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-mugshots", action="store_true")
    ap.add_argument("--json", metavar="FILE")
    args = ap.parse_args()

    total, recs = fetch_all("/inmates")
    print(f"{total} in custody (fetched {len(recs)})")

    for r in sorted(recs, key=lambda x: x.get("BookingID") or "", reverse=True):
        mug = "📷" if r.get("MugShotFileStream") else "  "
        pub = "pub" if r.get("PublishImageToWebjail") else "no-pub"
        print(f"{mug} #{r.get('BookingID')} pid={r['ptsBookingID']} "
              f"booked={str(r.get('BookingDate'))[:10]} [{pub}] {name_of(r)}")
        if args.save_mugshots and r.get("PublishImageToWebjail") is not False:
            save_mugshot(r, "mugshots")

    if args.json:
        clean = [strip_stream(r) for r in recs]
        with open(args.json, "w") as f:
            json.dump({"total": total, "fetched": len(recs), "inmates": clean}, f, indent=1)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    sys.exit(main())
