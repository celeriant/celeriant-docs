---
title: Monitoring and observability
---

# Monitoring and observability

The server exposes Prometheus metrics and a health endpoint on the metrics port (default `9090`), enabled by default.

- `GET /metrics`: Prometheus text format.
- `GET /health`: JSON, `{"status":"ok","node_id":"...","shards":N}`. Use it for load-balancer and orchestrator probes.

:::warning
The metrics port is plaintext HTTP, unauthenticated, and binds all interfaces regardless of `--listen-address`. `/metrics` exposes the node id, shard count, and full operational detail. Keep it on a private network or firewall it.
:::

## The metrics that matter

There are many; these are the ones to put on a dashboard and alert on.

**Is the cluster healthy**

- `celeriant_node_role`: 1 on the leader, 0 on the follower. Exactly one leader should report 1. Two is split-brain; zero means nobody holds the lease.
- `celeriant_leader_elections_total`: should be flat. A climbing count means the cluster is flapping.
- `celeriant_heartbeat_failures_total` and `celeriant_follower_auto_fence_total`: rising values mean the follower is struggling to keep up or the link is bad.

**Is replication keeping up**

- `celeriant_replication_follower_pressured`: 1 means the follower is falling behind and S3 fallback is imminent.
- `celeriant_replication_s3_fallbacks_total`: every increment is a window where writes took the slower S3 path. Occasional is fine; sustained means the follower cannot keep up.
- `celeriant_replication_queue_bytes`: the backlog awaiting the follower.

**Latency and throughput**

- `celeriant_write_duration_seconds`, `celeriant_read_duration_seconds`: end-to-end histograms. Watch p99.
- `celeriant_fsync_duration_seconds`, `celeriant_replication_duration_seconds`: where write latency comes from.
- `celeriant_writes_total`, `celeriant_write_errors_total`, `celeriant_reads_total`.

**Resource health**

- `celeriant_client_connections_active`, `celeriant_watch_subscribers_active`.
- `celeriant_cache_*_hits_total` / `_misses_total`: a collapsing hit rate signals the working set has outgrown the memory budget.
- `celeriant_shard_panics_total`, `celeriant_shard_restarts_total`: should be zero.

## A starting alert set

- `celeriant_node_role` summed across the cluster is not exactly 1.
- `rate(celeriant_leader_elections_total)` above zero for more than a minute.
- `rate(celeriant_replication_s3_fallbacks_total)` sustained.
- write p99 from `celeriant_write_duration_seconds` over your SLO.
- any `celeriant_shard_panics_total`.

The `deploy/local-cluster` stack wires Prometheus, Loki, and Grafana against both nodes, which is the quickest way to see these in motion.
