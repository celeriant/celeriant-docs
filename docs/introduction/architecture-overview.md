---
title: Architecture at a glance
---

# Architecture at a glance

The whole shape in one page. Each piece has its own [concept page](/concepts/event-sourcing); this is the map.

## Thread-per-core

Celeriant is a Rust server where each core owns a [shard](/concepts/aggregates) and runs single-threaded. There is no shared mutable state across cores on the write path, which removes the locking and the concurrency-bug classes that thread-pool databases spend their lives fighting. Aggregates map to shards deterministically by a routing rule set at cluster init.

## The write path

A write to an [aggregate](/concepts/aggregates) is, by default, conditional: it commits only if the aggregate is still at the version you read ([optimistic concurrency](/concepts/optimistic-concurrency)). On the leader, the batch is written with Direct I/O, `fdatasync`'d to disk, replicated to the follower, which also `fdatasync`'s, and only then acknowledged. So an acknowledged write is durable on two machines before your call returns. See [Durability and safety](/concepts/durability-and-safety).

Direct I/O is deliberate: it skips the kernel page cache, which can report a clean `fsync` and still lose data. The per-write cost is amortized by batching concurrent writes into one fsync and one replication round.

## The cluster

Two nodes, a leader and a follower, with no Raft and no Zookeeper. Leadership is an S3 lease acquired by conditional write; failover is a lease handoff. When the follower is down, the leader replicates to S3 instead, so an acknowledged write is never single-homed. See [Leader election and S3 leases](/operations/leader-election-s3).

## Storage and memory

The storage engine is built for very high stream cardinality. It indexes with bloom filters and falls back to a reverse scan of the log, with hot data in an LRU cache, so memory is bounded by the working set rather than the total number of aggregates. The design holds millions of aggregates and billions of events on a 32 GB box, with the log on NVMe, at the cost of slightly higher latency on the first read of a cold aggregate. See [Performance](/reference/performance).

## Reading

Reads are per-aggregate, ordered, and filtered by offset and event type ([Reads and ordering](/concepts/reads-and-ordering)). There is no query language, because Celeriant is the write side; you project the log into a read store and query that ([Building a read model](/guides/building-a-projection)). For real-time, a [watch](/concepts/watch) streams change notifications and your projection follows the tail.

## Where to go next

- The model: [Event sourcing and CQRS](/concepts/event-sourcing).
- The guarantees: [Durability and safety](/concepts/durability-and-safety).
- Running it: [Deployment overview](/operations/deployment-overview).
- Using it: the [Quickstart](/get-started/quickstart).
