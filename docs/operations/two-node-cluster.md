---
title: Running a two-node cluster
---

# Running a two-node cluster

A leader and a follower, coordinated through S3. The leader takes writes and replicates each batch to the follower over a dedicated replication port; both `fdatasync` before the leader acknowledges. There is no third node and no consensus quorum: the [S3 lease](/operations/leader-election-s3) is the arbiter.

## Ports

Each node listens on:

- **client port** (default `10000`): where clients connect.
- **replication port** (default `10001`): leader-to-follower batch replication and heartbeats.
- **metrics port** (default `9090`): the Prometheus `/metrics` and `/health` endpoints. See [Monitoring](/operations/monitoring).

## Required configuration

A node in a cluster needs S3 turned on and an identity it advertises to its peer:

```bash
celeriant \
  --data-root /var/lib/celeriant \
  --client-port 10000 \
  --replication-port 10001 \
  --s3-enabled \
  --s3-region us-east-1 \
  --s3-bucket celeriant-prod \
  --advertised-client-address node-1.internal:10000 \
  --advertised-replication-address node-1.internal:10001
```

The advertised addresses are what each node publishes to the other through S3 membership, and what the leader returns in a `NotLeader` redirect. Set them to addresses the peer and your clients can actually reach (the load-balancer or internal DNS name), not `0.0.0.0`. Do not run `--standalone` here; that disables clustering.

## Sharing the bucket

Two clusters can share one bucket if you give each a distinct `--s3-subfolder`. Without that, they will fight over the same lease. For S3-compatible stores, set `--s3-endpoint-override` (and, for local MinIO only, `--s3-allow-http` and `--s3-skip-signature`).

## A local cluster to try

The source tree ships a `deploy/local-cluster` Docker Compose stack: two nodes, MinIO standing in for S3, and Prometheus, Loki, and Grafana for observability.

```bash
cd deploy/local-cluster
docker compose up -d --build
```

Node 1's client port is published on `10000`, node 2's on `10002`. It is the fastest way to watch a failover: stop the leader and read the role flip in Grafana.

## What happens when a node goes down

The leader keeps serving. While the follower is unreachable it replicates to S3 instead, which adds S3 latency to the write path until the follower returns and catches up. If the **leader** goes down, the follower takes over once the lease expires: writes pause for up to the S3 lease TTL (`--s3-lease-duration-ms`, 30 s by default), while reads from the survivor continue throughout. Lower the TTL for faster failover, raise it to tolerate longer S3 hiccups. See [Leader election and S3 leases](/operations/leader-election-s3) for the timing and [Upgrading](/operations/upgrading) for the rolling-restart procedure.
