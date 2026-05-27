---
title: Atomic multi-aggregate writes
---

# Atomic multi-aggregate writes

Commit events to more than one aggregate in a single write that lands all-or-nothing. Use the full `WriteRequest`, which carries a map of aggregate to its events and guard. See [Consistency boundaries](/concepts/consistency-boundaries).

## A transfer

```csharp
await pool.WriteAsync(new WriteRequest
{
    ClientId = writerId,
    Writes = new Dictionary<AggregateKey, SingleAggregateWrite>
    {
        [fromAccount] = new()
        {
            Events = [new AggregateEvent { ClientSeq = nextFrom, EventTypeMajor = 1, EventTimestamp = now, EventValue = debited }],
            ExpectedVersion = fromVersion,
            EnforceClientIdempotency = true,
        },
        [toAccount] = new()
        {
            Events = [new AggregateEvent { ClientSeq = nextTo, EventTypeMajor = 1, EventTimestamp = now, EventValue = credited }],
            ExpectedVersion = toVersion,
            EnforceClientIdempotency = true,
        },
    },
});
```

`ClientId` lives on the request (it is the writer's identity for the whole batch). Each `SingleAggregateWrite` carries its own events, its own `ExpectedVersion` guard, and its own `AllowCreate`. If any guard fails, the entire request is rejected and neither aggregate changes.

## The constraint

Every aggregate in one request must live on the same [shard](/concepts/consistency-boundaries). Whether two specific aggregates do is decided by the server's routing rule. If you co-commit across an org's aggregates, route by `org_id` so they share a shard. A request whose aggregates span shards is rejected; that is not a missing feature, it is the line that keeps writes free of distributed transactions.

## Conflicts work the same way

A multi-aggregate write conflicts if any of its guards is stale. Wrap it in the same [read-decide-write loop](/guides/handling-conflicts): on `WriteOccException`, re-read every aggregate's version, re-decide, and resubmit.
