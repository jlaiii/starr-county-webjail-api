# curl one-liners (all read-only)

BASE=http://64.225.20.254:3030

# Count current inmates (cheapest useful request: 41 bytes)
curl "$BASE/inmates?\$limit=0"

# Count charges
curl "$BASE/offences?\$limit=0"

# Newest 5 bookings (createdAt = API insert time, see docs/04)
curl "$BASE/inmates?\$limit=5&\$sort[createdAt]=-1"

# Highest booking numbers (true chronological order)
curl "$BASE/inmates?\$limit=5&\$sort[BookingID]=-1"

# ONE full record, no paging — the id route is keyed on ptsSubjectID (NOT the booking id)
curl "$BASE/inmates/10260"
# curl "$BASE/inmates/10501"    # ptsBookingID here -> 404 No record found for id '10501'

# A single booking's charges (this one IS keyed on ptsBookingID)
curl "$BASE/inmate-detail/10501"

# Ask for gzip (curl needs --compressed; urllib needs manual gzip.decompress)
curl --compressed "$BASE/inmates?\$limit=5&\$sort[createdAt]=-1" -o /tmp/page.json

# Conditional GET: send back the weak ETag; an unchanged resource answers 304 with 0 bytes
ETAG=$(curl -sI "$BASE/inmates?\$limit=0" | tr -d '\r' | awk -F': ' '/^ETag/{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" "$BASE/inmates?\$limit=0"

# NOTE: field filters do NOT work — this returns the whole roster:
curl "$BASE/inmates?LastName=GARZA"
# ...so filter locally: save a page and grep
curl -s "$BASE/inmates?\$limit=50" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print([r['ptsBookingID'] for r in d['data'] if 'garza' in ' '.join((r.get('FirstName') or '', r.get('LastName') or '')).lower()])"

# Page 2 (the API caps at 50 per page — roster is ~2 pages)
curl "$BASE/inmates?\$limit=50&\$skip=50"

# Never trust total from a filtered URL; total is always the full count:
curl "$BASE/inmates?LastName=NOPE&\$limit=0"   # total still = full roster size

# Odd params the box accepts silently (see docs/03): $skip=-5 skips FORWARD 5,
# a repeated param keeps the FIRST value, and a bad $limit returns limit:null.
curl "$BASE/inmates?\$limit=5&\$limit=2"        # -> "limit: 5"

# Error shapes worth knowing (read-only, safe):
curl -s "$BASE/inmates/count"                   # 400 BadRequest (id route casts to ptsSubjectID)
curl -s "$BASE/nope"                            # 404 NotFound {"message":"Page not found"}
curl -s "$BASE/inmate-detail/999999"            # 200 {"offences":[],"attachments":[]}  (NOT a 404)
