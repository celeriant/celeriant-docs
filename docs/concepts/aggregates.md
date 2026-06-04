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
- **aggregate type** groups aggregates of the same kind: `Orders`, `Accounts`, `Devices`. Schemas are stored against aggregate types.
- **aggregate id** identifies the individual stream.

So `Acme / Orders / order-4821` is one order's event stream. All three parts are 128-bit ids.

## Ordering is per aggregate

Within an aggregate, events are strictly ordered: no gaps, no reordering, no concurrent writers. That ordering is the foundation that [optimistic concurrency](/concepts/optimistic-concurrency) and [reads](/concepts/reads-and-ordering) build on.

## Aggregates map to shards

Each aggregate is assigned to a shard, a partition of the keyspace owned by one core. Placement is a plain modulo, not an opaque hash: the server picks one id from the aggregate key per the routing rule set at cluster init (`org_id`, `aggregate_type_id`, or `aggregate_id`), and computes `id % shard_count`. Shard count defaults to one shard per core.

The choice to use `%` over the raw id is deliberate. It hands placement back to you. A hash would smear aggregates uniformly and you would never get two specific aggregates onto the same shard on purpose; `%` lets you do exactly that, because you control the id. Pick `aggregate_id = 1000` and `aggregate_id = 1004` on a 4-shard cluster and both land on shard 0. That co-location is the only way to write more than one aggregate [atomically](/concepts/consistency-boundaries): the engine rejects any multi-aggregate write whose targets span shards (`ShardRoutingMultipleShards`, error 9001). Picking the routing rule, and the ids within it, is how you draw your atomic boundaries.

Three rules, three placement strategies:

- `org_id` - every aggregate inside a tenant shares a shard. Pick this if your invariants are per-tenant (a transfer between two accounts in the same org, a credit and a hold on one customer's record). The cost: one tenant's writes never parallelise across cores.
- `aggregate_type_id` - every aggregate of a type shares a shard. Useful if you mostly co-commit across aggregates within a type.
- `aggregate_id` (default) - each aggregate goes to whatever shard its id mods to. Even distribution, full parallelism. Multi-aggregate atomic writes still work, but only between ids you have deliberately co-located (`id_a % shards == id_b % shards`). Plan your id allocation if you need this; otherwise the writes will fail.

Ordering is technically on `wal_seq` which is per-shard. There is no global order across aggregates, and you do not want one; a global sequence is a global bottleneck. Order is exactly as wide as the aggregate.

## Cardinality is not your problem

Model one stream per whatever your domain actually has: one per user, per device, per order, per match. Memory stays bounded by the hot working set, not the total count, so millions of aggregates do not blow up the server. See [Durability and safety](/concepts/durability-and-safety) for how, and [Modeling aggregates](/guides/modeling) for how to choose the boundary.
