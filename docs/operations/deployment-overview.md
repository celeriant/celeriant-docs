---
title: Deployment overview
---

# Deployment overview

Celeriant runs in one of two shapes. Pick deliberately; they have different durability and availability stories.

## Standalone

One process, no replication, no S3. Writes are `fdatasync`'d to local disk and acknowledged. It is the right shape for development and for workloads that can tolerate the durability of a single machine.

What you give up: there is no failover and no second copy. If that node's disk dies, the data on it is gone. See [Running a single node](/operations/single-node).

## Two-node cluster

A leader and a follower, with S3 as the coordination layer. The leader takes writes and replicates each batch to the follower; both `fdatasync` before the leader acknowledges. Leader election runs through an S3 lease, so there is no Raft and no Zookeeper. See [Running a two-node cluster](/operations/two-node-cluster) and [Leader election and S3 leases](/operations/leader-election-s3).

This is the production shape. It survives a node loss, does rolling [upgrades](/operations/upgrading) with no read downtime and one brief write pause at leader handoff, and keeps an acknowledged write in two places: the peer's disk, or S3 while the peer is down.

## What both need

- **A Direct-I/O-capable data directory.** The server validates `O_DIRECT` at boot and refuses to start if the filesystem silently falls back to buffered I/O. ext4 and XFS work; many overlay and encrypted filesystems do not.
- **`seccomp=unconfined`** when running in a container, because the storage engine uses `io_uring`.
- **Linux.** The server is Linux-only.

## What only the cluster needs

- **An S3 bucket that supports conditional writes** (If-Match / If-None-Match). AWS S3 supports this natively; for S3-compatible stores like MinIO, verify it before relying on it. The lease that prevents split-brain is built on it. See [Leader election and S3 leases](/operations/leader-election-s3).
- **Synchronized clocks (NTP).** The lease checks assume node clocks agree within `--max-clock-drift-ms` (500 ms by default). A node with a skewed clock boots with only a warning and then flaps elections, so treat NTP (chrony, systemd-timesyncd, or ntpd) as a hard prerequisite, not a nicety.

## Sizing

Shards default to the CPU count; one core owns one shard. Memory defaults to about 80% of available RAM for caches, and is bounded regardless of how many aggregates you store. NVMe is strongly preferred: the whole design assumes fast local disk. See [Configuration](/operations/configuration) to tune any of this.
