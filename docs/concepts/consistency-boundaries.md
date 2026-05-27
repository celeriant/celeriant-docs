---
title: Consistency boundaries
---

# Consistency boundaries

A consistency boundary is the set of aggregates a single write commits atomically: all of them land, or none do. In Celeriant that boundary can be more than one aggregate, which is unusual and useful.

## Beyond the single aggregate

Classic event sourcing draws the boundary at one aggregate: each write touches exactly one stream, and any invariant spanning two becomes a saga. Celeriant lets a single write carry [conditional](/concepts/optimistic-concurrency) writes to several aggregates and commit them atomically.

The textbook case is a transfer: debit one account, credit another, both or neither. You express it as one write carrying both events, each guarded on its own version. If either guard fails, the whole write is rejected and nothing is appended to either stream. No saga, no compensating action, no half-applied transfer to clean up. The [multi-aggregate writes guide](/guides/multi-aggregate-writes) has the code.

## The boundary is a shard

The aggregates in one atomic write must live on the same [shard](/concepts/aggregates), and the server's routing rule decides which aggregates those are. Route by org and a tenant's aggregates share a shard, so they can be co-committed. Route by aggregate id and every aggregate lands on its own shard, so atomic multi-aggregate writes are effectively off. Choose the routing rule around the invariants you need to enforce together.

This is deliberate: cross-shard atomic writes would reintroduce the distributed transaction Celeriant exists to avoid. If an invariant genuinely spans shards no matter how you route, Celeriant is the wrong tool for that particular write, and you will coordinate it outside the store. See [Atomic multi-aggregate writes](/guides/multi-aggregate-writes).
