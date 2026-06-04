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

## Two leases, two jobs

There are two independent leases. The whole failover story falls out of keeping them straight:

- **Heartbeat lease** (`--heartbeat-lease-duration-ms`, 1500ms; interval 500ms): the leader heartbeats the follower over the replication connection, and every heartbeat carries the follower's lease forward. This is the live authority in normal operation. While heartbeats arrive, the follower knows the leader is alive and stays a follower.
- **S3 lease** (`--s3-lease-duration-ms`, 30s by default): the durable, partition-proof record of who may write. It is the arbiter for the cold cases the heartbeat cannot cover, and what survives a total loss of inter-node connectivity.

The part the front page never says: in healthy two-node operation the leader does not renew the S3 lease at all. The heartbeat carries authority, so the S3 lease object just sits there long expired. The leader only writes S3 when it has to prove authority without the follower, which is exactly when it matters. Steady-state leasing therefore costs effectively nothing in S3 requests.

## Failover and split-brain

Failover is bounded by the heartbeat lease, not the S3 lease. When the leader dies, heartbeats stop, the follower's heartbeat lease expires within `--heartbeat-lease-duration-ms` (1.5s by default), and the follower challenges the S3 lease with a CAS. Because that S3 lease has been sitting expired through normal operation, the CAS wins immediately and the follower starts accepting writes. In practice that is around 1.3s, not 30s. Reads from the follower continue throughout; only writes pause, and only for that window.

The 30s S3 TTL bounds failover only in the cold cases the heartbeat cannot cover: a fresh boot with no heartbeat history, or the brief window right after a promotion before heartbeats are flowing. Outside those, the heartbeat lease times failover. Lower `--heartbeat-lease-duration-ms` for faster detection at the cost of tolerance for replication-link jitter.

A leader that cannot renew its lease fences itself and stops accepting writes, so you never get two writers. The lease, not the network, is the source of truth for who may write.

The fence is what guarantees there are never two writers; it is not a promise that an S3-only outage immediately stops the incumbent. A healthy leader-to-follower link sustains the leader's lease via heartbeats, so a leader that loses **only** S3 (follower still reachable) keeps serving - see "[the leader keeps serving](/concepts/durability-and-safety)" during an S3 outage. The self-fence is what fires when the leader can renew *neither* via S3 *nor* by heartbeat (i.e. it is isolated from both S3 and the follower), allowing a new leader to take over safely.

A long S3 outage stalls failover, because the lease lives in S3. It does not endanger acknowledged data, which is already on disk.

The fencing rule is the one thing in this design that absolutely cannot be wrong, so it is attacked directly: the chaos harness SIGSTOPs the leader for longer than its lease, lets the follower promote, then resumes the old leader and asserts no two-writer divergence ever reaches the durable log. See [Correctness testing](/concepts/correctness-testing).

## What S3 needs

- **Conditional writes** (If-Match / If-None-Match). Non-negotiable; the lease is built on them. AWS S3 has them natively; verify any S3-compatible store.
- **IAM**: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket` on the bucket (and subfolder, if used).
- A bucket per cluster, or a distinct `--s3-subfolder` per cluster sharing one bucket.

S3 here is coordination and replication fallback, not your backup. See [Backup and recovery](/operations/backup-recovery).
