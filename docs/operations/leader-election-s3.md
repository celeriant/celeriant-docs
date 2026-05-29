---
title: Leader election and S3 leases
---

# Leader election and S3 leases

Celeriant elects a leader with an S3 conditional write instead of a consensus protocol. One object in the bucket is the lease; whoever holds a valid lease is the leader. That is the whole mechanism, and it is why there is no Raft to misconfigure.

## How the lease works

The lease lives at a known key in the bucket. A node acquires or renews it with a conditional write (create-if-absent, or compare-and-swap on the object's ETag):

- No lease exists: a node creates it with itself as leader.
- A valid lease held by the other node: this node is the follower.
- The lease is expired, or this node already holds it: it renews or takes over with a CAS. If the CAS fails because the peer got there first, it becomes the follower.

Because the swap is conditional, two nodes cannot both win. The store that lies about conditional writes breaks this, which is why the bucket must genuinely support them.

## Two clocks, two jobs

There are two independent timers, and it helps to keep them straight:

- **Heartbeat** (interval 500ms, lease 1500ms by default): the leader heartbeats the follower over the replication connection. It is the fast path for detecting that the follower has fallen behind or gone away.
- **S3 lease** (30s TTL by default): the durable, partition-proof record of who is leader. It is what survives a total loss of inter-node connectivity.

The heartbeat keeps the cluster tight in the common case; the S3 lease is the backstop that prevents split-brain when the network partitions.

## Failover and split-brain

When the leader disappears, the follower waits out the lease (up to `--s3-lease-duration-ms`, 30 s by default), then takes it via CAS and starts accepting writes. That wait is the leader-failover write-outage window: reads from the follower continue throughout, writes pause until it takes the lease. The default trades failover speed for tolerance of S3 latency; tune it to your priorities. Note this is governed by the S3 lease, not the faster heartbeat, which detects a struggling follower rather than a dead leader.

A leader that cannot renew its lease fences itself and stops accepting writes, so you never get two writers. The lease, not the network, is the source of truth for who may write.

The fence is what guarantees there are never two writers; it is not a promise that an S3-only outage immediately stops the incumbent. A healthy leader-to-follower link sustains the leader's lease via heartbeats, so a leader that loses **only** S3 (follower still reachable) keeps serving — see "[the leader keeps serving](/concepts/durability-and-safety)" during an S3 outage. The self-fence is what fires when the leader can renew *neither* via S3 *nor* by heartbeat (i.e. it is isolated from both S3 and the follower), allowing a new leader to take over safely.

A long S3 outage stalls failover, because the lease lives in S3. It does not endanger acknowledged data, which is already on disk.

## What S3 needs

- **Conditional writes** (If-Match / If-None-Match). Non-negotiable; the lease is built on them. AWS S3 has them natively; verify any S3-compatible store.
- **IAM**: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket` on the bucket (and subfolder, if used).
- A bucket per cluster, or a distinct `--s3-subfolder` per cluster sharing one bucket.

S3 here is coordination and replication fallback, not your backup. See [Backup and recovery](/operations/backup-recovery).
