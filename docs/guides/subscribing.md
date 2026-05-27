---
title: Subscribing to live events
---

# Subscribing to live events

Open a [watch](/concepts/watch) to react to writes as they land. A watch delivers change notifications, not payloads; you read the new events yourself. The connection is dedicated, so dispose it.

## Open a watch

```csharp
var request = new WatchRequest
{
    RequestedLatency = TimeSpan.FromMilliseconds(250), // tolerate up to 250ms of coalescing
    AggregateTypes   = [ordersType],                   // scope: a type, or Orgs / Aggregates
    OperationTypes   = [WatchOperationType.Write],     // only writes
};

await using var watch = await pool.WatchAsync(request);

while (true)
{
    var response = await watch.NextAsync();
    foreach (var change in response.Events)
    {
        // change.OrgId / AggregateTypeId / AggregateId identify the aggregate,
        // change.FromAggregateVersion .. ToAggregateVersion is what changed.
        await ReadAndApply(change);
    }
}
```

Scope the watch with `Orgs`, `AggregateTypes`, or `Aggregates`, and filter by `OperationTypes`. A higher `RequestedLatency` lets the server coalesce bursts into fewer notifications; it never drops a change, because the notification's `ToAggregateVersion` only advances, so re-reading from your cursor cannot skip a batch.

## Catch up, then follow

A watch covers the live tail, not the past. To process every event with no gap and no duplicate, read up to where you are now, then start the watch, then read forward from the notifications:

```csharp
long cursor = LoadCheckpoint(key); // last batch index you processed

// 1. catch up
await foreach (var batch in pool.ReadAllAsync(key, ReadFilters.From(cursor + 1)))
{
    foreach (var e in batch.Events) Apply(e);
    cursor = batch.AggregateVersion;
}

// 2. follow
await using var watch = await pool.WatchAsync(new WatchRequest { Aggregates = [aggId] });
while (true)
{
    var response = await watch.NextAsync();
    foreach (var change in response.Events)
    {
        await foreach (var batch in pool.ReadAllAsync(key, ReadFilters.From(cursor + 1)))
        {
            foreach (var e in batch.Events) Apply(e);
            cursor = batch.AggregateVersion;
        }
    }
}
```

Reading by cursor on every notification, rather than trusting the notification's range alone, makes the consumer idempotent: a coalesced or duplicated notification just re-reads from where you are, which finds nothing new. It also closes the small window between finishing catch-up and the watch going live: the first notification re-drains anything written in between. If you must reflect a write the instant it lands, with no notification to wait for, drain the aggregate inline at read time; see [Building a read model](/guides/building-a-projection).
