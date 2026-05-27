---
title: Troubleshooting
---

# Troubleshooting

Symptom, cause, fix. For the full error catalogue see the [error codes reference](/reference/error-codes).

## The server will not start

**"Direct I/O" / `O_DIRECT` probe failure.** The `--data-root` filesystem silently downgrades `O_DIRECT` to buffered I/O, and the server refuses to run on it because that would void the durability guarantee. Move the data root to ext4 or XFS on a real block device; avoid overlay filesystems and some encrypted mounts.

**Cross-device compaction error (EXDEV).** `--compaction-temp-dir` is on a different filesystem from `--data-root`. Compaction swaps segments with an atomic `rename(2)`, which cannot cross devices. Put the temp dir on the same filesystem.

**Container exits immediately.** The storage engine needs `io_uring`; run the container with `--security-opt seccomp=unconfined`.

## Writes are being rejected

**`NotLeader` (2011).** The write hit a follower. The official client pools follow the redirect to the leader automatically; if you see this in your code, you are using a raw protocol client and must handle the redirect. Check `celeriant_node_role` to confirm which node is leader.

**`OptimisticConcurrencyViolation` (2003).** Not an operational fault: another writer moved the aggregate past your expected version. Re-read and retry. See [Optimistic concurrency](/concepts/optimistic-concurrency).

**Replication backpressure / heartbeat-starved rejections.** The follower cannot keep up, so the leader is shedding load to protect durability and the ack path. Look at `celeriant_replication_follower_pressured` and `celeriant_replication_queue_bytes`. Usual causes: the follower's disk or network is slower than the leader's write rate, or the follower is mid-catch-up after a restart. It self-resolves when the follower catches up; if it is chronic, the follower is undersized.

## The cluster is unhealthy

**No leader (`celeriant_node_role` sums to 0).** Nobody holds the lease. Check S3 reachability and credentials from both nodes, and that the bucket supports conditional writes. A long S3 outage stalls election by design.

**Two leaders, or flapping elections.** `celeriant_leader_elections_total` climbing. Check for clock skew beyond `--max-clock-drift-ms`, and that two clusters are not sharing a bucket without distinct `--s3-subfolder` values. Confirm both nodes advertise addresses the other can actually reach.

**Sustained S3 fallbacks.** `celeriant_replication_s3_fallbacks_total` rising steadily means the follower is effectively absent from the leader's point of view. Treat it as a down follower: check the replication port, TLS between nodes, and the follower's health.

## Clients cannot connect or authenticate

**Identity handshake errors (10001-10004).** `IdentifyInvalidNonce` (10001): an expired or malformed nonce, usually a client clock problem. `IdentifyInvalidSignature` (10002): the signature did not verify against the public key. `IdentifyMismatch` (10003): the `clientId` in a write does not match the identified client. `IdentifyRequired` (10004): the server runs with `--require-client-identity` and the client sent no identity. See [identity](/concepts/identity).

**TLS handshake failures.** With `--tls-mode strict` the client must speak TLS and, under `--tls-client-auth require`, present a cert signed by the trusted CA. Verify the CA chain on both sides; if you split trust with `--tls-intracluster-ca-cert`, confirm clients are signed by the client CA, not the intracluster one.

## When in doubt

Turn up `--log-level debug`, watch the [metrics](/operations/monitoring), and reproduce against the `deploy/local-cluster` stack where you can fail nodes safely.
