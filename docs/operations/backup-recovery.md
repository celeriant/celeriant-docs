---
title: Backup and recovery
---

# Backup and recovery

First, the thing that bites people: **S3 is not your backup.** In a Celeriant cluster S3 holds the leader lease and acts as a replication fallback when the follower is down. Those objects are operational, transient, and not a durable archive of your data. If you delete the bucket thinking it is a backup, you will be wrong.

## What is persisted, and where

- **The WAL, on each node's local disk**, under `--data-root`, one directory per shard. This is the durable copy of your events. On a two-node cluster there are two such copies, one per node.
- **Transient batches in S3**, only while the follower is unreachable, so an acknowledged write is never single-homed. The leader deletes them once the follower has caught up.

## Recovery within the cluster

This is automatic and is the common case:

- **A follower restarts**: it reads the S3 lease to find the leader, pulls anything it missed, and rejoins.
- **A leader restarts**: it boots, and the lease ensures the surviving node is the one writing, so there is no split-brain.
- On boot, each node validates its WAL (the [BLAKE3 chain](/concepts/audit-chain) detects corruption) and recovers it to rebuild in-memory state.

Losing one node is a non-event: the other keeps serving and the replacement catches up.

## Disaster recovery is yours to design

Cluster replication protects against losing a node. It does not protect against the things a backup is for: deleting the wrong data, a bad migration, a region loss, ransomware. For those you need a copy Celeriant does not manage. Options, in rough order of simplicity:

- Snapshot the `--data-root` volume on a schedule (filesystem or block-level snapshots). The WAL is append-only, which makes incremental snapshots cheap. Take the snapshot from a quiesced node or the follower where you can: a snapshot of a live, actively-written WAL may capture a torn tail. The BLAKE3 chain catches that on restore, but the tail may need truncating, so test the restore rather than assuming it.
- Run a downstream consumer that [watches](/concepts/watch) the log and archives events to cold storage you control.

Decide your RPO and test the restore. An untested backup is a guess.

:::info Pre-release
A first-class backup/export tool is not part of the pre-1.0 build. Until it lands, volume snapshots are the pragmatic path.
:::
