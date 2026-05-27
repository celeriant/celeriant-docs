---
title: Building a read model
---

# Building a read model

Celeriant is the write side. To answer queries, you project the event log into a read store and query that. This is where the [eventual-consistency tradeoff](/introduction/when-not-to-use) actually lives.

## The shape

A projector folds events into a queryable store (Postgres here) and remembers how far it got. Two rules make it correct:

1. **Process in order, from a checkpoint.** Read from the last batch index you handled, apply, advance the checkpoint.
2. **Make apply idempotent**, or update the projection and the checkpoint in one transaction, so reprocessing an event after a crash is a no-op.

```csharp
// catch up from the checkpoint, then follow the live tail
long cursor = await db.LoadCheckpoint(aggId);

async Task Drain()
{
    await foreach (var batch in pool.ReadAllAsync(key, ReadFilters.From(cursor + 1)))
    {
        await using var tx = await db.BeginTransactionAsync();
        foreach (var e in batch.Events)
            await db.ApplyToReadModel(tx, e);          // update the projection
        await db.SaveCheckpoint(tx, aggId, batch.AggregateVersion); // same transaction
        await tx.CommitAsync();
        cursor = batch.AggregateVersion;
    }
}

await Drain();                                          // 1. catch up

await using var watch = await pool.WatchAsync(new WatchRequest { Aggregates = [aggId] });
while (true)                                            // 2. follow
{
    await watch.NextAsync();
    await Drain();                                      // re-drain from the cursor on each notification
}
```

Updating the read model and the checkpoint in the same database transaction is the trick: a crash either commits both or neither, so on restart you resume from exactly the right place and never double-apply.

## Just-in-time catch-up

The loop above keeps the read model close to live, but it still lags by the watch latency. When a read must reflect the very latest write to an aggregate, drain that aggregate inline at read time before serving:

```csharp
await DrainAggregate(key);   // pull any new events into the read model now
return await db.Query(key);  // then serve from the up-to-date projection
```

Per aggregate, that is effectively read-your-writes, at the cost of a catch-up read on the request path. It is the standard answer to "but my reads need to be current," and it is why [eventual consistency](/introduction/when-not-to-use) is not the blocker people assume. What it does not give you is a transactional snapshot across many aggregates; for that you need an RDBMS.

## Rebuilding

Because the log is the source of truth, you rebuild a read model from scratch whenever you change its shape: drop the projection and the checkpoint, and replay from batch index 1. A new read model is a new fold over the same events.
