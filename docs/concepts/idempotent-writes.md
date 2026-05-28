---
title: Idempotent retries
---

# Idempotent retries

A network call can time out after the server committed but before you got the response. Retry naively and you double-write. Celeriant makes retries safe with a per-writer sequence number, so the same write applied twice lands once.

We call it idempotent retries, not "exactly-once". Exactly-once delivery is a fight you cannot win; idempotent writes are a contract you can keep, and it is the one that matters.

## How it works

The dedup key is the pair `(clientId, ClientSeq)` per aggregate, not `ClientSeq` alone. Two reasons that matters:

- Multiple writers can produce the same `ClientSeq` against the same aggregate (each numbers their own events from 1). Without the `clientId`, the server would deduplicate two distinct writes by mistake; with it, each writer has its own sequence space.
- Idempotency is enforced per-`(aggregate, clientId)`. The history is scoped to that pair. Change the `clientId` and you start over — which is exactly the silent-corruption bug below.

Each writer holds a [client id](/concepts/identity) that must stay stable across restarts. Treat it like durable service config; if you let it drift (the default new-GUID-per-process pattern is the common mistake), the dedup history does not apply and a retried write *will* land twice. The server cannot detect this, because as far as it knows the two writes came from two different clients.

For a given aggregate, the writer assigns a monotonic `ClientSeq` to each event it produces. With `enforceClientIdempotency: true`, the server tracks the highest `ClientSeq` it has seen for that `(aggregate, clientId)` and rejects anything at or below it.

```csharp
await pool.WriteAsync(
    key,
    events: [new AggregateEvent { ClientSeq = 7, /* ... */ }],
    enforceClientIdempotency: true);
```

If event 7 already landed, replaying it is a no-op as far as the log is concerned. The server returns `ClientIdempotencyViolation` ([error 2002](/reference/error-codes)); your client treats that as success, because the event you were trying to write is already there.

## The retry contract

This turns retries into something mechanical instead of something you reason about each time:

1. Assign each event a stable `ClientSeq` before the first attempt.
2. Send the write.
3. On a timeout or a dropped connection, send the exact same write again.
4. A success means it landed. A `ClientIdempotencyViolation` means it had already landed. Either way, you are done.

You do not build a dedup table. You do not store "in-flight" markers. The sequence number is the dedup key, and the server owns it.

## Combined with optimistic concurrency

Idempotency and [optimistic concurrency](/concepts/optimistic-concurrency) compose. The server checks the version guard and the idempotency token together, so a retried conditional write is both safe to repeat and still conditional. See the [idempotency guide](/guides/idempotency) for the end-to-end pattern, including HTTP request idempotency on top.
