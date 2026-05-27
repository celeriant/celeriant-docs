---
title: Implementing idempotent writes
---

# Implementing idempotent writes

Make a write safe to retry, so a timeout never becomes a double-write. See [Idempotent retries](/concepts/idempotent-writes) for the concept.

## The two pieces

1. A **stable client id** per writer. This is the catch: the `WriteAsync` convenience overload defaults `clientId` to a fresh random GUID, which defeats idempotency. Pass your own, and keep it stable across process restarts (treat it like durable service config, see [identity](/concepts/identity)).
2. A **monotonic `ClientSeq`** per event, and `enforceClientIdempotency: true`.

```csharp
await pool.WriteAsync(key,
    events: [new AggregateEvent
    {
        ClientSeq = 7,            // stable for THIS logical event
        EventTypeMajor   = 1,
        EventTimestamp   = DateTimeOffset.UtcNow,
        EventValue       = payload,
    }],
    clientId: writerId,                  // stable per writer, NOT the default
    enforceClientIdempotency: true);
```

The server tracks the highest `ClientSeq` it has seen per `(aggregate, clientId)` and rejects anything at or below it.

## The retry contract

```csharp
try
{
    await pool.WriteAsync(key, events, clientId: writerId, enforceClientIdempotency: true);
}
catch (IdempotencyViolationException)
{
    // error 2002: this event already landed. Treat as success; do not re-issue with a new index.
}
```

So the rule is mechanical:

1. Assign each logical event a stable `ClientSeq` before the first attempt.
2. Send it. On a timeout or dropped connection, send the exact same write again.
3. A success means it landed. An `IdempotencyViolationException` means it had already landed. Either way you are done.

You never build a dedup table; the `(clientId, ClientSeq)` pair is the dedup key, and the server owns it.

Two server responses both mean "this sequence is already here," and they differ. `IdempotencyViolationException` (2002) means the prior write is durable: you are done. `InflightDuplicateWriteException` (2013) means it is written but not yet confirmed durable: hold the `ClientSeq`, back off, and retry rather than declaring success, since it could still roll back. The [conflict guide](/guides/handling-conflicts) lays out all four ways a retry resolves.

## With optimistic concurrency

Idempotency and [conflict handling](/guides/handling-conflicts) compose: a retried conditional write is both safe to repeat and still guarded on `expectedVersion`. Set both on the same write. Mind the distinction the conflict guide draws: on an OCC conflict you re-derive the `ClientSeq` (a new fact), but on a timeout you reuse it (same fact, dedup catches it). Using a fresh index on a timeout retry is the double-write bug idempotency exists to prevent.

## HTTP request idempotency on top

If a client request maps to a write, derive the `ClientSeq` (or carry an `Idempotency-Key` header through to it) from the request, not from a counter you bump per attempt. Then a client that retries the HTTP call reuses the same index, and the write deduplicates end to end.
