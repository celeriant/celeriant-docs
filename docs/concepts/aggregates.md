---
title: The aggregate hierarchy
---

# The aggregate hierarchy

An aggregate is a single event stream and the unit of everything that matters here: ordering, optimistic concurrency, and addressing. Every event belongs to exactly one aggregate.

## The three-part key

An aggregate is addressed by a three-part key:

```
org_id / aggregate_type_id / aggregate_id
```

- **org** is the top-level tenant. Nothing is shared across orgs; it is a hard isolation boundary.
- **aggregate type** groups aggregates of the same kind: `Orders`, `Accounts`, `Devices`.
- **aggregate id** identifies the individual stream.

So `Acme / Orders / order-4821` is one order's event stream. All three parts are 128-bit ids.

## Ordering is per aggregate

Within an aggregate, events are strictly ordered: no gaps, no reordering, no concurrent writers. That ordering is the foundation that [optimistic concurrency](/concepts/optimistic-concurrency) and [reads](/concepts/reads-and-ordering) build on.

There is no global order across aggregates, and you do not want one; a global sequence is a global bottleneck. Order is exactly as wide as the aggregate.

## Aggregates map to shards

Each aggregate is assigned to a shard, a partition of the keyspace owned by one core, deterministically by a routing rule set on the server (by org, by type, or by aggregate id). Ordering holds within a shard, and so does the ability to write several aggregates [atomically](/concepts/consistency-boundaries): the aggregates in one atomic write must share a shard, which means the routing rule decides which aggregates can ever be co-committed.

## Cardinality is not your problem

Model one stream per whatever your domain actually has: one per user, per device, per order, per match. Memory stays bounded by the hot working set, not the total count, so millions of aggregates do not blow up the server. See [Durability and safety](/concepts/durability-and-safety) for how, and [Modeling aggregates](/guides/modeling) for how to choose the boundary.
