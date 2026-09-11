#!/usr/bin/env python3
"""
jail.py — one-file CLI for the Starr County (TX) webjail API. Read-only, stdlib only.

    python3 tools/jail.py count
    python3 tools/jail.py newest 5
    python3 tools/jail.py find PENA
    python3 tools/jail.py show 10260            # ptsSubjectID  -> single-record route
    python3 tools/jail.py show 2026002017       # BookingID     -> client-side match
    python3 tools/jail.py photo 10501 --out mugshots
    python3 tools/jail.py csv --out roster.csv
    python3 tools/jail.py charges 10501         # /inmate-detail for one booking

Add --json to any command for machine-readable output (agents: use this).

Design notes (see docs/06-recipes.md for the reasoning):
  * gzip on every request; `$limit=0` before any page fetch
  * pagination stops on the short page, never on `total`
  * no server-side search exists -> `find` walks the whole roster (~15 MB gzipped)
  * never writes to the county system
"""
from __future__ import annotations

import argparse
import base64
import csv
import gzip
import json
import pathlib
import sys
import urllib.error
import urllib.request

BASE = "http://64.225.20.254:3030"
UA = "starr-county-jail-cli/1.0 (+https://github.com/jlaiii/starr-county-webjail-api) read-only"


def fetch(path: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(BASE + path, headers={
        "User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return json.loads(body)


def roster() -> list[dict]:
    """Full roster, newest insert first."""
    out, skip = [], 0
    while True:
        d = fetch(f"/inmates?$limit=50&$skip={skip}&$sort[createdAt]=-1")
        page = d["data"]
        out += page
        if len(page) < 50:
            return out
        skip += 50


def charges_by_booking() -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {}
    skip = 0
    while True:
        d = fetch(f"/offences?$limit=50&$skip={skip}")
        page = d["data"]
        for c in page:
            out.setdefault(c["ptsBookingID"], []).append(c)
        if len(page) < 50:
            return out
        skip += 50


def name_of(r: dict) -> str:
    return " ".join(x for x in (r.get("FirstName"), r.get("MiddleName"), r.get("LastName")) if x)


def total_bond(cs: list[dict]) -> int:
    return sum(c.get("BondAmount") or 0 for c in cs)


def fmt(r: dict, cs: list[dict] | None = None) -> str:
    line = (f"#{r['BookingID']}  {name_of(r):<32} booked {r['BookingDate'][:10]}  "
            f"{r['Gender']:<6} {r['Race']:<6} {r['Height']:<7} {r['Weight']}lb  "
            f"DOB {r['DOB'][:10]}  pid={r['ptsBookingID']} subj={r['ptsSubjectID']}")
    if cs:
        line += f"  charges={len(cs)} bond=${total_bond(cs)}"
    return line


def cmd_count(a):
    inmates = fetch("/inmates?$limit=0")["total"]
    offences = fetch("/offences?$limit=0")["total"]
    print(json.dumps({"inmates": inmates, "offences": offences}) if a.json else
          f"{inmates} in custody · {offences} charge rows")
    return 0


def cmd_newest(a):
    recs = fetch(f"/inmates?$limit={min(a.n, 50)}&$sort[createdAt]=-1")["data"]
    cs = charges_by_booking() if not a.json else {}
    if a.json:
        print(json.dumps([{k: v for k, v in r.items() if k != "MugShotFileStream"} for r in recs], indent=2))
        return 0
    for r in recs:
        print(fmt(r, cs.get(r["ptsBookingID"])))
    return 0


def cmd_find(a):
    q = a.query.strip().lower()
    hits, cs = [], None
    for r in roster():
        hay = (name_of(r) + " " + r["BookingID"] + " " + str(r["ptsBookingID"])).lower()
        if q in hay:
            hits.append(r)
    cs = charges_by_booking()
    if a.json:
        print(json.dumps([{**{k: v for k, v in r.items() if k != "MugShotFileStream"},
                           "charges": cs.get(r["ptsBookingID"], [])} for r in hits], indent=2))
        return 0
    print(f"{len(hits)} match(es) for {a.query!r}")
    for r in hits:
        print(fmt(r, cs.get(r["ptsBookingID"])))
        for c in cs.get(r["ptsBookingID"], []):
            lvl = c.get("StatuteLevel") or "-"
            print(f"     - {c['StatuteDescription']}  [{lvl}]  bond=${c.get('BondAmount') or 0}"
                  f"{'  BOND DENIED' if c.get('IsBondDenied') else ''}")
    if not hits:
        print("No server-side search exists — this walks the whole roster client-side.")
    return 0


def cmd_show(a):
    who = a.id.strip()
    if who.isdigit() and len(who) <= 6:                    # ptsSubjectID -> single-record route
        try:
            r = fetch(f"/inmates/{who}")
            if isinstance(r, dict) and "BookingID" in r:
                rec = r
            else:
                rec = None
        except urllib.error.HTTPError:
            rec = None
    else:
        rec = None
    if rec is None:                                        # fall back to a client-side match
        for r in roster():
            if who == r["BookingID"] or who == str(r["ptsBookingID"]) or who == str(r["ptsSubjectID"]):
                rec = r
                break
    if rec is None:
        print(f"no record for {who!r} (tried the /inmates/<ptsSubjectID> id route and a roster match)")
        return 1
    detail = fetch(f"/inmate-detail/{rec['ptsBookingID']}")
    if a.json:
        out = {k: v for k, v in rec.items() if k != "MugShotFileStream"}
        out["mugshot_present"] = bool(rec.get("MugShotFileStream"))
        out["charges"] = detail.get("offences", [])
        print(json.dumps(out, indent=2))
        return 0
    print(fmt(rec, detail.get("offences", [])))
    print(f"     photo: {'withheld by county' if rec.get('PublishImageToWebjail') is False else ('yes (' + str(len(rec.get('MugShotFileStream') or '')) + ' b64 chars)')}")
    for c in detail.get("offences", []):
        print(f"     - {c['StatuteDescription']}  [{c.get('StatuteLevel') or '-'}]  "
              f"bond=${c.get('BondAmount') or 0}{'  BOND DENIED' if c.get('IsBondDenied') else ''}"
              f"  {c.get('ArrestingAgency') or '-'}")
    print(f"     total bond ${total_bond(detail.get('offences', []))} · {len(detail.get('offences', []))} charge(s)")
    return 0


def cmd_charges(a):
    d = fetch(f"/inmate-detail/{a.booking}")
    offs = d.get("offences", [])
    if a.json:
        print(json.dumps(offs, indent=2))
        return 0
    print(f"{len(offs)} charge(s); attachments={d.get('attachments')}")
    for c in offs:
        print(f"  - {c['StatuteDescription']}  [{c.get('StatuteLevel') or '-'}]  ${c.get('BondAmount') or 0}"
              f"  {c.get('ArrestingAgency') or '-'}  arrested {(c.get('ArrestDate') or '-')[:10]}")
    return 0


def cmd_photo(a):
    d = fetch(f"/inmates?$limit=50&$sort[createdAt]=-1")
    rec = next((r for r in d["data"] if r["ptsBookingID"] == a.booking), None)
    scan, skip = rec, 0
    while scan is None:                                    # keep paging if not on page 1
        skip += 50
        page = fetch(f"/inmates?$limit=50&$skip={skip}&$sort[createdAt]=-1")["data"]
        if not page:
            break
        scan = next((r for r in page if r["ptsBookingID"] == a.booking), None)
    if scan is None:
        print(f"booking {a.booking} is not on the current roster")
        return 1
    if scan.get("PublishImageToWebjail") is False:
        print(f"booking {a.booking}: photo withheld by the county (PublishImageToWebjail=false)")
        return 1
    blob = scan.get("MugShotFileStream") or ""
    if blob.startswith("data:"):
        blob = blob.split(",", 1)[1]
    raw = base64.b64decode(blob)
    ext = ".png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    out = pathlib.Path(a.out) / f"{a.booking}{ext}"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    print(f"{out} ({len(raw)} bytes, magic {raw[:4].hex()})")
    return 0


def cmd_csv(a):
    recs, cs = roster(), charges_by_booking()
    out = pathlib.Path(a.out)
    with out.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["bookingID", "ptsBookingID", "ptsSubjectID", "lastName", "firstName", "booked",
                    "dob", "gender", "race", "height", "weight", "charges", "bond_total", "agency"])
        for r in recs:
            ch = cs.get(r["ptsBookingID"], [])
            w.writerow([r["BookingID"], r["ptsBookingID"], r["ptsSubjectID"], r["LastName"], r["FirstName"],
                        r["BookingDate"][:10], r["DOB"][:10], r["Gender"], r["Race"], r["Height"], r["Weight"],
                        " | ".join(c["StatuteDescription"] for c in ch), total_bond(ch),
                        " | ".join(sorted({c.get("ArrestingAgency") or "" for c in ch} - {""}))])
    print(f"{out} — {len(recs)} rows")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only CLI for the Starr County (TX) webjail API.")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("count", help="inmate + charge totals").set_defaults(fn=cmd_count)

    p = sub.add_parser("newest", help="newest bookings"); p.add_argument("n", nargs="?", type=int, default=10)
    p.set_defaults(fn=cmd_newest)

    p = sub.add_parser("find", help="name / booking-number search (walks the whole roster)")
    p.add_argument("query"); p.set_defaults(fn=cmd_find)

    p = sub.add_parser("show", help="one record + charges by ptsSubjectID, ptsBookingID or BookingID")
    p.add_argument("id"); p.set_defaults(fn=cmd_show)

    p = sub.add_parser("charges", help="charges for one ptsBookingID"); p.add_argument("booking", type=int)
    p.set_defaults(fn=cmd_charges)

    p = sub.add_parser("photo", help="save one mugshot"); p.add_argument("booking", type=int)
    p.add_argument("--out", default="mugshots"); p.set_defaults(fn=cmd_photo)

    p = sub.add_parser("csv", help="export roster + charges"); p.add_argument("--out", default="roster.csv")
    p.set_defaults(fn=cmd_csv)

    a = ap.parse_args()
    try:
        return a.fn(a)
    except urllib.error.URLError as e:
        print(f"network error: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
