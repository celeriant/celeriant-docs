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

Each aggregate is assigned to a shard, a partition of the keyspace owned by one core. Placement is a modulo, not a hash: the server takes one id from the aggregate key, chosen by the routing rule set at cluster init (`org_id`, `aggregate_type_id`, or `aggregate_id`), and computes `id % shard_count` (the shard count defaults to the core count, one shard per core). Because it is a plain `%` on an id you control, you decide which aggregates co-locate. Ordering holds within a shard, and so does the ability to write several aggregates [atomically](/concepts/consistency-boundaries): the aggregates in one atomic write must share a shard, so the routing rule is how you place the aggregates that must be co-committed onto the same one.

## Cardinality is not your problem

Model one stream per whatever your domain actually has: one per user, per device, per order, per match. Memory stays bounded by the hot working set, not the total count, so millions of aggregates do not blow up the server. See [Durability and safety](/concepts/durability-and-safety) for how, and [Modeling aggregates](/guides/modeling) for how to choose the boundary.
