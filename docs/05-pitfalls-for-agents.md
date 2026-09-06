# Pitfalls for AI agents — read this first

Condensed from production experience (we run live booking/release watchers
against this API). Read `01`–`04` for depth; this file is the checklist
that prevents the classic mistakes.

## 1. Payloads are huge — budget every fetch

Each `/inmates` record embeds a **base64 mugshot** and weighs ~150–300 KB.
The full roster (~82–90 records) is **~25 MB** over 2 pages.

- One `$limit=1` probe = ~300 KB. A full scan = ~25 MB. Every request hits
  the county's box cold (no cache).
- **Do not** poll full pages on a fast cadence just to check "anything new?"
- New-booking check that costs ~300 KB: fetch `$limit=1&$sort[createdAt]=-1`
  and compare the top record's `createdAt` to your watermark (see #3).
  Full-scan rarely (hourly) as a safety net.
- A 1-minute full-roster poll would pull ~36 GB/day from the county. Don't.

## 2. Filters are ignored — including ones that look like they work

Verified ignored: `status=released`, field equality, `[$ne]`, `[$gt]`,
`[$like]`, `$or`, `$select`, `$select[]`, `released=1`, `isReleased=true`.
The server returns the unfiltered collection and a `total` that is the FULL
collection count. Filter in your code.

- Want one person? Fetch pages, match `ptsBookingID`/name client-side.
- Want a released roster? It doesn't exist. `?status=released` returns the
  same active roster.

## 3. Watermark on `createdAt`, never `updatedAt`

`updatedAt` is re-stamped **hourly on every record** (the county's sync
touches the whole collection) — a `updatedAt` watermark fires constantly.

`createdAt` is insert time only. New records appear at `:00:01`–`:00:02`
UTC on the hour. Watch pattern:

```
fetch newest record (sort createdAt desc, limit 1)
if its createdAt > watermark:
    page through createdAt-desc until records <= watermark
    alert every ptsBookingID not in your seen-set
    watermark = max createdAt seen this pass   # advance past seen records too!
```

Pitfall inside the pitfall: if you only advance the watermark for *alerted*
records, every later tick re-pays a full page scan for the already-seen top
record. Advance past **everything** you examined.

## 4. `BookingID` is the real clock

`BookingDate` is a calendar date at UTC midnight (time part meaningless),
and `createdAt` lags the actual booking by hours (median ~22 h — the county
keys bookings and the hourly job inserts them later). For anything
chronological use `BookingID` = `YYYY` + zero-padded 6-digit sequence —
lexicographic sort == true order.

## 5. Released = deleted, and deletions can be transient

- Release detection = roster ID-set diff.
- The box has been observed dropping the **whole roster** (or chunks) for a
  sync or two, then re-adding identical records. Two-phase confirm
  (absent on 2 consecutive polls) + mass-removal guard (>30% gone at once)
  before alerting.
- Mugshots of released people are gone from the county for good — archive
  while live if you need history.

## 6. Mugshot decoding

- Raw base64 without `data:` prefix in current data (defensive: strip a
  leading `data:...;base64,` if present).
- Decoded bytes are PNG or JPEG. Sniff magic: `\x89PNG\r\n\x1a\n` → `.png`,
  `\xff\xd8` → `.jpg`. Observed roster is ~100% PNG, ~150–290 KB each.
- Save by `ptsBookingID` (unique per booking) — e.g. `mugshots/<pid>.png`.
- `PublishImageToWebjail: false` means the county withholds the photo from
  the public site — respect that flag if you mirror the public site.

## 7. Data quality landmines

- Names: uppercase, hyphenated surnames, middle names often empty. Join
  parts with spaces; match case-insensitively.
- `StatuteLevel` has typos (`"MISDEMEANO"`) and nulls — don't enumerate
  strictly.
- `ArrestingAgency` includes `"STARR COUNTY SHERIFF'S OFFICE"` — watch the
  apostrophe when building queries/CSVs.
- No `IsBondDenied` on roster records — derive bondability from the
  booking's `/offences` rows (`IsBondDenied` per charge).
- `Gender`/`Race`/`EyeColor`/`HairColor` are uppercase words; `Height` is
  `5'06"`, `Weight` is an int in pounds.

## 8. Detail endpoint

`/inmate-detail/<ptsBookingID>` → `{offences:[...], attachments:[]}`.
Unknown id returns **200 with empty arrays**, not 404. `attachments` is
always empty on this system.

## 9. Writes are auth-protected — don't try

`POST/PUT/PATCH/DELETE` → `500 {"message":"Unauthenticated"}`. Anonymous
access is strictly read-only. (Also: don't poll the county's write path.)

## 10. Delivery/formatting lessons (for notification bots)

If you send alerts to chat apps (Telegram etc.), per-person messages beat
merged digests: one message with the person's bold name, booking number,
dates, charges; then the mugshot as its own attachment right after. When
several bookings arrive together, send pairs sequentially so photos never
detach from their owners. HTML-escape every name/field you interpolate.

## Polite-use summary

- ≥1 min polling cadence; full scans at most hourly.
- Cache what you fetch; archive what you care about (it will be deleted).
- Set a descriptive `User-Agent`.
- It's public data, but it's also a county public-safety system — no
  scraping bursts, no writes, no life-safety claims from lagged data.
