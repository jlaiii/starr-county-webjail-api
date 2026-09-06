# Data model

Two real collections (`inmates`, `offences`) + one custom detail route.
Field dictionaries below are **as observed on live data (Sep 2026)** —
types and enum values come from full-collection analysis, not docs.

## `inmates` — one record per current booking

One row per **booking** (a stay). The same person re-booked later gets a new
record with new IDs. Example values from live data.

| Field | Type | Example | Notes |
|---|---|---|---|
| `_id` | string | `"67a5a161f79f214686544d18"` | Mongo ObjectId |
| `ptsBookingID` | int | `10438` | **Join key.** Unique per booking. New-booking watchers key off this |
| `ptsPersonID` | int | `24332` | Person identity. Two same-name bookings on the roster had different ptsPersonID → they were different people |
| `ptsSubjectID` | int | `4983` | Subject identity (jail management system) |
| `BookingID` | string | `"2026001955"` | **Public booking number: `YYYY` + 6-digit sequence.** Zero-padded → lexicographic sort == chronological |
| `BookingDate` | string | `"2026-09-05T00:00:00.000Z"` | Calendar date county logged the booking. Always UTC **midnight** — time part meaningless |
| `FirstName` / `MiddleName` / `LastName` | string | `"AXEL"` / `""` / `"GUTIERREZ"` | Uppercase. Middle often empty. Names can be hyphenated (`"CARDONA-ZUNIGA"`) |
| `DOB` | string | `"1993-06-25T00:00:00.000Z"` | Midnight UTC. Age = compute from date |
| `Gender` | string | `"MALE"` | Observed: `MALE`, `FEMALE` |
| `Race` | string | `"WHITE"` | Observed: `WHITE` (majority), `BLACK` — uppercase words |
| `EyeColor` | string | `"BROWN"` | `BROWN`, `GREEN`, `BLACK`, `BLUE`, `HAZEL` |
| `HairColor` | string | `"BLACK"` | `BLACK`, `BROWN`, `GREY OR PARTIALLY GREY`, `BALD`, or null |
| `Height` | string | `"5'06\""` | Feet-inches string with quote |
| `Weight` | int | `180` | Pounds. Observed 119–290 |
| `MugShotFileStream` | string | base64 PNG | **Raw base64, no `data:` prefix in current data** (older records may include one — strip defensively). ~150–290 KB decoded. Sniff magic: `iVBORw0KGgo` = PNG, `/9j/` = JPEG |
| `PublishImageToWebjail` | bool | `true` | County's publication flag; ~96% true. When false, the mugshot is withheld from the public site |
| `createdAt` | string | `"2026-09-05T18:00:01.280Z"` | **API insert time** — hourly batch, seconds cluster at `:01`–`:02`. Median ~22 h after `BookingDate` (see 04-lifecycle) |
| `updatedAt` | string | `"2026-09-06T01:00:50.290Z"` | **Re-stamped hourly on every record** — do not use for change detection |

There is **no** `IsBondDenied`/bond field at the roster level — bondability
comes from the booking's `offences` rows.

## `offences` — charges

Join: `offences.ptsBookingID` → `inmates.ptsBookingID` (1 booking → N charges).
Note the same charge is served both here and inside `/inmate-detail/:pid`.

| Field | Type | Example | Notes |
|---|---|---|---|
| `ptsChargeID` | int | `8271` | Charge ID |
| `ptsBookingID` | int | `10438` | Join key to inmate |
| `StatuteDescription` | string | `"POSS MARIJ >4OZ<=5LBS"` | Free-text statute (uppercase, abbreviations) |
| `StatuteLevel` | string | `"SF"` | **Messy**: `MA`, `F3`, `SF`, `F1`, `F2`, `MB`, `MISDEMEANO` (sic), null |
| `BondAmount` | int | `2500` | Dollars. Can be null. Huge for F1s (e.g. 1,000,000) |
| `IsBondDenied` | bool | `false` | All `false` in the current snapshot; still check per charge |
| `ArrestingAgency` | string | `"STARR COUNTY SHERIFF'S OFFICE"` | 10+ agencies observed: SCSO, Rio Grande City PD, HCSO, DPS, Roma PD, HIDTA, ... |
| `ArrestDate` | string | `"2025-02-06T00:00:00.000Z"` | Midnight UTC |
| `createdAt` / `updatedAt` | string | ISO | Same batch semantics as inmates |

## `/inmate-detail/:ptsBookingID`

```json
{ "offences": [ ...same shape as /offences rows... ], "attachments": [] }
```

- Unknown pid → `200` with empty arrays (not 404).
- `attachments` is always `[]` on this system.

## `attachments` collection

`{ "total": 0, ... "data": [] }` — always empty. Ignore it.

## `/inmates/get/genders-races`

```json
{ "races": ["BLACK", "WHITE"], "genders": ["FEMALE", "MALE"] }
```

Narrower than the data actually contains (e.g. `HairColor` values above).
Fine for building filter chips, not for validation.

## ID semantics summary

- `ptsBookingID` — unique per booking/stay. Mugshot files, alerts, and
  dedupe keys should all use this.
- `ptsPersonID` / `ptsSubjectID` — person-level; stable identifiers from the
  county system. Two active bookings for "GABRIEL RODRIGUEZ" had different
  ptsPersonIDs → distinct people, not a duplicate.
- `BookingID` — human-facing number, `YYYY######`.
- There is no public endpoint to resolve person → past bookings.
