#!/usr/bin/env python3
"""Inmate card: booking info + charges + mugshot for one booking.

Demonstrates: roster lookup (client-side), /inmate-detail charges fetch,
mugshot decode + save, and a clean per-person text card with HTML-escaped
fields — the pattern used for per-booking notifications.

Usage:
    python3 inmate_card.py 10438              # by ptsBookingID
    python3 inmate_card.py --name "garcia teodulo"   # fuzzy name match
    python3 inmate_card.py 10438 --save-photo  # also write the mugshot file
"""
import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from datetime import datetime

API = "http://64.225.20.254:3030"
UA = "starr-webjail-example/1.0"
PAGE = 50


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def fetch_all(path):
    items, skip = [], 0
    while True:
        data = get(f"{API}{path}?$limit={PAGE}&$skip={skip}")
        items.extend(data.get("data", []))
        if len(data.get("data", [])) < PAGE:
            break
        skip += PAGE
    return items


def name_of(rec):
    return " ".join(str(rec.get(k) or "").strip()
                    for k in ("FirstName", "MiddleName", "LastName")).strip()


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def date_only(iso):
    s = str(iso or "")
    return f"{s[5:7]}/{s[8:10]}/{s[0:4]}" if len(s) >= 10 and s[4] == "-" else (s[:10] or "?")


def age(dob):
    try:
        d = datetime.fromisoformat(str(dob).replace("Z", "+00:00"))
        today = datetime.utcnow()
        return today.year - d.year - ((today.month, today.day) < (d.month, d.day))
    except Exception:
        return None


def money(v):
    if v is None:
        return "n/a"
    try:
        return f"${int(v):,}" if float(v) == int(v) else f"${float(v):,.2f}"
    except Exception:
        return "n/a"


def card(rec, offences, photo_path=None):
    a = age(rec.get("DOB"))
    bondable = "Not Bondable" if any(
        o.get("IsBondDenied") is True for o in offences) else "Bondable"
    lines = [f"<b>{esc(name_of(rec))}</b>",
             f"Booking #{esc(rec.get('BookingID'))} | "
             f"Booked {esc(date_only(rec.get('BookingDate')))}",
             f"DOB {esc(date_only(rec.get('DOB')))} ({a}) | "
             f"{esc(rec.get('Gender') or '?')}, {esc(rec.get('Race') or '?')} | "
             f"{esc(rec.get('Height') or '?')} / {esc(rec.get('Weight') or '?')} lbs | "
             f"{bondable}"]
    lines.append(f"Charges ({len(offences)}):")
    for o in offences or []:
        lvl = f" ({o.get('StatuteLevel')})" if o.get("StatuteLevel") else ""
        bnd = f" — Bond {money(o.get('BondAmount'))}" if o.get("BondAmount") else ""
        lines.append(f"• {esc(o.get('StatuteDescription') or '?')}{lvl}{bnd}")
    if not photo_path:
        lines.append("No photo on file")
    return "\n".join(lines)


def find_by_pid(pid):
    for r in fetch_all("/inmates"):
        if str(r.get("ptsBookingID")) == str(pid):
            return r
    return None


def find_by_name(q):
    q = q.lower()
    return [r for r in fetch_all("/inmates") if q in name_of(r).lower()]


def save_photo(rec):
    b64 = rec.get("MugShotFileStream")
    if not b64:
        return None
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    img = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    ext = ".png" if img[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    os.makedirs("mugshots", exist_ok=True)
    path = os.path.join("mugshots", f"{rec['ptsBookingID']}{ext}")
    with open(path, "wb") as f:
        f.write(img)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pid", nargs="?")
    ap.add_argument("--name")
    ap.add_argument("--save-photo", action="store_true")
    args = ap.parse_args()

    if args.pid:
        rec = find_by_pid(args.pid)
    elif args.name:
        hits = find_by_name(args.name)
        if len(hits) != 1:
            print(f"{len(hits)} matches — narrow it down:")
            for h in hits:
                print(f"  pid={h['ptsBookingID']} #{h.get('BookingID')} {name_of(h)}")
            return 1
        rec = hits[0]
    else:
        ap.print_usage()
        return 1
    if not rec:
        print("not found on the current roster")
        return 1

    det = get(f"{API}/inmate-detail/{rec['ptsBookingID']}")
    photo = save_photo(rec) if args.save_photo else None
    print(card(rec, det.get("offences") or [], photo))
    if photo:
        print(f"\nphoto saved: {photo}")


if __name__ == "__main__":
    sys.exit(main())
