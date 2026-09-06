# Record lifecycle — how data appears, changes, and disappears

Understanding the county's update rhythm is what makes watchers reliable.

## The hourly batch rhythm

The county system writes to this API on a **scheduled hourly job**:

- **`createdAt` clusters at `:00:01`–`:00:02` UTC.** Observed: 68/82 records
  at second `01`, the rest at `02`. New bookings are not visible the instant
  someone is arrested — they appear when the county's job inserts them
  (typically same or next calendar day).
- **`updatedAt` is re-stamped on EVERY record at the top of every hour.**
  A page sorted by `updatedAt` desc shows the entire roster churning hourly —
  this is a full re-touch, not real activity.

Measured Sep 2026: `BookingDate` (the logged booking date) vs `createdAt`
(API insert) gap: min 6 h, median **22 h**, max 89 h. So:

> **`BookingDate` = when the county logged the booking.
> `createdAt` = when this API first saw it.
> `BookingID` = the authoritative chronological sequence
> (`YYYY######`, zero-padded, lexicographically sortable).**

For alerting, treat **new unseen `ptsBookingID`** as the event, and order by
`BookingID` or `createdAt` — never by `updatedAt`.

## Booking lifecycle (happy path)

1. Person arrested → county keys the booking → appears in `BookingDate`.
2. County's hourly job inserts the roster record → `createdAt` = `:00:01` of
   that hour, full record incl. base64 `MugShotFileStream`, and matching
   rows in `/offences`.
3. Record stays in `/inmates` for the whole stay. Charges/bond can be edited
   by the county (record content hash changes; `updatedAt` re-stamp makes
   hash-diffing the only reliable edit detector — or just re-fetch).
4. Release → **the record is deleted from the API entirely.** No tombstone,
   no status flag, no archive endpoint. Same for `/offences` rows.

## Release detection

Since deletion is the only signal:

- Poll the roster ID set and diff: `prev_ids - current_ids` = released.
- **Confirm across 2+ consecutive polls.** The box occasionally drops the
  whole roster (or large chunks) for one or two syncs and then re-adds
  records with the **same `ptsBookingID`** — a naive watcher fires a mass
  "released" alert for people who never left. Two-phase confirmation plus a
  mass-removal guard (>30% of roster gone at once = suspicious) eliminates
  these false alarms.
- Re-added records keep their `ptsBookingID`. Re-booked people (new stay)
  get a **new** `ptsBookingID` and usually new `ptsPersonID`/`ptsSubjectID`.
- Two same-name, same-day bookings in the data turned out to be two
  different people (different person IDs) — never assume duplicate rows
  are the same human.

## Historical data

**None exists on the API.** The collection only holds current custody.
If you want history (released inmates, old bookings, mugshots after
release), you must archive it yourself while records are live — the county
deletes them and no backup is served.

## Chronology cheat sheet

| Need | Use |
|---|---|
| "New since last check" | `createdAt` watermark on `ptsBookingID` set |
| True booking order | `BookingID` string sort |
| Detect edits to a booking | content hash of the record (not `updatedAt`) |
| Detect release | roster ID-set diff, 2-phase confirmed |
| Detect a person's past stays | impossible via API — archive yourself |
