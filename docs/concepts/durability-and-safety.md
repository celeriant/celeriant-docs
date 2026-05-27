---
title: Durability and safety
---

# Durability and safety

What Celeriant guarantees, and the mechanism behind each guarantee. No slogans; every claim here is something you can reason about or test.

## An acknowledged write is on stable storage

Before the leader acknowledges a write, the batch is `fdatasync`'d to disk on the leader and on the follower. Two machines have it on durable media before your call returns. Pull the power on either node, on hardware that honors flush, and the write is still there.

When the follower is down, the leader ships the batch to S3 instead, so an acknowledged write still lives in two places: the surviving node's disk and S3. You are never acknowledging a write that exists in only one volatile place. That degraded path puts an S3 write on the ack, so write latency rises until the follower rejoins; see [Two-node cluster](/operations/two-node-cluster) for the operational detail.

## Direct I/O, because fsync can lie

Celeriant writes with Direct I/O and skips the kernel page cache. Buffered I/O can report a successful `fsync` and still lose the data when a later writeback fails; this is documented kernel behavior, not a hypothetical. Direct I/O avoids that whole class of silent loss.

It costs more per write, so the cost is amortized: concurrent writes are batched, and the batch is `fsync`'d and replicated once. See [Performance](/reference/performance).

## Thread-per-core, so whole bug classes do not exist

Each core owns its shard and runs single-threaded. There is no shared mutable state across cores on the write path, so the data races, lock-ordering deadlocks, and torn updates that thread-pool databases spend their lives chasing are designed out of that per-core path. Fewer places to be wrong is itself a safety property.

## Failover and its dependency

Leader election runs through an S3 conditional write that arbitrates a lease. Failover is a lease handoff, and it is off the write hot path. The honest dependency: a long S3 outage stalls failover, because that is where the lease lives. It does not put acknowledged data at risk; that is already on disk and, during a degraded window, in S3.

## Tamper evidence and encryption

Every event is hash-chained to its predecessor with BLAKE3, so any alteration of past events is detectable by recomputation. See [The audit chain](/concepts/audit-chain). Payloads can be [encrypted](/concepts/encryption) per event with AES-GCM, client-side, so the server stores ciphertext it cannot read.

## What it does not protect against

Durability is bounded by the envelope above: two nodes plus S3. Simultaneous, correlated loss of both nodes and S3 is outside it, as is anything upstream of the write (a bug that appends the wrong event is durably wrong). For disaster recovery beyond the cluster, see [Backup and recovery](/operations/backup-recovery).

:::info Pre-release
These guarantees hold in the current pre-1.0 build. The cluster and failover internals can still change before 1.0.
:::
