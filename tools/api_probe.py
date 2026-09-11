#!/usr/bin/env python3
"""
api_probe.py — live conformance test suite for the Starr County (TX) webjail API.

Every check asserts a behavior that is *documented* in docs/01-05. Run this after
any change to the docs, or whenever you suspect the county changed the box: if a
check flips to FAIL, the docs are stale and your integration may break.

Stdlib only, read-only, polite:
  * default mode issues ~40 requests, most of them $limit=0 / $limit=1 (~300 KB total)
  * --full adds roster-wide data-model analysis (a ~22 MB full-roster fetch)
  * never attempts writes (the API's write verbs are auth-protected; docs/05 §9)

Usage:
    python3 tools/api_probe.py              # quick suite + summary table
    python3 tools/api_probe.py --full       # + full-roster data-model checks
    python3 tools/api_probe.py --json out.json --quiet
    python3 tools/api_probe.py --base http://other-host:3030

Exit code: 0 = every check passed, 1 = at least one FAILED (or the box is unreachable).

Check groups:
    A envelope & pagination      E headers / protocol / caching
    B sorting                    F realtime (socket.io) surface
    C query params ignored       G rate / burst behavior
    D routes & error shapes      H data model (needs --full for the roster-wide ones)
    I offences data              J join / detail route
"""
from __future__ import annotations

import argparse
import base64
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://64.225.20.254:3030"
UA = "starr-county-api-probe/1.0 (+https://github.com/jlaiii/starr-county-webjail-api) read-only conformance test"

RESULTS: list[dict] = []


