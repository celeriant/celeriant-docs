---
title: Idempotent retries
---

# Idempotent retries

A network call can time out after the server committed but before you got the response. Retry naively and you double-write. Celeriant makes retries safe with a per-writer sequence number, so the same write applied twice lands once.

We call it idempotent retries, not "exactly-once". Exactly-once does happen here, but it takes two parts: the server refuses to apply the same sequence twice, and your client retries until it gets an answer. Celeriant can only promise its part. It cannot stop a client from changing its id, using a fresh sequence on every attempt, or giving up halfway. So the name describes the part the server actually owns.

## How it works

The dedup key is the pair `(clientId, ClientSeq)` per aggregate, not `ClientSeq` alone. Two reasons that matters:

- Multiple writers can produce the same `ClientSeq` against the same aggregate (each numbers their own events from 1). Without the `clientId`, the server would deduplicate two distinct writes by mistake; with it, each writer has its own sequence space.
- Idempotency is enforced per-`(aggregate, clientId)`. The history is scoped to that pair. Change the `clientId` and you start over - which is exactly the silent-corruption bug below.

Each writer holds a [client id](/concepts/identity) that must stay stable across restarts. Every write takes it explicitly, and the client library never invents one. Treat it like durable service config; if you let it drift (generating a fresh GUID at startup is the common mistake), the dedup history does not apply and a retried write *will* land twice. The server cannot detect this, because as far as it knows the two writes came from two different clients.

The sequence also needs to survive restarts. A service can re-derive it from the stream, since its own past events are replayable. An offline client persists it locally next to the queued event (SQLite, IndexedDB). Both patterns are in the [guide](/guides/idempotency).

For a given aggregate, the writer assigns a monotonic `ClientSeq` to each event it produces. With `enforceClientIdempotency: true`, the server tracks the highest `ClientSeq` it has seen for that `(aggregate, clientId)` and rejects anything at or below it.

Note the server keeps only the highest sequence, not a list of every sequence seen. It cannot tell "already written" from "never written but below the mark", so issue sequences in order. A write with several events is checked by its lowest sequence: every event in the write must be new.

```csharp
await pool.WriteAsync(
    key,
    events: [new AggregateEvent { ClientSeq = 7, /* ... */ }],
    clientId: writerId,
    enforceClientIdempotency: true);
```

If event 7 already landed, replaying it is a no-op as far as the log is concerned. The server returns `ClientIdempotencyViolation` ([error 2002](/reference/error-codes)); your client treats that as success, because the event you were trying to write is already there.

## The retry contract

This turns retries into something mechanical instead of something you reason about each time:

1. Assign each event a stable `ClientSeq` before the first attempt.
2. Send the write.
3. On a timeout or a dropped connection, send the same events with the same `ClientSeq` again. If the write is conditional, refresh the `expectedVersion` from a fresh read first; the next section is why.
4. A success means it landed. A `ClientIdempotencyViolation` means it had already landed. Either way, you are done.

You do not build a dedup table. You do not store "in-flight" markers. The sequence number is the dedup key, and the server owns it.

## Combined with optimistic concurrency

Idempotency and [optimistic concurrency](/concepts/optimistic-concurrency) compose, and the order of the checks is part of the contract: **the server checks the version guard first, then idempotency.** Two consequences follow.

First consequence: a retried conditional write needs a fresh `expectedVersion`. If your prior attempt landed, the version moved, because your own write moved it. Resend the identical request and the version guard fails first: you get a conflict (2003), never "already landed" (2002). So the retry recipe is: re-read, keep the same `ClientSeq` and payload, update the `expectedVersion`, send again. Now the server gives you a straight answer. Prior attempt landed: the guard passes and idempotency says 2002. Never landed: both checks pass and the write lands. This matters because after a timeout you cannot tell who moved the version, you or another writer. The retry is how you find out. One catch: with a shared client id, a 2002 is not automatically *yours*. That is the second consequence.

Second consequence: the ordering protects writers sharing a client id, with one gap you must close yourself. If two concurrent writes pick the same `ClientSeq`, the loser hits the version guard and gets a conflict. It re-reads and writes its own event under a fresh sequence. That holds only if the loser *hears* the rejection. If that 2003 is lost to a timeout, the loser follows the timeout recipe, retries its held sequence, and gets a 2002 about the winner's event, not its own. It reports success; its event was never written.

The root problem: `(clientId, ClientSeq)` only names your event if nobody else can mint the same name. Either keep one in-flight write per `(aggregate, clientId)` at a time, or verify a 2002 against your own request id before treating it as success. On a BFF the client id is shared by every concurrent request, so verification is the only option. The [guide](/guides/idempotency) shows it.

See the [idempotency guide](/guides/idempotency) for the end-to-end pattern, including HTTP request idempotency on top.
