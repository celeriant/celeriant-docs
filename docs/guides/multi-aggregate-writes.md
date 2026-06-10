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

Every aggregate in one request must live on the same [shard](/concepts/consistency-boundaries). The engine checks this at the front door, *before* validating events or guards: it computes the routed shard for each aggregate key and bails the entire request if more than one shard is involved. You get error **9001 `ShardRoutingMultipleShards`**.

Whether two aggregates share a shard is decided by `routing_id % num_shards`, where `routing_id` is one of `org_id`, `aggregate_type_id`, or `aggregate_id` per the rule set at cluster init. Not configurable per request; this is a cluster-wide decision baked in at startup.

## Picking the routing rule for the invariant

| Invariant you co-commit | Pick this rule | What you give up |
|---|---|---|
| Two aggregates in the same org (transfer between accounts in one tenant) | `org_id` | Per-tenant writes serialise on one shard |
| Two aggregates of the same type, across orgs | `aggregate_type_id` | That type's writes serialise on one shard |
| Independent, single-aggregate writes mostly | `aggregate_id` (default) | Multi-aggregate writes only work between *deliberately co-located* ids |

## Co-locating aggregates

If you are on the default rule and need a multi-aggregate write to land, you cannot pick the aggregates at random. You have to assign ids such that the modulo lines up:

```
num_shards = 4
account_A.aggregate_id = 1000   // 1000 % 4 = 0  → shard 0
account_B.aggregate_id = 1004   // 1004 % 4 = 0  → shard 0
```

A write across A and B is accepted. Pick `1001` for B and you get error 9001. So: if you ever expect to co-commit two aggregates, allocate their ids together, off a base value that mods to the shard you want. The same logic applies to id generators; a UUID-based allocator will scatter aggregates uniformly and break this entirely.

Co-location works for all routing types: `org_id`, `aggregate_type_id` and `aggregate_id`.

If you cannot guarantee co-location at allocation time, you have the wrong rule. Re-route by `org_id` or `aggregate_type_id`.

## Troubleshooting error 9001

`ShardRoutingMultipleShards (9001)` means the aggregate keys in the request hashed to different shards. Two reasons it fires:

1. Your routing rule does not match your invariant (writing across orgs while routing by `org_id`, etc.). Re-route the cluster.
2. You are on `aggregate_id` routing and the ids do not share a modulus. Re-allocate ids or re-route.

This is *not* an OCC conflict. Retrying with the same keys will fail forever.

## Conflicts work the same way

A multi-aggregate write conflicts if any of its guards is stale. Wrap it in the same [read-decide-write loop](/guides/handling-conflicts): on `WriteOccException`, re-read every aggregate's version, re-decide, and resubmit. The entire batch is rolled back atomically on any guard failure; you never have to clean up a half-applied write.
