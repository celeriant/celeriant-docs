---
title: Handling concurrency conflicts
---

# Handling concurrency conflicts

When a conditional write loses a race, the server rejects it and nothing is appended. The fix is a read-decide-write loop that re-runs on conflict. See [Optimistic concurrency](/concepts/optimistic-concurrency) for the concept.

## The loop

```csharp
while (true)
{
    // 1. read the aggregate's current version, and fold its events into state
    var details  = await pool.AggregateDetailsAsync(new AggregateDetailsRequest { AggregateKey = key });
    long version = details.MaxAggregateVersion;     // the version we guard against
    var state    = await LoadState(key);           // fold the stream; see Reading and replaying

    // 2. decide against that state
    if (!state.CanShip())
        throw new InvalidOperationException("cannot ship");

    try
    {
        // 3. write, guarded on the version we read
        await pool.WriteAsync(key,
            events: [new AggregateEvent
            {
                ClientSeq = state.NextClientIndex,
                EventTypeMajor   = 1,
                EventTimestamp   = DateTimeOffset.UtcNow,
                EventValue       = shipped,
            }],
            clientId: writerId,
            expectedVersion: version,
            enforceClientIdempotency: true);
        break; // committed
    }
    catch (WriteOccException)
    {
        // someone moved the aggregate after step 1; loop, re-read, re-decide
    }
}
```

`LoadState` is a fold of the stream (from the start, or from a snapshot); see [Reading and replaying](/guides/reading-and-replaying). The conflict is caught as a typed `WriteOccException` (error 2003). Every operation throws its own typed exception under `CeleriantErrorException`, so catch that and switch on `e.Error.ErrorCode` if you prefer a single handler.

## The new-aggregate case

`expectedVersion` is the aggregate's current version, which is `AggregateDetailsAsync(...).MaxAggregateVersion`. For a brand-new aggregate, pass `expectedVersion: 0` with `allowCreate: true`: it commits only if the aggregate does not yet exist, so two creators race cleanly.

## The four ways a write retry resolves

Failures look alike and must be handled differently, because they interact with [idempotency](/guides/idempotency). The rule turns on one question: does the prior attempt's event already exist, and is it durable?

- **Conflict** (`WriteOccException`, 2003): the world changed. Re-read, re-decide, and write a genuinely new event, re-deriving its `ClientSeq` from the caught-up state. The loop above does this.
- **Timeout or dropped connection**: you do not know whether the write landed. Retry with the *same* `ClientSeq` after a backoff; if it did land, the retry comes back as an idempotency violation (the last case below), which tells you it is safe to stop.
- **In-flight duplicate** (`InflightDuplicateWriteException`, 2013): a prior attempt with this `ClientSeq` was written but is not yet confirmed durable. Hold the `ClientSeq`, back off, and retry. Do not call it success yet; it could still roll back.
- **Idempotency violation** (`IdempotencyViolationException`, 2002): an event with this `ClientSeq` landed and is durable. If yours is the only request in flight for this `clientId`, that event is your prior attempt: treat it as success and read the result back. But when concurrent requests share a `clientId`, a sibling may have taken the sequence first; then your event never landed, and this is really a conflict in disguise. The stream settles it: the reference (`celeriant_reference/src/verify.rs` in the server repo) point-reads the contested sequence and compares its `EventId`. Yours means success; a sibling's means re-derive and retry.

The trap is using a fresh `ClientSeq` on a timeout retry: that appends the event twice. Hold the sequence constant on anything that might already be in flight, and re-derive it only after a genuine conflict.

## Do not retry forever

A conflict means the world changed and your decision needs re-checking; it is not a transient error to mask. If your loop spins many times on one aggregate, that aggregate is genuinely hot and you have a modeling problem. Cap the retries and surface the contention.
