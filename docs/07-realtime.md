# Realtime surface — what the socket.io endpoint does (and doesn't do)

Short version: **the box exposes a Socket.IO endpoint, it accepts a session, but
it publishes no service events to anonymous subscribers. Poll instead** — with
`If-None-Match` (see [06-recipes.md](06-recipes.md#3-cheap-change-detection-with-if-none-match)).

This file exists so the next agent doesn't spend an hour rediscovering it.

## What answers

```text
GET /socket.io/?EIO=3&transport=polling&t=<anything>
→ 200, Content-Type: text/plain; charset=UTF-8
→ body: 96:0{"sid":"…","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":5000}
```

Verbatim observations (2026-09-11):

- The server answers **both** `EIO=3` and `EIO=4` requests with the same
  handshake, and always frames the payload as **`<length>:<packet>`** — that is
  Engine.IO **v3** framing, i.e. a socket.io **v2** server (a modern
  python-socketio/`socket.io-client` v4 client will not talk to it directly;
  you'd need an engine.io-v3-era client, or hand-rolled polling as below).
- `pingInterval: 25000`, `pingTimeout: 5000`, `upgrades: ["websocket"]`.
  In v3 the **client** sends `2` (ping) and the server answers `3` (pong); a
  session that stops pinging is dropped after ~30 s with
  `400 {"code":1,"message":"Session ID unknown"}`.
- `POST /socket.io/?EIO=3&transport=polling&sid=<sid>` with body `40` (namespace
  connect) → `200 ok`; the pending long-poll then delivers `40`
  (socket.io connect ack).
- Emitting Feathers-style calls is accepted: body
  `42["find","inmates",{"query":{"$limit":1}}]` → `200 ok` (same for
  `offences`, `attachments`).

## What never arrives

With an open, pinged session subscribed via `find` on `inmates`, `offences` and
`attachments`, we sat through a complete county sync:

```text
02:00:01–02:00:53 UTC — the county re-stamped updatedAt on all 83 records
(listener log: 60 s of `3` pong packets, zero `42` event frames)
```

No `inmates created` / `inmates updated` / `inmates removed` frames were
published. Feathers only emits service events to clients that are *in* the
service's channel (and can require auth/`connection.api` room joins); this box
appears to publish to nobody anonymously. Conclusion: **there is no realtime
shortcut here.**

## What to use instead

| Need | Mechanism |
|---|---|
| "did anything change?" | `GET /inmates?$limit=0` (41 bytes) or a repeat request with `If-None-Match: <ETag>` → `304`, 0 bytes |
| "what's new?" | `$limit=1&$sort[createdAt]=-1` + gzip (~200 KB), compare to your watermark |
| "did this booking change?" | `GET /inmates/<ptsSubjectID>` (~200 KB gzipped) and hash the record |
| full sweep | 2 pages of 50, hourly at most |

All of those are ~10 s of code with stdlib `urllib` — no socket client, no
keep-alive (the box closes every HTTP connection anyway), no extra dependencies.

## Reproducing the probe

```python
# engine.io v3 polling in ~20 lines, no dependencies
import json, re, time, urllib.request

BASE = "http://64.225.20.254:3030"
frame = lambda pkt: f"{len(pkt)}:{pkt}"

def post(path, pkt):
    urllib.request.urlopen(urllib.request.Request(
        BASE + path, method="POST", data=frame(pkt).encode(),
        headers={"User-Agent": "realtime-probe/1.0", "Content-Type": "text/plain;charset=UTF-8"}))

body = urllib.request.urlopen(BASE + f"/socket.io/?EIO=3&transport=polling&t={time.time()}").read().decode()
sid = json.loads(re.search(r"\{.*\}", body).group(0))["sid"]
P = "/socket.io/?EIO=3&transport=polling&sid=" + sid
post(P, "40")                                   # namespace connect
post(P, '42["find","inmates",{"query":{"$limit":1}}]')
# then: GET P (long-poll) to receive frames; POST frame("2") every ~20 s to stay alive
```

The full listener used for this study lives in the project history
(`/tmp/sio_listen.py` at the time of writing) and is summarized above.