# --------------------------------------------------------------------------- http
def _request(base: str, path: str, method: str = "GET", headers: dict | None = None, timeout: int = 30) -> dict:
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(base + path, headers=hdrs, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return {"status": r.status, "hdrs": dict(r.headers), "body": body,
                    "ms": round((time.time() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "hdrs": dict(e.headers), "body": e.read(),
                "ms": round((time.time() - t0) * 1000)}
    except Exception as e:  # unreachable box / timeout
        return {"status": None, "hdrs": {}, "body": repr(e).encode(),
                "ms": round((time.time() - t0) * 1000)}


def _json(resp: dict):
    try:
        return json.loads(resp["body"].decode("utf-8", "replace"))
    except Exception:
        return None


# ------------------------------------------------------------------------- checks
def check(name: str, ok: bool | None, detail: str, group: str = "", expect: str = ""):
    """ok=True pass, ok=False fail, ok=None informational (always 'info')."""
    status = "info" if ok is None else ("pass" if ok else "fail")
    RESULTS.append({"group": group, "check": name, "status": status, "detail": detail, "expect": expect})
    return ok


def run(base: str, full: bool, quiet: bool) -> int:
    def get(path, **kw):
        return _request(base, path, **kw)

    def say(*a):
        if not quiet:
            print(*a, flush=True)

    # ---- reachability -----------------------------------------------------
    hello = get("/inmates?$limit=0")
    if hello["status"] is None:
        print(f"FATAL: cannot reach {base} — {hello['body'][:200]!r}")
        return 1
    say(f"probing {base} (HTTP {hello['status']}, {hello['ms']} ms)\n")

    # ================= A: envelope & pagination =================
    d = _json(hello)
    total = d["total"] if d else None
    check("A1 $limit=0 returns cheap count",
          bool(d) and d["data"] == [] and d["limit"] == 0 and sorted(d.keys()) == ["data", "limit", "skip", "total"],
          f"total={total} limit={d.get('limit') if d else None} data={d.get('data') if d else None}",
          "A", 'envelope {total,limit,skip,data} with data=[]')

    r = get("/inmates"); d = _json(r)
    check("A2 default page size is 10", bool(d) and d["limit"] == 10 and len(d["data"]) == 10,
          f"limit={d.get('limit') if d else None} rows={len(d.get('data', [])) if d else None}", "A")

    r = get("/inmates?$limit=60"); d = _json(r)
    check("A3 $limit>50 is capped at 50", bool(d) and d["limit"] == 50 and len(d["data"]) == 50,
          f"limit={d.get('limit') if d else None} rows={len(d.get('data', [])) if d else None}", "A")

    r = get("/inmates?$limit=10&$skip=9999"); d = _json(r)
    check("A4 $skip past end = empty page, total unchanged",
          bool(d) and d["data"] == [] and d["total"] == total, f"rows={len(d.get('data', []))} total={d.get('total') if d else None}", "A")

    r1 = get("/inmates?$limit=3&$skip=0&$sort[BookingID]=-1"); d1 = _json(r1)
    r2 = get("/inmates?$limit=3&$skip=-5&$sort[BookingID]=-1"); d2 = _json(r2)
    a = [x["ptsBookingID"] for x in (d1 or {}).get("data", [])]
    b = [x["ptsBookingID"] for x in (d2 or {}).get("data", [])]
    check("A5 negative $skip behaves like its absolute value",
          bool(a) and bool(b) and a != b, f"skip=0 -> {a} ; skip=-5 -> {b}", "A",
          "negative skip advances forward (|skip|), it does not clamp to 0")

    r3 = get("/inmates?$limit=5&$limit=2"); d3 = _json(r3)
    check("A6 repeated $limit: first value wins",
          bool(d3) and d3.get("limit") == 5 and len(d3.get("data", [])) == 5,
          f"limit={d3.get('limit') if d3 else None} rows={len(d3.get('data', [])) if d3 else None}", "A")

    r4 = get("/inmates?$limit=abc"); d4 = _json(r4)
    check("A7 non-numeric $limit does not error",
          bool(d4) and r4["status"] == 200, f"status={r4['status']} limit={d4.get('limit') if d4 else None}", "A")

    # ================= B: sorting =================
    r = get("/inmates?$limit=1&$sort[createdAt]=-1"); newest = (_json(r) or {}).get("data", [{}])[0]
    check("B1 $sort[createdAt]=-1 returns the newest insert",
          bool(newest) and newest.get("createdAt"), f"pid={newest.get('ptsBookingID')} createdAt={newest.get('createdAt')}", "B")

    r = get("/inmates?$limit=1&$sort[BookingID]=-1"); top = (_json(r) or {}).get("data", [{}])[0]
    check("B2 $sort[BookingID]=-1 is chronological (zero-padded ids)",
          bool(top) and str(top.get("BookingID", "0")) >= str(newest.get("BookingID", "0")),
          f"top BookingID={top.get('BookingID')} newest createdAt-id={newest.get('BookingID')}", "B")

    r_unk = get("/inmates?$limit=1&$sort[NoSuchField]=-1")
    r_bad = get("/inmates?$limit=1&$sort[createdAt]=desc")
    r_nb = get("/inmates?$limit=1&$sort=createdAt")
    check("B3 unknown / malformed $sort is ignored without error",
          all(x["status"] == 200 for x in (r_unk, r_bad, r_nb)),
          f"statuses={[x['status'] for x in (r_unk, r_bad, r_nb)]}", "B")

    r = get("/inmates?$sort[BookingID]=-1&$limit=0"); d = _json(r)
    check("B4 $limit=0 works with $sort", bool(d) and d.get("limit") == 0 and d.get("total") == total,
          f"limit={d.get('limit') if d else None} total={d.get('total') if d else None}", "B")

    # ================= C: parameters that are silently ignored =================
    r = get("/inmates?$limit=1&$select=ptsBookingID"); d = _json(r)
    keys = sorted(d["data"][0].keys()) if d and d.get("data") else []
    check("C1 $select is ignored (full records incl. mugshot)",
          "MugShotFileStream" in keys, f"{len(keys)} fields returned, mugshot present={'MugShotFileStream' in keys}", "C")

    r = get("/inmates?$limit=1&LastName=PENA"); d = _json(r)
    check("C2 field-equality filter is ignored (no server-side search)",
          bool(d) and d["total"] == total, f"total={d.get('total') if d else None} (collection total={total})", "C")

    r = get("/inmates?$limit=1&$or[0][LastName]=PENA&$or[1][LastName]=SILVA"); d = _json(r)
    check("C3 $or is ignored", bool(d) and d["total"] == total, f"total={d.get('total') if d else None}", "C")

    r = get("/inmates?$limit=1&$ne[nope]=1&bogus=1&_=123")
    check("C4 unknown params are tolerated (200, no error)",
          r["status"] == 200, f"status={r['status']}", "C")

    # ================= D: routes, ids, error shapes =================
    r = get("/"); check("D1 / serves the Feathers welcome HTML", r["status"] == 200 and b"Feathers" in r["body"],
                       f"status={r['status']} bytes={len(r['body'])}", "D")

    r = get("/attachments?$limit=0"); d = _json(r)
    check("D2 /attachments is always empty", bool(d) and d.get("total") == 0,
          f"total={d.get('total') if d else None}", "D")

    r = get("/inmates/get/genders-races"); d = _json(r)
    check("D3 /inmates/get/genders-races shape", bool(d) and isinstance(d.get("races"), list) and isinstance(d.get("genders"), list),
          f"races={d.get('races') if d else None} genders={d.get('genders') if d else None}", "D")

    r = get("/inmate-detail/999999"); d = _json(r)
    check("D4 /inmate-detail/<unknown> = 200 with empty arrays (not 404)",
          r["status"] == 200 and d == {"offences": [], "attachments": []}, f"status={r['status']} body={d}", "D")

    r = get("/inmates/count"); d = _json(r)
    check("D5 /inmates/<non-numeric> = 400 BadRequest (id route casts to ptsSubjectID)",
          r["status"] == 400 and "ptsSubjectID" in json.dumps(d or {}),
          f"status={r['status']} message={str((d or {}).get('message'))[:90]}", "D",
          "the id route is keyed on ptsSubjectID")

    r = get("/nope"); d = _json(r)
    check("D6 unknown route = 404 NotFound", r["status"] == 404 and (d or {}).get("name") == "NotFound",
          f"status={r['status']} name={(d or {}).get('name')}", "D")

    r = get("/docs"); check("D7 no docs/swagger endpoint exists", r["status"] == 404, f"/docs -> {r['status']}", "D")

    # live ids from the roster
    one = get("/inmates?$limit=1&$sort[createdAt]=-1")
    rec = (_json(one) or {}).get("data", [{}])[0]
    subj, bkg, oid = rec.get("ptsSubjectID"), rec.get("ptsBookingID"), rec.get("_id")

    r = get(f"/inmates/{subj}"); d = _json(r)
    check("D8 GET /inmates/<ptsSubjectID> returns ONE full record",
          r["status"] == 200 and isinstance(d, dict) and d.get("ptsSubjectID") == subj,
          f"status={r['status']} keys={sorted(d.keys())[:6] if isinstance(d, dict) else None} ms={r['ms']} bytes={len(r['body'])}",
          "D", "single-record fetch without paging (costs one record, ~250 KB)")

    r = get(f"/inmates/{bkg}"); d = _json(r)
    check("D9 GET /inmates/<ptsBookingID> = 404 (that is NOT the id route key)",
          r["status"] == 404, f"status={r['status']} message={str((d or {}).get('message'))[:60]}", "D")

    r = get(f"/offences/{oid}"); d = _json(r)
    check("D10 /offences/<_id> is not a working lookup", r["status"] in (400, 404),
          f"status={r['status']}", "D")

    # ================= E: headers, protocol, caching =================
    r = get("/inmates?$limit=0"); h = {k.lower(): v for k, v in r["hdrs"].items()}
    check("E1 CORS open on every response", h.get("access-control-allow-origin") == "*",
          f"ACAO={h.get('access-control-allow-origin')}", "E")
    check("E2 no Server / X-Powered-By fingerprint",
          "server" not in h and "x-powered-by" not in h, f"headers={sorted(h.keys())}", "E")
    check("E3 weak ETag present (enables conditional GET)", "etag" in h, f"ETag={h.get('etag')}", "E")

    etag = r["hdrs"].get("ETag")
    if etag:
        r2 = get("/inmates?$limit=0", headers={"If-None-Match": etag})
        check("E4 If-None-Match on an unchanged resource = 304 with empty body",
              r2["status"] == 304 and not r2["body"], f"status={r2['status']} bytes={len(r2['body'])}", "E",
              "pollers should send If-None-Match: cheap no-change signal")

    r3 = get("/inmates?$limit=1", headers={"Accept-Encoding": "gzip"})
    comp = r3["hdrs"].get("Content-Encoding")
    check("E5 gzip is supported when requested", comp == "gzip", f"Content-Encoding={comp} wire_bytes={len(r3['body'])}", "E",
          "urllib/curl do not ask for gzip by default; requests does")

    r4 = _request(base, "/inmates?$limit=0", method="OPTIONS")
    check("E6 OPTIONS -> 204 with CORS", r4["status"] == 204 and r4["hdrs"].get("Access-Control-Allow-Origin") == "*",
          f"status={r4['status']} allow={r4['hdrs'].get('Allow')}", "E")

    r5 = _request(base, "/inmates?$limit=0", method="HEAD")
    check("E7 HEAD -> 200, no body", r5["status"] == 200 and not r5["body"],
          f"status={r5['status']} bytes={len(r5['body'])} content-length={r5['hdrs'].get('Content-Length')}", "E")

    check("E8 connections are not reused (Connection: close)",
          h.get("connection") == "close", f"Connection={h.get('connection')}", "E",
          "every request costs a fresh TCP handshake; there is no keep-alive")

    # ================= F: realtime surface =================
    r = get("/socket.io/?EIO=3&transport=polling&t=%d" % time.time())
    body = r["body"].decode("utf-8", "replace")
    sid = None
    try:
        sid = json.loads(body[body.find("{"):])["sid"]
    except Exception:
        pass
    check("F1 socket.io endpoint answers a handshake (engine.io v3 framing)",
          r["status"] == 200 and bool(sid), f"status={r['status']} sid={sid} payload={body[:90]!r}", "F")
    check("F2 no REST streaming endpoint (/ws is 404)", get("/ws")["status"] == 404, "/ws -> 404", "F",
          "see docs/07-realtime.md for what the socket.io surface can and cannot do")

    # ================= G: burst behavior =================
    codes, times = [], []
    for _ in range(8):
        rr = get("/inmates?$limit=0")
        codes.append(rr["status"]); times.append(rr["ms"])
    check("G1 small burst is not rate-limited", all(c == 200 for c in codes),
          f"codes={codes} median={int(statistics.median(times))}ms max={max(times)}ms", "G",
          "no 429s observed — but stay polite (docs/03)")

    # ================= I/J + H: data model (needs records) =================
    r = get("/offences?$limit=50&$sort[ptsBookingID]=-1"); do = _json(r); offs = (do or {}).get("data", [])
    check("I1 /offences returns charge rows joinable by ptsBookingID", bool(offs) and "ptsBookingID" in offs[0],
          f"total={do.get('total') if do else None} rows={len(offs)} fields={sorted(offs[0].keys()) if offs else None}", "I")
    lv = {}
    for o in offs:
        lv[str(o.get("StatuteLevel"))] = lv.get(str(o.get("StatuteLevel")), 0) + 1
    check("I2 StatuteLevel is messy (nulls / typo MISDEMEANO present somewhere)",
          None, f"page sample={lv}", "I")

    if offs:
        r = get(f"/inmate-detail/{offs[0]['ptsBookingID']}"); d = _json(r)
        check("J1 /inmate-detail/<real pid> returns its charges",
              bool(d) and isinstance(d.get("offences"), list) and d.get("attachments") == [],
              f"offences={len(d.get('offences', []))} attachments={d.get('attachments')}", "J")

    # single-record fetch is the cheapest way to re-check one booking
    if subj:
        r = get(f"/inmates/{subj}")
        check("H1 single-record fetch cost", None,
              f"{len(r['body'])} bytes / {r['ms']} ms for ptsSubjectID={subj} (~1 record instead of a 13 MB page)", "H")

    if full:
        say("--full: fetching the whole roster (2 pages, ~22 MB) …")
        recs, skip = [], 0
        while True:
            p = get(f"/inmates?$limit=50&$skip={skip}&$sort[createdAt]=-1")
            dp = _json(p)
            batch = (dp or {}).get("data", [])
            recs.extend(batch)
            if len(batch) < 50:
                break
            skip += 50
        check("H2 full roster page-walk terminates on a short page", bool(recs),
              f"rows={len(recs)} total_reported={total}", "H")
        fields = sorted({k for x in recs for k in x})
        check("H3 roster field set unchanged", fields == sorted([
            "BookingDate", "BookingID", "DOB", "EyeColor", "FirstName", "Gender", "HairColor", "Height",
            "LastName", "MiddleName", "MugShotFileStream", "PublishImageToWebjail", "Race", "Weight",
            "_id", "createdAt", "ptsBookingID", "ptsPersonID", "ptsSubjectID", "updatedAt"]),
            f"{len(fields)} fields: {fields}", "H")
        bad = [x["ptsBookingID"] for x in recs if x.get("MugShotFileStream") and not x["MugShotFileStream"].startswith("iVBORw0KGgo")]
        check("H4 mugshots are raw base64 (no data: prefix)", not bad,
              f"{len(recs) - len(bad)}/{len(recs)} start with iVBORw0KGgo ({len(bad)} other)", "H")
        pub = [x for x in recs if x.get("PublishImageToWebjail") is not True]
        check("H5 some records withhold their photo (PublishImageToWebjail=false)", None,
              f"{len(pub)}/{len(recs)} withheld ({round(100*len(pub)/max(1,len(recs)))}%)", "H")
        sizes = sorted(len(x.get("MugShotFileStream") or "") for x in recs)
        check("H6 base64 mugshot size range", None,
              f"min={sizes[0]} median={sizes[len(sizes)//2]} max={sizes[-1]} (decoded ≈ 0.75×)", "H")
        minutes = {}
        for x in recs:
            minutes[x["createdAt"][14:16]] = minutes.get(x["createdAt"][14:16], 0) + 1
        secs = sorted({x["createdAt"][17:19] for x in recs})
        check("H7 createdAt sits in the first seconds of an hour (batch insert)",
              bool(minutes) and all(m == "00" for m in minutes) and len(secs) <= 4,
              f"minute-of-hour histogram={minutes}; distinct seconds={secs}", "H")
        gaps = []
        for x in recs:
            try:
                gaps.append((time.mktime(time.strptime(x["createdAt"][:19], "%Y-%m-%dT%H:%M:%S")) -
                             time.mktime(time.strptime(x["BookingDate"][:19], "%Y-%m-%dT%H:%M:%S"))) / 3600)
            except Exception:
                pass
        if gaps:
            check("H8 BookingDate -> createdAt gap (hours)", None,
                  f"min={min(gaps):.0f} median={statistics.median(gaps):.0f} max={max(gaps):.0f} (docs: min 6 / median ~21-22 / max 89)", "H")
        upd = sorted({x["updatedAt"][11:19] for x in recs})
        check("H9 updatedAt is re-stamped for every record in the same hour",
              bool(upd) and upd[0][:2] == upd[-1][:2] and upd[0] < upd[-1],
              f"{len(upd)} distinct stamps, {upd[0]} .. {upd[-1]} ({len(recs)} records)", "H",
              "the re-stamp sweep takes ~1 min; never use updatedAt for change detection")
        try:
            raw_b = base64.b64decode(next(x["MugShotFileStream"] for x in recs if x.get("MugShotFileStream")))
            check("H10 mugshot magic bytes", raw_b[:4] == b"\x89PNG",
                  f"{len(raw_b)} decoded bytes, magic={raw_b[:8].hex()}", "H")
        except Exception as e:
            check("H10 mugshot magic bytes", False, f"decode failed: {e}", "H")

    return 0 if not any(r["status"] == "fail" for r in RESULTS) else 1


# --------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description="Live conformance probe for the Starr County webjail API.")
    ap.add_argument("--base", default=DEFAULT_BASE, help=f"API base URL (default {DEFAULT_BASE})")
    ap.add_argument("--full", action="store_true", help="also fetch the whole roster for data-model checks (~22 MB)")
    ap.add_argument("--json", metavar="PATH", help="write full results as JSON")
    ap.add_argument("--quiet", action="store_true", help="only print the summary + failures")
    args = ap.parse_args()

    started = time.time()
    code = run(args.base, args.full, args.quiet)

    fails = [r for r in RESULTS if r["status"] == "fail"]
    counts = {}
    for r in RESULTS:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    if not args.quiet:
        print("\n==== results ====")
        for r in RESULTS:
            mark = {"pass": "PASS", "fail": "FAIL", "info": "INFO"}[r["status"]]
            print(f"[{mark}] {r['group']:>1} {r['check']:<58} {r['detail']}")
    print(f"\n{counts.get('pass', 0)} passed, {counts.get('fail', 0)} failed, {counts.get('info', 0)} informational"
          f" in {time.time() - started:.1f}s")
    for r in fails:
        print(f"  FAILED: {r['check']} — got {r['detail']} (expected: {r['expect'] or 'see docs'})")
    if not fails:
        print("All asserted behaviors match docs/01-05 minus the informational notes.")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"base": args.base, "when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "full": args.full, "counts": counts, "results": RESULTS}, f, indent=2)
        print(f"JSON written to {args.json}")
    return code


if __name__ == "__main__":
    sys.exit(main())
