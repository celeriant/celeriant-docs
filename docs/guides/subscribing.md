---
title: Subscribing to live events
---

# Subscribing to live events

Open a [watch](/concepts/watch) to react to writes as they land. A watch delivers change notifications, not payloads; you read the new events yourself.

## Open a watch

```csharp
var request = new WatchRequest
{
    AggregateTypes = [ordersType],               // scope: a type, or Orgs / Aggregates
    OperationTypes = [WatchOperationType.Write], // only writes
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

One request, one loop. The connection is dedicated, not pooled; dispose it when done.

## Shards are handled for you

A watch runs per shard, and your scope often spans several. The client library deals with this: it probes with a single connection, and if the server reports the scope crosses shards, it opens one connection per shard and merges them into the one stream behind `NextAsync`. You never see the fan-out.

Only the raw protocol path makes you think about shards. There, a watch without a `shard_id` must route to exactly one shard, so the scope has to line up with the cluster's [routing rule](/concepts/aggregates): routed by `org_id` you need an `Orgs` filter, by `aggregate_type_id` an `AggregateTypes` filter, by `aggregate_id` the explicit `Aggregates`. Cross the wires and you get error 9002 (`IncompatibleFilters`); a scope spanning multiple shards gets 9001 with the shard count. The client library recovers from both by fanning out, so you only ever see these errors on a raw connection.

## Latency

`RequestedLatency` is how much coalescing you tolerate. A higher value lets the server merge bursts into fewer notifications; it never drops a change, because the notification's `ToAggregateVersion` only advances, so re-reading from your cursor cannot skip a batch. Exceed the server's `--watch-max-requested-latency-ms` and you get 8001 (`LatencyTooHigh`).

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
