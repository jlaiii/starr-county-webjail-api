#!/usr/bin/env python3
"""Watch for RELEASES on the Starr County Webjail API.

Releases = roster deletion. Detection: diff the set of ptsBookingIDs between
polls. The county box occasionally drops the whole roster for a sync or two
(transient), so a release is only reported after it is missing on TWO
consecutive checks AND the mass-removal guard passes (>30% gone at once is
held for 3 runs). Prints one line per confirmed release.

Usage:  python3 watch_releases.py          # one check
        watch -n 300 python3 watch_releases.py   # or any scheduler loop
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API = "http://64.225.20.254:3030"
UA = "starr-webjail-example/1.0"
STATE = os.path.expanduser("~/.starr_release_state.json")  # set your own path
PAGE = 50
CONFIRM_RUNS = 2   # consecutive absences required
MASS_FRACTION = 0.3


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {"ids": None}


def save_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f)
    os.replace(tmp, STATE)


def current_ids():
    ids, skip = [], 0
    while True:
        batch = get(f"{API}/inmates?$limit={PAGE}&$skip={skip}").get("data", [])
        ids.extend(str(r["ptsBookingID"]) for r in batch if r.get("ptsBookingID"))
        if len(batch) < PAGE:
            break
        skip += PAGE
    return set(ids)


def main():
    st = load_state()
    prev = st.get("ids")
    cur = current_ids()

    if prev is None:  # first run: baseline only
        st["ids"] = sorted(cur)
        st["absent"] = {}
        save_state(st)
        print(f"baseline: {len(cur)} in custody — watching for releases")
        return

    removed = prev - cur

    # mass-removal guard: hold alerts while a sync claims >30% left at once
    if removed and len(removed) > max(10, int(len(prev) * MASS_FRACTION)):
        runs = st.get("mass_runs", 0) + 1
        st["mass_runs"] = runs
        save_state(st)
        print(f"hold: {len(removed)} removed ({runs}/3 runs) — possible "
              f"transient roster drop, not alerting yet")
        st["ids"] = sorted(cur)  # still advance baseline
        save_state(st)
        return
    st["mass_runs"] = 0

    absent = st.setdefault("absent", {})
    for pid in removed:
        absent[pid] = absent.get(pid, 0) + 1
    for pid in list(absent):
        if pid in cur:  # re-appeared — transient gap, never happened
            del absent[pid]
    st["ids"] = sorted(cur)

    for pid, n in list(absent.items()):
        if n >= CONFIRM_RUNS:
            print(f"RELEASED pid={pid} (absent {n} checks)")
            del absent[pid]
    save_state(st)


if __name__ == "__main__":
    sys.exit(main())
