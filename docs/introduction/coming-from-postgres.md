---
title: Coming from Postgres
---

# Coming from Postgres

You already did the hard part. You write events first, the events are your source of truth, and you project state from them: an events table, a version column for optimistic concurrency, indexes on aggregate id and event type, maybe [Marten](https://martendb.io/) on top. The model is right. Celeriant does not ask you to change it; it changes the engine underneath it.

## Where it breaks

The conditional insert that enforces your invariant is exactly the operation Postgres struggles to do at volume. Around 10k to 20k conditional writes a second you hit a wall: commit-fsync latency on every write, lock contention on hot aggregates, MVCC bloat, and the vacuum debt that builds underneath and turns into runaway IOPS. The engine was not built to be a high-throughput append-only log.

Celeriant keeps the model and changes the engine: thread-per-core, Direct I/O, batched fsync, and a storage design whose [memory is bounded by the hot working set](/concepts/durability-and-safety), not total cardinality. See the [Performance](/reference/performance) numbers.

## What maps to what

| Postgres event sourcing | Celeriant |
| --- | --- |
| `events` table | The append-only log itself |
| `aggregate_id` column + index | Native [aggregate](/concepts/aggregates) addressing, no index to maintain |
| Version column + conditional insert | [Aggregate version + conditional append](/concepts/optimistic-concurrency), first-class |
| Unique constraint for dedup | [Idempotent retries](/concepts/idempotent-writes) via client sequence numbers |
| `LISTEN` / `NOTIFY` or polling | The [watch API](/concepts/watch) |
| Projections in the same database | A read model you project into your read store |
| `VACUUM`, autovacuum tuning, IOPS dread | Gone; the log does not accumulate dead tuples |

## What you gain, what you give up

Gain: throughput, predictable latency, durability that does not depend on page-cache writeback, and millions of aggregates without the index falling out of RAM.

Give up: SQL on the write store. Celeriant reads are per-aggregate, by offset and event type, not ad-hoc queries. You keep Postgres on the read side, where it excels as a projection target. And transactional reads across many rows in one query: per-aggregate reads stay current with just-in-time catch-up, but cross-entity transactional snapshots are what Postgres is for. See [when not to use it](/introduction/when-not-to-use).

Next: the [Quickstart](/get-started/quickstart), or [Optimistic concurrency](/concepts/optimistic-concurrency).
