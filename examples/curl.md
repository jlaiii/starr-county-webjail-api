# curl one-liners (all read-only)

BASE=http://64.225.20.254:3030

# Count current inmates
curl "$BASE/inmates?\$limit=0"

# Count charges
curl "$BASE/offences?\$limit=0"

# Newest 5 bookings (createdAt = API insert time, see docs/04)
curl "$BASE/inmates?\$limit=5&\$sort[createdAt]=-1"

# Highest booking numbers (true chronological order)
curl "$BASE/inmates?\$limit=5&\$sort[BookingID]=-1"

# A single booking's charges
curl "$BASE/inmate-detail/10438"

# NOTE: field filters do NOT work — this returns the whole roster:
curl "$BASE/inmates?LastName=GARZA"
# ...so filter locally: save a page and grep
curl -s "$BASE/inmates?\$limit=50" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print([r['ptsBookingID'] for r in d['data'] if 'garza' in ' '.join((r.get('FirstName') or '', r.get('LastName') or '')).lower()])"

# Page 2 (the API caps at 50 per page — roster is ~2 pages)
curl "$BASE/inmates?\$limit=50&\$skip=50"

# Never trust total from a filtered URL; total is always the full count:
curl "$BASE/inmates?LastName=NOPE&\$limit=0"   # total still = full roster size
