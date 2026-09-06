#!/usr/bin/env python3
"""Mirror the Starr County Webjail API into a static GitHub Pages site.

Fetches the current roster + charges from the county's public API, strips
the inline base64 mugshots into individual files, and writes a same-origin
data.json the web app loads — so the Pages app needs no CORS relay and no
runtime calls to the county.

Run by .github/workflows/deploy.yml (hourly cron + on push).

Usage:  python3 tools/mirror.py            # writes into _site/
"""
import base64
import hashlib
import json
import os
import sys
import urllib.request

API = os.environ.get("COUNTY_API", "http://64.225.20.254:3030")
UA = "starr-webjail-mirror/1.0 (github actions)"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_site")
PAGE = 50


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def fetch_all(path):
    items, skip = [], 0
    while True:
        data = get(f"{API}{path}?$limit={PAGE}&$skip={skip}")
        batch = data.get("data", [])
        items.extend(batch)
        if len(batch) < PAGE:
            break
        skip += PAGE
    return items


def name_of(r):
    return " ".join(str(r.get(k) or "").strip()
                    for k in ("FirstName", "MiddleName", "LastName")).strip()


def save_photo(pid, b64, outdir):
    """Write one mugshot file; return its path or None. PNG/JPEG sniff."""
    if not b64:
        return None
    if b64.startswith("data:"):
        b64 = b64[b64.index(",") + 1:]
    try:
        img = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    except Exception:
        return None
    if len(img) < 500:
        return None
    ext = ".png" if img[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    path = os.path.join(outdir, f"{pid}{ext}")
    # write only when content changed (keeps deploys lean)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(img)
    if os.path.exists(path) and open(path, "rb").read() == img:
        os.remove(tmp)
        return f"mugshots/{pid}{ext}"
    os.replace(tmp, path)
    return f"mugshots/{pid}{ext}"


def main():
    os.makedirs(OUT, exist_ok=True)
    mugdir = os.path.join(OUT, "mugshots")
    os.makedirs(mugdir, exist_ok=True)

    inmates = fetch_all("/inmates")
    offences = fetch_all("/offences")
    print(f"fetched {len(inmates)} inmates, {len(offences)} offences")

    by_bid = {}
    for o in offences:
        by_bid.setdefault(str(o.get("ptsBookingID")), []).append(o)

    rows, photos = [], {}
    for r in inmates:
        pid = r.get("ptsBookingID")
        if pid is None:
            continue
        img = None
        if r.get("PublishImageToWebjail") is not False:
            img = save_photo(pid, r.get("MugShotFileStream"), mugdir)
        if img:
            photos[os.path.basename(img)] = 1
        charges = []
        for o in sorted(by_bid.get(str(pid), []), key=lambda x: str(x.get("ArrestDate") or "")):
            charges.append({
                "desc": o.get("StatuteDescription"),
                "level": o.get("StatuteLevel"),
                "bond": o.get("BondAmount"),
                "denied": bool(o.get("IsBondDenied")),
                "agency": o.get("ArrestingAgency"),
                "arrested": o.get("ArrestDate"),
            })
        rows.append({
            "ptsBookingID": pid,
            "bookingID": r.get("BookingID"),
            "name": name_of(r),
            "booked": r.get("BookingDate"),
            "dob": r.get("DOB"),
            "gender": r.get("Gender"),
            "race": r.get("Race"),
            "height": r.get("Height"),
            "weight": r.get("Weight"),
            "eye": r.get("EyeColor"),
            "hair": r.get("HairColor"),
            "imgPub": bool(r.get("PublishImageToWebjail")),
            "img": img,
            "charges": charges,
        })
    rows.sort(key=lambda x: str(x.get("bookingID") or ""), reverse=True)

    # drop mugshots of released inmates (mirror = current roster only)
    for fn in os.listdir(mugdir):
        if fn not in photos:
            try:
                os.remove(os.path.join(mugdir, fn))
            except OSError:
                pass

    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    doc = {
        "updated": now,
        "system": "Starr County Jail roster — hourly mirror of the county public Webjail API",
        "counts": {"inmates": len(rows), "photos": len(photos)},
        "inmates": rows,
    }
    with open(os.path.join(OUT, "data.json"), "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {len(rows)} inmates, {len(photos)} photos -> {OUT}")
    print(f"updated {now}")


if __name__ == "__main__":
    sys.exit(main())
