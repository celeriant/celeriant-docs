---
title: Consistency boundaries
---

# Consistency boundaries

A consistency boundary is the set of aggregates a single write commits atomically: all of them land, or none do. Most event stores draw this at one aggregate. Celeriant draws it at one shard, which can hold many aggregates, and the routing rule is how you decide which ones.

## Beyond the single aggregate

Classic event sourcing draws the boundary at one aggregate: each write touches exactly one stream, and any invariant spanning two becomes a saga. Celeriant lets a single write carry [conditional](/concepts/optimistic-concurrency) writes to several aggregates and commit them atomically.

The textbook case is a transfer: debit one account, credit another, both or neither. You express it as one write carrying both events, each guarded on its own version. If either guard fails, the whole write is rejected and nothing is appended to either stream. No saga, no compensating action, no half-applied transfer to clean up. The [multi-aggregate writes guide](/guides/multi-aggregate-writes) has the code.

If you have time, watch Sara Pellegrini & Milan Savic's presentation (https://www.youtube.com/watch?v=IgigmuHHchI).

## The boundary is a shard

A single atomic write spans one shard. That is the line. Cross-shard atomic writes would reintroduce the distributed transaction this database exists to avoid, so the engine rejects them outright (error 9001, `ShardRoutingMultipleShards`).

Which aggregates share a shard is something you decide. Placement is `id % shard_count`, where `id` is one part of the aggregate key chosen by the routing rule set at cluster init. Plain `%` on an id you control, not a hash that scrambles things. So you place co-committed aggregates onto the same shard on purpose.

Pick the rule that matches the invariants you actually enforce together:

- **`org_id`** - every aggregate inside one tenant lands on one shard. Bank-style transfers between accounts in the same org: trivial. Cost: that tenant's writes serialise on one core. Right call when invariants are per-tenant and tenant concurrency is bounded.
- **`aggregate_type_id`** - every aggregate of a type lands on one shard. Right call when atomic writes span aggregates of the same type and you want all of that type together for locality.
- **`aggregate_id`** - even distribution by aggregate id. Right call when most writes are single-aggregate and you want the cores. Multi-aggregate writes still work, but you have to *engineer* the id space so the aggregates that need to commit together hash to the same shard: `aggregate_id = 1000` and `aggregate_id = 1004` on a 4-shard cluster both land on shard 0, so they can be co-committed. If you skip this and pick ids at random, multi-aggregate writes will fail with 9001.

Choosing the rule is the architectural decision. Choosing the ids is the operational discipline that follows from it. See [Atomic multi-aggregate writes](/guides/multi-aggregate-writes) for the failure mode and the fix. If an invariant genuinely spans shards no matter how you route, this is the wrong tool for that particular write; coordinate it outside the store.
