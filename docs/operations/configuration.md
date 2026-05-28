---
title: Configuration reference
---

# Configuration reference

Every option is both a command-line flag and an environment variable: `--data-root` is `CELERIANT_DATA_ROOT`, `--num-shards` is `CELERIANT_NUM_SHARDS`, and so on. Flags suit a hand-run binary; the env vars suit containers. This page lists the ones you operate with; the binary's `--help` is the exhaustive list.

## Core

| Flag | Default | Notes |
| --- | --- | --- |
| `--data-root` | `data` | Data directory. Must be on an `O_DIRECT`-capable filesystem. |
| `--listen-address` | `0.0.0.0` | Bind address. |
| `--client-port` | `10000` | Client connections. |
| `--num-shards` | CPU count | One core per shard. |
| `--routing-rule` | `aggregate_id` | `org_id`, `aggregate_type_id`, or `aggregate_id`. Fixed at cluster init; changing it means re-sharding. Decides which aggregates can be [co-committed](/concepts/consistency-boundaries). |
| `--standalone` | `false` | Single node, no replication or S3. |
| `--log-level` | `info` | `trace`, `debug`, `info`, `warn`, `error`. |

## Cluster and failover

| Flag | Default | Notes |
| --- | --- | --- |
| `--replication-port` | `10001` | Leader-to-follower replication and heartbeats. |
| `--advertised-client-address` | derived | What clients are told to reach; set behind a proxy or LB. |
| `--advertised-replication-address` | derived | What the peer is told to reach. |
| `--heartbeat-interval-ms` | `500` | Leader heartbeat cadence. |
| `--heartbeat-timeout-ms` | = interval | Per-heartbeat soft timeout. Set below `--heartbeat-lease-duration-ms`. |
| `--heartbeat-hard-timeout-multiplier` | `4` | Hard cap for kernel-blocked kTLS sends that ignore the soft timeout. |
| `--heartbeat-lease-duration-ms` | `1500` | Silence before the follower's heartbeat lease expires. |
| `--heartbeat-starve-threshold-ms` | `500` | While a heartbeat is in flight longer than this, reject new writes with `FollowerHeartbeatStarved` so the NIC has bandwidth for the ack. `0` disables. |
| `--s3-lease-duration-ms` | `30000` | Durable leader-lease TTL. See [leader election](/operations/leader-election-s3). |
| `--max-clock-drift-ms` | `500` | Slack added to lease checks. NTP is required; flapping elections almost always trace to drift. |

## Write pipeline batching

These three knobs control how aggressively the leader amortises fsync and replication. Wider windows = more throughput per write, more latency per individual write. Tune to your write-latency SLO.

| Flag | Default | Notes |
| --- | --- | --- |
| `--fsync-delay-us` | `17000` | Window during which incoming writes are coalesced into one fsync. |
| `--replication-delay-us` | `17000` | Same idea, for the replication send. |
| `--s3-replication-delay-us` | `500000` | Same idea, while in S3 fallback. Larger to keep S3 cost down and avoid starving lease renewal. |
| `--replication-rollback-cooldown-us` | `500000` | After a replication rollback, reject new writes with `ReplicationBackpressure` for this long to drain the pending queue and prevent rollback storms. |
| `--s3-max-concurrent-fallback-uploads` | `128` | Cap on parallel S3 fallback uploads across all shards. Lower for MinIO or local-LAN where saturation can starve lease renewal. |
| `--internode-max-request-size` | `64 MiB` | Cap on a single replication batch payload. Also bounds a single promotion catch-up batch. |

## S3

| Flag | Default | Notes |
| --- | --- | --- |
| `--s3-enabled` | `false` | Required for a cluster. Needs region and bucket. |
| `--s3-region` / `--s3-bucket` | none | The bucket must support conditional writes. |
| `--s3-access-key-id` / `--s3-secret-access-key` | none | Or the usual AWS credential chain. |
| `--s3-subfolder` | none | Isolate multiple clusters in one bucket. |
| `--s3-endpoint-override` | none | For MinIO and other S3-compatible stores. |
| `--s3-allow-http` / `--s3-skip-signature` | `false` | Local testing only. |

## Security

| Flag | Default | Notes |
| --- | --- | --- |
| `--tls-mode` | `disabled` | `disabled` or `strict`. See [TLS and mTLS](/operations/tls-mtls). |
| `--tls-ca-cert` / `--tls-node-cert` / `--tls-node-key` | none | The trust root and node identity. |
| `--tls-client-auth` | `require` | `require`, `optional`, `none`. |
| `--require-client-identity` | `false` | Force the [identity](/concepts/identity) handshake. |

## Storage and memory

| Flag | Default | Notes |
| --- | --- | --- |
| `--memory-consumption-percent` | `80` | Share of RAM for caches (1-95). |
| `--memory-budget-bytes` | auto | Explicit override. |
| `--shard-log-preallocate-bytes` | `1GiB` | Size of each WAL file. |
| `--wal-compression-level` | `3` | zstd level for the WAL. |
| `--compaction-check-interval-secs` | `7200` | How often to scan for reclaimable space. |
| `--compaction-temp-dir` | shard dir | Must be on the same filesystem as `--data-root`. |

## Limits and observability

| Flag | Default | Notes |
| --- | --- | --- |
| `--max-request-size` | `16 MiB` | Per client request. |
| `--max-response-size` | `64 MiB` | Per response. |
| `--max-requested-latency-ms` | `2000` | Cap on a [watch](/concepts/watch) latency request. |
| `--metrics-enabled` | `true` | Prometheus `/metrics` and `/health`. |
| `--metrics-port` | `9090` | See [Monitoring](/operations/monitoring). |

## Tuning notes

- **Write throughput vs latency.** `--fsync-delay-us` and `--replication-delay-us` are the main knobs. The defaults (17 ms each) target high throughput. If your SLO is single-digit-ms p99, lower both to your latency budget minus your fsync time minus network RTT. You will give up throughput.
- **S3 fallback windows hurt.** While the follower is unreachable, every write pays `--s3-replication-delay-us` (default 500 ms) on the ack. This is intentional — bigger batches mean fewer S3 PUTs. If your follower is flapping briefly, the cluster recovers; if it is down for hours, plan for elevated write latency and budget S3 costs accordingly.
- **NTP is required.** `--max-clock-drift-ms` is slack, not the budget. If your nodes drift more than this between renewals, lease checks fail and you get election flaps. Check `chronyc tracking` on both nodes before opening a bug.
- **`reserve_coordinator_shard`** isolates shard 0 for heartbeat/schema work on dense-core boxes. Useful if you see one shard hot from coordination traffic alone.
